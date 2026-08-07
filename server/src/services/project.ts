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

/** Fila de `tasks` tal como la devuelve Prisma. */
type TaskRow = Awaited<ReturnType<typeof prisma.task.findMany>>[number];

/**
 * Recalcula estructura (WBS/orden), fechas (scheduling + roll-up) y avance (roll-up)
 * de todo el proyecto y guarda solo las filas cuyos campos calculados cambiaron.
 *
 * Devuelve el proyecto YA recalculado y en orden de presentación. Es exactamente lo que
 * quedó en la base —los campos calculados son los mismos que se acaban de escribir—, así
 * que las rutas responden con esto en vez de volver a leer la tabla: era un `findMany`
 * más por cada mutación, y con autosave por celda ese es el camino caliente.
 */
export async function recomputeProject(): Promise<TaskRow[]> {
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
  const fresh: TaskRow[] = [];
  for (const t of tasks) {
    const s = structure.get(t.id);
    const d = schedule.get(t.id);
    const p = progress.get(t.id);
    if (!s || !d || p == null) {
      fresh.push(t); // fila sin resultado (dato inconsistente): queda como estaba
      continue;
    }
    fresh.push({
      ...t,
      wbs: s.wbs,
      order: s.order,
      start: d.start,
      end: d.end,
      durationDays: d.durationDays,
      isMilestone: d.isMilestone,
      progress: p,
    });

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
  return fresh.sort((a, b) => a.order - b.order);
}
