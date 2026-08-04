// Layout: Toolbar arriba, panel izquierdo (grid) y panel derecho (timeline),
// separados por un splitter ARRASTRABLE. El ancho del panel izquierdo es un valor
// controlado (px): se ajusta arrastrando el divisor y se MANTIENE al redimensionar
// la ventana; el panel derecho absorbe el cambio de ancho (con scroll horizontal
// interno si su contenido es más ancho). El scroll vertical de ambos va sincronizado.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTasks, useDiscardEmptyRowOnLeave } from "./queries.ts";
import { Toolbar } from "./components/Toolbar.tsx";
import { Grid } from "./components/Grid.tsx";
import { Timeline } from "./components/Timeline.tsx";
import { TaskModal } from "./components/TaskModal.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { NoticeModal } from "./components/NoticeModal.tsx";

const MIN_GRID = 240; // ancho mínimo de cada panel al arrastrar

export default function App() {
  const { data: tasks, isLoading, isError, error } = useTasks();
  // Al pasar la selección a otra fila, descarta la que se deja atrás si quedó vacía.
  useDiscardEmptyRowOnLeave();
  const gridRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Ancho del panel izquierdo (px). null hasta medir el ancho natural (todas las columnas).
  const [gridWidth, setGridWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (gridWidth == null && tasks && gridRef.current) {
      setGridWidth(gridRef.current.scrollWidth);
    }
  }, [tasks, gridWidth]);

  // --- Arrastre del splitter ---
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onSplitterDown = (e: React.MouseEvent) => {
    const startW = gridWidth ?? gridRef.current?.offsetWidth ?? 0;
    drag.current = { startX: e.clientX, startW };
    setDragging(true);
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return;
      const raw = drag.current.startW + (e.clientX - drag.current.startX);
      const max = window.innerWidth - MIN_GRID;
      setGridWidth(Math.max(MIN_GRID, Math.min(raw, max)));
    };
    const onUp = () => {
      if (drag.current) {
        drag.current = null;
        setDragging(false);
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
          {tasks && <Grid tasks={tasks} />}
        </section>

        {tasks && (
          <>
            <div
              className={`splitter ${dragging ? "dragging" : ""}`}
              onMouseDown={onSplitterDown}
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
