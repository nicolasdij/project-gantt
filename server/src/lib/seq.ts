// Traducción entre el ID VISIBLE de una fila y su clave interna, que es lo único que
// pasa en el borde de la API.
//
// El ID visible es `order + 1`: un secuencial 1..N que se renumera solo cuando las filas
// se mueven, y es el número que el usuario escribe en Dependencies. La clave interna
// (`id`) es estable y es a la que apuntan las Dependencies ALMACENADAS. Traducir en el
// borde —y en un solo lugar— es lo que permite reordenar filas sin reescribir el campo
// de nadie.

import { remapDependencies } from "./deps.ts";

export type SeqTask = { id: number; order: number };

export type SeqMaps = {
  /** id interno → ID visible (para lo que sale hacia el cliente). */
  idToSeq: Map<number, number>;
  /** ID visible → id interno (para lo que entra desde el cliente). */
  seqToId: Map<number, number>;
};

export function buildMaps(tasks: SeqTask[]): SeqMaps {
  const idToSeq = new Map<number, number>();
  const seqToId = new Map<number, number>();
  for (const t of tasks) {
    const seq = t.order + 1;
    idToSeq.set(t.id, seq);
    seqToId.set(seq, t.id);
  }
  return { idToSeq, seqToId };
}

/** La tarea con sus Dependencies traducidas a ID visible (o sea, lista para el cliente). */
export function toSeq<T extends { dependencies: string | null }>(
  task: T,
  idToSeq: Map<number, number>,
): T {
  return { ...task, dependencies: remapDependencies(task.dependencies, idToSeq) };
}
