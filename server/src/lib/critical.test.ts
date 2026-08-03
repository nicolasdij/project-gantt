import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCriticalPath, type CriticalTask } from "./critical.ts";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const t = (p: Partial<CriticalTask> & { id: number }): CriticalTask => ({
  parentId: null,
  start: null,
  end: null,
  durationDays: 1,
  dependencies: null,
  ...p,
});

test("cadena simple: todas las tareas son críticas", () => {
  // A→B→C encadenadas FS, sin ramas paralelas.
  const tasks = [
    t({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    t({ id: 2, start: D("2026-08-10"), end: D("2026-08-14"), durationDays: 5, dependencies: "1FS" }),
    t({ id: 3, start: D("2026-08-17"), end: D("2026-08-21"), durationDays: 5, dependencies: "2FS" }),
  ];
  assert.deepEqual(computeCriticalPath(tasks).sort((a, b) => a - b), [1, 2, 3]);
});

test("rama paralela con holgura NO es crítica", () => {
  // A→B(5d)→D  y  A→C(2d)→D. La rama B es la larga (crítica); C tiene holgura.
  const tasks = [
    t({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    t({ id: 2, start: D("2026-08-10"), end: D("2026-08-14"), durationDays: 5, dependencies: "1FS" }),
    t({ id: 3, start: D("2026-08-10"), end: D("2026-08-11"), durationDays: 2, dependencies: "1FS" }),
    t({ id: 4, start: D("2026-08-17"), end: D("2026-08-19"), durationDays: 3, dependencies: "2FS, 3FS" }),
  ];
  const crit = computeCriticalPath(tasks).sort((a, b) => a - b);
  assert.deepEqual(crit, [1, 2, 4]); // 3 (rama corta) tiene holgura
});

test("milestone final con FF es crítico", () => {
  const tasks = [
    t({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    t({ id: 2, start: D("2026-08-07"), end: D("2026-08-07"), durationDays: 0, dependencies: "1FF" }),
  ];
  const crit = computeCriticalPath(tasks).sort((a, b) => a - b);
  assert.deepEqual(crit, [1, 2]);
});

test("dependencia SS: predecesor y sucesor críticos si el sucesor define el fin", () => {
  const tasks = [
    t({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    t({ id: 2, start: D("2026-08-03"), end: D("2026-08-14"), durationDays: 10, dependencies: "1SS" }),
  ];
  const crit = computeCriticalPath(tasks).sort((a, b) => a - b);
  assert.deepEqual(crit, [1, 2]);
});

test("los padres (resumen) se excluyen del CPM", () => {
  const tasks = [
    t({ id: 10, start: D("2026-08-03"), end: D("2026-08-14"), durationDays: 10 }), // padre
    t({ id: 11, parentId: 10, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    t({ id: 12, parentId: 10, start: D("2026-08-10"), end: D("2026-08-14"), durationDays: 5, dependencies: "11FS" }),
  ];
  const crit = computeCriticalPath(tasks);
  assert.ok(!crit.includes(10), "el padre no debe ser crítico");
  assert.deepEqual(crit.sort((a, b) => a - b), [11, 12]);
});

test("tarea aislada que termina antes del fin del proyecto tiene holgura", () => {
  const tasks = [
    t({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    t({ id: 2, start: D("2026-08-10"), end: D("2026-08-21"), durationDays: 10, dependencies: "1FS" }),
    t({ id: 3, start: D("2026-08-03"), end: D("2026-08-04"), durationDays: 2 }), // aislada, corta
  ];
  const crit = computeCriticalPath(tasks).sort((a, b) => a - b);
  assert.deepEqual(crit, [1, 2]); // la 3 no
});
