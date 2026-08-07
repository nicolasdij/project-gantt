// Rutas de tareas: CRUD + autosave (last-write-wins por campo).
// Tras cada mutación se recalcula WBS y roll-up de padres (recomputeProject).

import type { FastifyInstance } from "fastify";
import { prisma } from "../db.ts";
import { recomputeProject } from "../services/project.ts";
import { computeCriticalPath, type CriticalTask } from "../lib/critical.ts";
import { parseDependencies } from "../lib/deps.ts";
import { buildTaskPatch, type PatchTask } from "../lib/patch.ts";
import { buildMaps, toSeq } from "../lib/seq.ts";
import {
  findReparentConflict,
  resolveMove,
  type ReparentConflict,
} from "../lib/move.ts";
import { groupChildren, makeIsAncestor } from "../lib/tree.ts";

// Mensaje del 409 cuando reparentar cerraría un ciclo. Lo comparten `indent` y `move`:
// agregan la misma arista (hijo → padre nuevo), solo cambia el verbo de la frase.
function reparentError(
  action: "indent" | "move",
  conflict: ReparentConflict,
  tasks: { id: number; title: string }[],
  idToSeq: Map<number, number>,
): string {
  const t = tasks.find((x) => x.id === conflict.taskId);
  const who = t?.title || `ID ${idToSeq.get(conflict.taskId)}`;
  const pred = idToSeq.get(conflict.predId);
  return conflict.kind === "direct"
    ? `Cannot ${action}: "${who}" depends on ID ${pred}, which would become its parent (or ancestor). Remove that dependency first.`
    : `Cannot ${action}: it would create a circular chain — "${who}" depends on ID ${pred}. Remove that dependency first.`;
}

