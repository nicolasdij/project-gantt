// Hooks de datos (React Query): fetch de tareas + mutaciones.
// Toda mutación invalida ['tasks'] para releer el estado recalculado del server.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, useIsMutating } from "@tanstack/react-query";
import { api, type PatchData } from "./api.ts";
import type { Task } from "./types.ts";
import { useUI } from "./store.ts";

const KEY = ["tasks"] as const;
const CRITICAL_KEY = ["critical"] as const;

export function useTasks() {
  return useQuery({ queryKey: KEY, queryFn: api.list });
}

/** Ids del camino crítico. Solo consulta cuando el toggle está activo. */
export function useCriticalPath(enabled: boolean) {
  return useQuery({
    queryKey: CRITICAL_KEY,
    queryFn: api.critical,
    enabled,
    select: (d) => new Set(d.criticalIds),
  });
}

/** Indicador global de autosave: cuántas mutaciones hay en vuelo. */
export function useSavingCount() {
  return useIsMutating();
}

/**
 * Ids de las filas que son PADRES (tienen al menos un hijo). Es la pregunta que decide
 * qué celdas son read-only, qué barra es un resumen y qué rótulo no se dibuja, así que
 * conviene una sola definición y un solo cálculo por fetch: antes cada componente se
 * armaba el suyo (dos con la misma expresión copiada, dos con `.some()` por fila).
 */
export function useParentIds(): Set<number> {
  const { data: tasks = [] } = useTasks();
  return useMemo(
    () => new Set(tasks.map((t) => t.parentId).filter((x): x is number => x != null)),
    [tasks],
  );
}

// Duración con la que nace una fila nueva (la pone el server al crearla). El campo
// Duration nunca puede quedar vacío, así que "vacío" acá significa "sin tocar".
const NEW_ROW_DURATION_DAYS = 1;

/** ¿La fila está totalmente en blanco (nada que perder si se descarta)? */
function isBlankRow(t: Task): boolean {
  return (
    t.title.trim() === "" &&
    !t.start &&
    !t.end &&
    t.durationDays === NEW_ROW_DURATION_DAYS &&
    // Un avance tipeado es contenido real (la fila nace en 0%), igual que un color
    // de barra elegido a mano o un rótulo escrito (la fila nace sin ninguno de los dos).
    t.progress === 0 &&
    !t.barColor &&
    !(t.barTitle ?? "").trim() &&
    !(t.owner ?? "").trim() &&
    !(t.dependencies ?? "").trim() &&
    // No está en el grid, pero una fila con descripción tiene contenido real.
    !(t.descriptionMd ?? "").trim()
  );
}

/**
 * Descarta la fila que se deja atrás si quedó totalmente vacía: al mover la selección
 * de una fila a otra, se evalúa la anterior y se borra si está en blanco.
 *
 * La evaluación espera a que no haya mutaciones ni refetch en vuelo: el autosave del
 * blur dispara su PATCH justo antes del cambio de selección, así que decidir con la
 * caché de ese instante borraría una fila que el usuario acaba de completar.
 */
export function useDiscardEmptyRowOnLeave() {
  const { data: tasks = [], isFetching } = useTasks();
  const selectedId = useUI((s) => s.selectedId);
  const { remove } = useTaskMutations();
  const saving = useIsMutating();

  const [candidateId, setCandidateId] = useState<number | null>(null);
  const prevSelected = useRef<number | null>(selectedId);

  useEffect(() => {
    const prev = prevSelected.current;
    prevSelected.current = selectedId;
    // Solo al pasar de una fila a OTRA fila (no al deseleccionar).
    if (prev != null && selectedId != null && prev !== selectedId) setCandidateId(prev);
  }, [selectedId]);

  useEffect(() => {
    if (candidateId == null) return;
    if (saving > 0 || isFetching) return; // esperar el autosave y su refetch
    const task = tasks.find((t) => t.id === candidateId);
    setCandidateId(null);
    if (!task || !isBlankRow(task)) return;
    // Nunca borrar una fila con hijos: el borrado es en cascada.
    if (tasks.some((t) => t.parentId === task.id)) return;
    remove.mutate(task.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId, saving, isFetching, tasks]);
}

export function useTaskMutations() {
  const qc = useQueryClient();
  // Toda mutación puede cambiar fechas/dependencias → invalida tareas Y camino crítico.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: KEY });
    qc.invalidateQueries({ queryKey: CRITICAL_KEY });
  };
  const onError = (e: unknown) => {
    // Errores de negocio (ej. editar fecha de un padre → 409) se muestran en un
    // modal propio (nunca con alert()). Se accede al store fuera de React.
    useUI.getState().showError(e instanceof Error ? e.message : "Unexpected error");
  };

  const patch = useMutation({
    mutationFn: (v: { id: number; data: PatchData }) => api.patch(v.id, v.data),
    onError,
    onSettled: invalidate,
  });
  const create = useMutation({
    mutationFn: (v: { afterId?: number }) => api.create(v),
    onError,
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.remove(id),
    onError,
    onSettled: invalidate,
  });
  const move = useMutation({
    mutationFn: (v: { id: number; direction: "up" | "down" }) => api.move(v.id, v.direction),
    onError,
    onSettled: invalidate,
  });
  const indent = useMutation({
    mutationFn: (id: number) => api.indent(id),
    onError,
    onSettled: invalidate,
  });
  const outdent = useMutation({
    mutationFn: (id: number) => api.outdent(id),
    onError,
    onSettled: invalidate,
  });

  return { patch, create, remove, move, indent, outdent };
}
