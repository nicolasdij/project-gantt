# Project Gantt — Agreed Specification

> A Smartsheet / MS Project style web app (our own, free version).
> This document captures every decision made before writing code, so that any
> future session can pick the work up again with no prior context.

## Technical stack
- **Front-end:** React + Vite (TypeScript), state with Zustand/React Query, lightweight Markdown editor.
- **Back-end:** Node.js + Fastify + Prisma (ORM), REST API.
- **Database:** PostgreSQL via Docker Compose.
- **Usage model:** multi-user, autosave (last-write-wins per field), a single project to start with (extensible to several). If the server rejects a cell's change (e.g. the `409` for a dependency on an ancestor), the cell reverts to the previous value and the error is shown in a modal — it never keeps showing a value that wasn't saved.
- **Structure:** monorepo with `/client`, `/server` and `docker-compose.yml`.
- **Execution:** the whole application runs in Docker (see [Docker architecture](#docker-architecture)).

## Docker architecture
The entire app runs in containers, orchestrated with Docker Compose. It uses **one image per component** (granular approach), not a monolithic image.

### Topology
- **Development → 3 containers:**
  - `db` — official `postgres:16` image + persistent volume.
  - `server` — build of `./server` (Node + Fastify + Prisma), hot-reload via mounted volume.
  - `client` — build of `./client`, `vite dev` with hot-reload (port 5173).
- **Production → option A (3 containers):**
  - `db` — `postgres:16` + volume.
  - `server` — Fastify API.
  - `client` — `nginx` serving Vite's static build (front and back fully separated).

### Why granular and not monolithic
| Criterion | Monolithic image (db+server+client together) | One image per component (chosen) |
|---|---|---|
| **Lifecycle** | Rebuild everything on any change | Rebuild only the service you touched |
| **Scaling / logs** | All mixed together, hard to isolate | Each service with its own logs and health check |
| **Database** | Postgres inside the container → fragile data, anti-pattern | Official Postgres + persistent volume |
| **Dev vs. prod** | A single process, messy hot-reload | `server` and `client` with volume-based hot-reload |
| **Internal complexity** | Needs supervisord/multi-process in one container (anti-pattern) | Compose orchestrates; one process per container |

Rule applied: **one process per container**. Putting Postgres + Node + Vite in a single image would force an internal process manager — exactly what Compose avoids.

## App layout
- Toolbar on top.
- Left panel: grid of rows/columns (editable). The **ID** column is frozen: scrolling horizontally moves the other columns under it. The header row is frozen the same way vertically.
- Right panel: the Gantt timeline (horizontal bars, dependency arrows).

## Left panel columns (in this order)
| # | Column | Editable | Notes |
|---|--------|----------|-------|
| 1 | **ID** | No (autogen) | Sequential number, MS Project style. Used in Dependencies. It is a **link**: clicking it opens the edit modal. **Frozen column:** it stays in place when the left panel is scrolled horizontally. |
| 2 | **WBS** | No (autogen) | Hierarchical (1, 1.1, 1.2.1). Text (not editable). |
| 3 | **Title** | Yes | Short title of the item. |
| 4 | **Start Date** | Yes | Rendered in the format chosen in **Settings**. On edit → recomputes **End** (from Duration, skipping weekends). |
| 5 | **End Date** | Yes | Rendered in the format chosen in **Settings**. On edit → recomputes **Duration**. |
| 6 | **Duration** | Yes | `Nd` / `Nw` / `Nm` (a bare number means days). `1w` = 5 working days; `1m` = the working days per month set in **Settings**. Always stored and displayed in days, so `1m` becomes e.g. `20d`. On edit → recomputes **End**. Input that doesn't parse is rejected and the cell reverts. |
| 7 | **Dependencies** | Yes (not on parent rows) | E.g. `3FS` (Finish-Start with ID 3). Types supported in v1: **FS, SS and FF** (SF is out of scope). **Auto-scheduling:** when a dependency is set or edited, the successor's dates are adjusted to the predecessor (preserving its Duration), MS Project style. With several, the latest constraint wins. It also enables the critical path calculation. |
| 8 | **Owner** | Yes | A single owner. Autocomplete from values already present in other rows. |

**Focusing an editable field — with Tab or with the mouse — selects all of its text**, so typing replaces the value instead of appending to it. Two things are preserved: a second click inside a field that already has focus places the caret normally, and dragging to select part of the text is not overridden. Tab moves field to field (the 📅 date-picker button is out of the tab order).

### Fields only in the modal (opened from the ID link)
- **Description:** rich text editor (bold, italic, underline, ordered and unordered lists). **Stored as Markdown**.
- The modal also allows editing the rest of the left panel's visible columns.
- **Save / Cancel:** the modal is **not** autosave (unlike the grid). Changes accumulate in a local draft; **Save** sends them in a single PATCH and closes, **Cancel** closes and discards them.

## Business rules
- **Duration:** counts working days **inclusive** (Monday→Friday = 5d). Only Saturdays and Sundays are skipped (no holidays for now).
- **Milestone:** special case when Start = End → duration `0d`. Drawn as a diamond (◆).
- **Recalculations:**
  - Editing **End Date** → recomputes **Duration**.
  - Editing **Duration** → recomputes **End Date** (using Start + working days).
  - Editing **Start Date** → recomputes **End Date** (preserving Duration).
- **Parent rows (summary):** Start/End/Duration are **computed automatically** from the children (start = min of children, end = max of children) → **not editable** on parents. They do not accept **Dependencies** either: those are the input to scheduling, which only schedules leaves (the dependency belongs on the group's first child).
- **No circular dependencies:** a row cannot depend on **itself**, nor on anything that **already depends on it** (directly or through other rows), nor on an **ancestor** (its parent, grandparent…: the ancestor's dates are the roll-up of that very row). The API answers `409` in all three cases, and also rejects an **indent** that would close a cycle — either because a row in the moved branch depends on its new ancestor, or indirectly, through the roll-up edge that the indent adds.
  - **Why it matters:** the scheduler resolves dates by a fixed point, and a cycle kept it from converging — it cut off at its iteration cap (`number of rows + 2`), so the dates came out nonsensical *and* changed with the size of the project. The graph that matters has two kinds of edge, because both propagate dates: the dependency (predecessor → successor) and the roll-up (child → parent); a cycle through either one diverges.
  - If cyclic data already exists, both engines (scheduler and CPM) **ignore the dependencies that close the cycle**, so those tasks keep their stored dates instead of drifting.

## Timeline (right panel)
- Horizontal bars aligned with the grid rows.
- **Dependency arrows** drawn both in the normal view and in critical path view (SVG).
- Milestones as a diamond (◆).
- **Dragging bars:** from the **body** the whole task moves (Start and End together, **preserving the Duration**: only the Start is sent and the engine recomputes the end); from the **left** edge the Start moves with the End fixed, and from the **right** edge the End moves — in those two cases the Duration is recomputed. The resulting date snaps to the nearest working day (Sat→Fri, Sun→Mon) and, when resizing, stops against the opposite edge (minimum 1 day). Does not apply to parent rows (computed dates) or to milestones (duration-0 diamonds).
  - If the task has **Dependencies**, auto-scheduling recomputes its Start from the predecessor after the drag, so the bar returns to its place: the dependency wins (same as when resizing). To move it, remove or change the dependency.
- Zoom with **Day / Week / Month** buttons.
- **"Today"** marker.
- Horizontal scroll (synchronized with the grid).

## Critical path (CPM)
- Computed from the **Dependencies** (forward/backward pass, slack = 0).
- The CPM nodes are the **leaves** (parents are summaries). A dependency pointing at a **parent** row is not discarded: it is translated to the leaves in the subtree that determine the date being used — the ones that **finish last** for FS/FF, the ones that **start first** for SS. Without that translation, the leaf that pushes the group showed slack and the critical path was cut there.
- Dependency types supported in v1: **FS (Finish-Start), SS (Start-Start) and FF (Finish-Finish)**. SF (Start-Finish) is out of scope.
- Toolbar toggle: turning it on paints the critical path bars **red**; turning it off returns to the normal view.

## Toolbar (icon buttons)
1. ➕ **Add row** · 🗑️ **Delete row**
2. ⬅️ **Outdent** · ➡️ **Indent**
3. 🔺 **Move up** · 🔻 **Move down** (reorder)
4. 🔴 **Toggle critical path**
5. **Day · Week · Month** (zoom)
6. ⚙️ **Settings** (opens the settings popup)
- Autosave: no save button; a status indicator is shown ("Saving… / Saved").

## Settings (⚙️ popup in the toolbar)
Configures app behaviour. Same pattern as the detail modal: changes live in a local draft and are only applied with **Save**; **Cancel** (and ✕ / Escape / clicking the backdrop) closes discarding them.

- **Date format** — applies to the Start and End dates in the grid and in the item modal. Options: `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`, `DD.MM.YYYY`, `MMM D, YYYY` (the dropdown shows each one rendered with today's date).
- **Where it is stored:** `localStorage` in the browser, not the database. It is a UI preference, not project data, and the app has no users or sessions to hang it off server-side. If `localStorage` is unavailable (private mode), the default applies and the choice lasts for the session.
- **Consequence on the editable cells:** a native `input type="date"` renders according to the *browser's* locale and cannot be given a format, so the Start/End cells are **text inputs** that show the chosen format, plus a 📅 button that opens the native date picker (via `showPicker()` on a hidden input). The two prior rules still hold: typing does not recalculate until blur, and picking in the date picker commits immediately.
- **Working days per month** — how many working days `1m` means in the Duration field. Options: 20 (the default, matching MS Project), 21, 22. There is no single right answer, which is why it is a setting; a week, in contrast, is always 5 (Mon–Fri) and is not configurable.
- **What is typed** is parsed in the chosen format: the separators are tolerant (`4-8-2026` works for `DD/MM/YYYY`) but the field **order** is the one from the format — `04/08/2026` is 4-Aug under `DD/MM/YYYY` and 8-Apr under `MM/DD/YYYY`. A date that doesn't exist (31/02) or that doesn't match the format reverts and nothing is sent to the server.

## Implementation plan (phases)
1. **Scaffolding:** monorepo `/client` + `/server` + `docker-compose.yml` (Postgres). Prisma schema: `tasks` table (id, wbs, parentId, order, title, start, end, durationDays, isMilestone, owner, dependencies, descriptionMd) + migrations and seed.
2. **Backend / API:** task CRUD, autosave endpoint, server-side WBS calculation and parent roll-up, working-day date utilities (addWorkingDays, workingDaysBetween).
3. **Left panel (grid):** editable grid, inline editing, Start↔End↔Duration recalculation, Owner autocomplete, modal with Markdown editor, indent/outdent, add/delete, reordering, hierarchical WBS, parent roll-up.
4. **Right panel (Gantt):** aligned bars, Day/Week/Month scale, "today" marker, synchronized scroll, dependency arrows, milestones as diamonds.
5. **Critical path:** CPM engine over the Dependencies + red toggle.
6. **Polish:** autosave with debounce + indicator, validations, error handling.

## Decisions taken
1. **Dependency types (v1):** FS, SS and FF. SF is out of scope. ✅
2. **Docker architecture:** one image per component (granular), not monolithic. Dev = 3 containers (db, server, client with hot-reload). Prod = option A, 3 containers (db, server, client served by nginx). ✅
3. **Delivery scope:** phase by phase, validating each phase before moving to the next. ✅
4. **Auto-scheduling from dependencies:** editing a dependency reschedules the successor's dates according to the type (FS/SS/FF), preserving the Duration; with several, the latest one wins. The parent roll-up is recomputed from the already-rescheduled children. ✅
5. **Edit link on the ID column** (not on WBS). The delete dialog is our **own modal** (not the browser's `confirm()`). ✅
6. **Polish (Phase 6):**
   - The Start/End/Duration recalculation and the Gantt redraw happen when the field **loses focus** (blur), not on every keystroke. ✅
   - **Weekend** columns (Sat/Sun) are shown in **light grey** in the right panel. ✅
   - The **milestone diamond** is drawn **centered** inside its day's column. ✅
   - Notifications/errors through **our own modal** (never the browser's `alert()`/`confirm()`). ✅
7. **Discarding blank rows:** when the selection moves from one row to another, the row left behind is deleted if it ended up completely empty. "Empty" = title, start, end, owner, dependencies and description all empty, **and** Duration untouched (the field can never be left blank: a row is born with `1d`, so that default value is required; a typed duration counts as content). A row with children is not discarded (deletion cascades). The evaluation waits for in-flight mutations and refetches to finish, because the blur autosave fires its PATCH in the same click that changes the selection. ✅
8. **Dependencies are not accepted on parent rows:** the scheduler only schedules leaves (a parent's dates are roll-up), so a dependency on a parent scheduled nothing and only drew a misleading arrow. The cell is now read-only (in the grid and in the modal), the API answers `409`, and the Gantt does not draw the arrow. A parent row **can** be a predecessor. If a leaf with dependencies becomes a parent (by indenting), the stored value stays visible but inert. ✅
9. **Settings in `localStorage`, not in the database:** the date format and the working days per month are UI preferences — see the [Settings](#settings--popup-in-the-toolbar) section. The editable Start/End cells stopped being `input type="date"` because that control's format comes from the browser locale; they are now text inputs in the chosen format plus a button that opens the native picker. ✅
10. **Cycles are rejected at the edge and ignored by the engines:** the API validates with a single predicate — the dependency `succ ← pred` closes a cycle ⇔ `pred` is already downstream of `succ` following dependency and roll-up edges. The same predicate is what both engines use to skip those edges, so the scheduler and the CPM see the same graph. ✅
11. **Detail modal = form, not autosave:** the ID popup has **Save** (sends the modified fields in a single PATCH and closes) and **Cancel** (closes discarding) buttons. ✕, Escape and clicking the backdrop are equivalent to Cancel. The grid remains autosave per cell. ✅
