// Parseo del campo `dependencies` (texto libre) a estructura.
// Formato por token: "<ID><TIPO>" — ej. "3FS", "5SS", "12FF".
// El tipo por defecto (si se omite) es FS. Varios separados por coma/espacio/;.
// Tipos soportados en v1: FS, SS, FF. SF queda FUERA de alcance y se ignora.

export type DepType = "FS" | "SS" | "FF";
export type Dependency = { predId: number; type: DepType };

const SUPPORTED: DepType[] = ["FS", "SS", "FF"];

/** Lo mínimo que hace falta para armar el grafo de programación. */
export type DepGraphTask = { id: number; parentId: number | null; dependencies: string | null };

/**
 * Devuelve `cierraCiclo(succId, predId)`: si la dependencia "succ depende de pred"
 * forma parte de un ciclo.
 *
 * El grafo tiene DOS clases de aristas, porque las dos propagan fechas:
 *   - dependencia: pred → succ (el sucesor se programa desde el predecesor);
 *   - roll-up:     hijo → padre (las fechas del padre se derivan de sus hijos).
 * Un ciclo acá es exactamente lo que hacía divergir el punto fijo del scheduler: cada
 * iteración empujaba las fechas un poco más y el resultado terminaba dependiendo del
 * tope de iteraciones (o sea, del tamaño del proyecto).
 *
 * La dependencia succ←pred cierra un ciclo ⇔ `pred` ya está AGUAS ABAJO de `succ`
 * (se llega de succ a pred siguiendo esas aristas). La pregunta no depende de la
 * arista en cuestión —que va hacia succ, no desde succ—, así que el resultado es el
 * mismo antes y después de agregarla: sirve igual para validar en la API y para
 * descartar aristas en el motor.
 */
export function makeClosesCycle(tasks: DepGraphTask[]) {
  // Aguas abajo de un nodo: los que dependen de él, más su padre (roll-up).
  const downstream = new Map<number, number[]>();
  const exists = new Set(tasks.map((t) => t.id));
  const link = (from: number, to: number) => {
    const list = downstream.get(from);
    if (list) list.push(to);
    else downstream.set(from, [to]);
  };
  for (const t of tasks) {
    if (t.parentId != null && exists.has(t.parentId)) link(t.id, t.parentId);
    for (const d of parseDependencies(t.dependencies)) {
      if (exists.has(d.predId)) link(d.predId, t.id);
    }
  }

  const cache = new Map<number, Set<number>>();
  const reachableFrom = (id: number): Set<number> => {
    const hit = cache.get(id);
    if (hit) return hit;
    const seen = new Set<number>();
    const queue = [...(downstream.get(id) ?? [])];
    while (queue.length > 0) {
      const next = queue.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...(downstream.get(next) ?? []));
    }
    cache.set(id, seen);
    return seen;
  };

  return (succId: number, predId: number): boolean =>
    succId === predId || reachableFrom(succId).has(predId);
}

/**
 * Reescribe los números de un string de dependencias usando `map`.
 * Se usa para traducir entre la clave interna estable y el ID visible (order+1):
 *   - al LEER: map = idInterno → IDvisible
 *   - al ESCRIBIR: map = IDvisible → idInterno
 * Los tokens cuyo número no está en el mapa (ej. predecesor borrado) se descartan.
 */
export function remapDependencies(
  raw: string | null | undefined,
  map: Map<number, number>,
): string | null {
  if (!raw) return raw ?? null;
  const out = parseDependencies(raw)
    .map((d) => {
      const n = map.get(d.predId);
      return n != null ? `${n}${d.type}` : null;
    })
    .filter((x): x is string => x !== null);
  return out.join(", ");
}

export function parseDependencies(raw: string | null | undefined): Dependency[] {
  if (!raw) return [];
  const tokens = raw.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
  const deps: Dependency[] = [];
  for (const tok of tokens) {
    const m = tok.match(/^(\d+)\s*([a-zA-Z]{2})?$/);
    if (!m) continue;
    const predId = Number(m[1]);
    const type = (m[2]?.toUpperCase() ?? "FS") as DepType;
    if (!SUPPORTED.includes(type)) continue; // ignora SF u otros no soportados
    deps.push({ predId, type });
  }
  return deps;
}
