// Movimientos estructurales de filas: a dónde aterriza un Move Up/Down, y si reparentar
// cerraría un ciclo de dependencias (esto último lo comparten move e indent, porque la
// arista que agregan —hijo → padre nuevo— es la misma).
//
// Move Up/Down mueve entre HERMANOS, y en los extremos del grupo CRUZA al grupo de al
// lado conservando el nivel: el primer hijo pasa a ser el último del grupo anterior, y el
// último hijo, el primero del grupo siguiente. Antes ahí no hacía nada y la única salida
// era outdent → subir → indent, que además dejaba la fila en otro nivel en el medio.

import { makeClosesCycle, parseDependencies } from "./deps.ts";
import { groupChildren, makeIsAncestor } from "./tree.ts";

export type MoveTask = { id: number; parentId: number | null; order: number };

export type MovePlan =
  /** Reordenar entre hermanos: intercambia el `order` con esa fila. */
  | { kind: "swap"; otherId: number }
  /** Cruzar al grupo de al lado: cambia de padre y conserva el nivel. */
  | { kind: "reparent"; newParentId: number; newOrder: number };

/**
 * Decide qué hace un Move Up/Down. Devuelve `null` si no hay nada que hacer:
 * ya está en el borde y no hay grupo hermano al que cruzar.
 *
 * El `newOrder` del cruce solo tiene que ser correcto RELATIVO a los hermanos nuevos
 * (mayor que el último, o menor que el primero): `recomputeProject` renumera el orden
 * global después, y `groupChildren` ordena cada grupo por separado, así que un empate
 * con una fila de otro grupo no cambia nada.
 */
export function resolveMove(
  tasks: MoveTask[],
  id: number,
  direction: "up" | "down",
): MovePlan | null {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const task = byId.get(id);
  if (!task) return null;

  const childrenByParent = groupChildren(tasks);
  const sibs = childrenByParent.get(task.parentId ?? null) ?? [];
  const idx = sibs.findIndex((s) => s.id === id);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx >= 0 && swapIdx < sibs.length) {
    return { kind: "swap", otherId: sibs[swapIdx].id };
  }

  // Está en el borde de su grupo: se intenta cruzar al grupo hermano.
  if (task.parentId == null) return null; // nivel raíz: no hay grupo del que salir
  const parent = byId.get(task.parentId);
  if (!parent) return null;
  const parentSibs = childrenByParent.get(parent.parentId ?? null) ?? [];
  const pIdx = parentSibs.findIndex((p) => p.id === parent.id);
  const target = parentSibs[direction === "up" ? pIdx - 1 : pIdx + 1];
  if (!target) return null; // el grupo ya es el primero (o el último) de su nivel

  // El hermano tiene que ser YA un grupo. Si es una hoja, meterle un hijo la convertiría
  // en fila de resumen: perdería sus fechas (pasarían a ser roll-up de este mismo hijo) y
  // sus dependencias quedarían inertes. Eso no es "mover una fila", así que no se hace.
  const targetKids = childrenByParent.get(target.id) ?? [];
  if (targetKids.length === 0) return null;

  const newOrder =
    direction === "up"
      ? targetKids[targetKids.length - 1].order + 1 // último hijo del grupo anterior
      : targetKids[0].order - 1; // primer hijo del grupo siguiente
  return { kind: "reparent", newParentId: target.id, newOrder };
}

export type ReparentTask = { id: number; parentId: number | null; dependencies: string | null };

export type ReparentConflict = {
  /** `direct`: la fila depende del padre nuevo (o de un ancestro suyo). */
  kind: "direct" | "indirect";
  taskId: number;
  predId: number;
};

/**
 * ¿Colgar `movedId` de `newParentId` cerraría un ciclo? Devuelve la dependencia que
 * estorba, o `null` si el movimiento es válido.
 *
 * Reparentar cambia los ancestros de TODA la rama movida, así que puede volver circular
 * una dependencia existente sin que nadie toque el campo. Son dos preguntas distintas:
 *   - `direct`: alguien de la rama depende del padre nuevo o de un ancestro suyo, o sea
 *     de una fila cuyas fechas van a ser el roll-up de esta misma. Se detecta aparte
 *     porque permite señalar exactamente qué fila y qué dependencia estorban.
 *   - `indirect`: el ciclo pasa por la arista de roll-up que agrega el movimiento (X
 *     depende de Y, Y de B, y B se cuelga de X). Se revisa el grafo completo con el
 *     movimiento ya aplicado. Antes del movimiento no hay ciclos —la API los rechaza—,
 *     así que cualquiera que aparezca lo causa este movimiento.
 */
export function findReparentConflict(
  tasks: ReparentTask[],
  movedId: number,
  newParentId: number,
): ReparentConflict | null {
  const isAncestor = makeIsAncestor(tasks);
  const inMovedBranch = (t: ReparentTask) => t.id === movedId || isAncestor(movedId, t.id);
  const becomesAncestor = (predId: number) =>
    predId === newParentId || isAncestor(predId, newParentId);

  for (const t of tasks) {
    if (!inMovedBranch(t)) continue;
    const direct = parseDependencies(t.dependencies).find((d) => becomesAncestor(d.predId));
    if (direct) return { kind: "direct", taskId: t.id, predId: direct.predId };
  }

  const moved = tasks.map((t) => (t.id === movedId ? { ...t, parentId: newParentId } : t));
  const closesCycle = makeClosesCycle(moved);
  for (const t of moved) {
    const cyclic = parseDependencies(t.dependencies).find((d) => closesCycle(t.id, d.predId));
    if (cyclic) return { kind: "indirect", taskId: t.id, predId: cyclic.predId };
  }
  return null;
}
