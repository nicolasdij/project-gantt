// Paleta de colores de las barras del Gantt: acá viven solo las CLAVES válidas, que
// es lo único que el server necesita para validar lo que se guarda. Los tonos (y las
// etiquetas que se ven) son cosa del cliente (`client/src/lib/barColors.ts` + el CSS):
// el server no dibuja nada, así que no tiene por qué saber qué es "amber".
//
// La lista está duplicada a propósito en las dos puntas —no hay paquete compartido—,
// así que agregar un color es tocar ambas: acá para que la API lo acepte, allá para
// que se pueda elegir y pintar.
export const BAR_COLOR_KEYS = ["green", "amber", "violet", "pink"] as const;

/**
 * Normaliza el `barColor` que llega en un PATCH: devuelve la clave, o `null` para el
 * color por defecto (null, "" o solo espacios). Devuelve `undefined` si el valor NO
 * es de la paleta, para que la ruta lo rechace en vez de guardar una clave inventada
 * que después no pintaría nada.
 */
export function normalizeBarColor(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  if (key === "") return null;
  return (BAR_COLOR_KEYS as readonly string[]).includes(key) ? key : undefined;
}
