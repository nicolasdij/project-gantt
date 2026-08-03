// Rutas de tareas: CRUD + autosave (last-write-wins por campo).
// Tras cada mutación se recalcula WBS y roll-up de padres (recomputeProject).

import type { FastifyInstance } from "fastify";
import { prisma } from "../db.ts";
import { recalcDates } from "../lib/recalc.ts";
import { recomputeProject, isParent } from "../services/project.ts";
import { computeCriticalPath, type CriticalTask } from "../lib/critical.ts";

// Campos de contenido editables directamente (no disparan recálculo de fechas).
const CONTENT_FIELDS = ["title", "owner", "dependencies", "descriptionMd"] as const;
// Campos que disparan el motor de recálculo de fechas.
const DATE_FIELDS = ["start", "end", "durationDays"] as const;

export async function taskRoutes(app: FastifyInstance) {
  // --- LISTA ---
  app.get("/api/tasks", async () => {
    return prisma.task.findMany({ orderBy: { order: "asc" } });
  });

  // --- CAMINO CRÍTICO (CPM) ---
  // Devuelve los ids de las tareas críticas (holgura 0). Ruta estática: tiene
  // prioridad sobre /api/tasks/:id en el router de Fastify.
  app.get("/api/tasks/critical", async () => {
    const tasks = await prisma.task.findMany();
    return { criticalIds: computeCriticalPath(tasks as unknown as CriticalTask[]) };
  });

  // --- DETALLE ---
  app.get("/api/tasks/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return reply.code(404).send({ error: "Task no encontrada" });
    return task;
  });

  // --- CREAR (add row) ---
  // body opcional: { title?, parentId?, afterId? }
  //   afterId → inserta justo después de esa fila (hereda su parentId si no se indica).
  app.post("/api/tasks", async (req, reply) => {
    const body = (req.body ?? {}) as {
      title?: string;
      parentId?: number | null;
      afterId?: number;
    };

    // Determina posición (order) y padre.
    let newOrder: number;
    let parentId: number | null = body.parentId ?? null;

    if (body.afterId != null) {
      const after = await prisma.task.findUnique({ where: { id: body.afterId } });
      if (!after) return reply.code(400).send({ error: "afterId no existe" });
      newOrder = after.order + 1;
      if (body.parentId === undefined) parentId = after.parentId; // hermano por defecto
      // Hace hueco: desplaza las filas posteriores.
      await prisma.task.updateMany({
        where: { order: { gte: newOrder } },
        data: { order: { increment: 1 } },
      });
    } else {
      const agg = await prisma.task.aggregate({ _max: { order: true } });
      newOrder = (agg._max.order ?? 0) + 1;
    }

    const created = await prisma.task.create({
      data: {
        title: body.title ?? "",
        parentId,
        order: newOrder,
        durationDays: 1,
        isMilestone: false,
      },
    });

    await recomputeProject();
    return reply.code(201).send(await prisma.task.findUnique({ where: { id: created.id } }));
  });

  // --- AUTOSAVE / EDITAR (last-write-wins por campo) ---
  app.patch("/api/tasks/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const current = await prisma.task.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ error: "Task no encontrada" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    // Campos de contenido: se aplican tal cual.
    for (const f of CONTENT_FIELDS) {
      if (f in body) data[f] = body[f];
    }

    // Campos de fecha: pasan por el motor de recálculo.
    const touchesDates = DATE_FIELDS.some((f) => f in body);
    if (touchesDates) {
      // Los padres tienen Start/End/Duration calculados: no son editables.
      if (await isParent(id)) {
        return reply
          .code(409)
          .send({ error: "Start/End/Duration de una fila padre son calculados (no editables)" });
      }
      // Construye el edit SOLO con las claves presentes en el body: el motor de
      // recálculo usa Object.keys para saber qué campos se editaron.
      const edit: { start?: string | null; end?: string | null; durationDays?: number } = {};
      if ("start" in body) edit.start = body.start as string | null;
      if ("end" in body) edit.end = body.end as string | null;
      if ("durationDays" in body) edit.durationDays = Number(body.durationDays);

      const recalced = recalcDates(
        {
          start: current.start,
          end: current.end,
          durationDays: current.durationDays,
          isMilestone: current.isMilestone,
        },
        edit,
      );
      data.start = recalced.start;
      data.end = recalced.end;
      data.durationDays = recalced.durationDays;
      data.isMilestone = recalced.isMilestone;
    }

    if (Object.keys(data).length === 0) {
      return reply.code(400).send({ error: "Ningún campo editable en el body" });
    }

    await prisma.task.update({ where: { id }, data });
    await recomputeProject(); // actualiza roll-up de ancestros si cambiaron fechas
    return prisma.task.findUnique({ where: { id } });
  });

  // Helper: hermanos (misma parentId) ordenados.
  const siblingsOf = (parentId: number | null) =>
    prisma.task.findMany({ where: { parentId }, orderBy: { order: "asc" } });

  const listOrdered = () => prisma.task.findMany({ orderBy: { order: "asc" } });

  // --- MOVER ARRIBA / ABAJO (reordenar entre hermanos) ---
  app.post("/api/tasks/:id/move", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const dir = ((req.body as { direction?: string })?.direction ?? "").toLowerCase();
    if (dir !== "up" && dir !== "down") {
      return reply.code(400).send({ error: 'direction debe ser "up" o "down"' });
    }
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return reply.code(404).send({ error: "Task no encontrada" });

    const sibs = await siblingsOf(task.parentId);
    const idx = sibs.findIndex((s) => s.id === id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sibs.length) {
      return listOrdered(); // extremo: no-op
    }
    const other = sibs[swapIdx];
    await prisma.$transaction([
      prisma.task.update({ where: { id: task.id }, data: { order: other.order } }),
      prisma.task.update({ where: { id: other.id }, data: { order: task.order } }),
    ]);
    await recomputeProject();
    return listOrdered();
  });

  // --- INDENT (convertir en hijo del hermano anterior) ---
  app.post("/api/tasks/:id/indent", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return reply.code(404).send({ error: "Task no encontrada" });

    const sibs = await siblingsOf(task.parentId);
    const idx = sibs.findIndex((s) => s.id === id);
    if (idx <= 0) {
      return reply.code(400).send({ error: "No hay hermano previo: no se puede indentar" });
    }
    const newParent = sibs[idx - 1];
    // Se añade como último hijo del nuevo padre.
    const lastChild = await prisma.task.findFirst({
      where: { parentId: newParent.id },
      orderBy: { order: "desc" },
    });
    const newOrder = (lastChild?.order ?? newParent.order) + 1;
    await prisma.task.update({
      where: { id },
      data: { parentId: newParent.id, order: newOrder },
    });
    await recomputeProject();
    return listOrdered();
  });

  // --- OUTDENT (subir un nivel, quedando justo después del antiguo padre) ---
  app.post("/api/tasks/:id/outdent", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return reply.code(404).send({ error: "Task no encontrada" });
    if (task.parentId === null) {
      return reply.code(400).send({ error: "Ya está en la raíz: no se puede outdentar" });
    }
    const parent = await prisma.task.findUnique({ where: { id: task.parentId } });
    if (!parent) return reply.code(500).send({ error: "Padre inconsistente" });

    const grandparentId = parent.parentId; // puede ser null (nivel raíz)
    const groupSibs = await siblingsOf(grandparentId); // hermanos del padre
    const parentIdx = groupSibs.findIndex((s) => s.id === parent.id);

    // Nueva secuencia del grupo, insertando la tarea justo después del padre.
    const seq = [...groupSibs];
    seq.splice(parentIdx + 1, 0, task);

    await prisma.$transaction(
      seq.map((s, i) =>
        prisma.task.update({
          where: { id: s.id },
          data: s.id === id ? { parentId: grandparentId, order: i } : { order: i },
        }),
      ),
    );
    await recomputeProject();
    return listOrdered();
  });

  // --- BORRAR (delete row) ---
  // Los hijos se borran en cascada (onDelete: Cascade en el schema).
  app.delete("/api/tasks/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const exists = await prisma.task.findUnique({ where: { id } });
    if (!exists) return reply.code(404).send({ error: "Task no encontrada" });

    await prisma.task.delete({ where: { id } });
    await recomputeProject();
    return reply.code(204).send();
  });
}
