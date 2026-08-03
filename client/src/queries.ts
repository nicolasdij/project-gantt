// Hooks de datos (React Query): fetch de tareas + mutaciones.
// Toda mutación invalida ['tasks'] para releer el estado recalculado del server.
import { useMutation, useQuery, useQueryClient, useIsMutating } from "@tanstack/react-query";
import { api, type PatchData } from "./api.ts";
import { useUI } from "./store.ts";

const KEY = ["tasks"] as const;

export function useTasks() {
  return useQuery({ queryKey: KEY, queryFn: api.list });
}

/** Indicador global de autosave: cuántas mutaciones hay en vuelo. */
export function useSavingCount() {
  return useIsMutating();
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY });
  const onError = (e: unknown) => {
    // Errores de negocio (ej. editar fecha de un padre → 409) se muestran en un
    // modal propio (nunca con alert()). Se accede al store fuera de React.
    useUI.getState().showError(e instanceof Error ? e.message : "Error inesperado");
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
