// Tests de las utilidades de fechas laborables (node:test, ejecutados con tsx).
import { test } from "node:test";
import assert from "node:assert/strict";
import { addWorkingDays, subWorkingDays, workingDaysBetween, isWeekend, parseDate } from "./dates.ts";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

test("isWeekend detecta sábado y domingo (UTC)", () => {
  assert.equal(isWeekend(D("2026-08-01")), true); // sábado
  assert.equal(isWeekend(D("2026-08-02")), true); // domingo
  assert.equal(isWeekend(D("2026-08-03")), false); // lunes
});

test("workingDaysBetween: Lun→Vie = 5 (inclusive)", () => {
  assert.equal(workingDaysBetween(D("2026-08-03"), D("2026-08-07")), 5);
});

test("workingDaysBetween: mismo día hábil = 1", () => {
  assert.equal(workingDaysBetween(D("2026-08-03"), D("2026-08-03")), 1);
});

test("workingDaysBetween ignora el fin de semana intermedio", () => {
  // Lun 3 → Lun 10 = 6 días laborables (3,4,5,6,7 + 10), salta sáb/dom 8 y 9.
  assert.equal(workingDaysBetween(D("2026-08-03"), D("2026-08-10")), 6);
});

test("workingDaysBetween: end < start = 0", () => {
  assert.equal(workingDaysBetween(D("2026-08-07"), D("2026-08-03")), 0);
});

test("addWorkingDays: 0 días = misma fecha (milestone)", () => {
  assert.deepEqual(addWorkingDays(D("2026-08-03"), 0), D("2026-08-03"));
});

test("addWorkingDays: End = Start + (duration-1). 5d desde Lun = Vie", () => {
  // duración 5 → end = addWorkingDays(start, 4)
  assert.deepEqual(addWorkingDays(D("2026-08-03"), 4), D("2026-08-07"));
});

test("addWorkingDays cruza el fin de semana", () => {
  // Vie + 1 día laborable = Lun siguiente
  assert.deepEqual(addWorkingDays(D("2026-08-07"), 1), D("2026-08-10"));
});

test("subWorkingDays es el inverso de addWorkingDays", () => {
  const end = D("2026-08-14");
  // 5d que terminan el Vie 14 → empiezan el Lun 10 (subWorkingDays(end, 4))
  assert.deepEqual(subWorkingDays(end, 4), D("2026-08-10"));
});

test("subWorkingDays cruza el fin de semana hacia atrás", () => {
  // Lun - 1 día laborable = Vie anterior
  assert.deepEqual(subWorkingDays(D("2026-08-10"), 1), D("2026-08-07"));
});

test("parseDate acepta YYYY-MM-DD y normaliza a medianoche UTC", () => {
  assert.deepEqual(parseDate("2026-08-03"), D("2026-08-03"));
  assert.equal(parseDate(null), null);
  assert.equal(parseDate("no-es-fecha"), null);
});

test("round-trip: duration → end → duration es estable", () => {
  const start = D("2026-08-03");
  const duration = 5;
  const end = addWorkingDays(start, duration - 1);
  assert.equal(workingDaysBetween(start, end), duration);
});
