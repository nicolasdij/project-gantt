# Project Gantt

Aplicación web tipo **Smartsheet / MS Project** (versión propia y gratuita): un planificador de proyectos con grid editable a la izquierda y un diagrama de Gantt a la derecha.

Toda la aplicación corre en **Docker**. Ver [`SPEC.md`](./SPEC.md) para la especificación completa y el registro de decisiones.

## Funcionalidades

- **Grid editable** con jerarquía (WBS 1, 1.1, 1.2.1), edición inline y autosave.
- **Recálculo de fechas** Start ↔ End ↔ Duration en días laborables (Lun–Vie; sin feriados).
- **Auto-scheduling por dependencias** (estilo MS Project): FS, SS y FF. Al fijar/editar una dependencia, el sucesor se reprograma conservando su Duration.
- **Roll-up de padres**: Start/End/Duration de las filas resumen se calculan desde sus hijos.
- **Milestones** (Duration 0) representados como rombo ◆.
- **Diagrama de Gantt** con barras alineadas a las filas, escala **Day / Week / Month**, marcador de "hoy", flechas de dependencia (SVG) y scroll vertical sincronizado con el grid.
- **Barras redimensionables**: arrastrando el borde izquierdo se mueve el Start y con el derecho el End (la Duration se recalcula). El borde se pega al día laborable más cercano.
- **Modal de detalle** (desde el link del ID) con editor de descripción rich-text guardado como Markdown y botones **Guardar / Cancelar** (el modal no es autosave: descarta si cancelás).
- Reordenar / indent / outdent / add / delete filas.
- **Descarte de filas en blanco:** al pasar la selección a otra fila, la que se deja atrás se elimina si quedó totalmente vacía (sin título, fechas, owner, dependencies ni descripción, y con la Duration sin tocar).

