// Celdas editables inline del grid. Confirman en blur o Enter; cancelan en Escape.
import { useEffect, useRef, useState } from "react";

type TextProps = {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  listId?: string; // para autocomplete (datalist)
  align?: "left" | "right" | "center";
  // Toma el foco (y selecciona el contenido) en cuanto pasa a true. Lo usa la
  // celda Title de una fila recién creada; `onAutoFocused` avisa para bajar el pedido.
  autoFocus?: boolean;
  onAutoFocused?: () => void;
};

export function EditableText({
  value,
  onCommit,
  placeholder,
  listId,
  align = "left",
  autoFocus = false,
  onAutoFocused,
}: TextProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    onAutoFocused?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      ref={inputRef}
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
  // Último valor ya confirmado, para no commitear dos veces el mismo valor.
  const committed = useRef(value);
  // ¿El cambio actual provino de TECLEO? Si sí, se recalcula en el blur; si no
  // (viene del datepicker), se recalcula de inmediato.
  const typed = useRef(false);
  useEffect(() => {
    setDraft(value);
    committed.current = value;
  }, [value]);

  const commit = () => {
    const v = ref.current?.value ?? draft;
    if (v !== committed.current) {
      committed.current = v;
      onCommit(v);
    }
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  // Evento NATIVO `change` (no el `onChange` de React, que es `input` y salta por
  // cada segmento). Al elegir en el datepicker no hubo tecleo → confirmar ya; si
  // hubo tecleo, se difiere al blur (no recalcular mientras se escribe).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onNativeChange = () => {
      if (!typed.current) commitRef.current();
    };
    el.addEventListener("change", onNativeChange);
    return () => el.removeEventListener("change", onNativeChange);
  }, []);

  return (
    <input
      ref={ref}
      type="date"
      className="cell-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)} // solo actualiza el draft (no recalcula)
      onBlur={() => {
        commit(); // recalcula al quitar el foco (caso tecleo)
        typed.current = false;
      }}
      onKeyDown={(e) => {
        typed.current = true; // hubo tecleo → no recalcular hasta el blur
        if (e.key === "Enter") {
          ref.current?.blur();
        } else if (e.key === "Escape") {
          if (ref.current) ref.current.value = value; // revierte el DOM sin disparar change
          setDraft(value);
          typed.current = false;
          ref.current?.blur();
        }
      }}
    />
  );
}
