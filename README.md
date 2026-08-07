# Project Gantt

A **Smartsheet / MS Project** style web app (our own, free version): a project planner with an editable grid on the left and a Gantt chart on the right.

The whole application runs in **Docker**. See [`SPEC.md`](./SPEC.md) for the full specification and the record of decisions.

## Features

- **Editable grid** with hierarchy (WBS 1, 1.1, 1.2.1), inline editing and autosave. The **ID** column stays frozen when scrolling horizontally, and the **Title** column is resized by dragging the right edge of its header.
- **Panel widths**: a draggable divider between grid and Gantt. On load the left panel reaches exactly **up to Duration** — Dependencies, % Complete and Owner stay out of view so the Gantt gets the space; scroll the panel horizontally (or move the divider) to reach them.
- **Date recalculation** Start ↔ End ↔ Duration in working days (Mon–Fri; no holidays). Duration accepts `5d`, `2w` and `1m` (`1w` = 5 days; `1m` = the working days per month set in Settings).
- **Auto-scheduling from dependencies** (MS Project style): FS, SS and FF, with an optional **lag** in working days — `3FS+1d` starts one day after ID 3 finishes, `3FS-1d` overlaps by one. When a dependency is set or edited, the successor is rescheduled preserving its Duration.
- **No circular dependencies**: a row cannot depend on itself, on an ancestor, or on anything that already depends on it (directly or through other rows). The server answers `409`, a re-parenting that would close a cycle is rejected too (an indent, or a 🔺/🔻 that crosses groups), and the cell goes back to its previous value.
- **Parent roll-up**: Start/End/Duration **and % Complete** of summary rows are computed from their children (the percentage as an average weighted by each child's Duration). Summary rows accept neither dates nor dependencies (both are derived).
- **% Complete**: a per-row progress column (`0`–`100`, typed as `40` or `40%`) that **fills the Gantt bar** from the left in proportion to it — in a darker shade of the bar's colour and leaving 2px of clearance from the border, so the whole bar still reads behind the fill.
- **Critical path**: CPM toggle in the toolbar that paints the zero-slack bars red. A dependency on a summary row is translated to the leaves that actually drive its date.
- **Bar colour per row**: a 5-swatch palette in the detail modal (the default blue plus green, amber, violet and pink). It colours the row's bar — summary bars and milestone diamonds included — and its progress fill; the critical path view still overrides it with red.
- **Bar title**: an optional one-line label per row (set in the detail modal) drawn **centred inside its Gantt bar** when it fits and **just to the right of the bar** when it doesn't. Only on leaf rows: a summary row's bar shows none, and a row that becomes a parent keeps the value — it is hidden, not deleted.
- **Milestones** (Duration 0) drawn as a ◆ diamond.
- **Gantt chart** with bars aligned to the rows, **Day / Week / Month** scale, a "today" marker, dependency arrows (SVG) and vertical scroll synchronized with the grid.
- **Draggable bars**: dragging the **body** moves the whole task (Start and End together, preserving the Duration); dragging the **left** edge moves the Start and the **right** edge moves the End (there the Duration is recomputed). The resulting date snaps to the nearest working day.
- **Settings** (⚙️ in the toolbar): a popup to configure app behaviour, with **Save / Cancel**. It holds the **date format** used by Start and End (5 common formats) and the **working days per month** (20/21/22) that `1m` means in the Duration field. Both are stored in the browser.
- **Detail modal** (from the ID link) with a rich-text description editor stored as Markdown and **Save / Cancel** buttons (the modal is not autosave: cancelling discards).
- Reorder / indent / outdent / add / delete rows. 🔺/🔻 also **cross groups**: from the top of a group the row moves into the previous group (from the bottom, into the next one) keeping its level, instead of needing outdent → move up → indent.
- **Editing that gets out of the way**: focusing a field (with Tab or the mouse) selects all of its text, a new row focuses its Title, and a cell whose change the server rejects reverts instead of showing an unsaved value.
- **Discarding blank rows:** when the selection moves to another row, the one left behind is deleted if it ended up completely empty (no title, dates, owner, dependencies, description or bar title, % Complete at 0, no bar colour chosen, and with the Duration untouched).

> Status: **phase by phase** implementation (see [Roadmap](#roadmap)). Phases 1–6 complete.

## Stack

- **Front-end:** React + Vite + TypeScript · TanStack Query · Zustand.
- **Back-end:** Node.js + Fastify + Prisma (TypeScript).
- **Database:** PostgreSQL 16.
- **Orchestration:** Docker Compose (one image per component).

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and **Docker Compose v2** (`docker compose`, included in Docker Desktop).
- You don't need Node.js installed locally: everything (including the database) runs in containers.

## Getting started

```bash
git clone <REPO-URL>
cd project-gantt
docker compose up --build
```

This builds and starts **3 containers** and applies the database migrations automatically when the server boots:

| Service | URL | Description |
|---|---|---|
| `client` | http://localhost:5173 | React + Vite front-end (hot-reload) |
| `server` | http://localhost:3000 | Fastify + Prisma API (hot-reload) |
| `db`     | localhost:5432 | PostgreSQL 16 (persistent volume) |

Open **http://localhost:5173** in the browser.

### Load sample data (seed)

The database starts empty. To load a sample project (7 tasks with hierarchy, dependencies, partial progress and one milestone):

```bash
docker compose exec server npm run db:seed
```

Run it again whenever you want to **reset** the sample data (it also resets the IDs to 1..7).

### Useful commands

```bash
docker compose up -d          # start in the background
docker compose logs -f server # follow the server logs
docker compose down           # stop and remove the containers (keeps the DB)
docker compose down -v        # stop and ALSO delete the DB volume (full reset)
docker compose exec server npm test   # server unit tests
```

---

## Project structure

```
project-gantt/
├─ client/                  Front-end (React + Vite + TS)
│  ├─ src/
│  │  ├─ components/        Grid, Timeline, Toolbar, modals…
│  │  ├─ lib/               time scale, layout, parsers, formatting
│  │  ├─ api.ts             HTTP client
│  │  ├─ queries.ts         data hooks (TanStack Query) + autosave
│  │  └─ store.ts           UI state (Zustand)
│  └─ Dockerfile.dev
├─ server/                  Back-end (Fastify + Prisma + TS)
│  ├─ src/
│  │  ├─ routes/            task REST endpoints
│  │  ├─ services/          recompute (WBS, scheduling, roll-up of dates and progress)
│  │  └─ lib/               working days, dependencies, tree, moves, schedule, progress, colours, critical path
│  ├─ prisma/
│  │  ├─ schema.prisma      schema of the `tasks` table
│  │  ├─ migrations/        migration history (versioned)
│  │  └─ seed.ts            sample data
│  └─ Dockerfile.dev
├─ docker-compose.yml       development orchestration (3 containers)
├─ SPEC.md                  specification and decisions
└─ README.md
```

## API

Base: `http://localhost:3000/api`

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Server status + DB connection |
| GET | `/tasks` | Ordered list of tasks (pre-order) |
| GET | `/tasks/:id` | Detail of a task (404 if it doesn't exist) |
| POST | `/tasks` | Creates a row. Body: `{ title?, parentId?, afterId? }` (`afterId` inserts below and inherits the parent) |
| PATCH | `/tasks/:id` | **Autosave** per field (last-write-wins). Editing `start`/`end`/`durationDays`/`dependencies` triggers the recalculation, and `progress` re-rolls it up the ancestors. Returns `409` for: dates, dependencies, `progress` or `barTitle` on a parent row (the first three are derived — the dependency belongs on the first child, the progress on the children; the bar title is simply not drawn on a summary bar, and an already stored one is kept), and a dependency that is **circular** — on itself, on an ancestor, or on a row that already depends on this one. `progress` outside 0–100 is clamped; a non-numeric one is `400`. A `barColor` outside the palette is `400` (empty means the default) |
| POST | `/tasks/:id/move` | Reorders among siblings and, at the ends of a group, **crosses into the adjacent group** keeping the level (the branch travels with it). Body: `{ direction: "up" \| "down" }`. No-op when there is no group on that side or that sibling is a leaf (giving it a child would turn it into a summary row). `409` if crossing would close a dependency cycle |
| POST | `/tasks/:id/indent` | Turns the row into a child of the previous sibling. `409` if the new parent–child edge would close a dependency cycle |
| POST | `/tasks/:id/outdent` | Moves the row up one level |
| DELETE | `/tasks/:id` | Deletes the row (children cascade) |

After every mutation, the server recomputes **WBS + order**, applies the **dependency auto-scheduling** and the **parent roll-up** — dates (min/max of the children) and **% Complete** (their average weighted by Duration).

---

## Development notes

- **Hot-reload:** the server uses `nodemon --legacy-watch` (polling) and the client `vite` with `usePolling`. This is required for bind-mount changes to be detected under Docker on macOS/Windows.
- **When adding npm dependencies** to `client` or `server`: since `node_modules` lives in a named volume, `--build` is not enough. Reinstall inside the container:
  ```bash
  docker compose exec <server|client> npm install
  ```
  (or delete the `project-gantt_<svc>-node-modules` volume and recreate the service).
- **Migrations:** the server runs `prisma migrate deploy` at boot. To create a new migration after changing the schema:
  ```bash
  docker compose exec server npm run db:migrate -- --name <name>
  ```
- **Ports in use:** if 5173/3000/5432 are taken, edit the mapping in `docker-compose.yml`.

## Tests

Back-end unit tests (date utilities, dependency parsing, the scheduling engine — including the cycle rules — row moves, the progress roll-up, the colour palette and the CPM):

```bash
docker compose exec server npm test
```

77 tests, no external service needed: they exercise the pure engines in `server/src/lib`, so they don't touch the database. The UI is verified by hand.

---

## Roadmap

**Phase by phase** implementation (detailed plan in [`SPEC.md`](./SPEC.md)).

- [x] **Phase 1** — Scaffolding (monorepo, Docker Compose, Prisma + seed)
- [x] **Phase 2** — Backend / API (CRUD, autosave, WBS, roll-up, working days)
- [x] **Phase 3** — Left panel (editable grid, modal, indent/outdent, reordering)
- [x] **Phase 4** — Right panel (Gantt: bars, zoom, today, dependencies, milestones)
- [x] **Phase 5** — Critical path (CPM: backward pass over FS/SS/FF + red toggle)
- [x] **Phase 6** — Polish (commit on blur, shaded weekends, centered milestone, autosave indicator, errors via modal)
