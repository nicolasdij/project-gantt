// Rótulo de la barra (campo "Bar title"): decide si el texto entra ADENTRO de la barra
// —donde va centrado— o si hay que sacarlo AFUERA, a la derecha del borde.
//
// El ancho del texto se mide con canvas en vez de renderizarlo y medir el DOM: la
// respuesta está ANTES de pintar, así que no hace falta un ref por barra ni un segundo
// pase de layout para corregir la posición. La contra es que la fuente hay que
// declararla dos veces (acá y en el CSS); son fuentes del sistema, así que no hay
// webfont que cargue después y mueva la medición.

/** IMPORTANTE: tiene que coincidir con `.tl-bar-title` en index.css. */
const LABEL_FONT = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Aire a cada lado del texto dentro de la barra (= el padding lateral del CSS). */
export const BAR_TITLE_PAD = 4;

/** Separación entre el borde de la barra y el rótulo cuando va afuera. */
export const BAR_TITLE_GAP = 6;

// `undefined` = todavía no se intentó; `null` = no hay contexto 2d disponible.
let ctx: CanvasRenderingContext2D | null | undefined;

function textWidth(text: string): number {
  if (ctx === undefined) {
    ctx = document.createElement("canvas").getContext("2d");
    if (ctx) ctx.font = LABEL_FONT;
  }
  // Sin contexto 2d no se puede medir. Se asume que NO entra: afuera el texto se lee
  // completo siempre, así que es el lado seguro para equivocarse.
  if (!ctx) return Number.POSITIVE_INFINITY;
  return ctx.measureText(text).width;
}

/** ¿El rótulo entra adentro de una barra de `barWidth` px? */
export function fitsInBar(text: string, barWidth: number): boolean {
  return textWidth(text) <= barWidth - BAR_TITLE_PAD * 2;
}
