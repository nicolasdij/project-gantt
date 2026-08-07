// Validación y armado del PATCH de una tarea: del body que llegó, a los campos que se
// van a guardar — o al error que corresponde.
//
// Es una función PURA: no toca la base ni el `reply`. Las reglas del borde (qué no se
// escribe en una fila padre, qué dependencia es circular, qué valor no parsea) son
// reglas de NEGOCIO, y acá se pueden testear igual que los motores. Mientras vivieron
// dentro del handler eran el único código de negocio sin cobertura.
//
// El orden de los chequeos es: primero las reglas ESTRUCTURALES (esta fila no admite ese
// campo), después las de VALOR (ese campo no parsea). Con un body que viole las dos a la
// vez gana la estructural, que es la que explica por qué el campo no va.

import { recalcDates, type TaskDateFields } from "./recalc.ts";
import { clampPercent } from "./progress.ts";
import { BAR_COLOR_KEYS, normalizeBarColor } from "./barColors.ts";
import { makeClosesCycle, parseDependencies, remapDependencies } from "./deps.ts";
import { makeIsAncestor, makeIsParent } from "./tree.ts";
import { buildMaps } from "./seq.ts";

/** Lo que hace falta saber de cada fila del proyecto para validar un PATCH. */
export type PatchTask = TaskDateFields & {
  id: number;
  parentId: number | null;
  order: number;
  dependencies: string | null;
};

/** Campos que se aplican tal cual: son texto libre y no disparan nada. */
const CONTENT_FIELDS = ["title", "owner", "descriptionMd"] as const;
/** Campos que pasan por el motor de recálculo de fechas. */
const DATE_FIELDS = ["start", "end", "durationDays"] as const;

/**
 * Campos que SOLO existen en una hoja, con el motivo que se le devuelve al cliente.
 * Es una tabla y no cuatro `if` repartidos por el handler: la regla es una sola —"esta
 * fila no admite ese campo"— y agregar el próximo campo derivado es una entrada más.
 *
 * Ojo con el matiz: los tres primeros son DERIVADOS (lo que muestra un padre se
 * recalcula de sus hijos), pero el rótulo de la barra no se recalcula: se conserva y
 * solo deja de dibujarse. Por eso lo que se rechaza es ESCRIBIRLO en un padre, no
 * tenerlo guardado (ver SPEC, decisión 17).
 */
const LEAF_ONLY: { field: string; error: string }[] = [
  {
    field: "progress",
    error:
      "% Complete of a parent row is rolled up from its children (a duration-weighted average), so it is not editable. Set it on the children instead.",
  },
  {
    field: "barTitle",
    error:
      "A parent row cannot have a bar title: its bar is a summary rolled up from its children. Set it on the children instead.",
  },
  {
    field: "dependencies",
    error:
      "A parent row cannot have dependencies: its dates are rolled up from its children. Set the dependency on the first child instead.",
  },
  ...DATE_FIELDS.map((field) => ({
    field,
    error:
      "Start/End/Duration of a parent row are rolled up from its children (not editable)",
  })),
];

/** Campos que la ruta va a escribir. Se arma con claves sueltas, como el body. */
export type TaskPatchData = Record<string, unknown>;

export type PatchResult =
  | { ok: true; data: TaskPatchData }
  | { ok: false; status: 400 | 409; error: string };

