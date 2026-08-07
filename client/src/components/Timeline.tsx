// Panel derecho: timeline del Gantt. Barras alineadas con las filas del grid,
// escala Day/Week/Month, marcador "hoy", milestones como rombo y flechas de
// dependencia (SVG). El scroll vertical se sincroniza con el grid (ver App).
// Las barras se mueven y se redimensionan arrastrando (el gesto vive en useBarDrag).
import { forwardRef, memo, useMemo } from "react";
import type { Task } from "../types.ts";
import { useUI } from "../store.ts";
import { useCriticalPath, useParentIds, useTaskMutations } from "../queries.ts";
import { buildTimeScale } from "../lib/timeScale.ts";
import { barColorClass } from "../lib/barColors.ts";
import { BAR_TITLE_GAP, fitsInBar } from "../lib/barTitle.ts";
import { ROW_H, HEAD_H } from "../lib/layout.ts";
import { useBarDrag } from "./useBarDrag.ts";

type Geom = { startX: number; endX: number; cy: number; isMilestone: boolean };

// Rombo del milestone: cuadro de lado MS_SIZE rotado 45°. La distancia del centro
// a cada vértice (izq/der) es la semidiagonal = MS_SIZE * √2 / 2.
const MS_SIZE = ROW_H / 2;
const MS_HALF_DIAG = MS_SIZE * Math.SQRT1_2;

// Aire que deja el relleno de avance por dentro de la barra (los mismos px arriba,
// abajo y a la izquierda; el CSS pone los tres, acá se descuenta el ancho útil). El
// relleno nunca toca el borde: por eso se lee como "barra con algo adentro" y no como
// una barra de otro color.
const FILL_INSET = 2;

