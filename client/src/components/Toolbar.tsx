// Barra de herramientas. En la Fase 3 quedan activas las operaciones de fila.
// El toggle de camino crítico (Fase 5) y el zoom Day/Week/Month (Fase 4) se
// muestran deshabilitados hasta su fase.
import { useState } from "react";
import { useUI } from "../store.ts";
import { useTasks, useTaskMutations, useSavingCount } from "../queries.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

export function Toolbar() {
  const selectedId = useUI((s) => s.selectedId);
  const select = useUI((s) => s.select);
  const zoom = useUI((s) => s.zoom);
  const setZoom = useUI((s) => s.setZoom);
  const showCritical = useUI((s) => s.showCritical);
  const toggleCritical = useUI((s) => s.toggleCritical);
  const { data: tasks = [] } = useTasks();
  const { create, remove, indent, outdent, move } = useTaskMutations();
  const saving = useSavingCount();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const hasSel = selectedId != null;
  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;
  const hasChildren = selectedTask ? tasks.some((t) => t.parentId === selectedTask.id) : false;

  const addRow = () =>
    create.mutate(
      { afterId: selectedId ?? undefined },
      { onSuccess: (task) => select(task.id) },
    );

  const confirmDelete = () => {
    if (selectedId == null) return;
    remove.mutate(selectedId, { onSuccess: () => select(null) });
    setConfirmingDelete(false);
  };

  return (
    <div className="toolbar">
      <div className="tb-group">
        <button className="tb-btn" title="Añadir fila" onClick={addRow}>
          ➕
        </button>
        <button
          className="tb-btn"
          title="Borrar fila"
          onClick={() => setConfirmingDelete(true)}
          disabled={!hasSel}
        >
          🗑️
        </button>
      </div>

      <div className="tb-group">
        <button
          className="tb-btn"
          title="Indentar (hacer hijo)"
          onClick={() => hasSel && indent.mutate(selectedId!)}
          disabled={!hasSel}
        >
          ➡️
        </button>
        <button
          className="tb-btn"
          title="Outdentar (subir nivel)"
          onClick={() => hasSel && outdent.mutate(selectedId!)}
          disabled={!hasSel}
        >
          ⬅️
        </button>
      </div>

      <div className="tb-group">
        <button
          className="tb-btn"
          title="Mover arriba"
          onClick={() => hasSel && move.mutate({ id: selectedId!, direction: "up" })}
          disabled={!hasSel}
        >
          🔺
        </button>
        <button
          className="tb-btn"
          title="Mover abajo"
          onClick={() => hasSel && move.mutate({ id: selectedId!, direction: "down" })}
          disabled={!hasSel}
        >
          🔻
        </button>
      </div>

      <div className="tb-group">
        <button
          className={`tb-btn ${showCritical ? "tb-active" : ""}`}
          title="Camino crítico"
          aria-pressed={showCritical}
          onClick={toggleCritical}
        >
          🔴
        </button>
      </div>

      <div className="tb-group">
        <button
          className={`tb-btn tb-zoom ${zoom === "day" ? "tb-active" : ""}`}
          title="Zoom día"
          onClick={() => setZoom("day")}
        >
          Day
        </button>
        <button
          className={`tb-btn tb-zoom ${zoom === "week" ? "tb-active" : ""}`}
          title="Zoom semana"
          onClick={() => setZoom("week")}
        >
          Week
        </button>
        <button
          className={`tb-btn tb-zoom ${zoom === "month" ? "tb-active" : ""}`}
          title="Zoom mes"
          onClick={() => setZoom("month")}
        >
          Month
        </button>
      </div>

      <div className="tb-spacer" />
      <div className="save-indicator">{saving > 0 ? "Guardando…" : "Guardado"}</div>

      {confirmingDelete && selectedTask && (
        <ConfirmDialog
          title="Borrar fila"
          message={
            hasChildren
              ? `Se borrará "${selectedTask.title || `ID ${selectedTask.id}`}" y todas sus subtareas. Esta acción no se puede deshacer.`
              : `Se borrará "${selectedTask.title || `ID ${selectedTask.id}`}". Esta acción no se puede deshacer.`
          }
          confirmLabel="Borrar"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
