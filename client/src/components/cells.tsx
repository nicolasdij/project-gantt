// Celdas editables inline del grid. Confirman en blur o Enter; cancelan en Escape.
import { useEffect, useState } from "react";

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
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <input
      type="date"
      className="cell-input"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value && e.target.value !== value) onCommit(e.target.value);
      }}
    />
  );
}
