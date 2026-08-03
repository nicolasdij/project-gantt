// Motor de recálculo de una tarea hoja ante una edición (autosave por campo).
// Reglas (SPEC.md):
//   - Editar End Date    → recalcula Duration (workingDaysBetween).
//   - Editar Duration    → recalcula End Date (Start + días laborables).
//   - Editar Start Date  → recalcula End Date (manteniendo Duration).
//   - Editar Start y End juntos (modal) → recalcula Duration.
//   - Milestone: Duration 0 ⇒ isMilestone = true y End = Start (rombo ◆).

import { addWorkingDays, workingDaysBetween, parseDate } from "./dates.ts";

export type TaskDateFields = {
  start: Date | null;
  end: Date | null;
  durationDays: number;
  isMilestone: boolean;
};

// Edición entrante (autosave). Las fechas llegan como string YYYY-MM-DD o Date.
export type DateEdit = {
  start?: string | Date | null;
  end?: string | Date | null;
  durationDays?: number;
};

/**
 * Aplica una edición sobre el estado actual de una tarea hoja y devuelve
 * los campos de fecha ya recalculados y consistentes entre sí.
 */
export function recalcDates(current: TaskDateFields, edit: DateEdit): TaskDateFields {
  const touched = new Set(Object.keys(edit));

  let start = touched.has("start") ? parseDate(edit.start) : current.start;
  let end = touched.has("end") ? parseDate(edit.end) : current.end;
  let duration = touched.has("durationDays") ? Number(edit.durationDays) : current.durationDays;

  const editedStart = touched.has("start");
  const editedEnd = touched.has("end");
  const editedDuration = touched.has("durationDays");

  if (editedStart && editedEnd) {
    // El modal puede enviar ambos: las fechas mandan, se deriva la duración.
    duration = start && end ? workingDaysBetween(start, end) : duration;
  } else if (editedDuration) {
    // Duración manda: se recalcula End desde Start.
    if (start) end = duration <= 0 ? start : addWorkingDays(start, duration - 1);
  } else if (editedEnd) {
    // End manda: se recalcula Duration.
    if (start && end) duration = workingDaysBetween(start, end);
  } else if (editedStart) {
    // Start manda, se mantiene Duration y se recalcula End.
    if (start) end = duration <= 0 ? start : addWorkingDays(start, duration - 1);
  }

  // Regla de milestone: duración 0 ⇒ rombo y End == Start.
  const isMilestone = duration === 0;
  if (isMilestone && start) end = start;

  return { start, end, durationDays: duration, isMilestone };
}
