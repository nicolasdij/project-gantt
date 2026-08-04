// Popup de configuración (botón ⚙️ del toolbar). Mismo patrón que el modal de
// detalle: los cambios viven en un borrador local y solo se aplican con "Save";
// "Cancel" (y ✕ / Escape / click en el fondo) cierra descartándolos.
import { useEffect, useMemo, useState } from "react";
import { useUI } from "../store.ts";
import {
  DATE_FORMATS,
  WORKING_DAYS_PER_MONTH_OPTIONS,
  formatIsoAs,
  type DateFormat,
  type WorkingDaysPerMonth,
} from "../lib/format.ts";

export function SettingsModal() {
  const open = useUI((s) => s.settingsOpen);
  const close = useUI((s) => s.closeSettings);
  const dateFormat = useUI((s) => s.dateFormat);
  const setDateFormat = useUI((s) => s.setDateFormat);
  const daysPerMonth = useUI((s) => s.workingDaysPerMonth);
  const setDaysPerMonth = useUI((s) => s.setWorkingDaysPerMonth);

  const [draftFormat, setDraftFormat] = useState<DateFormat>(dateFormat);
  const [draftDays, setDraftDays] = useState<WorkingDaysPerMonth>(daysPerMonth);
  // El borrador se rearma al abrir (descarta lo que se hubiera tocado y cancelado).
  useEffect(() => {
    if (open) {
      setDraftFormat(dateFormat);
      setDraftDays(daysPerMonth);
    }
  }, [open, dateFormat, daysPerMonth]);

  // Cerrar con Escape = cancelar.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  // Fecha de ejemplo para el dropdown: hoy, así se ve cada formato con datos reales.
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  if (!open) return null;

  const save = () => {
    setDateFormat(draftFormat);
    setDaysPerMonth(draftDays);
    close();
  };

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" title="Close without saving" onClick={close}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <label className="field">
            <span>Date format</span>
            <select
              className="cell-input"
              value={draftFormat}
              onChange={(e) => setDraftFormat(e.target.value as DateFormat)}
            >
              {DATE_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {format} — {formatIsoAs(today, format)}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">Applies to the Start and End dates in the grid and in the item modal.</p>

          <label className="field">
            <span>Working days per month</span>
            <select
              className="cell-input"
              value={draftDays}
              onChange={(e) => setDraftDays(Number(e.target.value) as WorkingDaysPerMonth)}
            >
              {WORKING_DAYS_PER_MONTH_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
          </label>
          <p className="hint">
            Used by the Duration field: typing <code>1m</code> means one working month, so{" "}
            {draftDays} working days. A week is always 5 (<code>1w</code> = 5d).
          </p>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
