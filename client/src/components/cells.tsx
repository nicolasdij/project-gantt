// Celdas editables inline del grid. Confirman en blur o Enter; cancelan en Escape.
import { useEffect, useRef, useState } from "react";
import { useUI } from "../store.ts";
import { formatIsoAs, parseDateInput } from "../lib/format.ts";

/**
 * Devuelve los handlers para que un campo aparezca con TODO su texto seleccionado al
 * tomar el foco, con Tab o con el mouse.
 *
 * El `onFocus` solo no alcanza para el mouse: el foco llega en el mousedown y el
 * mouseup posterior colapsa la selección, dejando el caret donde se clickeó. De ahí el
 * paso por mouseup. Dos casos que se respetan:
 *   - si se ARRASTRÓ para seleccionar una parte, no se pisa esa selección;
 *   - si el campo YA tenía el foco, el click reposiciona el caret como siempre.
 */
export function useSelectAllOnFocus() {
  const pending = useRef(false);
  return {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select(),
    onMouseDown: (e: React.MouseEvent<HTMLInputElement>) => {
      pending.current = document.activeElement !== e.currentTarget;
    },
    onMouseUp: (e: React.MouseEvent<HTMLInputElement>) => {
      if (!pending.current) return;
      pending.current = false;
      const el = e.currentTarget;
      if (el.selectionStart === el.selectionEnd) el.select();
    },
  };
}

type TextProps = {
  value: string;
  /**
   * Confirma el valor. Devolver `false` significa RECHAZADO: la celda revierte al valor
   * anterior en vez de quedarse mostrando algo que no se guardó. Puede ser sincrónico
   * (la celda Duration cuando la entrada no parsea) o una promesa (el autosave cuando
   * el server rechaza el cambio, ej. el 409 de una dependencia a un ancestro).
   */
  onCommit: (next: string) => void | boolean | Promise<void | boolean>;
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
  const selectAll = useSelectAllOnFocus();
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
    if (draft === value) return;
    const result = onCommit(draft);
    // `value` acá es el valor previo (el de este render): es justo el que hay que
    // restaurar, y si el server rechazó sigue siendo el vigente.
    if (result === false) setDraft(value);
    else if (result instanceof Promise) {
      void result.then((ok) => {
        if (ok === false) setDraft(value);
      });
    }
  };

  return (
    <input
      ref={inputRef}
      className="cell-input"
      style={{ textAlign: align }}
      value={draft}
      placeholder={placeholder}
      list={listId}
      {...selectAll}
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
  /**
   * Cuándo se confirma lo tipeado. "blur" (default) es lo que quiere el grid: cada
   * commit es un PATCH, así que no puede salir uno por tecla. "input" es para el
   * modal, donde onCommit solo escribe en un borrador local: confirma en cuanto el
   * texto ya es una fecha válida, así el botón Save ve el valor sin depender de que
   * el click mueva el foco fuera del campo.
   */
  commitOn?: "blur" | "input";
};

/**
 * Celda de fecha. Es un input de TEXTO en el formato elegido en Settings (un
 * `input type="date"` nativo se dibuja según el locale del navegador y no admite
 * formato propio), más un botón que abre el datepicker nativo de un input oculto.
 * Se conservan las dos reglas de antes: tipear NO recalcula hasta el blur, y elegir
 * en el datepicker confirma de inmediato.
 */
export function EditableDate({ value, onCommit, commitOn = "blur" }: DateProps) {
  const dateFormat = useUI((s) => s.dateFormat);
  const selectAll = useSelectAllOnFocus();
  const picker = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => formatIsoAs(value, dateFormat));

  // Re-formatea al cambiar el valor o el formato elegido, pero respeta lo que se está
  // tipeando si ya significa esa misma fecha (si no, "4/8/2026" saltaría a
  // "04/08/2026" en plena escritura).
  useEffect(() => {
    setDraft((cur) => (value !== "" && parseDateInput(cur, dateFormat) === value ? cur : formatIsoAs(value, dateFormat)));
  }, [value, dateFormat]);

  const onType = (text: string) => {
    setDraft(text);
    if (commitOn !== "input") return;
    // Solo cuando ya es una fecha válida: nunca revierte a medio tipear.
    const iso = parseDateInput(text, dateFormat);
    if (iso != null && iso !== value) onCommit(iso);
  };

  const commit = () => {
    const text = draft.trim();
    if (text === "") {
      if (value !== "") onCommit(""); // se borró la fecha
      return;
    }
    const iso = parseDateInput(text, dateFormat);
    // Fecha inválida en este formato: se revierte (no se manda nada al server).
    if (iso == null) return setDraft(formatIsoAs(value, dateFormat));
    if (iso !== value) onCommit(iso);
    else setDraft(formatIsoAs(value, dateFormat)); // normaliza lo tipeado
  };

  return (
    <div className="date-cell">
      <input
        className="cell-input"
        value={draft}
        placeholder={dateFormat}
        {...selectAll}
        onChange={(e) => onType(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(formatIsoAs(value, dateFormat));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <button
        type="button"
        className="date-picker-btn"
        title="Open date picker"
        // Fuera del orden de tabulación: el Tab va campo a campo (como en una planilla)
        // y no se detiene en el botón. Con teclado la fecha se tipea en el formato
        // elegido, que es justamente para lo que está el campo de texto.
        tabIndex={-1}
        // El nativo tiene que estar renderizado para que showPicker() no tire
        // InvalidStateError: por eso se oculta con opacity/1px, no con display:none.
        onClick={() => picker.current?.showPicker?.()}
      >
        📅
      </button>
      <input
        ref={picker}
        type="date"
        className="date-picker-native"
        tabIndex={-1}
        aria-hidden
        value={value}
        onChange={(e) => onCommit(e.target.value)} // el datepicker confirma ya
      />
    </div>
  );
}