> Estado: implementación **fase por fase** (ver [Roadmap](#roadmap)). Fases 1–4 completas.

## Stack

- **Front-end:** React + Vite + TypeScript · TanStack Query · Zustand.
- **Back-end:** Node.js + Fastify + Prisma (TypeScript).
- **Base de datos:** PostgreSQL 16.
- **Orquestación:** Docker Compose (una imagen por componente).

---

## Requisitos previos

- [Docker](https://docs.docker.com/get-docker/) y **Docker Compose v2** (`docker compose`, incluido en Docker Desktop).
- No necesitas Node.js instalado en local: todo (incluida la base de datos) corre en contenedores.

## Puesta en marcha

```bash
git clone <URL-DEL-REPO>
cd project-gantt
docker compose up --build
```

Esto construye y levanta **3 contenedores** y aplica las migraciones de la base de datos automáticamente al arrancar el server:

| Servicio | URL | Descripción |
|---|---|---|
| `client` | http://localhost:5173 | Front-end React + Vite (hot-reload) |
| `server` | http://localhost:3000 | API Fastify + Prisma (hot-reload) |
| `db`     | localhost:5432 | PostgreSQL 16 (volumen persistente) |

Abre **http://localhost:5173** en el navegador.

### Cargar datos de ejemplo (seed)

La base arranca vacía. Para cargar un proyecto de ejemplo (7 tareas con jerarquía, dependencias y un milestone):

```bash
docker compose exec server npm run db:seed
```

Vuelve a ejecutarlo cuando quieras **resetear** los datos de ejemplo (reinicia también los IDs a 1..7).

### Comandos útiles

```bash
docker compose up -d          # levantar en segundo plano
docker compose logs -f server # ver logs del server
docker compose down           # parar y eliminar contenedores (conserva la DB)
docker compose down -v        # parar y BORRAR también el volumen de la DB (reset total)
docker compose exec server npm test   # tests unitarios del server
```

---

## Estructura del proyecto

```
project-gantt/
├─ client/                  Front-end (React + Vite + TS)
│  ├─ src/
│  │  ├─ components/        Grid, Timeline, Toolbar, modales…
│  │  ├─ lib/               escala de tiempo, layout, parsers, formato
│  │  ├─ api.ts             cliente HTTP
│  │  ├─ queries.ts         hooks de datos (TanStack Query) + autosave
│  │  └─ store.ts           estado de UI (Zustand)
│  └─ Dockerfile.dev
├─ server/                  Back-end (Fastify + Prisma + TS)
│  ├─ src/
│  │  ├─ routes/            endpoints REST de tasks
│  │  ├─ services/          recompute (WBS, scheduling, roll-up)
│  │  └─ lib/               fechas laborables, dependencias, árbol, schedule
│  ├─ prisma/
│  │  ├─ schema.prisma      esquema de la tabla `tasks`
│  │  ├─ migrations/        historial de migraciones (versionado)
│  │  └─ seed.ts            datos de ejemplo
│  └─ Dockerfile.dev
├─ docker-compose.yml       orquestación de desarrollo (3 contenedores)
├─ SPEC.md                  especificación y decisiones
└─ README.md
```

## API

Base: `http://localhost:3000/api`

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado del server + conexión a la DB |
| GET | `/tasks` | Lista de tareas ordenada (pre-orden) |
| GET | `/tasks/:id` | Detalle de una tarea (404 si no existe) |
| POST | `/tasks` | Crea fila. Body: `{ title?, parentId?, afterId? }` (`afterId` inserta debajo y hereda el padre) |
| PATCH | `/tasks/:id` | **Autosave** por campo (last-write-wins). Editar `start`/`end`/`durationDays`/`dependencies` dispara el recálculo. En filas padre las fechas devuelven `409` (son calculadas) |
| POST | `/tasks/:id/move` | Reordena entre hermanos. Body: `{ direction: "up" \| "down" }` |
| POST | `/tasks/:id/indent` | Convierte la fila en hija del hermano anterior |
| POST | `/tasks/:id/outdent` | Sube la fila un nivel |
| DELETE | `/tasks/:id` | Borra la fila (hijos en cascada) |

Tras cada mutación, el server recalcula **WBS + orden**, aplica el **auto-scheduling por dependencias** y el **roll-up de padres**.

---

## Notas de desarrollo

- **Hot-reload:** el server usa `nodemon --legacy-watch` (polling) y el client `vite` con `usePolling`. Es necesario para que los cambios en el bind-mount se detecten sobre Docker en macOS/Windows.
- **Al añadir dependencias npm** a `client` o `server`: como `node_modules` vive en un volumen nombrado, `--build` no basta. Reinstala dentro del contenedor:
  ```bash
  docker compose exec <server|client> npm install
  ```
  (o elimina el volumen `project-gantt_<svc>-node-modules` y recrea el servicio).
- **Migraciones:** el server ejecuta `prisma migrate deploy` al arrancar. Para crear una nueva migración tras cambiar el esquema:
  ```bash
  docker compose exec server npm run db:migrate -- --name <nombre>
  ```
- **Puertos ocupados:** si 5173/3000/5432 están en uso, edita el mapeo en `docker-compose.yml`.

## Tests

Tests unitarios del back-end (utilidades de fechas, parseo de dependencias y motor de scheduling):

```bash
docker compose exec server npm test
```

---

## Roadmap

Implementación **fase por fase** (plan detallado en [`SPEC.md`](./SPEC.md)).

- [x] **Fase 1** — Scaffolding (monorepo, Docker Compose, Prisma + seed)
- [x] **Fase 2** — Backend / API (CRUD, autosave, WBS, roll-up, fechas laborables)
- [x] **Fase 3** — Panel izquierdo (grid editable, modal, indent/outdent, reordenar)
- [x] **Fase 4** — Panel derecho (Gantt: barras, zoom, hoy, dependencias, milestones)
- [x] **Fase 5** — Camino crítico (CPM: backward pass sobre FS/SS/FF + toggle rojo)
- [x] **Fase 6** — Pulido (commit al perder foco, fines de semana sombreados, milestone centrado, indicador de autosave, errores por modal)
