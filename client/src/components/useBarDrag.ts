// Arrastre de las barras del Gantt: la máquina de estados del gesto, separada del
// dibujo. Timeline se quedaba con dos responsabilidades que no se tocan entre sí —el
// gesto y el render— y el gesto es la que tiene estado, listeners globales y efectos.
//
// Se guardan las FECHAS originales del arrastre, no las coordenadas: así el resultado no
// depende del scroll ni del zoom mientras el gesto está en curso.
import { useEffect, useState } from "react";
import type { Task } from "../types.ts";
import { addDaysIso, addWorkingDaysIso, isoToDate, snapToWorkingDayIso } from "../lib/format.ts";

/** Un borde (redimensiona) o el cuerpo ("move": desplaza Start y End juntos). */
export type DragMode = "start" | "end" | "move";

type Drag = {
  id: number;
  mode: DragMode;
  originClientX: number;
  startIso: string;
  endIso: string;
  durationDays: number; // se conserva al mover la barra completa
};

/** Fechas provisorias de la fila que se está arrastrando (no van al server todavía). */
export type DragPreview = { id: number; start: string; end: string } | null;

export type BarDrag = {
  /** Fechas provisorias de la fila en curso, para dibujarla siguiendo al puntero. */
  preview: DragPreview;
  /** Arranca el gesto (mousedown en el cuerpo o en un borde de la barra). */
  begin: (e: React.MouseEvent, t: Task, mode: DragMode) => void;
};

export function useBarDrag(
  dayWidth: number,
  onCommit: (id: number, data: { start?: string; end?: string }) => void,
): BarDrag {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<DragPreview>(null);

  const begin = (e: React.MouseEvent, t: Task, mode: DragMode) => {
    if (!t.start || !t.end) return;
    e.preventDefault();
    e.stopPropagation();
    setDrag({
      id: t.id,
      mode,
      originClientX: e.clientX,
      startIso: isoToDate(t.start),
      endIso: isoToDate(t.end),
      durationDays: t.durationDays,
    });
  };

  useEffect(() => {
    if (!drag) return;
    // Días arrastrados → fechas nuevas. La fecha resultante queda siempre en día
    // laborable. Al redimensionar, el borde frena contra el opuesto (la barra nunca
    // se invierte: mínimo 1 día); al mover, se conserva la Duration.
    const datesAt = (clientX: number) => {
      const deltaDays = Math.round((clientX - drag.originClientX) / dayWidth);
      if (drag.mode === "move") {
        const start = snapToWorkingDayIso(addDaysIso(drag.startIso, deltaDays));
        // Mismo cálculo que hará el server al conservar la Duration, para que el
        // preview no muestre un fin distinto del que va a quedar guardado.
        const end = drag.durationDays <= 0 ? start : addWorkingDaysIso(start, drag.durationDays - 1);
        return { start, end };
      }
      if (drag.mode === "start") {
        const moved = snapToWorkingDayIso(addDaysIso(drag.startIso, deltaDays));
        return { start: moved > drag.endIso ? drag.endIso : moved, end: drag.endIso };
      }
      const moved = snapToWorkingDayIso(addDaysIso(drag.endIso, deltaDays));
      return { start: drag.startIso, end: moved < drag.startIso ? drag.startIso : moved };
    };

    const onMove = (ev: MouseEvent) => setPreview({ id: drag.id, ...datesAt(ev.clientX) });
    const onUp = (ev: MouseEvent) => {
      const { start, end } = datesAt(ev.clientX);
      setDrag(null);
      setPreview(null);
      if (start === drag.startIso && end === drag.endIso) return; // no se movió
      // Mover: se manda SOLO start, porque editar el start es justamente el caso en
      // que el motor conserva la Duration y recalcula el fin.
      // Borde izquierdo: start Y end, para que derive la Duration (con solo `start`
      // movería el fin). Borde derecho: solo end.
      const data =
        drag.mode === "move" ? { start } : drag.mode === "start" ? { start, end } : { end };
      onCommit(drag.id, data);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, dayWidth]);

  // Cursor/selección global mientras se arrastra (igual que el splitter del layout).
  useEffect(() => {
    document.body.style.userSelect = drag ? "none" : "";
    document.body.style.cursor = drag ? (drag.mode === "move" ? "grabbing" : "ew-resize") : "";
  }, [drag]);

  return { preview, begin };
}
