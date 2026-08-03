// Modal de detalle (se abre desde el link del WBS).
// Permite editar el resto de columnas + la Descripción (rich text → Markdown).
// Todo es autosave: cada campo confirma en blur; la descripción, al perder foco.
import { useEffect, useMemo } from "react";
import type { Task } from "../types.ts";
import { useUI } from "../store.ts";
import { useTasks, useTaskMutations } from "../queries.ts";
import { EditableText, EditableDate } from "./cells.tsx";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import { formatDuration, parseDuration, isoToDate } from "../lib/format.ts";

export function TaskModal() {
  const modalTaskId = useUI((s) => s.modalTaskId);
  const closeModal = useUI((s) => s.closeModal);
  const { data: tasks = [] } = useTasks();
  const { patch } = useTaskMutations();

  const task = useMemo(
    () => tasks.find((t) => t.id === modalTaskId) ?? null,
    [tasks, modalTaskId],
  );
  const isParent = useMemo(
    () => (task ? tasks.some((t) => t.parentId === task.id) : false),
    [tasks, task],
  );

  // Cerrar con Escape.
  useEffect(() => {
    if (!modalTaskId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeModal();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalTaskId, closeModal]);

  if (!modalTaskId || !task) return null;

  const edit = (data: Parameters<typeof patch.mutate>[0]["data"]) =>
    patch.mutate({ id: task.id, data });

  return (
    <div className="modal-overlay" onClick={closeModal}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <span className="modal-wbs">{task.wbs}</span> · ID {task.order + 1}
          </h2>
          <button className="modal-close" title="Cerrar" onClick={closeModal}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <label className="field">
            <span>Title</span>
            <EditableText value={task.title} onCommit={(v) => edit({ title: v })} />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Start</span>
              {isParent ? (
                <span className="ro">{isoToDate(task.start) || "—"}</span>
              ) : (
                <EditableDate value={isoToDate(task.start)} onCommit={(v) => edit({ start: v })} />
              )}
            </label>
            <label className="field">
              <span>End</span>
              {isParent ? (
                <span className="ro">{isoToDate(task.end) || "—"}</span>
              ) : (
                <EditableDate value={isoToDate(task.end)} onCommit={(v) => edit({ end: v })} />
              )}
            </label>
            <label className="field">
              <span>Duration</span>
              {isParent ? (
                <span className="ro">{formatDuration(task.durationDays)}</span>
              ) : (
                <EditableText
                  value={formatDuration(task.durationDays)}
                  onCommit={(v) => {
                    const days = parseDuration(v);
                    if (days != null) edit({ durationDays: days });
                  }}
                />
              )}
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Owner</span>
              <EditableText value={task.owner ?? ""} onCommit={(v) => edit({ owner: v })} />
            </label>
            <label className="field">
              <span>Dependencies</span>
              <EditableText
                value={task.dependencies ?? ""}
                placeholder="ej. 3FS"
                onCommit={(v) => edit({ dependencies: v })}
              />
            </label>
          </div>

          {isParent && (
            <p className="hint">
              Start/End/Duration de una fila padre se calculan desde sus hijos (no editables).
            </p>
          )}

          <label className="field">
            <span>Description</span>
            <MarkdownEditor
              value={task.descriptionMd ?? ""}
              onChange={(md) => edit({ descriptionMd: md })}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

export type { Task };
