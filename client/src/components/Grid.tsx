// Panel izquierdo: grid editable con jerarquía, edición inline y roll-up de padres.
import { useMemo } from "react";
import type { Task } from "../types.ts";
import { useUI } from "../store.ts";
import { useTaskMutations } from "../queries.ts";
import { EditableText, EditableDate } from "./cells.tsx";
import { formatDuration, parseDuration, isoToDate, formatIsoAs, wbsDepth } from "../lib/format.ts";

const OWNERS_LIST_ID = "owners-autocomplete";

export function Grid({ tasks }: { tasks: Task[] }) {
  const selectedId = useUI((s) => s.selectedId);
  const select = useUI((s) => s.select);
  const openModal = useUI((s) => s.openModal);
  const dateFormat = useUI((s) => s.dateFormat);
  const daysPerMonth = useUI((s) => s.workingDaysPerMonth);
  const focusTitleId = useUI((s) => s.focusTitleId);
  const clearTitleFocus = useUI((s) => s.clearTitleFocus);
  const { patch } = useTaskMutations();

  // Ids que son padres (tienen al menos un hijo): sus fechas son calculadas.
  const parentIds = useMemo(
    () => new Set(tasks.map((t) => t.parentId).filter((x): x is number => x != null)),
    [tasks],
  );

  // Valores de Owner ya existentes para el autocomplete.
  const owners = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.owner).filter((o): o is string => !!o))).sort(),
    [tasks],
  );

  const edit = (id: number, data: Parameters<typeof patch.mutate>[0]["data"]) =>
    patch.mutate({ id, data });

  return (
    <div className="grid-wrap">
      <datalist id={OWNERS_LIST_ID}>
        {owners.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>

      <table className="grid">
        <thead>
          <tr>
            <th className="col-id">ID</th>
            <th className="col-wbs">WBS</th>
            <th className="col-title">Title</th>
            <th className="col-date">Start</th>
            <th className="col-date">End</th>
            <th className="col-dur">Duration</th>
            <th className="col-owner">Owner</th>
            <th className="col-deps">Dependencies</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const isParent = parentIds.has(t.id);
            const depth = wbsDepth(t.wbs);
            const selected = t.id === selectedId;

            return (
              <tr
                key={t.id}
                className={`${selected ? "row-selected" : ""} ${isParent ? "row-parent" : ""}`}
                onClick={() => select(t.id)}
              >
                <td className="col-id">
                  <button
                    type="button"
                    className="id-link"
                    title="Open details"
                    onClick={(e) => {
                      e.stopPropagation();
                      openModal(t.id);
                    }}
                  >
                    {/* ID visible = posición (order+1): siempre 1..N, se renumera solo. */}
                    {t.order + 1}
                  </button>
                </td>

                <td className="col-wbs num">{t.wbs}</td>

                <td className="col-title">
                  <div style={{ paddingLeft: depth * 18 }} className="title-cell">
                    {t.isMilestone && <span className="milestone-mark">◆</span>}
                    <EditableText
                      value={t.title}
                      onCommit={(v) => edit(t.id, { title: v })}
                      autoFocus={focusTitleId === t.id}
                      onAutoFocused={clearTitleFocus}
                    />
                  </div>
                </td>

                {/* Start / End / Duration: en padres son calculados (read-only). */}
                <td className="col-date">
                  {isParent ? (
                    <span className="ro">{formatIsoAs(t.start, dateFormat) || "—"}</span>
                  ) : (
                    <EditableDate value={isoToDate(t.start)} onCommit={(v) => edit(t.id, { start: v })} />
                  )}
                </td>
                <td className="col-date">
                  {isParent ? (
                    <span className="ro">{formatIsoAs(t.end, dateFormat) || "—"}</span>
                  ) : (
                    <EditableDate value={isoToDate(t.end)} onCommit={(v) => edit(t.id, { end: v })} />
                  )}
                </td>
                <td className="col-dur">
                  {isParent ? (
                    <span className="ro num">{formatDuration(t.durationDays)}</span>
                  ) : (
                    <EditableText
                      align="right"
                      value={formatDuration(t.durationDays)}
                      onCommit={(v) => {
                        // "5d" / "2w" / "1m" / "7". Si no parsea se rechaza, y la
                        // celda revierte en vez de dejar el texto inválido a la vista.
                        const days = parseDuration(v, daysPerMonth);
                        if (days == null) return false;
                        edit(t.id, { durationDays: days });
                      }}
                    />
                  )}
                </td>

                <td className="col-owner">
                  <EditableText
                    value={t.owner ?? ""}
                    listId={OWNERS_LIST_ID}
                    onCommit={(v) => edit(t.id, { owner: v })}
                  />
                </td>
                {/* Dependencies: en un padre no se editan. Sus fechas son roll-up de los
                    hijos, así que la dependencia no programaría nada (va en el primer hijo).
                    Si quedó un valor de cuando la fila era hoja, se muestra: está ignorado,
                    pero esconderlo sería peor que dejarlo a la vista. */}
                <td className="col-deps">
                  {isParent ? (
                    <span
                      className="ro"
                      title="A parent row cannot have dependencies: its dates are rolled up from its children. Set the dependency on the first child instead."
                    >
                      {t.dependencies || "—"}
                    </span>
                  ) : (
                    <EditableText
                      value={t.dependencies ?? ""}
                      placeholder="e.g. 3FS"
                      onCommit={(v) => edit(t.id, { dependencies: v })}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
