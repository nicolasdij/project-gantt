import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTaskPatch, type PatchTask } from "./patch.ts";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

// El ID VISIBLE de una fila es `order + 1`: acá los `order` arrancan en 0, así que la
// fila con order 0 es el ID 1 para el cliente.
const task = (p: Partial<PatchTask> & { id: number; order: number }): PatchTask => ({
  parentId: null,
  start: null,
  end: null,
  durationDays: 5,
  isMilestone: false,
  dependencies: null,
  ...p,
});

/** Padre (id 1, ID visible 1) con un hijo hoja (id 2, ID visible 2), más otra hoja. */
const project = (): PatchTask[] => [
  task({ id: 1, order: 0, start: D("2026-08-03"), end: D("2026-08-07") }),
  task({ id: 2, order: 1, parentId: 1, start: D("2026-08-03"), end: D("2026-08-07") }),
  task({ id: 3, order: 2, start: D("2026-08-10"), end: D("2026-08-14") }),
];

const patch = (id: number, body: Record<string, unknown>, tasks = project()) =>
  buildTaskPatch({ id, body, tasks });

test("campos de contenido: pasan tal cual", () => {
  const r = patch(3, { title: "Hola", owner: "Nico", descriptionMd: "**x**" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.data, { title: "Hola", owner: "Nico", descriptionMd: "**x**" });
});

test("un body sin ningún campo editable es 400", () => {
  const r = patch(3, { wbs: "9", nope: 1 });
  assert.deepEqual(r, { ok: false, status: 400, error: "No editable field in the request body" });
});

test("en una fila PADRE los campos derivados se rechazan con 409", () => {
  for (const field of ["progress", "barTitle", "dependencies", "start", "end", "durationDays"]) {
    const r = patch(1, { [field]: "x" });
    assert.equal(r.ok, false, `${field} debería rechazarse en un padre`);
    assert.equal(r.ok === false && r.status, 409);
  }
});

test("en una HOJA esos mismos campos se aceptan", () => {
  assert.equal(patch(3, { progress: 40 }).ok, true);
  assert.equal(patch(3, { barTitle: "Rótulo" }).ok, true);
  assert.equal(patch(3, { dependencies: "" }).ok, true);
  assert.equal(patch(3, { durationDays: 3 }).ok, true);
});

test("el color de la barra SÍ se acepta en un padre: es estilo, no programación", () => {
  const r = patch(1, { barColor: "green" });
  assert.deepEqual(r.ok && r.data, { barColor: "green" });
});

test("un color fuera de la paleta es 400 y nombra las opciones", () => {
  const r = patch(3, { barColor: "turquesa" });
  assert.equal(r.ok === false && r.status, 400);
  assert.match(r.ok === false ? r.error : "", /Unknown bar colour\. Use one of: /);
});

test("la regla ESTRUCTURAL gana sobre la de valor", () => {
  // Un body que viola las dos (un color inválido y un campo que el padre no admite)
  // devuelve el 409 estructural: es el que explica por qué el campo no va ahí.
  const r = patch(1, { barColor: "turquesa", progress: 10 });
  assert.equal(r.ok === false && r.status, 409);
  assert.match(r.ok === false ? r.error : "", /% Complete of a parent row/);
});

test("rótulo de la barra: se recorta y lo vacío se guarda como null", () => {
  assert.deepEqual(patch(3, { barTitle: "  Pilotaje  " }).ok && patch(3, { barTitle: "  Pilotaje  " }).data, {
    barTitle: "Pilotaje",
  });
  assert.deepEqual(patch(3, { barTitle: "   " }).ok && patch(3, { barTitle: "   " }).data, {
    barTitle: null,
  });
  assert.deepEqual(patch(3, { barTitle: null }).ok && patch(3, { barTitle: null }).data, {
    barTitle: null,
  });
});

test("avance: no numérico es 400, y lo que se pasa de 100 se recorta", () => {
  assert.equal(patch(3, { progress: "abc" }).ok === false, true);
  assert.equal((patch(3, { progress: "abc" }) as { status: number }).status, 400);
  assert.deepEqual(patch(3, { progress: 150 }).ok && patch(3, { progress: 150 }).data, {
    progress: 100,
  });
  assert.deepEqual(patch(3, { progress: "40" }).ok && patch(3, { progress: "40" }).data, {
    progress: 40,
  });
});

test("Dependencies: entran en ID VISIBLE y se guardan en id interno", () => {
  // La fila 3 (ID visible 3) depende del ID visible 2, que es el id interno 2.
  const r = patch(3, { dependencies: "2FS+1d" });
  assert.deepEqual(r.ok && r.data, { dependencies: "2FS+1d" });
});

test("Dependencies: un ancestro se rechaza con 409 y en ID visible", () => {
  const r = patch(2, { dependencies: "1FS" }); // la 2 es hija de la 1
  assert.equal(r.ok === false && r.status, 409);
  assert.match(r.ok === false ? r.error : "", /A row cannot depend on ID 1: that row is its parent/);
});

test("Dependencies: apuntarse a sí misma se rechaza", () => {
  const r = patch(3, { dependencies: "3FS" });
  assert.equal(r.ok === false && r.status, 409);
  assert.match(r.ok === false ? r.error : "", /cannot depend on itself \(ID 3\)/);
});

test("Dependencies: un ciclo indirecto se rechaza", () => {
  // La 3 ya depende de la 4; que la 4 dependa de la 3 cerraría el ciclo.
  const tasks = [
    ...project(),
    task({ id: 4, order: 3, start: D("2026-08-17"), end: D("2026-08-21") }),
  ];
  tasks[2] = { ...tasks[2], dependencies: "4FS" }; // la 3 depende de la 4
  const r = patch(4, { dependencies: "3FS" }, tasks);
  assert.equal(r.ok === false && r.status, 409);
  assert.match(r.ok === false ? r.error : "", /would be circular/);
});

test("fechas: pasan por el motor de recálculo (Duration → End)", () => {
  const r = patch(3, { durationDays: 3 }); // la 3 empieza el Lun 10-ago
  assert.equal(r.ok, true);
  const data = r.ok ? r.data : {};
  assert.equal(iso(data.start), "2026-08-10");
  assert.equal(iso(data.end), "2026-08-12"); // 3 días laborables inclusive
  assert.equal(data.durationDays, 3);
  assert.equal(data.isMilestone, false);
});

test("fechas: duración 0 vuelve la fila un milestone con End = Start", () => {
  const r = patch(3, { durationDays: 0 });
  const data = r.ok ? r.data : {};
  assert.equal(data.isMilestone, true);
  assert.equal(iso(data.end), iso(data.start));
});

test("una fila que no existe es un error, no un crash", () => {
  const r = patch(99, { title: "x" });
  assert.equal(r.ok, false);
});
