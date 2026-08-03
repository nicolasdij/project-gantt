// Panel derecho: timeline del Gantt. Barras alineadas con las filas del grid,
// escala Day/Week/Month, marcador "hoy", milestones como rombo y flechas de
// dependencia (SVG). El scroll vertical se sincroniza con el grid (ver App).
import { forwardRef, useMemo } from "react";
import type { Task } from "../types.ts";
import { useUI } from "../store.ts";
import { useCriticalPath } from "../queries.ts";
import { parseDependencies } from "../lib/deps.ts";
import { buildTimeScale } from "../lib/timeScale.ts";
import { ROW_H, HEAD_H } from "../lib/layout.ts";

type Geom = { startX: number; endX: number; cy: number; isMilestone: boolean };

// Rombo del milestone: cuadro de lado MS_SIZE rotado 45°. La distancia del centro
// a cada vértice (izq/der) es la semidiagonal = MS_SIZE * √2 / 2.
const MS_SIZE = ROW_H / 2;
const MS_HALF_DIAG = MS_SIZE * Math.SQRT1_2;

export const Timeline = forwardRef<HTMLDivElement, { tasks: Task[] }>(function Timeline(
  { tasks },
  ref,
) {
  const zoom = useUI((s) => s.zoom);
  const selectedId = useUI((s) => s.selectedId);
  const select = useUI((s) => s.select);
  const showCritical = useUI((s) => s.showCritical);
  const { data: criticalSet } = useCriticalPath(showCritical);
  const isCritical = (id: number) => showCritical && !!criticalSet?.has(id);

  // "Hoy" en medianoche local; solo para el marcador.
  const today = useMemo(() => new Date(), []);
  const scale = useMemo(() => buildTimeScale(tasks, zoom, today), [tasks, zoom, today]);

  const parentIds = useMemo(
    () => new Set(tasks.map((t) => t.parentId).filter((x): x is number => x != null)),
    [tasks],
  );

  // Geometría por tarea (índice de fila = posición en el array, ya ordenado).
  const geom = useMemo(() => {
    const map = new Map<number, Geom>();
    tasks.forEach((t, i) => {
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
  }, [tasks, scale]);

  const bodyHeight = tasks.length * ROW_H;

  // Flechas de dependencia.
  const arrows = useMemo(() => {
    const paths: { d: string; key: string }[] = [];
    const stub = 10;
    for (const t of tasks) {
      const succ = geom.get(t.id);
      if (!succ || (!t.start && !t.end)) continue;
      for (const dep of parseDependencies(t.dependencies)) {
        const pred = geom.get(dep.predId);
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
          // Une los FINES (bordes derechos): enruta por FUERA, a la derecha de ambas barras.
          const goRight = Math.max(x1, x2) + stub;
          d = `M ${x1} ${y1} H ${goRight} V ${y2} H ${x2}`;
        } else if (dep.type === "SS") {
          // Une los INICIOS (bordes izquierdos): enruta por FUERA, a la izquierda de ambas barras.
          const goLeft = Math.min(x1, x2) - stub;
          d = `M ${x1} ${y1} H ${goLeft} V ${y2} H ${x2}`;
        } else {
          // FS: sale del fin del predecesor (derecha) hacia el inicio del sucesor (izquierda).
          d = `M ${x1} ${y1} H ${x1 + stub} V ${y2} H ${x2}`;
        }
        paths.push({ d, key: `${dep.predId}-${t.id}-${dep.type}` });
      }
    }
    return paths;
  }, [tasks, geom]);

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
            <div className="tl-today" style={{ left: scale.todayX, height: bodyHeight }} title="Hoy" />
          )}

          {/* Barras / milestones */}
          {tasks.map((t) => {
            const g = geom.get(t.id)!;
            if (!t.start || !t.end) return null;
            const isParent = parentIds.has(t.id);
            const critical = isCritical(t.id);
            if (t.isMilestone) {
              // El centro es el punto medio entre los vértices izq/der guardados en geom.
              const center = (g.startX + g.endX) / 2;
              return (
                <div
                  key={`bar${t.id}`}
                  className={`tl-milestone ${critical ? "tl-critical" : ""}`}
                  style={{ left: center - MS_SIZE / 2, top: g.cy - MS_SIZE / 2, width: MS_SIZE, height: MS_SIZE }}
                  title={t.title}
                />
              );
            }
            const w = Math.max(2, g.endX - g.startX);
            const barH = isParent ? 10 : 18;
            return (
              <div
                key={`bar${t.id}`}
                className={`tl-bar ${isParent ? "tl-bar-parent" : ""} ${critical ? "tl-critical" : ""}`}
                style={{ left: g.startX, top: g.cy - barH / 2, width: w, height: barH }}
                title={t.title}
              />
            );
          })}

          {/* Flechas de dependencia */}
          <svg className="tl-arrows" width={scale.width} height={bodyHeight}>
            <defs>
              <marker
                id="dep-arrow"
                viewBox="0 0 8 8"
                refX="7"
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
        </div>
      </div>
    </div>
  );
});
