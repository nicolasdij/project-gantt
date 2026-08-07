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
  /** Clave de la paleta ("green", "amber"…) o null = color por defecto. */
  barColor: string | null;
  /** Rótulo sobre la barra del Gantt (null = sin rótulo). Solo se muestra en las hojas. */
  barTitle: string | null;
  owner: string | null;
  /** Texto tal cual se edita, en IDs visibles ("3FS+1d, 5SS"). */
  dependencies: string | null;
  /**
   * Las mismas dependencias YA PARSEADAS por el server, en IDs visibles. El cliente no
   * parsea el campo: tener una copia del parser acá significaba que un cambio de formato
   * podía dejar al Gantt sin dibujar una flecha que el scheduler sí estaba respetando.
   */
  deps: Dependency[];
  descriptionMd: string | null;
};

export type DepType = "FS" | "SS" | "FF";
/** Dependencia parseada: `predId` es el ID VISIBLE del predecesor; `lag`, días laborables. */
export type Dependency = { predId: number; type: DepType; lag: number };

// Campos editables inline en el grid.
export type EditableField =
  | "title"
  | "start"
  | "end"
  | "durationDays"
  | "progress"
  | "barColor"
  | "barTitle"
  | "owner"
  | "dependencies"
  | "descriptionMd";
