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
  const requestTitleFocus = useUI((s) => s.requestTitleFocus);
  const openSettings = useUI((s) => s.openSettings);
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
      {
        // Se selecciona la fila nueva y se pide el foco para su celda Title: la celda
        // lo toma cuando la fila llega en el refetch (ver focusTitleId en el store).
        onSuccess: (task) => {
          select(task.id);
          requestTitleFocus(task.id);
        },
      },
    );

  const confirmDelete = () => {
    if (selectedId == null) return;
    remove.mutate(selectedId, { onSuccess: () => select(null) });
    setConfirmingDelete(false);
  };

  return (
    <div className="toolbar">
      <div className="tb-group">
        <button className="tb-btn" title="Add row" onClick={addRow}>
          ➕
        </button>
        <button
          className="tb-btn"
          title="Delete row"
          onClick={() => setConfirmingDelete(true)}
          disabled={!hasSel}
        >
          🗑️
        </button>
      </div>

      {/* Outdent a la izquierda e Indent a la derecha: el sentido de cada flecha
          coincide con su posición en el grupo. */}
      <div className="tb-group">
        <button
          className="tb-btn"
          title="Outdent (move up a level)"
          onClick={() => hasSel && outdent.mutate(selectedId!)}
          disabled={!hasSel}
        >
          ⬅️
        </button>
        <button
          className="tb-btn"
          title="Indent (make child)"
          onClick={() => hasSel && indent.mutate(selectedId!)}
          disabled={!hasSel}
        >
          ➡️
        </button>
      </div>

      <div className="tb-group">
        <button
          className="tb-btn"
          title="Move up"
          onClick={() => hasSel && move.mutate({ id: selectedId!, direction: "up" })}
          disabled={!hasSel}
        >
          🔺
        </button>
        <button
          className="tb-btn"
          title="Move down"
          onClick={() => hasSel && move.mutate({ id: selectedId!, direction: "down" })}
          disabled={!hasSel}
        >
          🔻
        </button>
      </div>

      <div className="tb-group">
        <button
          className={`tb-btn ${showCritical ? "tb-active" : ""}`}
          title="Critical path"
          aria-pressed={showCritical}
          onClick={toggleCritical}
        >
          🔴
        </button>
      </div>

      <div className="tb-group">
        <button
          className={`tb-btn tb-zoom ${zoom === "day" ? "tb-active" : ""}`}
          title="Zoom: day"
          onClick={() => setZoom("day")}
        >
          Day
        </button>
        <button
          className={`tb-btn tb-zoom ${zoom === "week" ? "tb-active" : ""}`}
          title="Zoom: week"
          onClick={() => setZoom("week")}
        >
          Week
        </button>
        <button
          className={`tb-btn tb-zoom ${zoom === "month" ? "tb-active" : ""}`}
          title="Zoom: month"
          onClick={() => setZoom("month")}
        >
          Month
        </button>
      </div>

      <div className="tb-spacer" />

      <div className="tb-group">
        <button className="tb-btn" title="Settings" onClick={openSettings}>
          ⚙️
        </button>
      </div>

      <div className="save-indicator">{saving > 0 ? "Saving…" : "Saved"}</div>

      {confirmingDelete && selectedTask && (
        <ConfirmDialog
          title="Delete row"
          message={
            hasChildren
              ? `"${selectedTask.title || `ID ${selectedTask.id}`}" and all its subtasks will be deleted. This action cannot be undone.`
              : `"${selectedTask.title || `ID ${selectedTask.id}`}" will be deleted. This action cannot be undone.`
          }
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