const TimelineImpl = forwardRef<HTMLDivElement, { tasks: Task[] }>(function Timeline(
  { tasks },
  ref,
) {
  const zoom = useUI((s) => s.zoom);
  const selectedId = useUI((s) => s.selectedId);
  const select = useUI((s) => s.select);
  const showCritical = useUI((s) => s.showCritical);
  const { data: criticalSet } = useCriticalPath(showCritical);
  const { patch } = useTaskMutations();
  const isCritical = (id: number) => showCritical && !!criticalSet?.has(id);

  // "Hoy" en medianoche local; solo para el marcador.
  const today = useMemo(() => new Date(), []);
  // La escala se construye con las tareas del server (no con el preview del arrastre)
  // para que el timeline no se re-encuadre debajo del puntero en medio del gesto.
  const scale = useMemo(() => buildTimeScale(tasks, zoom, today), [tasks, zoom, today]);

  const parentIds = useParentIds();

  // Arrastre de las barras (estado del gesto, listeners y cursor: ver useBarDrag).
  const { preview, begin: beginDrag } = useBarDrag(scale.dayWidth, (id, data) =>
    patch.mutate({ id, data }),
  );

  // Filas a dibujar: las del server, con el preview del arrastre aplicado a la que se
  // mueve, así la barra sigue al puntero sin esperar al server.
  const rows = useMemo(
    () =>
      preview
        ? tasks.map((t) => (t.id === preview.id ? { ...t, start: preview.start, end: preview.end } : t))
        : tasks,
    [tasks, preview],
  );

  // Geometría por tarea (índice de fila = posición en el array, ya ordenado).
  const geom = useMemo(() => {
    const map = new Map<number, Geom>();
    rows.forEach((t, i) => {
      const cy = i * ROW_H + ROW_H / 2;
      if (!t.start || !t.end) {
        map.set(t.id, { startX: 0, endX: 0, cy, isMilestone: t.isMilestone });
        return;
      }
      if (t.isMilestone) {
        // Milestone: centrado en la columna de su día. Los puntos de conexión de
        // las flechas son los VÉRTICES del rombo (no el centro), para que la flecha
        // termine en el vértice: izquierdo = inicio (FS/SS), derecho = fin (FF).
        const center = scale.xOf(t.start) + scale.dayWidth / 2;
        map.set(t.id, {
          startX: center - MS_HALF_DIAG, // vértice izquierdo
          endX: center + MS_HALF_DIAG, // vértice derecho
          cy,
          isMilestone: true,
        });
        return;
      }
      const startX = scale.xOf(t.start);
      const endX = scale.xOf(t.end) + scale.dayWidth; // borde derecho del día de fin
      map.set(t.id, { startX, endX, cy, isMilestone: false });
    });
    return map;
  }, [rows, scale]);

  // Rótulos de barra (campo "Bar title"). Se resuelve acá, y no dentro del map de las
  // barras, porque el que NO entra se dibuja en su propia capa: va después de las
  // flechas para que no le cruce una línea por encima del texto.
  const barTitles = useMemo(() => {
    const map = new Map<number, { text: string; inside: boolean; x: number; cy: number }>();
    for (const t of rows) {
      // En una fila padre no se dibuja: su barra es un resumen de los hijos. El valor
      // sigue guardado —si vuelve a ser hoja, reaparece—, solo se oculta.
      if (parentIds.has(t.id)) continue;
      const text = (t.barTitle ?? "").trim();
      if (!text || !t.start || !t.end) continue;
      const g = geom.get(t.id);
      if (!g) continue;
      // El rombo de un milestone no tiene ancho donde escribir: siempre afuera.
      const inside = !t.isMilestone && fitsInBar(text, Math.max(2, g.endX - g.startX));
      map.set(t.id, { text, inside, x: g.endX + BAR_TITLE_GAP, cy: g.cy });
    }
    return map;
  }, [rows, geom, parentIds]);

  const bodyHeight = tasks.length * ROW_H;

  // Las Dependencies vienen en ID VISIBLE (order+1). Mapa seq → id interno.
  const idBySeq = useMemo(
    () => new Map(tasks.map((t) => [t.order + 1, t.id])),
    [tasks],
  );

  // Flechas de dependencia.
  const arrows = useMemo(() => {
    const paths: { d: string; key: string }[] = [];
    const stub = 10; // saliente desde el borde de la barra
    // Tramo recto final, el que le da dirección a la punta. Tiene que ser MÁS LARGO
    // que la cabeza de la flecha: la punta ocupa markerWidth × stroke-width
    // (7 × 1.4 ≈ 10px, porque markerUnits es strokeWidth por defecto) hacia atrás
    // desde el vértice. Si el tramo es más corto, la cabeza se pasa de la esquina y el
    // tramo anterior entra por el lado DIAGONAL del triángulo en vez de por su lado
    // vertical. Con 14 quedan ~4px de línea recta visibles antes de la cabeza.
    const HEAD_LEN = 10;
    const entry = HEAD_LEN + 4;
    for (const t of tasks) {
      // Una fila padre no puede ser sucesora: sus fechas son roll-up de los hijos y el
      // scheduler no la programa, así que dibujar la flecha afirmaría algo que no pasa.
      // (Sí puede ser PREDECESORA: eso el scheduler lo respeta.)
      if (parentIds.has(t.id)) continue;
      const succ = geom.get(t.id);
      if (!succ || (!t.start && !t.end)) continue;
      for (const dep of t.deps) {
        const predId = idBySeq.get(dep.predId); // dep.predId es un ID visible
        if (predId == null) continue;
        const pred = geom.get(predId);
        if (!pred) continue;
        let x1: number, x2: number;
        if (dep.type === "SS") {
          x1 = pred.startX;
          x2 = succ.startX;
        } else if (dep.type === "FF") {
          x1 = pred.endX;
          x2 = succ.endX;
        } else {
          x1 = pred.endX; // FS
          x2 = succ.startX;
        }
        const y1 = pred.cy;
        const y2 = succ.cy;
        let d: string;
        if (dep.type === "FF") {
          // Une los FINES (bordes derechos): enruta por FUERA, a la derecha de ambas
          // barras, a `entry` del más lejano para que la cabeza entre derecha.
          const goRight = Math.max(x1, x2) + entry;
          d = `M ${x1} ${y1} H ${goRight} V ${y2} H ${x2}`;
        } else if (dep.type === "SS") {
          // Une los INICIOS (bordes izquierdos): enruta por FUERA, a la izquierda de ambas barras.
          const goLeft = Math.min(x1, x2) - entry;
          d = `M ${x1} ${y1} H ${goLeft} V ${y2} H ${x2}`;
        } else if (x2 >= x1 + stub + entry) {
          // FS con espacio: sale del fin del predecesor (derecha), baja, y entra al
          // inicio del sucesor por la IZQUIERDA (o sea, por fuera de la barra).
          d = `M ${x1} ${y1} H ${x1 + stub} V ${y2} H ${x2}`;
        } else {
          // FS sin espacio (el sucesor arranca donde termina el predecesor, o antes):
          // hay que rodear. Si se bajara en línea recta, el último tramo iría de
          // derecha a izquierda y la punta entraría por DENTRO de la barra del sucesor.
          const midY = (y1 + y2) / 2; // entre las dos filas
          d = `M ${x1} ${y1} H ${x1 + stub} V ${midY} H ${x2 - entry} V ${y2} H ${x2}`;
        }
        paths.push({ d, key: `${dep.predId}-${t.id}-${dep.type}` });
      }
    }
    return paths;
  }, [tasks, geom, idBySeq, parentIds]);

  return (
    <div className="panel panel-timeline" ref={ref}>
      <div className="tl-content" style={{ width: scale.width }}>
        {/* Cabecera con ticks mayor/menor */}
        <div className="tl-header" style={{ width: scale.width, height: HEAD_H }}>
          <div className="tl-tickrow tl-major" style={{ height: HEAD_H / 2 }}>
            {scale.majorTicks.map((tk, i) => (
              <div key={`M${i}`} className="tl-tick" style={{ left: tk.x, width: tk.width }}>
                {tk.label}
              </div>
            ))}
          </div>
          <div className="tl-tickrow tl-minor" style={{ height: HEAD_H / 2 }}>
            {scale.minorTicks.map((tk, i) => (
              <div key={`m${i}`} className="tl-tick" style={{ left: tk.x, width: tk.width }}>
                {tk.label}
              </div>
            ))}
          </div>
        </div>

        {/* Cuerpo */}
        <div className="tl-body" style={{ width: scale.width, height: bodyHeight }}>
          {/* Sombreado de fines de semana (al fondo) */}
          {scale.weekendBands.map((w, i) => (
            <div key={`we${i}`} className="tl-weekend" style={{ left: w.x, width: w.width, height: bodyHeight }} />
          ))}

          {/* Separadores de mes (ticks mayores) */}
          {scale.majorTicks.map((tk, i) => (
            <div key={`sep${i}`} className="tl-col-sep" style={{ left: tk.x, height: bodyHeight }} />
          ))}

          {/* Bandas de fila (clic = seleccionar, igual que el grid) */}
          {tasks.map((t, i) => (
            <div
              key={`band${t.id}`}
              className={`tl-band ${t.id === selectedId ? "tl-band-selected" : ""}`}
              style={{ top: i * ROW_H, height: ROW_H }}
              onClick={() => select(t.id)}
            />
          ))}

          {/* Marcador "hoy" */}
          {scale.todayX != null && (
            <div className="tl-today" style={{ left: scale.todayX, height: bodyHeight }} title="Today" />
          )}

          {/* Barras / milestones */}
          {rows.map((t) => {
            const g = geom.get(t.id)!;
            if (!t.start || !t.end) return null;
            const isParent = parentIds.has(t.id);
            const critical = isCritical(t.id);
            // Color elegido en el modal (vacío = el de siempre). En la vista de camino
            // crítico el rojo gana: es un diagnóstico, no un estilo de la fila.
            const color = barColorClass(t.barColor);
            if (t.isMilestone) {
              // El centro es el punto medio entre los vértices izq/der guardados en geom.
              const center = (g.startX + g.endX) / 2;
              return (
                <div
                  key={`bar${t.id}`}
                  className={`tl-milestone ${color} ${critical ? "tl-critical" : ""}`}
                  style={{ left: center - MS_SIZE / 2, top: g.cy - MS_SIZE / 2, width: MS_SIZE, height: MS_SIZE }}
                  title={t.title}
                />
              );
            }
            const w = Math.max(2, g.endX - g.startX);
            const barH = isParent ? 10 : 18;
            // Las filas padre tienen fechas calculadas desde los hijos: ni se
            // redimensionan ni se mueven.
            const draggable = !isParent;
            // Relleno de avance: proporcional al % sobre el ancho ÚTIL de la barra (el
            // que queda tras descontar el aire de los dos lados). En una barra muy
            // angosta no queda ancho útil y no se dibuja nada.
            const pct = Math.max(0, Math.min(100, t.progress));
            const fillW = (Math.max(0, w - FILL_INSET * 2) * pct) / 100;
            const label = pct > 0 ? `${t.title} — ${pct}% complete` : t.title;
            const barTitle = barTitles.get(t.id);
            return (
              <div
                key={`bar${t.id}`}
                className={`tl-bar ${isParent ? "tl-bar-parent" : ""} ${color} ${draggable ? "tl-bar-draggable" : ""} ${critical ? "tl-critical" : ""}`}
                style={{ left: g.startX, top: g.cy - barH / 2, width: w, height: barH }}
                title={draggable ? `${label} — drag to move, drag an edge to resize` : label}
                onMouseDown={draggable ? (e) => beginDrag(e, t, "move") : undefined}
              >
                {/* Antes que los tiradores en el DOM: así el resaltado de los bordes
                    al pasar el mouse sigue quedando por encima del relleno. */}
                {fillW >= 1 && <span className="tl-bar-fill" style={{ width: fillW }} />}
                {/* Rótulo que SÍ entra: centrado adentro, después del relleno para que
                    se dibuje encima de él. El que no entra va en su propia capa. */}
                {barTitle?.inside && <span className="tl-bar-title">{barTitle.text}</span>}
                {draggable && (
                  <>
                    <span
                      className="tl-bar-handle tl-bar-handle-start"
                      title="Drag to change Start"
                      onMouseDown={(e) => beginDrag(e, t, "start")}
                    />
                    <span
                      className="tl-bar-handle tl-bar-handle-end"
                      title="Drag to change End"
                      onMouseDown={(e) => beginDrag(e, t, "end")}
                    />
                  </>
                )}
              </div>
            );
          })}

          {/* Flechas de dependencia */}
          <svg className="tl-arrows" width={scale.width} height={bodyHeight}>
            <defs>
              {/* refX = 8 es la punta del triángulo: así la punta cae EXACTAMENTE en
                  el borde de la barra (con refX 7 se metía ~1px hacia adentro). */}
              <marker
                id="dep-arrow"
                viewBox="0 0 8 8"
                refX="8"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" className="tl-arrowhead" />
              </marker>
            </defs>
            {arrows.map((a) => (
              <path key={a.key} d={a.d} className="tl-arrow-path" markerEnd="url(#dep-arrow)" />
            ))}
          </svg>

          {/* Rótulos que no entran en su barra: afuera, a la derecha del borde. Van
              DESPUÉS del SVG para que el texto quede por encima de las flechas y no
              cruzado por una línea. */}
          {rows.map((t) => {
            const bt = barTitles.get(t.id);
            if (!bt || bt.inside) return null;
            return (
              <div
                key={`bt${t.id}`}
                className="tl-bar-title-out"
                style={{ left: bt.x, top: bt.cy - ROW_H / 2, height: ROW_H }}
              >
                {bt.text}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

// memo: su única prop es `tasks` (referencia estable de react-query), así que el panel
// no se vuelve a dibujar cuando App re-renderiza por otra cosa — en particular durante
// un arrastre del divisor o del ancho de una columna, que dispara un render por cada
// movimiento del mouse. Lo que sí lo actualiza (zoom, selección, camino crítico) llega
// por el store, y eso el memo no lo bloquea.
export const Timeline = memo(TimelineImpl);
