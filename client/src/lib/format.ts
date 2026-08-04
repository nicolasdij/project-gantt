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

/**
 * ISO → "dd/mm/yyyy" para las celdas de SOLO LECTURA (fechas de filas padre).
 * En las filas editables el formato lo dibuja el `input type="date"` del navegador;
 * esto es para que las filas padre muestren la fecha igual y no en ISO.
 */
export function isoToDisplayDate(iso: string | null): string {
  const [y, m, d] = isoToDate(iso).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
}

/** "YYYY-MM-DD" + n días de calendario. En UTC, para no depender de la zona horaria. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Corre la fecha al día laborable más cercano (sábado → viernes, domingo → lunes).
 * Se usa al redimensionar barras: el borde arrastrado nunca queda en fin de semana.
 */
export function snapToWorkingDayIso(iso: string): string {
  const day = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
  if (day === 6) return addDaysIso(iso, -1);
  if (day === 0) return addDaysIso(iso, 1);
  return iso;
}

/** Profundidad en el árbol a partir del WBS (1.2.1 → 2). */
export function wbsDepth(wbs: string): number {
  if (!wbs) return 0;
  return wbs.split(".").length - 1;
}
