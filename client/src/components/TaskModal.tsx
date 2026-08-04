// Modal de detalle (se abre desde el link del ID).
// Permite editar el resto de columnas + la Descripción (rich text → Markdown).
// A diferencia del grid (autosave por celda), el modal es un FORMULARIO: los
// cambios se acumulan en un borrador local y solo se envían al pulsar "Guardar".
// "Cancelar" (y ✕ / Escape / click en el fondo) cierra descartando el borrador.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Task } from "../types.ts";
import type { PatchData } from "../api.ts";
import { useUI } from "../store.ts";
import { useTasks, useTaskMutations } from "../queries.ts";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import { formatDuration, parseDuration, isoToDate, isoToDisplayDate } from "../lib/format.ts";

// Borrador: todo como string, tal cual se teclea (la Duration se parsea al guardar).
type Draft = {
  title: string;
  start: string; // YYYY-MM-DD o ""
  end: string; // YYYY-MM-DD o ""
  duration: string; // "Nd" / "Nw"
  owner: string;
  dependencies: string;
  descriptionMd: string;
};

const draftOf = (task: Task): Draft => ({
  title: task.title,
  start: isoToDate(task.start),
  end: isoToDate(task.end),
  duration: formatDuration(task.durationDays),
  owner: task.owner ?? "",
  dependencies: task.dependencies ?? "",
  descriptionMd: task.descriptionMd ?? "",
});

export function TaskModal() {
  const modalTaskId = useUI((s) => s.modalTaskId);
  const closeModal = useUI((s) => s.closeModal);
  const showError = useUI((s) => s.showError);
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

  const [draft, setDraft] = useState<Draft | null>(null);
  // Espejo del borrador en un ref: los handlers (en particular el de Guardar) leen
  // el último valor de forma sincrónica, sin esperar al re-render.
  const draftRef = useRef<Draft | null>(null);
  // Valores al abrir el modal: se envía solo lo que cambió respecto a esta base.
  const baseRef = useRef<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    const current = draftRef.current;
    if (!current) return;
    const next = { ...current, [key]: value };
    draftRef.current = next;
    setDraft(next);
  };

  // Inicializa (y resetea) el borrador al abrir el modal de una tarea.
  useEffect(() => {
    if (!task) {
      draftRef.current = null;
      baseRef.current = null;
      setDraft(null);
      return;
    }
    const initial = draftOf(task);
    draftRef.current = initial;
    baseRef.current = initial;
    setDraft(initial);
    setSaving(false);
    // Solo al cambiar de tarea: un refetch en segundo plano no debe pisar lo tecleado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalTaskId, task?.id]);

  const cancel = () => closeModal();

  // Cerrar con Escape = cancelar (descarta el borrador).
  useEffect(() => {
    if (!modalTaskId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeModal();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalTaskId, closeModal]);

  if (!modalTaskId || !task || !draft) return null;

  /** Diff del borrador contra la base. `null` si la Duration es inválida. */
  const buildPatch = (d: Draft, base: Draft): PatchData | null => {
    const data: PatchData = {};
    if (d.title !== base.title) data.title = d.title;
    if (d.owner !== base.owner) data.owner = d.owner;
    if (d.descriptionMd !== base.descriptionMd) data.descriptionMd = d.descriptionMd;

    // En las filas padre Start/End/Duration son calculados y las Dependencies no
    // aplican (el server rechaza ambos con 409): nunca se envían.
    if (!isParent) {
      if (d.dependencies !== base.dependencies) data.dependencies = d.dependencies;
      if (d.start !== base.start) data.start = d.start;
      if (d.end !== base.end) data.end = d.end;
      if (d.duration !== base.duration) {
        const days = parseDuration(d.duration);
        if (days == null) return null;
        data.durationDays = days;
      }
    }
    return data;
  };

  const save = async () => {
    const d = draftRef.current!;
    const base = baseRef.current!;
    const data = buildPatch(d, base);
    if (!data) {
      showError(`Invalid Duration: "${d.duration}". Use e.g. 5d or 2w.`);
      return;
    }
    if (Object.keys(data).length === 0) {
      closeModal(); // nada que guardar
      return;
    }
    setSaving(true);
    try {
      await patch.mutateAsync({ id: task.id, data });
      closeModal();
    } catch {
      // El error ya se muestra en su modal (onError de la mutación): el popup
      // sigue abierto para no perder los cambios.
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={cancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <span className="modal-wbs">{task.wbs}</span> · ID {task.order + 1}
          </h2>
          <button className="modal-close" title="Close without saving" onClick={cancel}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <label className="field">
            <span>Title</span>
            <input
              className="cell-input"
              value={draft.title}
              onChange={(e) => setField("title", e.target.value)}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Start</span>
              {isParent ? (
                <span className="ro">{isoToDisplayDate(draft.start) || "—"}</span>
              ) : (
                <input
                  type="date"
                  className="cell-input"
                  value={draft.start}
                  onChange={(e) => setField("start", e.target.value)}
                />
              )}
            </label>
            <label className="field">
              <span>End</span>
              {isParent ? (
                <span className="ro">{isoToDisplayDate(draft.end) || "—"}</span>
              ) : (
                <input
                  type="date"
                  className="cell-input"
                  value={draft.end}
                  onChange={(e) => setField("end", e.target.value)}
                />
              )}
            </label>
            <label className="field">
              <span>Duration</span>
              {isParent ? (
                <span className="ro">{draft.duration}</span>
              ) : (
                <input
                  className="cell-input"
                  value={draft.duration}
                  onChange={(e) => setField("duration", e.target.value)}
                />
              )}
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Owner</span>
              <input
                className="cell-input"
                value={draft.owner}
                onChange={(e) => setField("owner", e.target.value)}
              />
            </label>
            <label className="field">
              <span>Dependencies</span>
              {isParent ? (
                <span className="ro">{draft.dependencies || "—"}</span>
              ) : (
                <input
                  className="cell-input"
                  placeholder="e.g. 3FS"
                  value={draft.dependencies}
                  onChange={(e) => setField("dependencies", e.target.value)}
                />
              )}
            </label>
          </div>

          {isParent && (
            <p className="hint">
              Start/End/Duration of a parent row are rolled up from its children (not editable),
              so it cannot have dependencies either — set them on the first child instead.
            </p>
          )}

          {/* OJO: no envolver el editor en un <label>. Un <label> se asocia al primer
              elemento labelable que contiene y el `div contentEditable` no lo es, así
              que tomaría como control al primer botón de la toolbar (Bold) y le
              reenviaría todos los clicks del área de texto: el caret nunca entraría. */}
          <div className="field">
            <span>Description</span>
            <MarkdownEditor
              value={draft.descriptionMd}
              onChange={(md) => setField("descriptionMd", md)}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={cancel} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export type { Task };
