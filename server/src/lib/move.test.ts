import { test } from "node:test";
import assert from "node:assert/strict";
import { findReparentConflict, resolveMove, type MoveTask } from "./move.ts";

type Row = MoveTask & { dependencies: string | null };
const row = (p: Partial<Row> & { id: number; order: number }): Row => ({
  parentId: null,
  dependencies: null,
  ...p,
});

// Dos grupos hermanos a nivel raíz, con dos hijos cada uno:
//   0 A          2 B
//   1  a1        4  b1
//   2  a2        5  b2
const twoGroups = (): Row[] => [
  row({ id: 1, order: 0 }), // A
  row({ id: 2, order: 1, parentId: 1 }), // a1
  row({ id: 3, order: 2, parentId: 1 }), // a2
  row({ id: 4, order: 3 }), // B
  row({ id: 5, order: 4, parentId: 4 }), // b1
  row({ id: 6, order: 5, parentId: 4 }), // b2
];

test("entre hermanos: intercambia con el de al lado", () => {
  assert.deepEqual(resolveMove(twoGroups(), 3, "up"), { kind: "swap", otherId: 2 });
  assert.deepEqual(resolveMove(twoGroups(), 2, "down"), { kind: "swap", otherId: 3 });
  // También entre filas de nivel raíz.
  assert.deepEqual(resolveMove(twoGroups(), 4, "up"), { kind: "swap", otherId: 1 });
});

test("el primer hijo cruza al grupo ANTERIOR, como último hijo", () => {
  // Es el caso que antes obligaba a outdent → subir → indent.
  const plan = resolveMove(twoGroups(), 5, "up");
  assert.deepEqual(plan, { kind: "reparent", newParentId: 1, newOrder: 3 });
  // El orden queda después del último hijo de A (a2, order 2), o sea al final del grupo.
});

test("el último hijo cruza al grupo SIGUIENTE, como primer hijo", () => {
  const plan = resolveMove(twoGroups(), 3, "down");
  assert.deepEqual(plan, { kind: "reparent", newParentId: 4, newOrder: 3 });
  // El orden queda antes del primer hijo de B (b1, order 4), o sea al principio.
});

test("sin grupo del otro lado: no-op", () => {
  const tasks = twoGroups();
  assert.equal(resolveMove(tasks, 2, "up"), null); // primer hijo del PRIMER grupo
  assert.equal(resolveMove(tasks, 6, "down"), null); // último hijo del ÚLTIMO grupo
  assert.equal(resolveMove(tasks, 1, "up"), null); // fila raíz, ya la primera
  assert.equal(resolveMove(tasks, 4, "down"), null); // fila raíz, ya la última
  assert.equal(resolveMove(tasks, 99, "up"), null); // id inexistente
});

test("no cruza hacia un hermano que es HOJA", () => {
  // Colgarle un hijo la volvería fila de resumen: perdería sus fechas (pasarían a ser
  // roll-up de este mismo hijo) y sus dependencias quedarían inertes.
  const tasks = [
    row({ id: 1, order: 0 }), // tarea suelta, sin hijos
    row({ id: 2, order: 1 }), // grupo
    row({ id: 3, order: 2, parentId: 2 }), // su primer hijo
  ];
  assert.equal(resolveMove(tasks, 3, "up"), null);
});

test("cruza entre subgrupos del mismo padre (el caso real)", () => {
  // P
  //  A → a1
  //  B → b1   ← b1 sube al grupo A sin salir de P
  const tasks = [
    row({ id: 1, order: 0 }), // P
    row({ id: 2, order: 1, parentId: 1 }), // A
    row({ id: 3, order: 2, parentId: 2 }), // a1
    row({ id: 4, order: 3, parentId: 1 }), // B
    row({ id: 5, order: 4, parentId: 4 }), // b1
  ];
  assert.deepEqual(resolveMove(tasks, 5, "up"), {
    kind: "reparent",
    newParentId: 2,
    newOrder: 3,
  });
});

