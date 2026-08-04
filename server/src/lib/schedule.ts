// Programación de fechas: auto-scheduling por dependencias (hojas) + roll-up (padres).
//
// - Auto-scheduling (estilo MS Project): una tarea hoja con dependencias ve su
//   Start/End determinados por sus predecesores, conservando su Duration.
//     FS (Finish-Start): sucesor empieza el día laborable siguiente al fin del pred.
//     SS (Start-Start):  sucesor empieza a la vez que el pred.
//     FF (Finish-Finish):sucesor termina a la vez que el pred (Start = End - dur + 1).
//   Con varias dependencias se toma la restricción más tardía (Start implícito máximo).
// - Roll-up: los padres toman Start = mín(hijos), End = máx(hijos).
//
// Se resuelve por punto fijo (itera scheduling + roll-up hasta estabilizar), lo que
// maneja cadenas de dependencias y predecesores que son padres. Las dependencias que
// cierran un CICLO se ignoran (ver makeClosesCycle): son las que impedían converger, y
// el resultado terminaba dependiendo del tope de iteraciones.

import { addWorkingDays, subWorkingDays, workingDaysBetween } from "./dates.ts";
import { makeClosesCycle, parseDependencies } from "./deps.ts";
import { groupChildren, makeIsAncestor } from "./tree.ts";

export type ScheduleTask = {
  id: number;
  parentId: number | null;
  order: number;
  start: Date | null;
  end: Date | null;
  durationDays: number;
  isMilestone: boolean;
  dependencies: string | null;
};

export type ScheduledFields = {
  start: Date | null;
  end: Date | null;
  durationDays: number;
  isMilestone: boolean;
};

type Eff = { start: Date | null; end: Date | null; dur: number };

const sameDate = (a: Date | null, b: Date | null) =>
  a === null || b === null ? a === b : a.getTime() === b.getTime();

/** End derivado de Start + duración (milestone: End = Start). */
function endFromStart(start: Date, dur: number): Date {
  return dur <= 0 ? start : addWorkingDays(start, dur - 1);
}

export function computeSchedule(tasks: ScheduleTask[]): Map<number, ScheduledFields> {
  const childrenByParent = groupChildren(tasks);
  const isParent = (id: number) => (childrenByParent.get(id)?.length ?? 0) > 0;
  const roots = childrenByParent.get(null) ?? [];
  const isAncestor = makeIsAncestor(tasks);
  const closesCycle = makeClosesCycle(tasks);

  // Estado efectivo por tarea, inicializado con los valores almacenados.
  const eff = new Map<number, Eff>();
  for (const t of tasks) {
    eff.set(t.id, { start: t.start, end: t.end, dur: t.durationDays });
  }

  // Roll-up de padres (post-orden) a partir del estado efectivo de los hijos.
  const rollup = (t: ScheduleTask): void => {
    const kids = childrenByParent.get(t.id);
    if (!kids || kids.length === 0) return; // hoja: se conserva su eff
    for (const k of kids) rollup(k);
    let minS: Date | null = null;
    let maxE: Date | null = null;
    for (const k of kids) {
      const e = eff.get(k.id)!;
      if (e.start && (!minS || e.start < minS)) minS = e.start;
      if (e.end && (!maxE || e.end > maxE)) maxE = e.end;
    }
    eff.set(t.id, {
      start: minS,
      end: maxE,
      dur: minS && maxE ? workingDaysBetween(minS, maxE) : 0,
    });
  };
  const rollupAll = () => roots.forEach(rollup);

  // Un paso de scheduling sobre las hojas con dependencias. Devuelve si cambió algo.
  const scheduleLeavesOnce = (): boolean => {
    let changed = false;
    for (const t of tasks) {
      if (isParent(t.id)) continue; // los padres se calculan por roll-up
      const deps = parseDependencies(t.dependencies);
      if (deps.length === 0) continue; // sin dependencias: conserva sus fechas

      const dur = eff.get(t.id)!.dur;
      let impliedStart: Date | null = null;
      for (const d of deps) {
        // Depender de un ANCESTRO es circular: sus fechas son el roll-up de esta misma
        // tarea, así que cada iteración la empujaría más lejos (el punto fijo diverge
        // y el resultado dependería del tope de iteraciones). La API lo rechaza; acá
        // se ignora por si el dato ya existía.
        if (isAncestor(d.predId, t.id)) continue;
        // Dependencia que forma parte de un CICLO (incluido depender de sí misma):
        // aplicarla haría divergir el punto fijo, empujando las fechas en cada
        // iteración. Se ignora, así la tarea conserva sus fechas. La API la rechaza;
        // esto es para datos que ya existieran.
        if (closesCycle(t.id, d.predId)) continue;
        const p = eff.get(d.predId);
        if (!p || !p.start || !p.end) continue; // predecesor inexistente o sin fechas
        let s: Date;
        if (d.type === "SS") s = p.start;
        else if (d.type === "FF") s = dur <= 0 ? p.end : subWorkingDays(p.end, dur - 1);
        else s = addWorkingDays(p.end, 1); // FS
        if (!impliedStart || s > impliedStart) impliedStart = s;
      }
      if (!impliedStart) continue;

      const newEnd = endFromStart(impliedStart, dur);
      const cur = eff.get(t.id)!;
      if (!sameDate(cur.start, impliedStart) || !sameDate(cur.end, newEnd)) {
        eff.set(t.id, { start: impliedStart, end: newEnd, dur });
        changed = true;
      }
    }
    return changed;
  };

  // Roll-up ANTES de la primera pasada: las fechas de los padres que vienen de la base
  // pueden estar desactualizadas respecto de sus hijos (el hijo que acaba de editarse
  // ya está guardado, el padre todavía no). Si se programara con esas fechas viejas y
  // esa pasada no cambiara nada, el bucle cortaría y las hojas que dependen del padre
  // se quedarían con la fecha vieja hasta la mutación siguiente.
  rollupAll();

  // Punto fijo: alterna scheduling y roll-up hasta estabilizar (tope = nº tareas + 2).
  const maxIter = tasks.length + 2;
  for (let i = 0; i < maxIter; i++) {
    const changed = scheduleLeavesOnce();
    rollupAll();
    if (!changed) break;
  }

  // Resultado: milestone solo aplica a hojas con duración 0.
  const result = new Map<number, ScheduledFields>();
  for (const t of tasks) {
    const e = eff.get(t.id)!;
    const parent = isParent(t.id);
    result.set(t.id, {
      start: e.start,
      end: e.end,
      durationDays: e.dur,
      isMilestone: parent ? false : e.dur === 0,
    });
  }
  return result;
}
