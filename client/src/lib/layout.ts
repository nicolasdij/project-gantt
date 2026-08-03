// Constantes de layout compartidas entre el grid y el timeline.
// IMPORTANTE: ROW_H y HEAD_H deben coincidir con los valores en index.css
// (.grid tbody tr / .grid thead th) para que las filas queden alineadas.
import type { Zoom } from "../store.ts";

export const ROW_H = 30; // alto de cada fila (px)
export const HEAD_H = 48; // alto de la cabecera (px)

// Ancho por día de calendario según el zoom.
export const DAY_WIDTH: Record<Zoom, number> = {
  day: 30,
  week: 11,
  month: 4,
};
