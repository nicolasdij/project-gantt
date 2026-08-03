// Motor de camino crítico (CPM) sobre las dependencias FS/SS/FF.
//
// El forward pass (early start/finish) ya lo resuelve el scheduler: las fechas
// actuales de cada tarea SON su early start/finish. Aquí hacemos el BACKWARD PASS
// (late start/finish) y marcamos como críticas las tareas con holgura 0
// (late start == early start).
//
// Solo se consideran las HOJAS con fechas como actividades; los padres son
// resúmenes (roll-up), no participan en el CPM. Dependencias que apunten a un
// padre se ignoran (caso fuera de alcance en v1).

import { addWorkingDays, subWorkingDays } from "./dates.ts";
import { parseDependencies } from "./deps.ts";

export type CriticalTask = {
  id: number;
  parentId: number | null;
  start: Date | null;
  end: Date | null;
  durationDays: number;
  dependencies: string | null;
};

type Edge = { other: number; type: "FS" | "SS" | "FF" };

export function computeCriticalPath(tasks: CriticalTask[]): number[] {
  const parentIds = new Set(tasks.map((t) => t.parentId).filter((x): x is number => x != null));
  const isLeaf = (id: number) => !parentIds.has(id);

  // Actividades = hojas con fechas.
  const acts = tasks.filter((t) => isLeaf(t.id) && t.start && t.end);
  if (acts.length === 0) return [];
  const byId = new Map(acts.map((t) => [t.id, t]));

  // Aristas predecesor→sucesor (solo entre actividades).
  const predsOf = new Map<number, Edge[]>(); // sucesor → [(pred, tipo)]
  const succsOf = new Map<number, Edge[]>(); // predecesor → [(succ, tipo)]
  for (const s of acts) {
    for (const d of parseDependencies(s.dependencies)) {
      if (!byId.has(d.predId)) continue;
      (predsOf.get(s.id) ?? predsOf.set(s.id, []).get(s.id)!).push({ other: d.predId, type: d.type });
      (succsOf.get(d.predId) ?? succsOf.set(d.predId, []).get(d.predId)!).push({ other: s.id, type: d.type });
    }
  }

  // Orden topológico (predecesores antes que sucesores), tolerante a ciclos.
  const order: number[] = [];
  const state = new Map<number, 0 | 1 | 2>();
  const visit = (id: number) => {
    const st = state.get(id) ?? 0;
    if (st !== 0) return; // ya visitado o en ciclo → no reprocesar
    state.set(id, 1);
    for (const e of predsOf.get(id) ?? []) visit(e.other);
    state.set(id, 2);
    order.push(id);
  };
  for (const a of acts) visit(a.id);

  const projectEnd = acts.reduce((m, t) => (t.end! > m ? t.end! : m), acts[0].end!);
  const off = (dur: number) => Math.max(0, dur - 1); // días a sumar/restar (inclusive)

  const LS = new Map<number, Date>();
  const LF = new Map<number, Date>();

  // Backward pass: sucesores antes que predecesores (orden topológico inverso).
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const t = byId.get(id)!;
    const succs = succsOf.get(id) ?? [];

    let ls: Date;
    if (succs.length === 0) {
      // Terminal: late finish = fin del proyecto.
      const lf = projectEnd;
      ls = subWorkingDays(lf, off(t.durationDays));
      LF.set(id, lf);
    } else {
      // Restricción más tardía posible = el late start MÍNIMO entre los sucesores.
      let best: Date | null = null;
      for (const e of succs) {
        const lsS = LS.get(e.other)!;
        const lfS = LF.get(e.other)!;
        let cand: Date;
        if (e.type === "SS") {
          cand = lsS; // el sucesor no puede empezar antes que el predecesor
        } else if (e.type === "FF") {
          cand = subWorkingDays(lfS, off(t.durationDays)); // fin del pred ≤ fin del succ
        } else {
          // FS: el pred termina el día laborable anterior al inicio del succ
          const lfP = subWorkingDays(lsS, 1);
          cand = subWorkingDays(lfP, off(t.durationDays));
        }
        if (best === null || cand < best) best = cand;
      }
      ls = best!;
      LF.set(id, addWorkingDays(ls, off(t.durationDays)));
    }
    LS.set(id, ls);
  }

  // Crítica ⇔ holgura 0 ⇔ late start == early start.
  const critical: number[] = [];
  for (const t of acts) {
    const ls = LS.get(t.id);
    if (ls && ls.getTime() === t.start!.getTime()) critical.push(t.id);
  }
  return critical;
}