export async function taskRoutes(app: FastifyInstance) {
  /** Traduce a ID visible una lista ya ordenada (lo que sale hacia el cliente). */
  const forClient = <T extends { id: number; order: number; dependencies: string | null }>(
    tasks: T[],
  ) => {
    const { idToSeq } = buildMaps(tasks);
    return tasks.map((t) => toSeq(t, idToSeq));
  };

  // Lista ordenada con Dependencies ya traducidas a ID visible (para el cliente).
  const listForClient = async () =>
    forClient(await prisma.task.findMany({ orderBy: { order: "asc" } }));

  // --- LISTA ---
  app.get("/api/tasks", async () => listForClient());

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
    const tasks = await prisma.task.findMany({ orderBy: { order: "asc" } });
    const task = tasks.find((t) => t.id === id);
    if (!task) return reply.code(404).send({ error: "Task not found" });
    return toSeq(task, buildMaps(tasks).idToSeq);
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
      if (!after) return reply.code(400).send({ error: "afterId does not exist" });
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

    const tasks = await recomputeProject();
    return reply.code(201).send(forClient(tasks).find((t) => t.id === created.id)!);
  });

  // --- AUTOSAVE / EDITAR (last-write-wins por campo) ---
  // La ruta es solo HTTP: leer, delegar y responder. Qué se puede escribir y qué error
  // corresponde lo decide `buildTaskPatch`, que es puro y está testeado (lib/patch.ts).
  app.patch("/api/tasks/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    // Una sola lectura para todo: el estado de la fila, si es padre y el grafo de
    // dependencias salen de acá (antes eran un findUnique, un COUNT y otro findMany).
    const all = await prisma.task.findMany();
    if (!all.some((t) => t.id === id)) {
      return reply.code(404).send({ error: "Task not found" });
    }

    const result = buildTaskPatch({
      id,
      body: (req.body ?? {}) as Record<string, unknown>,
      tasks: all as unknown as PatchTask[],
    });
    if (!result.ok) return reply.code(result.status).send({ error: result.error });

    await prisma.task.update({ where: { id }, data: result.data });
    // Recalcula roll-up de ancestros si cambiaron fechas, y devuelve el proyecto ya
    // recalculado: no hace falta volver a leer la tabla para responder.
    const tasks = await recomputeProject();
    return forClient(tasks).find((t) => t.id === id)!;
  });

  /**
   * Todas las filas + sus hijos ya agrupados y ordenados. Las operaciones de estructura
   * (mover, indentar, sacar de nivel) necesitan hermanos, hijos y el grafo de
   * dependencias: sale todo de UNA lectura en vez de una query por pregunta.
   */
  const loadProject = async () => {
    const all = await prisma.task.findMany();
    const childrenByParent = groupChildren(all);
    return {
      all,
      childrenByParent,
      siblingsOf: (parentId: number | null) => childrenByParent.get(parentId) ?? [],
    };
  };

  // --- MOVER ARRIBA / ABAJO ---
  // Entre hermanos, y en los extremos del grupo CRUZA al grupo de al lado conservando el
  // nivel (ver resolveMove). Cruzar cambia de padre, así que valida ciclos como el indent.
  app.post("/api/tasks/:id/move", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const dir = ((req.body as { direction?: string })?.direction ?? "").toLowerCase();
    if (dir !== "up" && dir !== "down") {
      return reply.code(400).send({ error: 'direction must be "up" or "down"' });
    }
    const { all } = await loadProject();
    const task = all.find((t) => t.id === id);
    if (!task) return reply.code(404).send({ error: "Task not found" });

    const plan = resolveMove(all, id, dir);
    if (!plan) return forClient([...all].sort((a, b) => a.order - b.order)); // no-op

    if (plan.kind === "swap") {
      const other = all.find((t) => t.id === plan.otherId)!;
      await prisma.$transaction([
        prisma.task.update({ where: { id: task.id }, data: { order: other.order } }),
        prisma.task.update({ where: { id: other.id }, data: { order: task.order } }),
      ]);
    } else {
      const conflict = findReparentConflict(all, id, plan.newParentId);
      if (conflict) {
        return reply
          .code(409)
          .send({ error: reparentError("move", conflict, all, buildMaps(all).idToSeq) });
      }
      await prisma.task.update({
        where: { id },
        data: { parentId: plan.newParentId, order: plan.newOrder },
      });
    }
    return forClient(await recomputeProject());
  });

  // --- INDENT (convertir en hijo del hermano anterior) ---
  app.post("/api/tasks/:id/indent", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { all, childrenByParent, siblingsOf } = await loadProject();
    const task = all.find((t) => t.id === id);
    if (!task) return reply.code(404).send({ error: "Task not found" });

    const sibs = siblingsOf(task.parentId);
    const idx = sibs.findIndex((s) => s.id === id);
    if (idx <= 0) {
      return reply.code(400).send({ error: "No previous sibling: cannot indent" });
    }
    const newParent = sibs[idx - 1];

    // Indentar cambia los ancestros de toda la rama, así que puede volver circular una
    // dependencia existente sin tocar el campo: se rechaza en vez de dejar el dato en un
    // estado inválido o borrarlo por su cuenta. Misma validación que el cruce de grupo de
    // `move`: las dos operaciones agregan la arista de roll-up hijo → padre nuevo.
    const conflict = findReparentConflict(all, id, newParent.id);
    if (conflict) {
      return reply
        .code(409)
        .send({ error: reparentError("indent", conflict, all, buildMaps(all).idToSeq) });
    }

    // Se añade como último hijo del nuevo padre.
    const newParentKids = childrenByParent.get(newParent.id) ?? [];
    const lastChild = newParentKids[newParentKids.length - 1];
    const newOrder = (lastChild?.order ?? newParent.order) + 1;
    await prisma.task.update({
      where: { id },
      data: { parentId: newParent.id, order: newOrder },
    });
    return forClient(await recomputeProject());
  });

  // --- OUTDENT (subir un nivel, quedando justo después del antiguo padre) ---
  app.post("/api/tasks/:id/outdent", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const { all, siblingsOf } = await loadProject();
    const task = all.find((t) => t.id === id);
    if (!task) return reply.code(404).send({ error: "Task not found" });
    if (task.parentId === null) {
      return reply.code(400).send({ error: "Already at root level: cannot outdent" });
    }
    const parent = all.find((t) => t.id === task.parentId);
    if (!parent) return reply.code(500).send({ error: "Inconsistent parent" });

    const grandparentId = parent.parentId; // puede ser null (nivel raíz)
    const groupSibs = siblingsOf(grandparentId); // hermanos del padre
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
    return forClient(await recomputeProject());
  });

  // --- BORRAR (delete row) ---
  // Los hijos se borran en cascada (onDelete: Cascade en el schema).
  app.delete("/api/tasks/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const exists = await prisma.task.findUnique({ where: { id } });
    if (!exists) return reply.code(404).send({ error: "Task not found" });

    await prisma.task.delete({ where: { id } });
    await recomputeProject();
    return reply.code(204).send();
  });
}
