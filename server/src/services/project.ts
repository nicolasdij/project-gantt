// Servicio de proyecto: recalcula WBS + orden + fechas (auto-scheduling por
// dependencias y roll-up de padres) y lo persiste. Se invoca tras cualquier mutación.
// El proyecto es único y pequeño: recalcular todo en cada cambio es simple y correcto.

import { prisma } from "../db.ts";
import { computeStructure, type TreeTask } from "../lib/tree.ts";
import { computeSchedule, type ScheduleTask } from "../lib/schedule.ts";

function sameDate(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}

/**
 * Recalcula estructura (WBS/orden) y fechas (scheduling + roll-up) de todo el
 * proyecto y guarda solo las filas cuyos campos calculados cambiaron.
 */
export async function recomputeProject(): Promise<number> {
  const tasks = await prisma.task.findMany();
  const structure = computeStructure(tasks as unknown as TreeTask[]);
  const schedule = computeSchedule(tasks as unknown as ScheduleTask[]);

  const updates: Promise<unknown>[] = [];
  for (const t of tasks) {
    const s = structure.get(t.id);
    const d = schedule.get(t.id);
    if (!s || !d) continue;

    const changed =
      s.wbs !== t.wbs ||
      s.order !== t.order ||
      !sameDate(d.start, t.start) ||
      !sameDate(d.end, t.end) ||
      d.durationDays !== t.durationDays ||
      d.isMilestone !== t.isMilestone;

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
