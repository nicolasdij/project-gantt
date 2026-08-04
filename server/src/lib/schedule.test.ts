import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSchedule, type ScheduleTask } from "./schedule.ts";
import { parseDependencies } from "./deps.ts";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// Helper para construir tareas con defaults.
const task = (p: Partial<ScheduleTask> & { id: number }): ScheduleTask => ({
  parentId: null,
  order: p.id,
  start: null,
  end: null,
  durationDays: 5,
  isMilestone: false,
  dependencies: null,
  ...p,
});

test("parseDependencies: tipos, default FS, ignora SF", () => {
  assert.deepEqual(parseDependencies("3FS"), [{ predId: 3, type: "FS" }]);
  assert.deepEqual(parseDependencies("3"), [{ predId: 3, type: "FS" }]); // default FS
  assert.deepEqual(parseDependencies("5ss, 7ff"), [
    { predId: 5, type: "SS" },
    { predId: 7, type: "FF" },
  ]);
  assert.deepEqual(parseDependencies("3SF"), []); // SF fuera de alcance
  assert.deepEqual(parseDependencies(""), []);
  assert.deepEqual(parseDependencies(null), []);
});

test("FS: el sucesor empieza el día laborable siguiente al fin del predecesor", () => {
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 2, durationDays: 5, dependencies: "1FS" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(2)!.start), "2026-08-10"); // Lun siguiente al Vie 07
  assert.equal(iso(r.get(2)!.end), "2026-08-14");
});

test("SS: el sucesor empieza a la vez que el predecesor", () => {
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 2, durationDays: 10, dependencies: "1SS" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(2)!.start), "2026-08-03");
  assert.equal(iso(r.get(2)!.end), "2026-08-14"); // 10 lab desde Lun 03
});

test("FF: el sucesor termina a la vez que el predecesor", () => {
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 2, durationDays: 3, dependencies: "1FF" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(2)!.end), "2026-08-07");
  assert.equal(iso(r.get(2)!.start), "2026-08-05"); // 3 lab que terminan el Vie 07
});

test("cadena FS (1→2→3) propaga las fechas", () => {
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 2, durationDays: 5, dependencies: "1FS" }),
    task({ id: 3, durationDays: 5, dependencies: "2FS" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(2)!.start), "2026-08-10");
  assert.equal(iso(r.get(3)!.start), "2026-08-17"); // tras el fin de 2 (14)
});

test("milestone (dur 0) con FS: start = end = día siguiente al pred", () => {
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 2, durationDays: 0, isMilestone: true, dependencies: "1FS" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(2)!.start), "2026-08-10");
  assert.equal(iso(r.get(2)!.end), "2026-08-10");
  assert.equal(r.get(2)!.isMilestone, true);
});

test("roll-up de padre desde hijos programados por dependencias", () => {
  const tasks = [
    task({ id: 1, parentId: null, durationDays: 0 }), // padre
    task({ id: 2, parentId: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 3, parentId: 1, durationDays: 5, dependencies: "2FS" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(1)!.start), "2026-08-03"); // min hijos
  assert.equal(iso(r.get(1)!.end), "2026-08-14"); // max hijos (fin de 3)
  assert.equal(r.get(1)!.isMilestone, false); // un padre nunca es milestone
});

test("varias dependencias: toma la restricción más tardía", () => {
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-05"), durationDays: 3 }),
    task({ id: 2, start: D("2026-08-03"), end: D("2026-08-11"), durationDays: 7 }),
    task({ id: 3, durationDays: 5, dependencies: "1FS, 2FS" }),
  ];
  const r = computeSchedule(tasks);
  // Debe empezar tras el más tardío (fin de 2 = 11 → 12)
  assert.equal(iso(r.get(3)!.start), "2026-08-12");
});

test("una fila NO puede depender de su propio padre: la dependencia se ignora", () => {
  // Es circular: el fin del padre es el roll-up de este mismo hijo, así que aplicarla
  // empujaba al hijo en CADA iteración del punto fijo (el resultado terminaba
  // dependiendo del tope de iteraciones, o sea del tamaño del proyecto).
  const tasks = [
    task({ id: 1, parentId: null, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }), // padre
    task({ id: 2, parentId: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5, dependencies: "1FS" }),
    task({ id: 3, parentId: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(2)!.start), "2026-08-03"); // el hijo se queda donde estaba
  assert.equal(iso(r.get(2)!.end), "2026-08-07");
  assert.equal(iso(r.get(1)!.end), "2026-08-07"); // y el padre no infla su duración
  assert.equal(r.get(1)!.durationDays, 5);
});

test("tampoco puede depender de un ABUELO", () => {
  const tasks = [
    task({ id: 1, parentId: null, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 2, parentId: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 3, parentId: 2, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5, dependencies: "1FS" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(3)!.start), "2026-08-03");
  assert.equal(iso(r.get(3)!.end), "2026-08-07");
});

test("una dependencia a un padre AJENO sigue funcionando", () => {
  // Control: el bloqueo es solo para ancestros propios, no para cualquier padre.
  const tasks = [
    task({ id: 1, parentId: null, durationDays: 0 }), // padre ajeno
    task({ id: 2, parentId: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 3, parentId: null, durationDays: 5, dependencies: "1FS" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(3)!.start), "2026-08-10"); // tras el fin del grupo (07-ago)
});

test("una hoja que depende de un padre sigue su roll-up NUEVO, no el persistido", () => {
  // Estado tal como queda en la base justo después de alargar el hijo (id 2) hasta el
  // 14: el padre todavía tiene su fin viejo (07) guardado y L es coherente con ese fin
  // viejo. Antes se programaba con la fecha vieja del padre y, como esa pasada no
  // cambiaba nada, el punto fijo cortaba y L quedaba desfasada hasta la mutación
  // siguiente (superpuesta al grupo al que debe seguir).
  const tasks = [
    task({ id: 1, parentId: null, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 2, parentId: 1, start: D("2026-08-03"), end: D("2026-08-14"), durationDays: 10 }),
    task({ id: 3, parentId: null, start: D("2026-08-10"), end: D("2026-08-14"), durationDays: 5, dependencies: "1FS" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(1)!.end), "2026-08-14"); // roll-up nuevo del padre
  assert.equal(iso(r.get(3)!.start), "2026-08-17"); // L arranca tras el fin nuevo
  assert.equal(iso(r.get(3)!.end), "2026-08-21");
});
