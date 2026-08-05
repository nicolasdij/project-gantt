// Servicio de proyecto: recalcula WBS + orden + fechas (auto-scheduling por
// dependencias y roll-up de padres) + avance de los padres, y lo persiste. Se invoca
// tras cualquier mutación.
// El proyecto es único y pequeño: recalcular todo en cada cambio es simple y correcto.

import { prisma } from "../db.ts";
import { computeStructure, type TreeTask } from "../lib/tree.ts";
import { computeSchedule, type ScheduleTask } from "../lib/schedule.ts";
import { computeProgress } from "../lib/progress.ts";

function sameDate(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/**
 * Recalcula estructura (WBS/orden), fechas (scheduling + roll-up) y avance (roll-up)
 * de todo el proyecto y guarda solo las filas cuyos campos calculados cambiaron.
 */
export async function recomputeProject(): Promise<number> {
  const tasks = await prisma.task.findMany();
  const structure = computeStructure(tasks as unknown as TreeTask[]);
  const schedule = computeSchedule(tasks as unknown as ScheduleTask[]);
  // Después del scheduling: el avance de un padre pondera por la duración de cada
  // hijo, y la que vale es la que acaba de calcularse (la de la base puede ser vieja).
  const progress = computeProgress(
    tasks.map((t) => ({
      id: t.id,
      parentId: t.parentId,
      order: t.order,
      progress: t.progress,
      durationDays: schedule.get(t.id)?.durationDays ?? t.durationDays,
    })),
  );

  const updates: Promise<unknown>[] = [];
  for (const t of tasks) {
    const s = structure.get(t.id);
    const d = schedule.get(t.id);
    const p = progress.get(t.id);
    if (!s || !d || p == null) continue;

    const changed =
      s.wbs !== t.wbs ||
      s.order !== t.order ||
      !sameDate(d.start, t.start) ||
      !sameDate(d.end, t.end) ||
      d.durationDays !== t.durationDays ||
      d.isMilestone !== t.isMilestone ||
      p !== t.progress;

    if (changed) {
      updates.push(
        prisma.task.update({
          where: { id: t.id },
          data: {
            wbs: s.wbs,
            order: s.order,
            start: d.start,
            end: d.end,
            durationDays: d.durationDays,
            isMilestone: d.isMilestone,
            progress: p,
          },
        }),
      );
    }
  }

  if (updates.length > 0) await prisma.$transaction(updates as any);
  return updates.length;
}

/** ¿La tarea tiene hijos? (los padres no permiten editar Start/End/Duration). */
export async function isParent(id: number): Promise<boolean> {
  const count = await prisma.task.count({ where: { parentId: id } });
  return count > 0;
}
