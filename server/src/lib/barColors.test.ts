import { test } from "node:test";
import assert from "node:assert/strict";
import { BAR_COLOR_KEYS, normalizeBarColor } from "./barColors.ts";

test("una clave de la paleta se acepta tal cual", () => {
  for (const key of BAR_COLOR_KEYS) assert.equal(normalizeBarColor(key), key);
});

test("vacío, espacios y null son el color por defecto", () => {
  assert.equal(normalizeBarColor(""), null);
  assert.equal(normalizeBarColor("   "), null);
  assert.equal(normalizeBarColor(null), null);
  assert.equal(normalizeBarColor(undefined), null);
});

test("se normalizan mayúsculas y espacios alrededor", () => {
  assert.equal(normalizeBarColor(" Amber "), "amber");
});

test("un color fuera de la paleta se rechaza (undefined)", () => {
  // Rechazar y no caer al default: guardar una clave inventada dejaría una barra
  // que no se pinta y un dato que nadie sabe de dónde salió.
  assert.equal(normalizeBarColor("chartreuse"), undefined);
  assert.equal(normalizeBarColor("#ff0000"), undefined);
  assert.equal(normalizeBarColor(42), undefined);
});
