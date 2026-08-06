// Utilidades de fechas laborables.
// Regla de negocio (SPEC.md): la duración cuenta días laborables INCLUSIVE
// (Lunes→Viernes = 5d). Solo se ignoran sábados y domingos (sin feriados por ahora).
// Todo el cálculo se hace en UTC para evitar corrimientos por zona horaria.

/** ¿La fecha cae en sábado (6) o domingo (0)? */
export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** Copia normalizada a medianoche UTC (descarta la hora). */
function atUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Suma un día de calendario (UTC). */
function nextDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/**
 * Avanza `workingDays` días laborables a partir de `start`.
 * - `workingDays = 0` devuelve la misma fecha (útil para milestones).
 * - Solo cuenta como avance los días que NO son fin de semana.
 *
 * Para obtener el End de una tarea a partir de Start + Duration:
 *   end = addWorkingDays(start, duration - 1)   (duration inclusive)
 */
export function addWorkingDays(start: Date, workingDays: number): Date {
  let d = atUtcMidnight(start);
  let remaining = workingDays;
  while (remaining > 0) {
    d = nextDay(d);
    if (!isWeekend(d)) remaining--;
  }
  return d;
}

/**
 * Retrocede `workingDays` días laborables desde `end` (inverso de addWorkingDays).
 * Útil para dependencias Finish-Finish: dado el End objetivo y la duración,
 *   start = subWorkingDays(end, duration - 1).
 */
export function subWorkingDays(end: Date, workingDays: number): Date {
  let d = atUtcMidnight(end);
  let remaining = workingDays;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (!isWeekend(d)) remaining--;
  }
  return d;
}

/**
 * Corre `date` en `days` días laborables: positivo hacia adelante, negativo hacia atrás,
 * 0 devuelve la misma fecha. Es lo que necesita el LAG de las dependencias, donde el
 * signo lo pone el usuario (`3FS+2d` / `3FS-2d`) y no se sabe de antemano.
 */
export function shiftWorkingDays(date: Date, days: number): Date {
  return days >= 0 ? addWorkingDays(date, days) : subWorkingDays(date, -days);
}

/**
 * Cuenta los días laborables entre `start` y `end`, AMBOS inclusive.
 * Lun→Vie devuelve 5. Si end < start devuelve 0.
 * Un único día laborable (start == end en día hábil) devuelve 1.
 */
export function workingDaysBetween(start: Date, end: Date): number {
  const s = atUtcMidnight(start);
  const e = atUtcMidnight(end);
  if (e < s) return 0;
  let count = 0;
  let d = s;
  while (d <= e) {
    if (!isWeekend(d)) count++;
    d = nextDay(d);
  }
  return count;
}

/** Parsea "YYYY-MM-DD" (o ISO) a Date en medianoche UTC. Devuelve null si es inválida. */
export function parseDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return atUtcMidnight(value);
  const s = value.length > 10 ? value : `${value}T00:00:00.000Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : atUtcMidnight(d);
}
