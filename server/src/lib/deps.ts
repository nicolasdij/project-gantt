// Parseo del campo `dependencies` (texto libre) a estructura.
// Formato por token: "<ID><TIPO>" — ej. "3FS", "5SS", "12FF".
// El tipo por defecto (si se omite) es FS. Varios separados por coma/espacio/;.
// Tipos soportados en v1: FS, SS, FF. SF queda FUERA de alcance y se ignora.

export type DepType = "FS" | "SS" | "FF";
export type Dependency = { predId: number; type: DepType };

const SUPPORTED: DepType[] = ["FS", "SS", "FF"];

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
