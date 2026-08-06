import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSchedule, type ScheduleTask } from "./schedule.ts";
import {
  formatDependency,
  MAX_LAG_DAYS,
  parseDependencies,
  remapDependencies,
} from "./deps.ts";

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
  assert.deepEqual(parseDependencies("3FS"), [{ predId: 3, type: "FS", lag: 0 }]);
  assert.deepEqual(parseDependencies("3"), [{ predId: 3, type: "FS", lag: 0 }]); // default FS
  assert.deepEqual(parseDependencies("5ss, 7ff"), [
    { predId: 5, type: "SS", lag: 0 },
    { predId: 7, type: "FF", lag: 0 },
  ]);
  assert.deepEqual(parseDependencies("3SF"), []); // SF fuera de alcance
  assert.deepEqual(parseDependencies(""), []);
  assert.deepEqual(parseDependencies(null), []);
});

test("parseDependencies: lag con signo, la 'd' y el tipo son opcionales", () => {
  assert.deepEqual(parseDependencies("3FS+1d"), [{ predId: 3, type: "FS", lag: 1 }]);
  assert.deepEqual(parseDependencies("3FS+1"), [{ predId: 3, type: "FS", lag: 1 }]); // sin 'd'
  assert.deepEqual(parseDependencies("3+1d"), [{ predId: 3, type: "FS", lag: 1 }]); // sin tipo
  assert.deepEqual(parseDependencies("3FS-2D"), [{ predId: 3, type: "FS", lag: -2 }]); // lead
  assert.deepEqual(parseDependencies("5ss+3d, 7ff-1d"), [
    { predId: 5, type: "SS", lag: 3 },
    { predId: 7, type: "FF", lag: -1 },
  ]);
  assert.deepEqual(parseDependencies("3FS+0d"), [{ predId: 3, type: "FS", lag: 0 }]);
  // Espacios alrededor del signo: el lag no se puede perder en un "3FS" a secas, que
  // programaría igual ignorando lo que se pidió.
  assert.deepEqual(parseDependencies("3FS + 1d"), [{ predId: 3, type: "FS", lag: 1 }]);
  assert.deepEqual(parseDependencies("3FS -2"), [{ predId: 3, type: "FS", lag: -2 }]);
  assert.deepEqual(parseDependencies("3FS+1d 5SS"), [
    { predId: 3, type: "FS", lag: 1 },
    { predId: 5, type: "SS", lag: 0 },
  ]);
  // Fuera de rango o malformado: se descarta el token entero, como cualquier basura.
  assert.deepEqual(parseDependencies(`3FS+${MAX_LAG_DAYS + 1}d`), []);
  assert.deepEqual(parseDependencies("3FS+1w"), []); // semanas: no soportadas
  assert.deepEqual(parseDependencies("3FS+50%"), []); // porcentajes: fuera de alcance
});

test("formatDependency: round-trip, y el lag 0 no se escribe", () => {
  const round = (s: string) => parseDependencies(s).map(formatDependency).join(", ");
  assert.equal(round("3FS"), "3FS");
  assert.equal(round("3"), "3FS"); // el default se hace explícito
  assert.equal(round("3FS+0d"), "3FS"); // lag 0: no se escribe
  assert.equal(round("3fs+2"), "3FS+2d"); // se normaliza a la forma canónica
  assert.equal(round("5SS-1d, 7FF+3d"), "5SS-1d, 7FF+3d");
});

test("remapDependencies conserva el lag al traducir los IDs", () => {
  // Es el camino que recorre TODA lectura y escritura de la API (id interno ↔ ID
  // visible): si el serializador se olvidara del lag, cada ida y vuelta lo borraría.
  const map = new Map([
    [10, 1],
    [20, 2],
  ]);
  assert.equal(remapDependencies("10FS+2d, 20SS-1d", map), "1FS+2d, 2SS-1d");
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

test("FS+1d: el sucesor deja un día laborable libre tras el fin del predecesor", () => {
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 2, durationDays: 5, dependencies: "1FS+1d" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(2)!.start), "2026-08-11"); // Mar 11, no el Lun 10 del FS pelado
  assert.equal(iso(r.get(2)!.end), "2026-08-17");
});

test("el lag cuenta días LABORABLES: se saltea el fin de semana", () => {
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-06"), durationDays: 4 }), // fin Jue
    task({ id: 2, durationDays: 3, dependencies: "1FS+1d" }),
  ];
  const r = computeSchedule(tasks);
  // FS pelado daría Vie 07; el +1d salta el sábado y el domingo, no cae en Sáb 08.
  assert.equal(iso(r.get(2)!.start), "2026-08-10");
});

test("FS-1d (lead): el sucesor solapa y arranca el día en que termina el pred", () => {
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 2, durationDays: 5, dependencies: "1FS-1d" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(2)!.start), "2026-08-07"); // el mismo Vie que cierra el 1
  assert.equal(iso(r.get(2)!.end), "2026-08-13");
});

