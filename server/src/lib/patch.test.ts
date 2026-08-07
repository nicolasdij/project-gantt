import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTaskPatch, type PatchResult, type PatchTask, type TaskPatchData } from "./patch.ts";

/** Los campos a guardar de un PATCH que se espera VÁLIDO. */
function dataOf(r: PatchResult): TaskPatchData {
  if (!r.ok) throw new Error(`esperaba ok, vino ${r.status}: ${r.error}`);
  return r.data;
}
/** El rechazo de un PATCH que se espera INVÁLIDO. */
function rejectionOf(r: PatchResult): { status: number; error: string } {
  if (r.ok) throw new Error(`esperaba un rechazo, vino ok: ${JSON.stringify(r.data)}`);
  return r;
}

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
  assert.deepEqual(dataOf(r), { title: "Hola", owner: "Nico", descriptionMd: "**x**" });
});

test("un body sin ningún campo editable es 400", () => {
  const r = patch(3, { wbs: "9", nope: 1 });
  assert.deepEqual(r, { ok: false, status: 400, error: "No editable field in the request body" });
});

test("en una fila PADRE los campos derivados se rechazan con 409", () => {
  for (const field of ["progress", "barTitle", "dependencies", "start", "end", "durationDays"]) {
    assert.equal(rejectionOf(patch(1, { [field]: "x" })).status, 409, field);
  }
});

test("en una HOJA esos mismos campos se aceptan", () => {
  assert.equal(patch(3, { progress: 40 }).ok, true);
  assert.equal(patch(3, { barTitle: "Rótulo" }).ok, true);
  assert.equal(patch(3, { dependencies: "" }).ok, true);
  assert.equal(patch(3, { durationDays: 3 }).ok, true);
});

test("el color de la barra SÍ se acepta en un padre: es estilo, no programación", () => {
  assert.deepEqual(dataOf(patch(1, { barColor: "green" })), { barColor: "green" });
});

test("un color fuera de la paleta es 400 y nombra las opciones", () => {
  const r = rejectionOf(patch(3, { barColor: "turquesa" }));
  assert.equal(r.status, 400);
  assert.match(r.error, /Unknown bar colour\. Use one of: /);
});

test("la regla ESTRUCTURAL gana sobre la de valor", () => {
  // Un body que viola las dos (un color inválido y un campo que el padre no admite)
  // devuelve el 409 estructural: es el que explica por qué el campo no va ahí.
  const r = rejectionOf(patch(1, { barColor: "turquesa", progress: 10 }));
  assert.equal(r.status, 409);
  assert.match(r.error, /% Complete of a parent row/);
});

test("rótulo de la barra: se recorta y lo vacío se guarda como null", () => {
  assert.deepEqual(dataOf(patch(3, { barTitle: "  Pilotaje  " })), { barTitle: "Pilotaje" });
  assert.deepEqual(dataOf(patch(3, { barTitle: "   " })), { barTitle: null });
  assert.deepEqual(dataOf(patch(3, { barTitle: null })), { barTitle: null });
});

test("avance: no numérico es 400, y lo que se pasa de 100 se recorta", () => {
  assert.equal(rejectionOf(patch(3, { progress: "abc" })).status, 400);
  assert.deepEqual(dataOf(patch(3, { progress: 150 })), { progress: 100 });
  assert.deepEqual(dataOf(patch(3, { progress: "40" })), { progress: 40 });
});

test("Dependencies: entran en ID VISIBLE y se guardan en id interno", () => {
  // La fila 3 (ID visible 3) depende del ID visible 2, que es el id interno 2.
  assert.deepEqual(dataOf(patch(3, { dependencies: "2FS+1d" })), { dependencies: "2FS+1d" });
});

test("Dependencies: un ancestro se rechaza con 409 y en ID visible", () => {
  const r = rejectionOf(patch(2, { dependencies: "1FS" })); // la 2 es hija de la 1
  assert.equal(r.status, 409);
  assert.match(r.error, /A row cannot depend on ID 1: that row is its parent/);
});

test("Dependencies: apuntarse a sí misma se rechaza", () => {
  const r = rejectionOf(patch(3, { dependencies: "3FS" }));
  assert.equal(r.status, 409);
  assert.match(r.error, /cannot depend on itself \(ID 3\)/);
});

test("Dependencies: un ciclo indirecto se rechaza", () => {
  // La 3 ya depende de la 4; que la 4 dependa de la 3 cerraría el ciclo.
  const tasks = [
    ...project(),
    task({ id: 4, order: 3, start: D("2026-08-17"), end: D("2026-08-21") }),
  ];
  tasks[2] = { ...tasks[2], dependencies: "4FS" }; // la 3 depende de la 4
  const r = rejectionOf(patch(4, { dependencies: "3FS" }, tasks));
  assert.equal(r.status, 409);
  assert.match(r.error, /would be circular/);
});

test("fechas: pasan por el motor de recálculo (Duration → End)", () => {
  const data = dataOf(patch(3, { durationDays: 3 })); // la 3 empieza el Lun 10-ago
  assert.equal(iso(data.start), "2026-08-10");
  assert.equal(iso(data.end), "2026-08-12"); // 3 días laborables inclusive
  assert.equal(data.durationDays, 3);
  assert.equal(data.isMilestone, false);
});

test("fechas: duración 0 vuelve la fila un milestone con End = Start", () => {
  const data = dataOf(patch(3, { durationDays: 0 }));
  assert.equal(data.isMilestone, true);
  assert.equal(iso(data.end), iso(data.start));
});

test("una fila que no existe es un error, no un crash", () => {
  assert.equal(rejectionOf(patch(99, { title: "x" })).status, 400);
});