test("mueve la RAMA entera: un grupo también cruza", () => {
  const tasks = [
    row({ id: 1, order: 0 }), // A
    row({ id: 2, order: 1, parentId: 1 }), // a1
    row({ id: 3, order: 2 }), // B
    row({ id: 4, order: 3, parentId: 3 }), // G (grupo, primer hijo de B)
    row({ id: 5, order: 4, parentId: 4 }), // g1 (lo sigue por parentId)
  ];
  assert.deepEqual(resolveMove(tasks, 4, "up"), {
    kind: "reparent",
    newParentId: 1,
    newOrder: 2,
  });
});

test("conflicto DIRECTO: la fila depende del grupo al que va a entrar", () => {
  // Pasa en cuanto una fila depende del grupo anterior: al entrar, ese grupo sería su
  // padre y sus fechas el roll-up de esta misma fila.
  const tasks = twoGroups();
  tasks[4] = { ...tasks[4], dependencies: "1FS" }; // b1 depende de A
  assert.deepEqual(findReparentConflict(tasks, 5, 1), {
    kind: "direct",
    taskId: 5,
    predId: 1,
  });
});

test("conflicto DIRECTO: también si depende de un ANCESTRO del padre nuevo", () => {
  const tasks = [
    row({ id: 1, order: 0 }), // P
    row({ id: 2, order: 1, parentId: 1 }), // A
    row({ id: 3, order: 2, parentId: 2 }), // a1
    row({ id: 4, order: 3, parentId: 1 }), // B
    row({ id: 5, order: 4, parentId: 4, dependencies: "1FS" }), // b1 depende de P
  ];
  assert.deepEqual(findReparentConflict(tasks, 5, 2), {
    kind: "direct",
    taskId: 5,
    predId: 1,
  });
});

test("conflicto DIRECTO: lo dispara cualquier fila de la rama movida, no solo la raíz", () => {
  const tasks = [
    row({ id: 1, order: 0 }), // A
    row({ id: 2, order: 1, parentId: 1 }), // a1
    row({ id: 3, order: 2 }), // B
    row({ id: 4, order: 3, parentId: 3 }), // G, el que se mueve
    row({ id: 5, order: 4, parentId: 4, dependencies: "1FS" }), // g1 depende de A
  ];
  assert.deepEqual(findReparentConflict(tasks, 4, 1), {
    kind: "direct",
    taskId: 5,
    predId: 1,
  });
});

test("conflicto INDIRECTO: el ciclo pasa por la arista de roll-up que agrega el movimiento", () => {
  // Z depende de A, y b1 depende de Z. Al entrar b1 en A, el fin de A pasa a salir de b1,
  // que sale de Z, que sale de A. Ninguna dependencia apunta a A desde la rama movida, así
  // que el chequeo directo no lo ve: hay que mirar el grafo completo.
  const tasks = [
    row({ id: 1, order: 0 }), // A
    row({ id: 2, order: 1, parentId: 1 }), // a1
    row({ id: 3, order: 2 }), // B
    row({ id: 4, order: 3, parentId: 3, dependencies: "5FS" }), // b1 depende de Z
    row({ id: 5, order: 4, dependencies: "1FS" }), // Z depende de A
  ];
  // Donde está ahora no hay ciclo: A no es alcanzable desde Z.
  assert.equal(findReparentConflict(tasks, 4, 3), null);
  // Cualquiera de las dos aristas del ciclo sirve para el mensaje (quitando una u otra se
  // rompe), y la que se reporta es la primera que aparece: la de la fila que se movió.
  assert.deepEqual(findReparentConflict(tasks, 4, 1), {
    kind: "indirect",
    taskId: 4,
    predId: 5,
  });
});

test("un movimiento limpio no reporta conflicto", () => {
  assert.equal(findReparentConflict(twoGroups(), 5, 1), null);
  // Depender de una HOJA del grupo al que entra es legítimo: queda como hermana, no como
  // ancestro. Es justo la forma de encadenarse detrás de la última fila de ese grupo.
  const tasks = twoGroups();
  tasks[4] = { ...tasks[4], dependencies: "3FS" }; // b1 depende de a2, hoja de A
  assert.equal(findReparentConflict(tasks, 5, 1), null);
});
