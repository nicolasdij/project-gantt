// Parseo del campo `dependencies` en el cliente (para dibujar las flechas).
// Debe reflejar el parser del server (FS/SS/FF; SF fuera de alcance; default FS).
export type DepType = "FS" | "SS" | "FF";
export type Dependency = { predId: number; type: DepType };

const SUPPORTED: DepType[] = ["FS", "SS", "FF"];

export function parseDependencies(raw: string | null | undefined): Dependency[] {
  if (!raw) return [];
  const tokens = raw.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
  const deps: Dependency[] = [];
  for (const tok of tokens) {
    const m = tok.match(/^(\d+)\s*([a-zA-Z]{2})?$/);
    if (!m) continue;
    const predId = Number(m[1]);
    const type = (m[2]?.toUpperCase() ?? "FS") as DepType;
    if (!SUPPORTED.includes(type)) continue;
    deps.push({ predId, type });
  }
  return deps;
}