export function buildTaskPatch(input: {
  id: number;
  body: Record<string, unknown>;
  /** Todas las filas del proyecto: hacen falta para las Dependencies y para saber si es padre. */
  tasks: PatchTask[];
}): PatchResult {
  const { id, body, tasks } = input;
  const current = tasks.find((t) => t.id === id);
  if (!current) return { ok: false, status: 400, error: "Task not found" };

  const data: TaskPatchData = {};
  const isParent = makeIsParent(tasks)(id);

  // --- Reglas estructurales: qué campos no admite ESTA fila ---
  if (isParent) {
    const forbidden = LEAF_ONLY.find((f) => f.field in body);
    if (forbidden) return { ok: false, status: 409, error: forbidden.error };
  }

  // --- Campos de contenido: tal cual ---
  for (const f of CONTENT_FIELDS) {
    if (f in body) data[f] = body[f];
  }

  // --- Color de la barra: es estilo, no programación. Se acepta en CUALQUIER fila
  //     (también en un padre: su barra de resumen se pinta igual). ---
  if ("barColor" in body) {
    const color = normalizeBarColor(body.barColor);
    if (color === undefined) {
      return {
        ok: false,
        status: 400,
        error: `Unknown bar colour. Use one of: ${BAR_COLOR_KEYS.join(", ")} (or empty for the default).`,
      };
    }
    data.barColor = color;
  }

  // --- Rótulo de la barra ---
  if ("barTitle" in body) {
    // Vacío (o solo espacios) se guarda como null: "sin rótulo" es un único valor, el
    // mismo con el que quedaron todas las filas anteriores a este campo.
    const text = body.barTitle == null ? "" : String(body.barTitle).trim();
    data.barTitle = text || null;
  }

  // --- Avance ---
  if ("progress" in body) {
    const n = Number(body.progress);
    if (!Number.isFinite(n)) {
      return { ok: false, status: 400, error: "% Complete must be a number between 0 and 100" };
    }
    data.progress = clampPercent(n);
  }

  // --- Dependencies: llegan en ID VISIBLE → se guardan en id interno ---
  if ("dependencies" in body) {
    const deps = validateDependencies(id, body.dependencies, tasks);
    if (!deps.ok) return deps;
    data.dependencies = deps.internal;
  }

  // --- Fechas: pasan por el motor de recálculo ---
  if (DATE_FIELDS.some((f) => f in body)) {
    // El edit se arma SOLO con las claves presentes: el motor usa Object.keys para saber
    // qué campos se editaron (editar End no es lo mismo que editar Start).
    const edit: { start?: string | null; end?: string | null; durationDays?: number } = {};
    if ("start" in body) edit.start = body.start as string | null;
    if ("end" in body) edit.end = body.end as string | null;
    if ("durationDays" in body) edit.durationDays = Number(body.durationDays);

    const recalced = recalcDates(current, edit);
    data.start = recalced.start;
    data.end = recalced.end;
    data.durationDays = recalced.durationDays;
    data.isMilestone = recalced.isMilestone;
  }

  if (Object.keys(data).length === 0) {
    return { ok: false, status: 400, error: "No editable field in the request body" };
  }
  return { ok: true, data };
}

/**
 * Traduce y valida el campo Dependencies. Devuelve el texto ya en ids internos, o el
 * error: ni un ANCESTRO (sus fechas son el roll-up de esta misma fila) ni un CICLO.
 * Aplicar cualquiera de los dos hacía divergir el punto fijo del scheduler, que cortaba
 * por su tope de iteraciones: las fechas salían disparatadas y encima dependían del
 * tamaño del proyecto.
 */
function validateDependencies(
  id: number,
  raw: unknown,
  tasks: PatchTask[],
): { ok: true; internal: string | null } | { ok: false; status: 409; error: string } {
  const { seqToId, idToSeq } = buildMaps(tasks);
  const internal = remapDependencies(raw == null ? "" : String(raw), seqToId);

  const isAncestor = makeIsAncestor(tasks);
  const ancestorDep = parseDependencies(internal).find((d) => isAncestor(d.predId, id));
  if (ancestorDep) {
    return {
      ok: false,
      status: 409,
      error: `A row cannot depend on ID ${idToSeq.get(ancestorDep.predId)}: that row is its parent (or an ancestor), and its dates are rolled up from this one.`,
    };
  }

  // Se valida sobre el grafo con el valor candidato YA aplicado.
  const candidate = tasks.map((t) => (t.id === id ? { ...t, dependencies: internal } : t));
  const closesCycle = makeClosesCycle(candidate);
  const cyclicDep = parseDependencies(internal).find((d) => closesCycle(id, d.predId));
  if (cyclicDep) {
    return {
      ok: false,
      status: 409,
      error:
        cyclicDep.predId === id
          ? `A row cannot depend on itself (ID ${idToSeq.get(id)}).`
          : `That dependency would be circular: ID ${idToSeq.get(cyclicDep.predId)} already depends on this row, directly or through other rows.`,
    };
  }
  return { ok: true, internal };
}
