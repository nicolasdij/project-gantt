// Parseo del campo `dependencies` en el cliente (para dibujar las flechas).
// Debe reflejar el parser del server (FS/SS/FF; SF fuera de alcance; default FS; lag
// opcional con signo en días laborables, "3FS+1d"). Si el cliente no reconociera un
// token que el server sí acepta, la dependencia programaría fechas sin flecha que las
// explique — y al revés, dibujaría una flecha que no programa nada.
export type DepType = "FS" | "SS" | "FF";
export type Dependency = { predId: number; type: DepType; lag: number };

const SUPPORTED: DepType[] = ["FS", "SS", "FF"];

/** Tope del |lag| en días laborables; igual que en el server. */
export const MAX_LAG_DAYS = 3650;

const TOKEN_RE = /^(\d+)([a-zA-Z]{2})?(?:([+-])(\d+)[dD]?)?$/;

export function parseDependencies(raw: string | null | undefined): Dependency[] {
  if (!raw) return [];
  // Igual que el server: el signo se pega a su número antes de tokenizar, así un
  // "3FS + 1d" no se parte en tres pedazos.
  const glued = raw.replace(/\s*([+-])\s*/g, "$1");
  const tokens = glued.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
  const deps: Dependency[] = [];
  for (const tok of tokens) {
    const m = tok.match(TOKEN_RE);
    if (!m) continue;
    const predId = Number(m[1]);
    const type = (m[2]?.toUpperCase() ?? "FS") as DepType;
    if (!SUPPORTED.includes(type)) continue;
    const lag = m[4] ? Number(m[4]) * (m[3] === "-" ? -1 : 1) : 0;
    if (Math.abs(lag) > MAX_LAG_DAYS) continue;
    deps.push({ predId, type, lag });
  }
  return deps;
}
