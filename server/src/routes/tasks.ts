// Rutas de tareas: CRUD + autosave (last-write-wins por campo).
// Tras cada mutación se recalcula WBS y roll-up de padres (recomputeProject).

import type { FastifyInstance } from "fastify";
import { prisma } from "../db.ts";
import { recalcDates } from "../lib/recalc.ts";
import { recomputeProject, isParent } from "../services/project.ts";
import { computeCriticalPath, type CriticalTask } from "../lib/critical.ts";
import { makeClosesCycle, parseDependencies, remapDependencies } from "../lib/deps.ts";
import {
  findReparentConflict,
  resolveMove,
  type ReparentConflict,
} from "../lib/move.ts";
import { makeIsAncestor } from "../lib/tree.ts";
import { clampPercent } from "../lib/progress.ts";
import { BAR_COLOR_KEYS, normalizeBarColor } from "../lib/barColors.ts";

// Campos de contenido editables directamente (no disparan recálculo de fechas).
const CONTENT_FIELDS = ["title", "owner", "descriptionMd"] as const;
// Campos que disparan el motor de recálculo de fechas.
const DATE_FIELDS = ["start", "end", "durationDays"] as const;

// El ID VISIBLE de una tarea es `order + 1` (secuencial 1..N que se renumera solo).
// La clave interna (`id`) es estable y es a la que apuntan las Dependencies almacenadas.
// Estas utilidades traducen las Dependencies entre ambos mundos en el borde de la API.
type SeqTask = { id: number; order: number; dependencies: string | null };
function buildMaps(tasks: SeqTask[]) {
  const idToSeq = new Map<number, number>();
  const seqToId = new Map<number, number>();
  for (const t of tasks) {
    const seq = t.order + 1;
    idToSeq.set(t.id, seq);
    seqToId.set(seq, t.id);
  }
  return { idToSeq, seqToId };
}
// Devuelve la tarea con sus Dependencies traducidas a ID visible (para el cliente).
function toSeq<T extends { dependencies: string | null }>(task: T, idToSeq: Map<number, number>): T {
  return { ...task, dependencies: remapDependencies(task.dependencies, idToSeq) };
}

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
  // Lista ordenada con Dependencies ya traducidas a ID visible (para el cliente).
  const listForClient = async () => {
    const tasks = await prisma.task.findMany({ orderBy: { order: "asc" } });
    const { idToSeq } = buildMaps(tasks);
    return tasks.map((t) => toSeq(t, idToSeq));
  };

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

    await recomputeProject();
    const tasks = await prisma.task.findMany({ orderBy: { order: "asc" } });
    const fresh = tasks.find((t) => t.id === created.id)!;
    return reply.code(201).send(toSeq(fresh, buildMaps(tasks).idToSeq));
  });

  // --- AUTOSAVE / EDITAR (last-write-wins por campo) ---
  app.patch("/api/tasks/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const current = await prisma.task.findUnique({ where: { id } });
    if (!current) return reply.code(404).send({ error: "Task not found" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};

    // Campos de contenido: se aplican tal cual.
    for (const f of CONTENT_FIELDS) {
      if (f in body) data[f] = body[f];
    }

    // Las fechas de un padre son calculadas (roll-up de los hijos), y las
    // Dependencies son justamente la entrada del scheduling: en un padre no
    // significan nada (el scheduler solo programa hojas), así que tampoco se aceptan.
    // El avance de un padre también es roll-up (promedio de los hijos ponderado por
    // duración), así que tampoco se escribe a mano.
    const touchesDates = DATE_FIELDS.some((f) => f in body);
    const touchesDeps = "dependencies" in body;
    const touchesProgress = "progress" in body;
    const parent =
      touchesDates || touchesDeps || touchesProgress ? await isParent(id) : false;
    if (parent && touchesProgress) {
      return reply.code(409).send({
        error:
          "% Complete of a parent row is rolled up from its children (a duration-weighted average), so it is not editable. Set it on the children instead.",
      });
    }
    // Color de la barra: es estilo, no programación. Se acepta en cualquier fila
    // (también en un padre: su barra de resumen se pinta igual) y no dispara nada.
    if ("barColor" in body) {
      const color = normalizeBarColor(body.barColor);
      if (color === undefined) {
        return reply.code(400).send({
          error: `Unknown bar colour. Use one of: ${BAR_COLOR_KEYS.join(", ")} (or empty for the default).`,
        });
      }
      data.barColor = color;
    }
    if (touchesProgress) {
      const n = Number(body.progress);
      if (!Number.isFinite(n)) {
        return reply.code(400).send({ error: "% Complete must be a number between 0 and 100" });
      }
      data.progress = clampPercent(n);
    }
    if (parent && touchesDates) {
      return reply
        .code(409)
        .send({ error: "Start/End/Duration of a parent row are rolled up from its children (not editable)" });
    }
    if (parent && touchesDeps) {
      return reply.code(409).send({
        error:
          "A parent row cannot have dependencies: its dates are rolled up from its children. Set the dependency on the first child instead.",
      });
    }

    // Dependencies: llegan en ID VISIBLE (seq) → traducir a id interno antes de guardar.
    if (touchesDeps) {
      const all = await prisma.task.findMany();
      const { seqToId, idToSeq } = buildMaps(all);
      const raw = body.dependencies == null ? "" : String(body.dependencies);
      const internal = remapDependencies(raw, seqToId);

      // Una fila no puede depender de un ANCESTRO: las fechas del ancestro son el
      // roll-up de esta misma fila, así que la restricción es circular (el scheduler
      // se iría empujando la fila en cada iteración).
      const isAncestor = makeIsAncestor(all);
      const ancestorDep = parseDependencies(internal).find((d) => isAncestor(d.predId, id));
      if (ancestorDep) {
        return reply.code(409).send({
          error: `A row cannot depend on ID ${idToSeq.get(ancestorDep.predId)}: that row is its parent (or an ancestor), and its dates are rolled up from this one.`,
        });
      }

      // Y tampoco un CICLO: ni apuntarse a sí misma, ni depender de algo que ya depende
      // de ella (directa o indirectamente). Aplicarlo hacía divergir el punto fijo del
      // scheduler, que terminaba cortando por su tope de iteraciones: las fechas salían
      // disparatadas y encima dependían del tamaño del proyecto. Se valida sobre el grafo
      // con el valor candidato ya aplicado.
      const candidate = all.map((t) => (t.id === id ? { ...t, dependencies: internal } : t));
      const closesCycle = makeClosesCycle(candidate);
      const cyclicDep = parseDependencies(internal).find((d) => closesCycle(id, d.predId));
      if (cyclicDep) {
        return reply.code(409).send({
          error:
            cyclicDep.predId === id
              ? `A row cannot depend on itself (ID ${idToSeq.get(id)}).`
              : `That dependency would be circular: ID ${idToSeq.get(cyclicDep.predId)} already depends on this row, directly or through other rows.`,
        });
      }
      data.dependencies = internal;
    }

    // Campos de fecha: pasan por el motor de recálculo.
    if (touchesDates) {
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
      return reply.code(400).send({ error: "No editable field in the request body" });
    }

    await prisma.task.update({ where: { id }, data });
    await recomputeProject(); // actualiza roll-up de ancestros si cambiaron fechas
    const tasks = await prisma.task.findMany({ orderBy: { order: "asc" } });
    return toSeq(tasks.find((t) => t.id === id)!, buildMaps(tasks).idToSeq);
  });

  // Helper: hermanos (misma parentId) ordenados.
  const siblingsOf = (parentId: number | null) =>
    prisma.task.findMany({ where: { parentId }, orderBy: { order: "asc" } });

  // --- MOVER ARRIBA / ABAJO ---
  // Entre hermanos, y en los extremos del grupo CRUZA al grupo de al lado conservando el
  // nivel (ver resolveMove). Cruzar cambia de padre, así que valida ciclos como el indent.
  app.post("/api/tasks/:id/move", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const dir = ((req.body as { direction?: string })?.direction ?? "").toLowerCase();
    if (dir !== "up" && dir !== "down") {
      return reply.code(400).send({ error: 'direction must be "up" or "down"' });
    }
    const all = await prisma.task.findMany();
    const task = all.find((t) => t.id === id);
    if (!task) return reply.code(404).send({ error: "Task not found" });

    const plan = resolveMove(all, id, dir);
    if (!plan) return listForClient(); // borde sin grupo al lado: no-op

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
    await recomputeProject();
    return listForClient();
  });

  // --- INDENT (convertir en hijo del hermano anterior) ---
  app.post("/api/tasks/:id/indent", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return reply.code(404).send({ error: "Task not found" });

    const sibs = await siblingsOf(task.parentId);
    const idx = sibs.findIndex((s) => s.id === id);
    if (idx <= 0) {
      return reply.code(400).send({ error: "No previous sibling: cannot indent" });
    }
    const newParent = sibs[idx - 1];

    // Indentar cambia los ancestros de toda la rama, así que puede volver circular una
    // dependencia existente sin tocar el campo: se rechaza en vez de dejar el dato en un
    // estado inválido o borrarlo por su cuenta. Misma validación que el cruce de grupo de
    // `move`: las dos operaciones agregan la arista de roll-up hijo → padre nuevo.
    const all = await prisma.task.findMany();
    const conflict = findReparentConflict(all, id, newParent.id);
    if (conflict) {
      return reply
        .code(409)
        .send({ error: reparentError("indent", conflict, all, buildMaps(all).idToSeq) });
    }

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
    return listForClient();
  });

  // --- OUTDENT (subir un nivel, quedando justo después del antiguo padre) ---
  app.post("/api/tasks/:id/outdent", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return reply.code(404).send({ error: "Task not found" });
    if (task.parentId === null) {
      return reply.code(400).send({ error: "Already at root level: cannot outdent" });
    }
    const parent = await prisma.task.findUnique({ where: { id: task.parentId } });
    if (!parent) return reply.code(500).send({ error: "Inconsistent parent" });

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
    return listForClient();
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
