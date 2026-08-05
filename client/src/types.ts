export type Task = {
  id: number;
  wbs: string;
  parentId: number | null;
  order: number;
  title: string;
  start: string | null; // ISO
  end: string | null; // ISO
  durationDays: number;
  isMilestone: boolean;
  /** Avance 0..100. En las filas padre es calculado (roll-up ponderado por duración). */
  progress: number;
  owner: string | null;
  dependencies: string | null;
  descriptionMd: string | null;
};

// Campos editables inline en el grid.
export type EditableField =
  | "title"
  | "start"
  | "end"
  | "durationDays"
  | "progress"
  | "owner"
  | "dependencies"
  | "descriptionMd";
