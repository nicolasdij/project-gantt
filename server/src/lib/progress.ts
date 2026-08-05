// Roll-up de avance (% completado) de las filas padre.
//
// En una hoja el porcentaje lo escribe el usuario. En un padre es CALCULADO: el
// promedio de sus hijos PONDERADO POR DURACIÓN, que es lo que hace que el número
// signifique algo (un hijo de 10d al 100% pesa el doble que uno de 5d al 100%).
// Se resuelve en post-orden, así un padre de padres pondera con la duración de
// roll-up de cada rama.

import { groupChildren } from "./tree.ts";

export type ProgressTask = {
  id: number;
  parentId: number | null;
  order: number;
  progress: number;
  // Peso del hijo en el promedio. Se pasa la duración YA recalculada (la del
  // scheduling de esta misma pasada), no la que hay en la base: si no, el padre
  // ponderaría con una duración vieja durante un cambio de fechas.
  durationDays: number;
};

/** Recorta a un entero 0..100 (defensivo: la API ya valida lo que entra). */
export function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Devuelve el % de cada tarea: el propio en las hojas, el roll-up en los padres. */
export function computeProgress(tasks: ProgressTask[]): Map<number, number> {
  const childrenByParent = groupChildren(tasks);
  const result = new Map<number, number>();

  const resolve = (t: ProgressTask): number => {
    const kids = childrenByParent.get(t.id) ?? [];
    if (kids.length === 0) {
      const own = clampPercent(t.progress);
      result.set(t.id, own);
      return own;
    }
    const values = kids.map((k) => ({ pct: resolve(k), weight: Math.max(0, k.durationDays) }));
    const totalWeight = values.reduce((acc, v) => acc + v.weight, 0);
    // Todos los hijos con peso 0 (p. ej. si son milestones) daría 0/0: en ese caso
    // se cae a promedio simple, que es lo único con sentido cuando no hay duraciones
    // que comparar.
    const pct =
      totalWeight > 0
        ? values.reduce((acc, v) => acc + v.pct * v.weight, 0) / totalWeight
        : values.reduce((acc, v) => acc + v.pct, 0) / values.length;
    // Se redondea en cada nivel a propósito: el padre pondera con los valores que se
    // VEN en el grid, así el número de arriba se puede reproducir a mano desde los de
    // abajo (a costa de unas décimas de arrastre en árboles profundos).
    const rounded = clampPercent(pct);
    result.set(t.id, rounded);
    return rounded;
  };

  (childrenByParent.get(null) ?? []).forEach(resolve);
  // Filas no alcanzadas desde las raíces (dato inconsistente: parentId que no existe):
  // conservan su propio valor en vez de quedar sin resultado.
  for (const t of tasks) {
    if (!result.has(t.id)) result.set(t.id, clampPercent(t.progress));
  }
  return result;
}
