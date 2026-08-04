// Layout: Toolbar arriba, panel izquierdo (grid) y panel derecho (timeline),
// separados por un splitter ARRASTRABLE. El ancho del panel izquierdo es un valor
// controlado (px): se ajusta arrastrando el divisor y se MANTIENE al redimensionar
// la ventana; el panel derecho absorbe el cambio de ancho (con scroll horizontal
// interno si su contenido es más ancho). El scroll vertical de ambos va sincronizado.
//
// Acá viven los DOS anchos arrastrables, porque se afectan entre sí: el del panel y
// el de la columna Title. Los gestos son iguales (mousedown + mousemove global) y
// comparten el mismo estado de arrastre, así el ancho de partida se toma una sola vez
// al empezar y nunca se calcula sobre un valor de un render anterior.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTasks, useDiscardEmptyRowOnLeave } from "./queries.ts";
import { Toolbar } from "./components/Toolbar.tsx";
import { Grid } from "./components/Grid.tsx";
import { Timeline } from "./components/Timeline.tsx";
import { TaskModal } from "./components/TaskModal.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { NoticeModal } from "./components/NoticeModal.tsx";

const MIN_GRID = 240; // ancho mínimo de cada panel al arrastrar
const MIN_TITLE = 120; // ancho mínimo de la columna Title
const DEFAULT_TITLE = 240;

/** Deja al panel izquierdo un ancho válido: ni él ni el derecho bajan de MIN_GRID. */
const clampPanel = (w: number) => Math.max(MIN_GRID, Math.min(w, window.innerWidth - MIN_GRID));

/** Ancho del contenido del grid hasta el borde derecho de Duration (incluida). */
function widthThroughDuration(panel: HTMLDivElement): number | null {
  const table = panel.querySelector("table.grid");
  const dur = panel.querySelector("thead th.col-dur");
  if (!table || !dur) return null;
  // Rects y no offsetLeft: offsetLeft es relativo al offsetParent (que acá depende de
  // qué ancestro esté posicionado), mientras que la diferencia de rects es siempre la
  // distancia real. Se mide con scrollLeft en 0, así que la columna ID pegada no está
  // desplazada. Incluye los bordes de las celdas; +1 para no cortar el último.
  const content = dur.getBoundingClientRect().right - table.getBoundingClientRect().left + 1;
  // El ancho del panel incluye su barra de scroll vertical, que no es área útil: sin
  // sumarla, Duration queda tapada por la barra. Con scrollbars superpuestas (macOS)
  // la diferencia es 0 y no suma nada.
  return content + (panel.offsetWidth - panel.clientWidth);
}

export default function App() {
  const { data: tasks, isLoading, isError, error } = useTasks();
  // Al pasar la selección a otra fila, descarta la que se deja atrás si quedó vacía.
  useDiscardEmptyRowOnLeave();
  const gridRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Ancho de la columna Title (px). Se arrastra desde el borde de su cabecera.
  const [titleWidth, setTitleWidth] = useState(DEFAULT_TITLE);

  // Ancho del panel izquierdo (px). null hasta medirlo sobre el DOM ya renderizado.
  const [gridWidth, setGridWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (gridWidth != null || !tasks || !gridRef.current) return;
    // Ancho inicial = hasta Duration, no el natural de la tabla: Dependencies y Owner
    // quedan fuera de vista (se llega a ellas con el scroll horizontal del panel o
    // corriendo el divisor) y ese ancho se lo queda el Gantt, que es lo que se mira.
    const w = widthThroughDuration(gridRef.current) ?? gridRef.current.scrollWidth;
    setGridWidth(clampPanel(w));
  }, [tasks, gridWidth]);

  // --- Arrastre: divisor de paneles y borde de la columna Title ---
  const drag = useRef<{
    kind: "panel" | "title";
    startX: number;
    startPanel: number;
    startTitle: number;
  } | null>(null);
  // Qué se está arrastrando (o null): es estado, no solo el ref, porque de esto
  // dependen el cursor global y el resaltado del agarre.
  const [dragging, setDragging] = useState<"panel" | "title" | null>(null);

  const startDrag = (kind: "panel" | "title") => (e: React.MouseEvent) => {
    drag.current = {
      kind,
      startX: e.clientX,
      startPanel: gridWidth ?? gridRef.current?.offsetWidth ?? 0,
      startTitle: titleWidth,
    };
    setDragging(kind);
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      if (d.kind === "panel") {
        setGridWidth(clampPanel(d.startPanel + dx));
        return;
      }
      // Title: el panel acompaña el mismo delta, así las columnas que estaban a la
      // vista siguen estándolo (ensanchar Title no empuja Duration fuera del panel).
      // Si el panel ya está en su tope, deja de crecer y el grid pasa a scrollear.
      const next = Math.max(MIN_TITLE, d.startTitle + dx);
      setTitleWidth(next);
      setGridWidth(clampPanel(d.startPanel + (next - d.startTitle)));
    };
    const onUp = () => {
      if (drag.current) {
        drag.current = null;
        setDragging(null);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Cursor/selección global mientras se arrastra.
  useEffect(() => {
    document.body.style.userSelect = dragging ? "none" : "";
    document.body.style.cursor = dragging ? "col-resize" : "";
  }, [dragging]);

  // Sincroniza el scroll vertical entre grid y timeline (bidireccional, sin bucle).
  useEffect(() => {
    const g = gridRef.current;
    const t = timelineRef.current;
    if (!g || !t) return;
    let lock = false;
    const sync = (from: HTMLDivElement, to: HTMLDivElement) => () => {
      if (lock) return;
      lock = true;
      to.scrollTop = from.scrollTop;
      lock = false;
    };
    const gh = sync(g, t);
    const th = sync(t, g);
    g.addEventListener("scroll", gh);
    t.addEventListener("scroll", th);
    return () => {
      g.removeEventListener("scroll", gh);
      t.removeEventListener("scroll", th);
    };
  }, [tasks]);

  const gridStyle =
    gridWidth != null ? { flex: `0 0 ${gridWidth}px`, width: gridWidth } : undefined;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Project Gantt</h1>
        <Toolbar />
      </header>

      <main className="app-main">
        <section className="panel panel-grid" ref={gridRef} style={gridStyle}>
          {isLoading && <p className="state">Loading…</p>}
          {isError && <p className="state error">Error: {(error as Error)?.message}</p>}
          {tasks && (
            <Grid
              tasks={tasks}
              titleWidth={titleWidth}
              onTitleResizeStart={startDrag("title")}
              titleResizing={dragging === "title"}
            />
          )}
        </section>

        {tasks && (
          <>
            <div
              className={`splitter ${dragging === "panel" ? "dragging" : ""}`}
              onMouseDown={startDrag("panel")}
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize"
            />
            <Timeline tasks={tasks} ref={timelineRef} />
          </>
        )}
      </main>

      <TaskModal />
      <SettingsModal />
      <NoticeModal />
    </div>
  );
}
