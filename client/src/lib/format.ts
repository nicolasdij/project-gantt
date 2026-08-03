// Utilidades de formato/parón para el grid.

/** Muestra la duración como "Nd" (los milestones son "0d"). */
export function formatDuration(days: number): string {
  return `${days}d`;
}

/**
 * Parsea la entrada de Duration del usuario: "Nd" / "Nw" / "N".
 * 1w = 5 días laborables. Devuelve días como entero, o null si es inválida.
 */
export function parseDuration(input: string): number | null {
  const m = input.trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*([dw])?$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  const unit = m[2] ?? "d";
  const days = unit === "w" ? n * 5 : n;
  return Math.max(0, Math.round(days));
}

/** ISO → "YYYY-MM-DD" para inputs date y visualización. */
export function isoToDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/** Profundidad en el árbol a partir del WBS (1.2.1 → 2). */
export function wbsDepth(wbs: string): number {
  if (!wbs) return 0;
  return wbs.split(".").length - 1;
}
