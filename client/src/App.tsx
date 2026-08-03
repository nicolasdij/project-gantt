// Layout: Toolbar arriba, panel izquierdo (grid) y panel derecho (timeline).
// El scroll vertical de ambos paneles se mantiene sincronizado para que las
// barras del Gantt queden alineadas con las filas del grid.
import { useEffect, useRef } from "react";
import { useTasks } from "./queries.ts";
import { Toolbar } from "./components/Toolbar.tsx";
import { Grid } from "./components/Grid.tsx";
import { Timeline } from "./components/Timeline.tsx";
import { TaskModal } from "./components/TaskModal.tsx";
import { NoticeModal } from "./components/NoticeModal.tsx";

export default function App() {
  const { data: tasks, isLoading, isError, error } = useTasks();
  const gridRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="app">
      <header className="app-header">
        <h1>Project Gantt</h1>
        <Toolbar />
      </header>

      <main className="app-main">
        <section className="panel panel-grid" ref={gridRef}>
          {isLoading && <p className="state">Cargando…</p>}
          {isError && <p className="state error">Error: {(error as Error)?.message}</p>}
          {tasks && <Grid tasks={tasks} />}
        </section>

        {tasks && <Timeline tasks={tasks} ref={timelineRef} />}
      </main>

      <TaskModal />
      <NoticeModal />
    </div>
  );
}
