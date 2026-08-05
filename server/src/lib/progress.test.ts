import { test } from "node:test";
import assert from "node:assert/strict";
import { clampPercent, computeProgress, type ProgressTask } from "./progress.ts";

let seq = 0;
const t = (p: Partial<ProgressTask> & { id: number }): ProgressTask => ({
  parentId: null,
  order: seq++,
  progress: 0,
  durationDays: 1,
  ...p,
});

test("una hoja conserva su propio porcentaje", () => {
  const got = computeProgress([t({ id: 1, progress: 40 })]);
  assert.equal(got.get(1), 40);
});

test("el padre promedia a los hijos ponderando por duración", () => {
  // 3d al 100% + 5d al 40% → (300 + 200) / 8 = 62.5 → 63
  const tasks = [
    t({ id: 1 }),
    t({ id: 2, parentId: 1, progress: 100, durationDays: 3 }),
    t({ id: 3, parentId: 1, progress: 40, durationDays: 5 }),
  ];
  const got = computeProgress(tasks);
  assert.equal(got.get(1), 63);
  assert.equal(got.get(2), 100); // los hijos no se tocan
  assert.equal(got.get(3), 40);
});

test("el porcentaje que trae un padre en la base se ignora (es calculado)", () => {
  const tasks = [
    t({ id: 1, progress: 99 }),
    t({ id: 2, parentId: 1, progress: 50, durationDays: 4 }),
  ];
  assert.equal(computeProgress(tasks).get(1), 50);
});

test("padre de padres: cada rama pesa por su duración de roll-up", () => {
  // Rama A: 10d al 100%. Rama B: 5d al 0%. Raíz → (1000 + 0) / 15 = 66.6 → 67
  const tasks = [
    t({ id: 1 }),
    t({ id: 2, parentId: 1, durationDays: 10 }),
    t({ id: 3, parentId: 2, progress: 100, durationDays: 10 }),
    t({ id: 4, parentId: 1, durationDays: 5 }),
    t({ id: 5, parentId: 4, progress: 0, durationDays: 5 }),
  ];
  const got = computeProgress(tasks);
  assert.equal(got.get(2), 100);
  assert.equal(got.get(4), 0);
  assert.equal(got.get(1), 67);
});

test("hijos con duración 0 (milestones): cae a promedio simple", () => {
  // Sin duraciones que comparar el promedio ponderado sería 0/0.
  const tasks = [
    t({ id: 1 }),
    t({ id: 2, parentId: 1, progress: 100, durationDays: 0 }),
    t({ id: 3, parentId: 1, progress: 0, durationDays: 0 }),
  ];
  assert.equal(computeProgress(tasks).get(1), 50);
});

test("un milestone entre hijos con duración no aporta peso", () => {
  // El hito al 0% no arrastra el total hacia abajo: pesa 0.
  const tasks = [
    t({ id: 1 }),
    t({ id: 2, parentId: 1, progress: 100, durationDays: 5 }),
    t({ id: 3, parentId: 1, progress: 0, durationDays: 0 }),
  ];
  assert.equal(computeProgress(tasks).get(1), 100);
});

test("valores fuera de rango se recortan a 0..100", () => {
  const tasks = [t({ id: 1, progress: 150 }), t({ id: 2, progress: -20 })];
  const got = computeProgress(tasks);
  assert.equal(got.get(1), 100);
  assert.equal(got.get(2), 0);
  assert.equal(clampPercent(40.6), 41);
  assert.equal(clampPercent(Number.NaN), 0);
});

test("una fila con parentId inexistente conserva su valor", () => {
  const got = computeProgress([t({ id: 1, parentId: 99, progress: 30 })]);
  assert.equal(got.get(1), 30);
});
