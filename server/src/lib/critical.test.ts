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

test("dependencia a un PADRE: la hoja que empuja al grupo es crítica", () => {
  // P(10) contiene a C1(11). L(1) depende de P por FS y M(2) de L.
  // C1 define el fin de P → define el arranque de L → toda la cadena es crítica.
  const tasks = [
    t({ id: 10, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }), // padre
    t({ id: 11, parentId: 10, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    t({ id: 1, start: D("2026-08-10"), end: D("2026-08-14"), durationDays: 5, dependencies: "10FS" }),
    t({ id: 2, start: D("2026-08-17"), end: D("2026-08-21"), durationDays: 5, dependencies: "1FS" }),
  ];
  const crit = computeCriticalPath(tasks).sort((a, b) => a - b);
  assert.deepEqual(crit, [1, 2, 11]);
  assert.ok(!crit.includes(10), "el padre sigue sin ser un nodo del CPM");
});

test("dependencia a un PADRE: solo la hoja que determina la fecha, no sus hermanas", () => {
  // P(10) contiene C1(11, termina 07-ago) y C2(12, termina 04-ago).
  // Con FS manda la que termina último (C1); C2 conserva holgura.
  const tasks = [
    t({ id: 10, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    t({ id: 11, parentId: 10, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    t({ id: 12, parentId: 10, start: D("2026-08-03"), end: D("2026-08-04"), durationDays: 2 }),
    t({ id: 1, start: D("2026-08-10"), end: D("2026-08-14"), durationDays: 5, dependencies: "10FS" }),
  ];
  const crit = computeCriticalPath(tasks).sort((a, b) => a - b);
  assert.deepEqual(crit, [1, 11]); // la 12 tiene holgura
});

test("dependencia SS a un PADRE: manda la hoja que empieza primero", () => {
  // P(10) contiene C1(11, empieza 03-ago) y C2(12, empieza 05-ago). L(1) es 10SS.
  const tasks = [
    t({ id: 10, start: D("2026-08-03"), end: D("2026-08-11"), durationDays: 7 }),
    t({ id: 11, parentId: 10, start: D("2026-08-03"), end: D("2026-08-05"), durationDays: 3 }),
    t({ id: 12, parentId: 10, start: D("2026-08-05"), end: D("2026-08-11"), durationDays: 5 }),
    t({ id: 1, start: D("2026-08-03"), end: D("2026-08-14"), durationDays: 10, dependencies: "10SS" }),
  ];
  const crit = computeCriticalPath(tasks).sort((a, b) => a - b);
  assert.ok(crit.includes(11), "la hoja que abre el grupo define el SS");
  assert.ok(!crit.includes(12), "la otra hoja no participa del SS");
});

test("dependencia a un PADRE anidado: baja hasta las hojas", () => {
  // P(10) → P2(11) → C(12). La dependencia a P(10) debe llegar a C(12).
  const tasks = [
    t({ id: 10, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    t({ id: 11, parentId: 10, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    t({ id: 12, parentId: 11, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    t({ id: 1, start: D("2026-08-10"), end: D("2026-08-14"), durationDays: 5, dependencies: "10FS" }),
  ];
  assert.deepEqual(computeCriticalPath(tasks).sort((a, b) => a - b), [1, 12]);
});

test("una hoja que depende de su propio padre no genera auto-arista", () => {
  // C1(11) es hijo de P(10) y depende de P: al bajar, P resuelve a C1 → se descarta.
  const tasks = [
    t({ id: 10, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    t({ id: 11, parentId: 10, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5, dependencies: "10FS" }),
  ];
  assert.deepEqual(computeCriticalPath(tasks), [11]); // sin colgarse ni romper
});

test("un ciclo de dependencias no rompe el cálculo", () => {
  // Entrada inválida que el usuario puede tipear: 1 depende de 2 y 2 depende de 1.
  // Antes reventaba con TypeError (el backward pass leía el late start de un sucesor
  // sin resolver); ahora los sucesores sin resolver se ignoran.
  const tasks = [
    t({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5, dependencies: "2FS" }),
    t({ id: 2, start: D("2026-08-10"), end: D("2026-08-14"), durationDays: 5, dependencies: "1FS" }),
  ];
  assert.doesNotThrow(() => computeCriticalPath(tasks));
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
