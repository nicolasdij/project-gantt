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
- **Panel widths.** The divider between the two is draggable, and neither panel goes below 240px. On load (and on every reload) the left panel is **as wide as it needs to be to show up to Duration**, measured on the rendered grid — not the width of the whole table: **Dependencies**, **% Complete** and **Owner** are left out of view on purpose, and that width goes to the Gantt, which is what the view is for. Those columns are reached by scrolling the panel horizontally or by moving the divider.
- **The Title column is resizable** by dragging the right edge of its header (minimum 120px). The panel follows the same delta, so widening Title does not push Duration out of view; once the panel hits its limit it stops growing and the grid scrolls instead. Neither width is persisted: both are recomputed on reload, which is what keeps "up to Duration" true at every start.

## Left panel columns (in this order)
| # | Column | Editable | Notes |
|---|--------|----------|-------|
| 1 | **ID** | No (autogen) | Sequential number, MS Project style. Used in Dependencies. It is a **link**: clicking it opens the edit modal. **Frozen column:** it stays in place when the left panel is scrolled horizontally. |
| 2 | **WBS** | No (autogen) | Hierarchical (1, 1.1, 1.2.1). Text (not editable). |
| 3 | **Title** | Yes | Short title of the item. **Resizable column:** dragging the right edge of its header changes its width (see [App layout](#app-layout)). |
| 4 | **Start Date** | Yes | Rendered in the format chosen in **Settings**. On edit → recomputes **End** (from Duration, skipping weekends). |
| 5 | **End Date** | Yes | Rendered in the format chosen in **Settings**. On edit → recomputes **Duration**. |
| 6 | **Duration** | Yes | `Nd` / `Nw` / `Nm` (a bare number means days). `1w` = 5 working days; `1m` = the working days per month set in **Settings**. Always stored and displayed in days, so `1m` becomes e.g. `20d`. On edit → recomputes **End**. Input that doesn't parse is rejected and the cell reverts. |
| 7 | **Dependencies** | Yes (not on parent rows) | E.g. `3FS` (Finish-Start with ID 3), optionally with a **lag**: `3FS+1d` (ID 3 finishes, one day passes, this row starts) or `3FS-1d` (they overlap by a day). Types supported in v1: **FS, SS and FF** (SF is out of scope). **Auto-scheduling:** when a dependency is set or edited, the successor's dates are adjusted to the predecessor (preserving its Duration), MS Project style. With several, the latest constraint wins. It also enables the critical path calculation. |
| 8 | **% Complete** | Yes (not on parent rows) | Progress of the item, `0`–`100`. Typed as `40` or `40%` and always displayed as `40%`. Input that isn't a number is rejected and the cell reverts; a value above 100 is clamped (typing `150` is a clear intent, not a typo). Drives the **progress fill** inside the Gantt bar. |
| 9 | **Owner** | Yes | A single owner. Autocomplete from values already present in other rows. |

**Focusing an editable field — with Tab or with the mouse — selects all of its text**, so typing replaces the value instead of appending to it. Two things are preserved: a second click inside a field that already has focus places the caret normally, and dragging to select part of the text is not overridden. Tab moves field to field (the 📅 date-picker button is out of the tab order). **Inserting a row focuses its Title**, so the title can be typed without clicking first.

### Fields only in the modal (opened from the ID link)
- **Description:** rich text editor (bold, italic, underline, ordered and unordered lists). **Stored as Markdown**. The buttons behave as **toggles** and show their on/off state for the current selection.
- **Bar colour:** a palette of **5 swatches** that sets the colour of that row's bar in the Gantt. The first one is the **default** — the blue every bar used before this existed — followed by green, amber, violet and pink. What is stored is the palette **key**, not a colour: restyling a shade is a CSS change, not a data migration, and the default is stored as `null`, so "never chosen" and "chose the default" are the same value. It applies to **any** row: a summary row's thin bar and a milestone's diamond take the colour too, otherwise picking one on those rows would do nothing visible. The **critical path view wins** over it: while the toggle is on those bars stay red, because that view is a diagnostic and not the row's styling.
- **Bar title:** a single-line text drawn **on that row's Gantt bar**. Empty by default, which is what every pre-existing row keeps. Only on **leaf** rows: a summary row's bar is a roll-up of its children, so it shows none — and a row that **becomes a parent** keeps its stored value, it just stops being drawn (it comes back if the row stops being a parent). The API answers `409` if it is written on a parent row. Whitespace-only is stored as empty, so "no label" is a single value.
- The modal also allows editing the rest of the left panel's visible columns.
- **Save / Cancel:** the modal is **not** autosave (unlike the grid). Changes accumulate in a local draft; **Save** sends them in a single PATCH and closes, **Cancel** closes and discards them.

## Business rules
- **Duration:** counts working days **inclusive** (Monday→Friday = 5d). Only Saturdays and Sundays are skipped (no holidays for now).
- **Milestone:** special case when Start = End → duration `0d`. Drawn as a diamond (◆).
- **Recalculations:**
  - Editing **End Date** → recomputes **Duration**.
  - Editing **Duration** → recomputes **End Date** (using Start + working days).
  - Editing **Start Date** → recomputes **End Date** (preserving Duration).
- **% Complete:** an integer 0–100 per row. On a **parent** it is **computed**: the average of its children **weighted by their Duration**, so a 10d child at 100% counts twice as much as a 5d one (a plain average would make the number meaningless). It resolves bottom-up, so a parent of parents weights each branch by its rolled-up duration. Each level is rounded, so the number shown on a summary row can be reproduced by hand from the ones below it. Children with duration 0 (milestones) carry no weight; if **every** child weighs 0 it falls back to a plain average, the only thing that means anything when there are no durations to compare.
- **Parent rows (summary):** Start/End/Duration **and % Complete** are **computed automatically** from the children (start = min of children, end = max of children; % Complete = duration-weighted average) → **not editable** on parents. They do not accept **Dependencies** either: those are the input to scheduling, which only schedules leaves (the dependency belongs on the group's first child). Nor a **Bar title**: their bar is a summary of the children. Unlike the derived fields, that value is **not recomputed but kept** — a leaf that becomes a parent stops showing its label and gets it back if it stops being one, because it is something the user typed and nothing else can restore it.
- **Dependency format:** `<ID><type><±lag>` per token, several separated by commas or spaces. The type defaults to **FS** (`3` = `3FS`) and the lag defaults to **0**. The lag is counted in **working days** — the same unit as Duration — and the `d` is optional (`3FS+1` = `3FS+1d`); a **positive** lag delays the successor (`2FS+1d`: ID 2 finishes, one working day passes, this row starts — a Friday finish plus one day is the following Tuesday, not the Saturday), and a **negative** one overlaps them (`2FS-1d` starts the very day ID 2 finishes). The lag applies to the predecessor's date before the successor's Start is derived, so it works the same for the three types: `SS+3d` starts three days after the predecessor starts, `FF-2d` finishes two days before it finishes. MS Project's percentage lags (`3FS+50%`) and elapsed days (`+1ed`) are **out of scope**: they are a different calendar semantics, and the whole engine counts working days. Spaces around the sign are tolerated (`3FS + 1d`) — otherwise the token would split in three and leave a bare `3FS` behind, which is the worst possible outcome: it schedules anyway, silently ignoring the lag that was asked for. A malformed token (`3FS+1w`, or a lag beyond ±3650d) is discarded whole, like any other unparseable input, and the value stored is the canonical form (`3+1` comes back as `3FS+1d`).
- **No circular dependencies:** a row cannot depend on **itself**, nor on anything that **already depends on it** (directly or through other rows), nor on an **ancestor** (its parent, grandparent…: the ancestor's dates are the roll-up of that very row). The API answers `409` in all three cases, and also rejects an **indent** — or a 🔺/🔻 that **crosses groups** — that would close a cycle: either because a row in the moved branch depends on its new ancestor, or indirectly, through the roll-up edge that re-parenting adds. Both operations add the same edge (child → new parent), so they share one validation.
  - **Why it matters:** the scheduler resolves dates by a fixed point, and a cycle kept it from converging — it cut off at its iteration cap (`number of rows + 2`), so the dates came out nonsensical *and* changed with the size of the project. The graph that matters has two kinds of edge, because both propagate dates: the dependency (predecessor → successor) and the roll-up (child → parent); a cycle through either one diverges.
  - If cyclic data already exists, both engines (scheduler and CPM) **ignore the dependencies that close the cycle**, so those tasks keep their stored dates instead of drifting.

## Moving rows
- 🔺/🔻 **Move up / Move down** reorder a row among its **siblings**, and at the ends of a group they **cross into the group next door keeping the level**: the first child becomes the **last child of the previous group**, the last child becomes the **first child of the next group**. The whole branch travels — the children follow their parent.
  - **Why:** at those ends the button used to do nothing, and the only way to change a row's group was **outdent → move up → indent**, which left the row at another level along the way. Overloading a keystroke that did nothing costs no existing behaviour, and it is how moving a line at the top of a list behaves in any outliner.
  - **It does not cross into a sibling that is a leaf.** Giving a childless task a child would turn it into a **summary row**: its dates would become the roll-up of that very child and its dependencies would go inert. That is not "moving a row", so it stays a no-op, as before. Same when there is no group on that side at all (the group is already the first or last of its level, or the row is at root level).
  - Crossing **changes the parent**, so it runs the **same cycle validation as the indent** (see [No circular dependencies](#business-rules)) and answers `409` with the offending dependency named. The most common case: a row that depends on the very group it is trying to enter — that group's dates would become the roll-up of the row depending on it.
  - The **visible ID** (`order + 1`) shifts with any reorder, this one included. Stored dependencies point at the stable internal id, so they follow the row and are re-translated on the way out of the API; what the user typed as `3FS` may read `4FS` afterwards, pointing at the same task.

## Timeline (right panel)
- Horizontal bars aligned with the grid rows.
- **Dependency arrows** drawn both in the normal view and in critical path view (SVG). They leave and arrive on the **outer** edge of the bars, and the final segment runs **horizontally into the arrowhead**, so the line meets the vertical side of the triangle instead of a diagonal one. When the successor starts before the predecessor finishes, the route wraps around the bars rather than doubling back into them.
- **Bar colour per row:** chosen from the modal's 5-swatch palette (see [Fields only in the modal](#fields-only-in-the-modal-opened-from-the-id-link)). The progress fill follows it, in the darker shade of that same colour.
- **Progress fill:** each bar is filled from the left in proportion to its **% Complete**, in a darker shade of the bar's own colour (including the red of the critical path). The fill **does not take up the whole bar**: it keeps 2px of clearance from the border on every side, so the full bar still reads behind it and the fill looks like something *inside* the bar rather than a bar of another colour. It applies to summary rows too, with their rolled-up percentage. Milestones are not filled: a 0-duration diamond has no length to fill. Bars too narrow to leave any usable width are not filled either.
- **Bar title:** the text set in the modal (see [Fields only in the modal](#fields-only-in-the-modal-opened-from-the-id-link)) is drawn **centred inside the bar** when it fits, and **just outside, to the right of the bar**, when it doesn't. It is drawn only on **leaf** rows. Whether it fits is decided by **measuring the text** before painting (canvas `measureText` with the label's own font) rather than rendering it and correcting afterwards — that way there is no second layout pass and no flicker of a label that starts inside and jumps out. On a **milestone** it always goes outside: a diamond has no width to write in. The outside label is drawn **after the dependency arrows** so an arrow never crosses the text, and below the sticky header so scrolling hides it; neither label takes pointer events, so a bar drags the same with a label on it.
- Milestones as a diamond (◆).
- **No hover highlight:** moving the mouse over the timeline does not shade the row. The selected row is highlighted; nothing else follows the pointer.
- **Dragging bars:** from the **body** the whole task moves (Start and End together, **preserving the Duration**: only the Start is sent and the engine recomputes the end); from the **left** edge the Start moves with the End fixed, and from the **right** edge the End moves — in those two cases the Duration is recomputed. The resulting date snaps to the nearest working day (Sat→Fri, Sun→Mon) and, when resizing, stops against the opposite edge (minimum 1 day). Does not apply to parent rows (computed dates) or to milestones (duration-0 diamonds).
  - If the task has **Dependencies**, auto-scheduling recomputes its Start from the predecessor after the drag, so the bar returns to its place: the dependency wins (same as when resizing). To move it, remove or change the dependency.
- Zoom with **Day / Week / Month** buttons.
- **"Today"** marker.
- Horizontal scroll (synchronized with the grid).

## Critical path (CPM)
- Computed from the **Dependencies** (forward/backward pass, slack = 0).
- The CPM nodes are the **leaves** (parents are summaries). A dependency pointing at a **parent** row is not discarded: it is translated to the leaves in the subtree that determine the date being used — the ones that **finish last** for FS/FF, the ones that **start first** for SS. Without that translation, the leaf that pushes the group showed slack and the critical path was cut there.
- Dependency types supported in v1: **FS (Finish-Start), SS (Start-Start) and FF (Finish-Finish)**. SF (Start-Finish) is out of scope.
- **Lags are part of the path, not slack:** the forward pass already carries the lag (the dates come from the scheduler), so the backward pass **subtracts it back** — with a `+2d` the predecessor's late finish sits two days before the successor's late start. Without that, the gap the dependency itself imposes looked like float and the critical path was cut at the row before it.
- Toolbar toggle: turning it on paints the critical path bars **red**; turning it off returns to the normal view.

## Toolbar (icon buttons)
1. ➕ **Add row** · 🗑️ **Delete row**
2. ⬅️ **Outdent** · ➡️ **Indent**
3. 🔺 **Move up** · 🔻 **Move down** (reorder, and **cross groups** at the ends — see [Moving rows](#moving-rows))
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
1. **Scaffolding:** monorepo `/client` + `/server` + `docker-compose.yml` (Postgres). Prisma schema: `tasks` table (id, wbs, parentId, order, title, start, end, durationDays, isMilestone, progress, barColor, barTitle, owner, dependencies, descriptionMd) + migrations and seed.
2. **Backend / API:** task CRUD, autosave endpoint, server-side WBS calculation and parent roll-up (dates and % Complete), working-day date utilities (addWorkingDays, workingDaysBetween).
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
7. **Discarding blank rows:** when the selection moves from one row to another, the row left behind is deleted if it ended up completely empty. "Empty" = title, start, end, owner, dependencies, description **and bar title** all empty, **% Complete** at 0, **no bar colour** chosen, **and** Duration untouched (the field can never be left blank: a row is born with `1d`, so that default value is required; a typed duration counts as content). A row with children is not discarded (deletion cascades). The evaluation waits for in-flight mutations and refetches to finish, because the blur autosave fires its PATCH in the same click that changes the selection. ✅
8. **Dependencies are not accepted on parent rows:** the scheduler only schedules leaves (a parent's dates are roll-up), so a dependency on a parent scheduled nothing and only drew a misleading arrow. The cell is now read-only (in the grid and in the modal), the API answers `409`, and the Gantt does not draw the arrow. A parent row **can** be a predecessor. If a leaf with dependencies becomes a parent (by indenting), the stored value stays visible but inert. ✅
9. **Settings in `localStorage`, not in the database:** the date format and the working days per month are UI preferences — see the [Settings](#settings--popup-in-the-toolbar) section. The editable Start/End cells stopped being `input type="date"` because that control's format comes from the browser locale; they are now text inputs in the chosen format plus a button that opens the native picker. ✅
10. **Cycles are rejected at the edge and ignored by the engines:** the API validates with a single predicate — the dependency `succ ← pred` closes a cycle ⇔ `pred` is already downstream of `succ` following dependency and roll-up edges. The same predicate is what both engines use to skip those edges, so the scheduler and the CPM see the same graph. ✅
11. **The initial panel width is measured, not hardcoded:** it is taken from the right edge of the Duration header on the rendered grid, plus the width of the panel's vertical scrollbar (without that, the scrollbar covered Duration; with overlay scrollbars it adds nothing). Measuring instead of adding up constants means the value stays right when a column changes width — including the Title column the user just dragged. ✅
12. **Detail modal = form, not autosave:** the ID popup has **Save** (sends the modified fields in a single PATCH and closes) and **Cancel** (closes discarding) buttons. ✕, Escape and clicking the backdrop are equivalent to Cancel. The grid remains autosave per cell. ✅
13. **% Complete is a stored field on the leaves and a computed one on the parents:** the grid gained a `% Complete` column to the right of Dependencies, and the Gantt bar is filled in proportion to it. On a parent the value is **not** editable — it is the average of its children weighted by their Duration, computed by the same server pass that recalculates WBS, order and dates, and persisted like them (the API answers `409` if it is written directly). Weighting by duration is what makes the number mean something: a plain average would put a 1d task and a 20d one on the same footing. The fill is drawn **inset 2px** from the bar's border rather than edge to edge, so at 100% the bar is still legible as a bar with something inside it, not as a bar of a different colour. ✅
14. **The bar colour is a palette, not a colour picker:** the detail modal offers **5 fixed swatches** (default blue, green, amber, violet, pink) instead of a free colour input. Five keys can be validated at the API edge, they keep the chart readable (no unusable contrast, no two rows a shade apart), and each one carries a matching darker tone for the progress fill — a free picker would need that second tone computed at runtime. What is stored is the **key** (`"green"`), so the actual shades live only in the CSS variables, and the default is `null`, which is what makes the pre-existing rows already correct. The colour loses to the **critical path** red on purpose. ✅
15. **Dependency lags live in the token, not in a new column:** `dependencies` was already free text, so `3FS+1d` needed **no migration** and every stored `3FS` keeps parsing (lag `0`). The unit is **working days**, like Duration — a `+1d` that landed on a Saturday would mean nothing here. Two consequences worth naming: the lag has a single **serializer** (`formatDependency`), because the API rewrites the field on every read and write to translate internal ids ↔ visible IDs and a serializer that forgot the lag would erase it on each round trip; and the **CPM backward pass** has to subtract the lag with the sign inverted, otherwise the gap the dependency imposes reads as float and the critical path breaks. The `d` and the type stay optional (`3+1` = `3FS+1d`), and the magnitude is capped at ±3650d — without a cap a typo would walk the calendar day by day and hang the scheduler instead of just giving a wrong date. ✅

16. **Moving between groups overloads 🔺/🔻 instead of adding buttons:** the alternative was a separate pair of buttons for "move to the previous/next group". It was rejected because it would make the **user** check what the app already knows — to pick between 🔺 and ⏫ you have to look first at whether the row is at the end of its group, and the rest of the time both buttons do the same thing. At those ends 🔺 was a no-op, so nothing existing was lost. The cost, worth naming: 🔺 can now **change the parent**, not just the order, and there is no undo — what makes it acceptable is that the change is visible at once (the WBS jumps from `1.3.1` to `1.2.3`) and 🔻 undoes it exactly. ✅
17. **The bar title is hidden on a parent, never deleted:** the other fields a summary row rejects (dates, % Complete) are **derived** — whatever a parent shows can be recomputed from its children, so nothing is lost by ignoring what was stored. A bar title is not: it is text the user typed, and no roll-up can bring it back. So indenting a row under another **hides** its label and the API rejects writing one on a parent, but the value stays in the row and returns intact if it stops being a parent. The alternative — clearing it on indent — would destroy data as a side effect of a structural move, and the move is already reversible in one click (🔺/🔻, outdent). ✅
