// Borrador del modal de detalle: el estado del formulario y el diff que se envía,
// separados del render.
//
// A diferencia del grid (autosave por celda), el modal es un FORMULARIO: lo tecleado se
// acumula acá y solo sale al guardar. Eso trae estado, un espejo en ref y la lógica de
// "qué cambió respecto de lo que había al abrir", que es lo que el componente no
// necesitaba tener encima para dibujar sus campos.
import { useEffect, useRef, useState } from "react";
import type { Task } from "../types.ts";
import type { PatchData } from "../api.ts";
import { barColorKey, type BarColorKey } from "../lib/barColors.ts";
import {
  formatDuration,
  parseDuration,
  formatPercent,
  parsePercent,
  isoToDate,
  type WorkingDaysPerMonth,
} from "../lib/format.ts";

/** Todo como string, tal cual se teclea (la Duration se parsea al guardar). */
export type Draft = {
  title: string;
  start: string; // YYYY-MM-DD o ""
  end: string; // YYYY-MM-DD o ""
  duration: string; // "Nd" / "Nw"
  progress: string; // "40%" (se parsea al guardar)
  barColor: BarColorKey; // "" = el color por defecto
  barTitle: string; // "" = sin rótulo sobre la barra
  owner: string;
  dependencies: string;
  descriptionMd: string;
};

const draftOf = (task: Task): Draft => ({
  title: task.title,
  start: isoToDate(task.start),
  end: isoToDate(task.end),
  duration: formatDuration(task.durationDays),
  progress: formatPercent(task.progress),
  barColor: barColorKey(task.barColor),
  barTitle: task.barTitle ?? "",
  owner: task.owner ?? "",
  dependencies: task.dependencies ?? "",
  descriptionMd: task.descriptionMd ?? "",
});

export type TaskDraft = {
  /** El borrador para dibujar los campos (null si no hay tarea abierta). */
  draft: Draft | null;
  setField: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  /**
   * Lo que hay que enviar, o el mensaje si un campo tecleado no parsea (Duration y
   * % Complete son texto libre). Devolver el mensaje —y no un `null`— evita que quien
   * llama tenga que adivinar cuál de los dos falló.
   */
  buildPatch: () => { data: PatchData } | { error: string };
};

export function useTaskDraft(
  task: Task | null,
  opts: { isParent: boolean; daysPerMonth: WorkingDaysPerMonth },
): TaskDraft {
  const [draft, setDraft] = useState<Draft | null>(null);
  // Espejo del borrador en un ref: los handlers (en particular el de Guardar) leen el
  // último valor de forma sincrónica, sin esperar al re-render.
  const draftRef = useRef<Draft | null>(null);
  // Valores al abrir el modal: se envía solo lo que cambió respecto a esta base.
  const baseRef = useRef<Draft | null>(null);

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
    // Solo al cambiar de tarea: un refetch en segundo plano no debe pisar lo tecleado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  const buildPatch = (): { data: PatchData } | { error: string } => {
    const d = draftRef.current;
    const base = baseRef.current;
    if (!d || !base) return { data: {} };

    const data: PatchData = {};
    if (d.title !== base.title) data.title = d.title;
    if (d.owner !== base.owner) data.owner = d.owner;
    // El color es estilo, no programación: se acepta también en una fila padre (su
    // barra de resumen se pinta igual). "" es el default, y en la base eso es null.
    if (d.barColor !== base.barColor) data.barColor = d.barColor || null;
    if (d.descriptionMd !== base.descriptionMd) data.descriptionMd = d.descriptionMd;

    // En una fila padre Start/End/Duration y % Complete son calculados, las Dependencies
    // no aplican y el rótulo de la barra no se dibuja (el server rechaza los cuatro con
    // 409): nunca se envían.
    if (!opts.isParent) {
      if (d.dependencies !== base.dependencies) data.dependencies = d.dependencies;
      // "" borra el rótulo, y en la base eso es null.
      if (d.barTitle !== base.barTitle) data.barTitle = d.barTitle.trim() || null;
      if (d.start !== base.start) data.start = d.start;
      if (d.end !== base.end) data.end = d.end;
      if (d.duration !== base.duration) {
        const days = parseDuration(d.duration, opts.daysPerMonth);
        if (days == null) {
          return { error: `Invalid Duration: "${d.duration}". Use e.g. 5d, 2w or 1m.` };
        }
        data.durationDays = days;
      }
      if (d.progress !== base.progress) {
        const pct = parsePercent(d.progress);
        if (pct == null) {
          return { error: `Invalid % Complete: "${d.progress}". Use a number from 0 to 100.` };
        }
        data.progress = pct;
      }
    }
    return { data };
  };

  return { draft, setField, buildPatch };
}
