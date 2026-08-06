// Parseo del campo `dependencies` (texto libre) a estructura.
// Formato por token: "<ID><TIPO><±LAG>" — ej. "3FS", "5SS+2d", "12FF-1d".
// El tipo por defecto (si se omite) es FS y el lag por defecto es 0. Varios tokens
// separados por coma/espacio/;.
// Tipos soportados en v1: FS, SS, FF. SF queda FUERA de alcance y se ignora.
//
// LAG (retardo) / LEAD (adelanto): el número con signo corre la fecha que impone la
// dependencia, en DÍAS LABORABLES —la misma unidad que Duration—, y la `d` es opcional
// ("3FS+1" == "3FS+1d"). "ID#3 empieza 1 día después de que termine ID#2" es "2FS+1d".
// Un lag negativo solapa las tareas: "2FS-1d" arranca el mismo día en que termina el 2.
// Los porcentajes de MS Project ("3FS+50%") y sus días corridos ("+1ed") quedan fuera:
// son otra semántica de calendario y el motor entero cuenta días laborables.

export type DepType = "FS" | "SS" | "FF";
export type Dependency = { predId: number; type: DepType; lag: number };

const SUPPORTED: DepType[] = ["FS", "SS", "FF"];

/**
 * Tope del |lag|, en días laborables (~10 años). Un token que lo pase se descarta como
 * cualquier otro malformado: es un typo, y sin tope el desplazamiento se hace día por
 * día, así que un número disparatado colgaría al scheduler en vez de dar una fecha mala.
 */
export const MAX_LAG_DAYS = 3650;

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
 * Serializa una dependencia al formato del campo. Es el inverso de parseDependencies y
 * el ÚNICO lugar que arma el token: el remapeo de IDs de la API pasa por acá, así que
 * olvidarse del lag lo borraría en cada ida y vuelta al servidor.
 * El lag 0 no se escribe: "3FS" y no "3FS+0d".
 */
export function formatDependency(d: Dependency): string {
  const lag = d.lag === 0 ? "" : `${d.lag > 0 ? "+" : "-"}${Math.abs(d.lag)}d`;
  return `${d.predId}${d.type}${lag}`;
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
      return n != null ? formatDependency({ ...d, predId: n }) : null;
    })
    .filter((x): x is string => x !== null);
  return out.join(", ");
}

// "<ID>" "<TIPO>"? ("+"|"-" "<LAG>" "d"?)? — sin espacios internos: los tokens se separan
// por espacio, así que cada uno llega ya pegado (ver parseDependencies).
const TOKEN_RE = /^(\d+)([a-zA-Z]{2})?(?:([+-])(\d+)[dD]?)?$/;

export function parseDependencies(raw: string | null | undefined): Dependency[] {
  if (!raw) return [];
  // El signo del lag se pega a su número ANTES de tokenizar. Un "3FS + 1d" tipeado con
  // espacios se partiría en tres pedazos y dejaría un "3FS" válido: el peor resultado
  // posible, porque programa igual pero ignorando en silencio el lag que se pidió.
  const glued = raw.replace(/\s*([+-])\s*/g, "$1");
  const tokens = glued.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
  const deps: Dependency[] = [];
  for (const tok of tokens) {
    const m = tok.match(TOKEN_RE);
    if (!m) continue;
    const predId = Number(m[1]);
    const type = (m[2]?.toUpperCase() ?? "FS") as DepType;
    if (!SUPPORTED.includes(type)) continue; // ignora SF u otros no soportados
    const lag = m[4] ? Number(m[4]) * (m[3] === "-" ? -1 : 1) : 0;
    if (Math.abs(lag) > MAX_LAG_DAYS) continue; // fuera de rango: token descartado
    deps.push({ predId, type, lag });
  }
  return deps;
}
