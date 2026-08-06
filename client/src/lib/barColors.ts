// Paleta de colores de las barras del Gantt (se elige en el modal de detalle).
//
// Los TONOS no están acá: viven en el CSS como variables (`--bar-*`), una por color y
// otra para su relleno de avance, que es más oscuro. Así el color de una barra, el de
// su relleno y el de la muestra del selector salen todos del mismo lugar.
//
// El default es el azul que ya usaban todas las barras: se ofrece como una opción más
// de la paleta y se guarda como `null` (no como una clave), así una fila sin elegir
// nada y una con el default elegido son el mismo dato.
//
// La lista de claves está duplicada en el server (`server/src/lib/barColors.ts`), que
// valida lo que entra por la API: agregar un color es tocar las dos puntas.

/** "" es el default (en la base, `null`). */
export type BarColorKey = "" | "green" | "amber" | "violet" | "pink";

export const BAR_COLORS: { key: BarColorKey; label: string; cssVar: string }[] = [
  { key: "", label: "Default (blue)", cssVar: "--bar-blue" },
  { key: "green", label: "Green", cssVar: "--bar-green" },
  { key: "amber", label: "Amber", cssVar: "--bar-amber" },
  { key: "violet", label: "Violet", cssVar: "--bar-violet" },
  { key: "pink", label: "Pink", cssVar: "--bar-pink" },
];

/** La clave tal como se edita en el modal ("" = default) a partir del dato guardado. */
export function barColorKey(barColor: string | null): BarColorKey {
  const found = BAR_COLORS.find((c) => c.key !== "" && c.key === barColor);
  // Un valor desconocido (dato viejo, o de una paleta futura) se dibuja con el
  // default en vez de dejar la barra sin color.
  return found?.key ?? "";
}

/** Clase CSS que pinta la barra/rombo. Cadena vacía para el color por defecto. */
export function barColorClass(barColor: string | null): string {
  const key = barColorKey(barColor);
  return key === "" ? "" : `tl-color-${key}`;
}
