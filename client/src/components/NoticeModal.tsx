// Modal de notificación (errores/avisos). Reemplaza a alert() del navegador.
// Único botón de cierre; se cierra con Escape/Enter o clic fuera.
import { useEffect } from "react";
import { useUI } from "../store.ts";

export function NoticeModal() {
  const notice = useUI((s) => s.notice);
  const dismiss = useUI((s) => s.dismissNotice);

  useEffect(() => {
    if (!notice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notice, dismiss]);

  if (!notice) return null;

  return (
    <div className="modal-overlay" onClick={dismiss}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className={`confirm-title ${notice.kind === "error" ? "notice-error" : ""}`}>
          {notice.kind === "error" ? "⚠️ " : ""}
          {notice.title}
        </h2>
        <p className="confirm-message">{notice.message}</p>
        <div className="confirm-actions">
          <button className="btn btn-primary" onClick={dismiss} autoFocus>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
