// Cálculo de estructura del árbol: WBS jerárquico, orden global (pre-orden) y
// marca de "es padre". Las FECHAS (scheduling + roll-up) se calculan aparte en
// schedule.ts, para separar estructura de programación.

export type TreeTask = {
  id: number;
  parentId: number | null;
  order: number;
};

export type StructureFields = {
  id: number;
  wbs: string;
  // Orden global en PRE-ORDEN (padre antes que hijos), normalizado 0..N-1.
  order: number;
  isParent: boolean;
};

/**
 * Devuelve `esAncestro(candidato, id)`: si `candidato` es padre, abuelo, … de `id`.
 * Se usa para rechazar dependencias circulares (una fila no puede depender de un
 * ancestro, porque las fechas del ancestro se derivan de ella).
 * Construye el mapa una sola vez, para consultas repetidas.
 */
export function makeIsAncestor(tasks: { id: number; parentId: number | null }[]) {
  const parentOf = new Map(tasks.map((t) => [t.id, t.parentId]));
  return (candidate: number, id: number): boolean => {
    const seen = new Set<number>([id]); // guarda contra datos con ciclos de jerarquía
    let p = parentOf.get(id) ?? null;
    while (p != null && !seen.has(p)) {
      if (p === candidate) return true;
      seen.add(p);
      p = parentOf.get(p) ?? null;
    }
    return false;
  };
}

/** Agrupa hijos por padre y ordena cada grupo por `order`. */
export function groupChildren<T extends TreeTask>(tasks: T[]): Map<number | null, T[]> {
  const byParent = new Map<number | null, T[]>();
  for (const t of tasks) {
    const key = t.parentId ?? null;
    const list = byParent.get(key) ?? [];
    list.push(t);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);
  return byParent;
}

/** Calcula WBS + orden global + isParent para todas las tareas. */
export function computeStructure(tasks: TreeTask[]): Map<number, StructureFields> {
  const childrenByParent = groupChildren(tasks);
  const result = new Map<number, StructureFields>();

  let orderCounter = 0;
  const walk = (parentId: number | null, prefix: string) => {
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.forEach((t, i) => {
      const wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      result.set(t.id, {
        id: t.id,
        wbs,
        order: orderCounter++,
        isParent: (childrenByParent.get(t.id)?.length ?? 0) > 0,
      });
      walk(t.id, wbs);
    });
  };
  walk(null, "");

  return result;
}
