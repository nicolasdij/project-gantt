// Utilidades de formato/parón para el grid.

/** Muestra la duración como "Nd" (los milestones son "0d"). */
export function formatDuration(days: number): string {
  return `${days}d`;
}

// Cuántos días laborables tiene un mes. Configurable en Settings porque no hay una
// respuesta única (MS Project usa 20 por defecto; según la convención se usa 21 o 22).
export const WORKING_DAYS_PER_MONTH_OPTIONS = [20, 21, 22] as const;
export type WorkingDaysPerMonth = (typeof WORKING_DAYS_PER_MONTH_OPTIONS)[number];
export const DEFAULT_WORKING_DAYS_PER_MONTH: WorkingDaysPerMonth = 20;

/**
 * Parsea la entrada de Duration del usuario: "Nd" / "Nw" / "Nm" / "N".
 * 1w = 5 días laborables (una semana Lun-Vie, no configurable); 1m = los días
 * laborables del mes definidos en Settings. Devuelve días como entero, o null si la
 * entrada es inválida.
 */
export function parseDuration(
  input: string,
  daysPerMonth: WorkingDaysPerMonth = DEFAULT_WORKING_DAYS_PER_MONTH,
): number | null {
  const m = input.trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*([dwm])?$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  const unit = m[2] ?? "d";
  const days = unit === "w" ? n * 5 : unit === "m" ? n * daysPerMonth : n;
  return Math.max(0, Math.round(days));
}

// --- Avance (% Complete) ------------------------------------------------------

/** Muestra el avance como "N%". */
export function formatPercent(progress: number): string {
  return `${progress}%`;
}

/**
 * Parsea la entrada de % Complete: "40", "40%", "40,5%". Devuelve un entero 0..100,
 * o null si la entrada no es un número (ahí la celda revierte, igual que Duration).
 * Lo que se pasa de rango se RECORTA en vez de rechazarse: "150" es una intención
 * clara ("terminado"), no un error de tipeo.
 */
export function parsePercent(input: string): number | null {
  const m = input.trim().match(/^(\d+(?:[.,]\d+)?)\s*%?$/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** ISO → "YYYY-MM-DD" para inputs date y visualización. */
export function isoToDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

// --- Formato de fecha configurable (Settings) ---------------------------------
// Todas las fechas Start/End que la app dibuja pasan por formatIsoAs(); lo que se
// tipea vuelve a ISO con parseDateInput(). Por eso las celdas editables son un input
// de TEXTO y no un `input type="date"`: el nativo se dibuja según el locale del
// navegador y no hay forma de imponerle un formato.

export const DATE_FORMATS = [
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD",
  "DD.MM.YYYY",
  "MMM D, YYYY",
] as const;

export type DateFormat = (typeof DATE_FORMATS)[number];
export const DEFAULT_DATE_FORMAT: DateFormat = "DD/MM/YYYY";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

/** ISO (o "YYYY-MM-DD") → texto en el formato elegido. "" si no hay fecha. */
export function formatIsoAs(iso: string | null, format: DateFormat): string {
  const [y, m, d] = isoToDate(iso).split("-");
  if (!y || !m || !d) return "";
  switch (format) {
    case "MM/DD/YYYY":
      return `${m}/${d}/${y}`;
    case "YYYY-MM-DD":
      return `${y}-${m}-${d}`;
    case "DD.MM.YYYY":
      return `${d}.${m}.${y}`;
    case "MMM D, YYYY":
      return `${MONTHS_SHORT[Number(m) - 1]} ${Number(d)}, ${y}`;
    default:
      return `${d}/${m}/${y}`;
  }
}

/**
 * Texto tipeado → "YYYY-MM-DD", o null si no es una fecha válida en ese formato.
 * Los separadores son tolerantes (4-8-2026 vale para DD/MM/YYYY), pero el ORDEN de
 * los campos lo manda el formato elegido: "04/08/2026" es 4-ago en DD/MM/YYYY y
 * 8-abr en MM/DD/YYYY.
 */
export function parseDateInput(text: string, format: DateFormat): string | null {
  const t = text.trim();
  if (!t) return null;

  let y: number, m: number, d: number;
  if (format === "MMM D, YYYY") {
    const parts = t.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);
    if (!parts) return null;
    const month = MONTHS_SHORT.findIndex(
      (name) => name.toLowerCase() === parts[1].slice(0, 3).toLowerCase(),
    );
    if (month < 0) return null;
    [m, d, y] = [month + 1, Number(parts[2]), Number(parts[3])];
  } else {
    const nums = t.split(/\D+/).filter(Boolean).map(Number);
    if (nums.length !== 3) return null;
    if (format === "YYYY-MM-DD") [y, m, d] = nums;
    else if (format === "MM/DD/YYYY") [m, d, y] = nums;
    else [d, m, y] = nums; // DD/MM/YYYY y DD.MM.YYYY
  }

  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad2(m)}-${pad2(d)}`;
  // Descarta días que no existen (31/02): el round-trip por Date tiene que coincidir.
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return iso;
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

/**
 * Avanza `workingDays` días laborables (mismo algoritmo que addWorkingDays del
 * server). Al mover una barra completa se usa para que el fin del PREVIEW quede
 * donde el server va a ponerlo al conservar la Duration.
 */
export function addWorkingDaysIso(iso: string, workingDays: number): string {
  let cur = iso;
  let remaining = workingDays;
  while (remaining > 0) {
    cur = addDaysIso(cur, 1);
    const day = new Date(`${cur}T00:00:00.000Z`).getUTCDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return cur;
}

/** Profundidad en el árbol a partir del WBS (1.2.1 → 2). */
export function wbsDepth(wbs: string): number {
  if (!wbs) return 0;
  return wbs.split(".").length - 1;
}
