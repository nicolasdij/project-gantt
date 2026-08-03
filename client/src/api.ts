// Cliente HTTP fino sobre la API del server (proxy /api → server).
import type { Task } from "./types.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* respuesta sin cuerpo JSON */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type PatchData = Partial<
  Pick<Task, "title" | "start" | "end" | "durationDays" | "owner" | "dependencies" | "descriptionMd">
>;

export const api = {
  list: () => request<Task[]>("/api/tasks"),
  critical: () => request<{ criticalIds: number[] }>("/api/tasks/critical"),
  patch: (id: number, data: PatchData) =>
    request<Task>(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify(data),
    }),
  create: (body: { title?: string; parentId?: number | null; afterId?: number }) =>
    request<Task>("/api/tasks", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    }),
  remove: (id: number) => request<void>(`/api/tasks/${id}`, { method: "DELETE" }),
  move: (id: number, direction: "up" | "down") =>
    request<Task[]>(`/api/tasks/${id}/move`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ direction }),
    }),
  indent: (id: number) => request<Task[]>(`/api/tasks/${id}/indent`, { method: "POST" }),
  outdent: (id: number) => request<Task[]>(`/api/tasks/${id}/outdent`, { method: "POST" }),
};
