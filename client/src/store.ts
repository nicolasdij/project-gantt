// Estado de UI (no de datos: los datos viven en React Query).
import { create } from "zustand";

export type Notice = { kind: "error" | "info"; title: string; message: string };
export type Zoom = "day" | "week" | "month";

type UIState = {
  selectedId: number | null;
  select: (id: number | null) => void;
  modalTaskId: number | null;
  openModal: (id: number) => void;
  closeModal: () => void;
  // Fila cuya celda Title debe tomar el foco. Se pide al crear una fila (para poder
  // tipear el título sin un click extra) y la propia celda lo limpia al enfocarse:
  // el foco tiene que esperar a que la fila nueva llegue en el refetch y se monte.
  focusTitleId: number | null;
  requestTitleFocus: (id: number) => void;
  clearTitleFocus: () => void;
  zoom: Zoom;
  setZoom: (zoom: Zoom) => void;
  showCritical: boolean;
  toggleCritical: () => void;
  // Notificaciones (errores/avisos) mostradas como modal propio, nunca con alert().
  notice: Notice | null;
  notify: (notice: Notice) => void;
  showError: (message: string) => void;
  dismissNotice: () => void;
};

export const useUI = create<UIState>((set) => ({
  selectedId: null,
  select: (id) => set({ selectedId: id }),
  modalTaskId: null,
  openModal: (id) => set({ modalTaskId: id }),
  closeModal: () => set({ modalTaskId: null }),
  focusTitleId: null,
  requestTitleFocus: (id) => set({ focusTitleId: id }),
  clearTitleFocus: () => set({ focusTitleId: null }),
  zoom: "week",
  setZoom: (zoom) => set({ zoom }),
  showCritical: false,
  toggleCritical: () => set((s) => ({ showCritical: !s.showCritical })),
  notice: null,
  notify: (notice) => set({ notice }),
  showError: (message) => set({ notice: { kind: "error", title: "Error", message } }),
  dismissNotice: () => set({ notice: null }),
}));
