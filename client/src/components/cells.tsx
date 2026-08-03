// Celdas editables inline del grid. Confirman en blur o Enter; cancelan en Escape.
import { useEffect, useRef, useState } from "react";

type TextProps = {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  listId?: string; // para autocomplete (datalist)
  align?: "left" | "right" | "center";
};

export function EditableText({ value, onCommit, placeholder, listId, align = "left" }: TextProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      className="cell-input"
      style={{ textAlign: align }}
      value={draft}
      placeholder={placeholder}
      list={listId}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

type DateProps = {
  value: string; // YYYY-MM-DD o ""
  onCommit: (next: string) => void;
};

export function EditableDate({ value, onCommit }: DateProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  // Última fecha ya confirmada, para no commitear dos veces (change + blur del mismo valor).
  const committed = useRef(value);
  useEffect(() => {
    setDraft(value);
    committed.current = value;
  }, [value]);

  const maybeCommit = () => {
    const v = ref.current?.value ?? draft;
    if (v !== value && v !== committed.current) {
      committed.current = v;
      onCommit(v);
    }
  };

  // Escucha el evento NATIVO `change` (no el `onChange` de React, que es `input` y
  // se dispara por cada segmento). El `change` nativo salta al elegir en el date
  // picker (de inmediato) y al perder el foco tras escribir — nunca por cada tecla.
  const latest = useRef(maybeCommit);
  latest.current = maybeCommit;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => latest.current();
    el.addEventListener("change", handler);
    return () => el.removeEventListener("change", handler);
  }, []);

  return (
    <input
      ref={ref}
      type="date"
      className="cell-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)} // solo actualiza el draft (no recalcula)
      onBlur={maybeCommit}
      onKeyDown={(e) => {
        if (e.key === "Enter") ref.current?.blur();
        else if (e.key === "Escape") {
          setDraft(value);
          ref.current?.blur();
        }
      }}
    />
  );
}
