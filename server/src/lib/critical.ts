// Motor de camino crítico (CPM) sobre las dependencias FS/SS/FF.
//
// El forward pass (early start/finish) ya lo resuelve el scheduler: las fechas
// actuales de cada tarea SON su early start/finish. Aquí hacemos el BACKWARD PASS
// (late start/finish) y marcamos como críticas las tareas con holgura 0
// (late start == early start).
//
// Solo se consideran las HOJAS con fechas como actividades: los padres son
// resúmenes (roll-up) y no participan como nodos del CPM.
//
// Un padre SÍ puede ser predecesor (el scheduler respeta esas dependencias), y por
// eso la arista no se descarta: se TRADUCE a las hojas del subárbol que realmente
// determinan la fecha usada — las que terminan último para FS/FF, las que empiezan
// primero para SS. Sin esa traducción, la hoja que empuja al grupo aparecía con
// holgura y el camino crítico se cortaba ahí (ver tests).
// (Un padre no puede ser SUCESOR: sus fechas son derivadas, la API lo rechaza.)

import { addWorkingDays, subWorkingDays } from "./dates.ts";
import { makeClosesCycle, parseDependencies, type DepType } from "./deps.ts";
import { makeIsAncestor } from "./tree.ts";

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

  // Hijos por padre, para poder bajar de un padre a sus hojas.
  const childrenOf = new Map<number, CriticalTask[]>();
  for (const t of tasks) {
    if (t.parentId == null) continue;
    (childrenOf.get(t.parentId) ?? childrenOf.set(t.parentId, []).get(t.parentId)!).push(t);
  }

  /** Actividades hoja descendientes de `id` (a cualquier profundidad). */
  const leafActivitiesUnder = (id: number): CriticalTask[] => {
    const out: CriticalTask[] = [];
    const walk = (pid: number) => {
      for (const c of childrenOf.get(pid) ?? []) {
        if (isLeaf(c.id)) {
          const act = byId.get(c.id);
          if (act) out.push(act);
        } else {
          walk(c.id);
        }
      }
    };
    walk(id);
    return out;
  };

  /**
   * Predecesores reales de una dependencia. Si apunta a una hoja, es ella misma; si
   * apunta a un padre, son las hojas del subárbol que determinan la fecha que usa la
   * dependencia (con empates, todas). El resto de los hijos conserva su holgura.
   */
  const resolvePreds = (predId: number, type: DepType): number[] => {
    if (byId.has(predId)) return [predId];
    const kids = leafActivitiesUnder(predId);
    if (kids.length === 0) return []; // padre sin hojas con fechas, o id inexistente
    if (type === "SS") {
      // SS se ancla al INICIO del grupo → manda la hoja que empieza primero.
      const min = kids.reduce((m, k) => (k.start! < m ? k.start! : m), kids[0].start!);
      return kids.filter((k) => k.start!.getTime() === min.getTime()).map((k) => k.id);
    }
    // FS y FF se anclan al FIN del grupo → manda la hoja que termina último.
    const max = kids.reduce((m, k) => (k.end! > m ? k.end! : m), kids[0].end!);
    return kids.filter((k) => k.end!.getTime() === max.getTime()).map((k) => k.id);
  };

  // Aristas predecesor→sucesor (solo entre actividades).
  const predsOf = new Map<number, Edge[]>(); // sucesor → [(pred, tipo)]
  const succsOf = new Map<number, Edge[]>(); // predecesor → [(succ, tipo)]
  const isAncestor = makeIsAncestor(tasks);
  const closesCycle = makeClosesCycle(tasks);
  for (const s of acts) {
    for (const d of parseDependencies(s.dependencies)) {
      // Depender de un ancestro es circular (la API lo rechaza y el scheduler lo
      // ignora): acá también, para que los dos motores vean el mismo grafo.
      if (isAncestor(d.predId, s.id)) continue;
      // Misma regla que el scheduler: una dependencia que cierra un ciclo se ignora,
      // para que los dos motores vean el mismo grafo.
      if (closesCycle(s.id, d.predId)) continue;
      for (const predId of resolvePreds(d.predId, d.type)) {
        if (predId === s.id) continue; // defensa: nunca una auto-arista
        (predsOf.get(s.id) ?? predsOf.set(s.id, []).get(s.id)!).push({ other: predId, type: d.type });
        (succsOf.get(predId) ?? succsOf.set(predId, []).get(predId)!).push({ other: s.id, type: d.type });
      }
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

    // Restricción más tardía posible = el late start MÍNIMO entre los sucesores.
    // Un sucesor todavía sin resolver (solo ocurre con ciclos) se ignora en vez de
    // romper el cálculo.
    let best: Date | null = null;
    for (const e of succs) {
      const lsS = LS.get(e.other);
      const lfS = LF.get(e.other);
      if (!lsS || !lfS) continue;
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

    let ls: Date;
    if (best === null) {
      // Terminal (sin sucesores utilizables): late finish = fin del proyecto.
      const lf = projectEnd;
      ls = subWorkingDays(lf, off(t.durationDays));
      LF.set(id, lf);
    } else {
      ls = best;
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
