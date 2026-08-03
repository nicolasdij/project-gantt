// Escala temporal del timeline: dominio de fechas, conversión fecha↔X y ticks
// de cabecera (mayor/menor) según el zoom.
import type { Task } from "../types.ts";
import type { Zoom } from "../store.ts";
import { DAY_WIDTH } from "./layout.ts";

const DAY_MS = 86400000;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export type Tick = { label: string; x: number; width: number };

export type TimeScale = {
  origin: Date; // primer día del dominio (medianoche UTC)
  totalDays: number;
  dayWidth: number;
  width: number; // ancho total en px
  xOf: (iso: string | null) => number; // X del inicio de ese día
  dayIndexOf: (iso: string | null) => number;
  todayX: number | null;
  majorTicks: Tick[];
  minorTicks: Tick[];
};

const midnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const parse = (iso: string | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso.length > 10 ? iso : `${iso}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : midnight(d);
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const diffDays = (a: Date, b: Date) => Math.round((midnight(a).getTime() - midnight(b).getTime()) / DAY_MS);

export function buildTimeScale(tasks: Task[], zoom: Zoom, today: Date): TimeScale {
  // Dominio: [min(start) , max(end)] de todas las tareas, incluyendo "hoy",
  // con un pequeño margen a cada lado.
  const dates: Date[] = [];
  for (const t of tasks) {
    const s = parse(t.start);
    const e = parse(t.end);
    if (s) dates.push(s);
    if (e) dates.push(e);
  }
  dates.push(midnight(today));

  let min = dates.reduce((a, b) => (b < a ? b : a), dates[0] ?? midnight(today));
  let max = dates.reduce((a, b) => (b > a ? b : a), dates[0] ?? midnight(today));
  // Margen y redondeo al lunes anterior / para encuadrar mejor.
  min = addDays(min, -3);
  max = addDays(max, 5);

  const dayWidth = DAY_WIDTH[zoom];
  const totalDays = Math.max(1, diffDays(max, min) + 1);
  const width = totalDays * dayWidth;

  const dayIndexOf = (iso: string | null): number => {
    const d = parse(iso);
    return d ? diffDays(d, min) : 0;
  };
  const xOf = (iso: string | null) => dayIndexOf(iso) * dayWidth;
  const todayIdx = diffDays(midnight(today), min);
  const todayX = todayIdx >= 0 && todayIdx <= totalDays ? todayIdx * dayWidth : null;

  const { majorTicks, minorTicks } = buildTicks(min, totalDays, dayWidth, zoom);

  return { origin: min, totalDays, dayWidth, width, xOf, dayIndexOf, todayX, majorTicks, minorTicks };
}

function buildTicks(origin: Date, totalDays: number, dayWidth: number, zoom: Zoom) {
  const minorTicks: Tick[] = [];
  const majorTicks: Tick[] = [];

  // --- Ticks menores ---
  if (zoom === "day") {
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(origin, i);
      minorTicks.push({ label: String(d.getUTCDate()), x: i * dayWidth, width: dayWidth });
    }
  } else if (zoom === "week") {
    for (let i = 0; i < totalDays; i += 7) {
      const d = addDays(origin, i);
      const w = Math.min(7, totalDays - i) * dayWidth;
      minorTicks.push({ label: `${d.getUTCDate()}/${d.getUTCMonth() + 1}`, x: i * dayWidth, width: w });
    }
  } else {
    // month: un tick por mes calendario
    forEachMonth(origin, totalDays, dayWidth, (label, x, width) => {
      minorTicks.push({ label, x, width });
    });
  }

  // --- Ticks mayores ---
  if (zoom === "month") {
    // agrupar por año
    forEachGroup(origin, totalDays, dayWidth, (d) => String(d.getUTCFullYear()), majorTicks);
  } else {
    // agrupar por mes
    forEachMonth(origin, totalDays, dayWidth, (label, x, width) => {
      majorTicks.push({ label, x, width });
    });
  }

  return { majorTicks, minorTicks };
}

// Itera meses calendario dentro del dominio.
function forEachMonth(
  origin: Date,
  totalDays: number,
  dayWidth: number,
  emit: (label: string, x: number, width: number) => void,
) {
  let i = 0;
  while (i < totalDays) {
    const d = addDays(origin, i);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    // días restantes de este mes dentro del dominio
    let j = i;
    while (j < totalDays) {
      const dj = addDays(origin, j);
      if (dj.getUTCFullYear() !== y || dj.getUTCMonth() !== m) break;
      j++;
    }
    emit(`${MESES[m]} ${y}`, i * dayWidth, (j - i) * dayWidth);
    i = j;
  }
}

// Agrupa por una clave (ej. año) y emite ticks.
function forEachGroup(
  origin: Date,
  totalDays: number,
  dayWidth: number,
  keyOf: (d: Date) => string,
  out: Tick[],
) {
  let i = 0;
  while (i < totalDays) {
    const key = keyOf(addDays(origin, i));
    let j = i;
    while (j < totalDays && keyOf(addDays(origin, j)) === key) j++;
    out.push({ label: key, x: i * dayWidth, width: (j - i) * dayWidth });
    i = j;
  }
}
