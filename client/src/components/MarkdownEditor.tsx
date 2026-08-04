// Editor WYSIWYG ligero: negrita, cursiva, subrayado, listas (ordenadas y no).
// Se edita como HTML (contentEditable) y se GUARDA como Markdown.
//   - MD → HTML al inicializar (marked).
//   - HTML → MD en cada `input` y en el blur (turndown). El subrayado se conserva
//     como <u>. Commitear en `input` (y no solo en el blur) es lo que garantiza que
//     el botón Guardar del modal vea lo último tipeado sin depender de que el click
//     mueva el foco fuera del editor.
import { useEffect, useRef } from "react";
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

  const exec = (command: string) => {
    // execCommand está deprecado pero es la vía más simple y universal para
    // un WYSIWYG básico; suficiente para el alcance del editor (v1).
    document.execCommand(command, false);
    ref.current?.focus();
  };

  const commit = () => {
    if (ref.current) onChange(htmlToMd(ref.current.innerHTML));
  };

  const Btn = ({ cmd, label, title }: { cmd: string; label: string; title: string }) => (
    <button type="button" className="md-btn" title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => exec(cmd)}>
      {label}
    </button>
  );

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
