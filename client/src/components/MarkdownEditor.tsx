// Editor WYSIWYG ligero: negrita, cursiva, subrayado, listas (ordenadas y no).
// Se edita como HTML (contentEditable) y se GUARDA como Markdown.
//   - MD → HTML al inicializar (marked).
//   - HTML → MD en cada `input` y en el blur (turndown). El subrayado se conserva
//     como <u>. Commitear en `input` (y no solo en el blur) es lo que garantiza que
//     el botón Guardar del modal vea lo último tipeado sin depender de que el click
//     mueva el foco fuera del editor.
import { useCallback, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  // Cursiva con `*` y NO con `_` (el default de turndown): CommonMark no reconoce
  // `_` en medio de una palabra, así que "negrita + negrita-cursiva" pegadas se
  // guardaban como `**Asdf_Zxc_**` y al releerlas los `_` aparecían literales.
  emDelimiter: "*",
});
// Markdown no tiene subrayado nativo: lo conservamos como HTML <u>.
turndown.keep(["u"]);

function mdToHtml(md: string): string {
  return marked.parse(md ?? "", { async: false }) as string;
}
function htmlToMd(html: string): string {
  return turndown.turndown(html ?? "").trim();
}

// Comandos de lista (necesitan recolocar el caret) y todos los que se muestran
// como "presionados" cuando están activos en la selección.
const LIST_COMMANDS = ["insertUnorderedList", "insertOrderedList"];
const TOGGLE_COMMANDS = ["bold", "italic", "underline", ...LIST_COMMANDS];

type Props = {
  value: string;
  onChange: (markdown: string) => void;
};

export function MarkdownEditor({ value, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Inicializa el HTML solo cuando cambia el `value` desde fuera (no en cada tecla),
  // para no perder la posición del cursor mientras se escribe.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const current = htmlToMd(el.innerHTML);
    if (current !== (value ?? "")) {
      el.innerHTML = mdToHtml(value ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);


  // Al convertir en lista una línea que YA tenía texto, Chrome colapsa la selección
  // al inicio del <li> recién creado, así que lo próximo que se tipea (o el Enter
  // para el siguiente bullet) entra ANTES del texto existente. Se recoloca el caret
  // al final del <li> que lo contiene.
  const caretToEndOfListItem = () => {
    const host = ref.current;
    const sel = window.getSelection();
    if (!host || !sel || sel.rangeCount === 0) return;
    const node = sel.anchorNode;
    if (!node || !host.contains(node)) return;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const li = el?.closest("li");
    if (!li) return;
    const range = document.createRange();
    range.selectNodeContents(li);
    range.collapse(false); // al final
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // Estado "presionado" de los botones: qué comandos están activos en la selección
  // actual. execCommand ya funciona como toggle (apretar B sobre texto en negrita se
  // la quita); esto es lo que lo hace VISIBLE.
  const [activeCmds, setActiveCmds] = useState<string[]>([]);
  const refreshActiveCmds = useCallback(() => {
    const host = ref.current;
    const sel = document.getSelection();
    const inside = !!host && !!sel?.anchorNode && host.contains(sel.anchorNode);
    // Si la selección no está en el editor (foco en otro campo), todos apagados.
    const next = inside
      ? TOGGLE_COMMANDS.filter((c) => {
          try {
            return document.queryCommandState(c);
          } catch {
            return false; // comando no soportado por el navegador
          }
        })
      : [];
    setActiveCmds((prev) =>
      prev.length === next.length && prev.every((c, i) => c === next[i]) ? prev : next,
    );
  }, []);

  // `selectionchange` cubre mover el caret, seleccionar con el mouse y tipear.
  useEffect(() => {
    document.addEventListener("selectionchange", refreshActiveCmds);
    return () => document.removeEventListener("selectionchange", refreshActiveCmds);
  }, [refreshActiveCmds]);

  const exec = (command: string) => {
    // execCommand está deprecado pero es la vía más simple y universal para
    // un WYSIWYG básico; suficiente para el alcance del editor (v1).
    document.execCommand(command, false);
    ref.current?.focus();
    if (LIST_COMMANDS.includes(command)) caretToEndOfListItem();
    refreshActiveCmds(); // el comando cambia el estado sin mover la selección
  };

  const commit = () => {
    if (ref.current) onChange(htmlToMd(ref.current.innerHTML));
  };

  const Btn = ({ cmd, label, title }: { cmd: string; label: string; title: string }) => {
    const on = activeCmds.includes(cmd);
    return (
      <button
        type="button"
        className={`md-btn ${on ? "md-btn-active" : ""}`}
        title={title}
        aria-pressed={on}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => exec(cmd)}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="md-editor">
      <div className="md-toolbar">
        <Btn cmd="bold" label="B" title="Bold" />
        <Btn cmd="italic" label="I" title="Italic" />
        <Btn cmd="underline" label="U" title="Underline" />
        <span className="md-sep" />
        <Btn cmd="insertUnorderedList" label="• List" title="Bulleted list" />
        <Btn cmd="insertOrderedList" label="1. List" title="Numbered list" />
      </div>
      <div
        ref={ref}
        className="md-content"
        contentEditable
        suppressContentEditableWarning
        onInput={commit}
        onBlur={commit}
      />
    </div>
  );
}