test("SS+3d: el sucesor empieza 3 días laborables después del inicio del pred", () => {
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 2, durationDays: 5, dependencies: "1SS+3d" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(2)!.start), "2026-08-06");
  assert.equal(iso(r.get(2)!.end), "2026-08-12");
});

test("FF-2d: el sucesor termina 2 días laborables antes que el pred", () => {
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    task({ id: 2, durationDays: 3, dependencies: "1FF-2d" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(2)!.end), "2026-08-05");
  assert.equal(iso(r.get(2)!.start), "2026-08-03"); // 3 lab que terminan el Mié 05
});

test("el lag participa en la restricción más tardía", () => {
  // El predecesor que termina PRIMERO manda, porque su lag lo empuja más lejos.
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-05"), durationDays: 3 }),
    task({ id: 2, start: D("2026-08-03"), end: D("2026-08-11"), durationDays: 7 }),
    task({ id: 3, durationDays: 5, dependencies: "1FS+10d, 2FS" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(3)!.start), "2026-08-20"); // 10 lab tras el FS del 1, no el 12
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

test("auto-dependencia: la fila se apunta a sí misma → se ignora", () => {
  // Aplicarla empujaba la fila en cada iteración del punto fijo, y el resultado
  // terminaba dependiendo del tope de iteraciones (o sea, del tamaño del proyecto).
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5, dependencies: "1FS" }),
    task({ id: 2, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(1)!.start), "2026-08-03");
  assert.equal(iso(r.get(1)!.end), "2026-08-07");
});

test("ciclo entre dos hojas: las dos conservan sus fechas", () => {
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5, dependencies: "2FS" }),
    task({ id: 2, start: D("2026-08-10"), end: D("2026-08-14"), durationDays: 5, dependencies: "1FS" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(1)!.start), "2026-08-03");
  assert.equal(iso(r.get(2)!.start), "2026-08-10");
});

test("el resultado de un ciclo NO depende del tamaño del proyecto", () => {
  // Era el síntoma del bug: el punto fijo cortaba por `nº tareas + 2`, así que agregar
  // filas sueltas movía las fechas de las tareas del ciclo.
  const cycle = () => [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5, dependencies: "2FS" }),
    task({ id: 2, start: D("2026-08-10"), end: D("2026-08-14"), durationDays: 5, dependencies: "1FS" }),
  ];
  const relleno = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      task({ id: 100 + i, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }),
    );
  const chico = computeSchedule([...cycle(), ...relleno(1)]);
  const grande = computeSchedule([...cycle(), ...relleno(20)]);
  assert.equal(iso(chico.get(1)!.start), iso(grande.get(1)!.start));
  assert.equal(iso(chico.get(2)!.start), iso(grande.get(2)!.start));
});

test("ciclo de tres hojas: se ignoran las tres dependencias", () => {
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5, dependencies: "3FS" }),
    task({ id: 2, start: D("2026-08-10"), end: D("2026-08-14"), durationDays: 5, dependencies: "1FS" }),
    task({ id: 3, start: D("2026-08-17"), end: D("2026-08-21"), durationDays: 5, dependencies: "2FS" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(1)!.start), "2026-08-03");
  assert.equal(iso(r.get(2)!.start), "2026-08-10");
  assert.equal(iso(r.get(3)!.start), "2026-08-17");
});

test("ciclo a través del roll-up de un padre: también se corta", () => {
  // X depende del padre P, y el hijo C de P depende de X: el fin de P sale de C, que
  // sale de X, que sale de P. El ciclo pasa por la arista de roll-up.
  const tasks = [
    task({ id: 1, parentId: null, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5 }), // P
    task({ id: 2, parentId: 1, start: D("2026-08-03"), end: D("2026-08-07"), durationDays: 5, dependencies: "3FS" }), // C
    task({ id: 3, start: D("2026-08-10"), end: D("2026-08-14"), durationDays: 5, dependencies: "1FS" }), // X
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(2)!.start), "2026-08-03");
  assert.equal(iso(r.get(3)!.start), "2026-08-10");
  assert.equal(iso(r.get(1)!.end), "2026-08-07"); // el padre no infla su duración
});

test("un diamante NO es un ciclo: sigue programando", () => {
  // A→B, A→C, B→D, C→D. Dos caminos que convergen no deben marcarse como ciclo.
  const tasks = [
    task({ id: 1, start: D("2026-08-03"), end: D("2026-08-04"), durationDays: 2 }),
    task({ id: 2, durationDays: 3, dependencies: "1FS" }),
    task({ id: 3, durationDays: 5, dependencies: "1FS" }),
    task({ id: 4, durationDays: 2, dependencies: "2FS, 3FS" }),
  ];
  const r = computeSchedule(tasks);
  assert.equal(iso(r.get(2)!.start), "2026-08-05");
  assert.equal(iso(r.get(3)!.start), "2026-08-05");
  // D arranca tras el más tardío de los dos (C termina 11-ago) → 12-ago
  assert.equal(iso(r.get(4)!.start), "2026-08-12");
});
