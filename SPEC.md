# Project Gantt — Especificación acordada

> Aplicación web tipo Smartsheet / MS Project (versión propia y gratuita).
> Este documento captura todas las decisiones tomadas antes de empezar a codificar,
> para que cualquier sesión futura pueda retomar el trabajo sin contexto previo.

## Stack técnico
- **Front-end:** React + Vite (TypeScript), estado con Zustand/React Query, editor Markdown ligero.
- **Back-end:** Node.js + Fastify + Prisma (ORM), API REST.
- **Base de datos:** PostgreSQL vía Docker Compose.
- **Modelo de uso:** multi-usuario, autosave (last-write-wins por campo), un proyecto para empezar (extensible a varios).
- **Estructura:** monorepo con `/client`, `/server` y `docker-compose.yml`.
- **Ejecución:** toda la aplicación corre en Docker (ver [Arquitectura Docker](#arquitectura-docker)).

## Arquitectura Docker
Toda la app corre en contenedores, orquestados con Docker Compose. Se usa **una imagen por componente** (enfoque granular), no una imagen monolítica.

### Topología
- **Desarrollo → 3 contenedores:**
  - `db` — imagen oficial `postgres:16` + volumen persistente.
  - `server` — build de `./server` (Node + Fastify + Prisma), hot-reload montando volumen.
  - `client` — build de `./client`, `vite dev` con hot-reload (puerto 5173).
- **Producción → opción A (3 contenedores):**
  - `db` — `postgres:16` + volumen.
  - `server` — API Fastify.
  - `client` — `nginx` sirviendo el build estático de Vite (front y back totalmente separados).

### Por qué granular y no monolítico
| Criterio | Imagen monolítica (db+server+client juntos) | Una imagen por componente (elegido) |
|---|---|---|
| **Ciclo de vida** | Rebuild de todo ante cualquier cambio | Rebuild solo del servicio tocado |
| **Escalado / logs** | Todo mezclado, difícil de aislar | Cada servicio con sus logs y health check |
| **Base de datos** | Postgres dentro del contenedor → datos frágiles, anti-patrón | Postgres oficial + volumen persistente |
| **Dev vs. prod** | Un solo proceso, hot-reload sucio | `server` y `client` con hot-reload por volumen |
| **Complejidad interna** | Requiere supervisord/multi-proceso en un contenedor (anti-patrón) | Compose orquesta; un proceso por contenedor |

Regla aplicada: **un proceso por contenedor**. Meter Postgres + Node + Vite en una sola imagen obligaría a un gestor de procesos interno, justo lo que Compose evita.

## Layout de la app
- Toolbar arriba.
- Panel izquierdo: grid de filas/columnas (editable).
- Panel derecho: timeline del Gantt (barras horizontales, flechas de dependencia).

## Columnas del panel izquierdo (en este orden)
| # | Columna | Editable | Notas |
|---|---------|----------|-------|
| 1 | **ID** | No (autogen) | Número secuencial, estilo MS Project. Se usa en Dependencies. Es un **link**: al hacer click abre el modal de edición. |
| 2 | **WBS** | No (autogen) | Jerárquico (1, 1.1, 1.2.1). Texto (no editable). |
| 3 | **Title** | Sí | Título breve del ítem. |
| 4 | **Start Date** | Sí | Formato YYYY-MM-DD. Al editar → recalcula **End** (según Duration, sin fines de semana). |
| 5 | **End Date** | Sí | Formato YYYY-MM-DD. Al editar → recalcula **Duration**. |
| 6 | **Duration** | Sí | `Nd` / `Nw`. `1w` = 5 días laborables. Al editar → recalcula **End**. |
| 7 | **Owner** | Sí | Un solo responsable. Autocomplete con valores ya existentes en otras filas. |
| 8 | **Dependencies** | Sí | Ej. `3FS` (Finish-Start con el ID 3). Tipos soportados en v1: **FS, SS y FF** (SF queda fuera del alcance). **Auto-scheduling:** al fijar/editar una dependencia, las fechas del sucesor se ajustan al predecesor (conservando su Duration), estilo MS Project. Con varias, se toma la restricción más tardía. Habilita también el cálculo del camino crítico. |

### Campos solo en el modal (abierto desde el link del ID)
- **Description:** editor rich text (negrita, cursiva, subrayado, listas numeradas y sin numerar). Se **guarda como Markdown**.
- El modal también permite editar el resto de columnas visibles del panel izquierdo.

## Reglas de negocio
- **Duration:** cuenta días laborables **inclusive** (Lunes→Viernes = 5d). Solo se ignoran sábados y domingos (sin feriados por ahora).
- **Milestone:** caso especial cuando Start = End → duración `0d`. Se dibuja como rombo (◆).
- **Recálculos:**
  - Editar **End Date** → recalcula **Duration**.
  - Editar **Duration** → recalcula **End Date** (usando Start + días laborables).
  - Editar **Start Date** → recalcula **End Date** (manteniendo Duration).
- **Filas padre (resumen):** Start/End/Duration se **calculan automáticamente** desde los hijos (start = mín de hijos, end = máx de hijos) → **no editables** en padres.

## Timeline (panel derecho)
- Barras horizontales alineadas con las filas del grid.
- **Flechas de dependencia** dibujadas tanto en vista normal como en camino crítico (SVG).
- Milestones como rombo (◆).
- Zoom con botones **Day / Week / Month**.
- Marcador de **"hoy"**.
- Scroll horizontal (sincronizado con el grid).

## Camino crítico (CPM)
- Se calcula a partir de las **Dependencies** (forward/backward pass, slack = 0).
- Tipos de dependencia soportados en v1: **FS (Finish-Start), SS (Start-Start) y FF (Finish-Finish)**. SF (Start-Finish) queda fuera del alcance.
- Toggle en el toolbar: al activarlo pinta de **rojo** las barras del camino crítico; al desactivarlo vuelve a la vista normal.

## Toolbar (botones en íconos)
1. ➕ **Add row** · 🗑️ **Delete row**
2. ➡️ **Indent** · ⬅️ **Outdent**
3. 🔺 **Move up** · 🔻 **Move down** (reordenar)
4. 🔴 **Toggle critical path**
5. **Day · Week · Month** (zoom)
- Autosave: sin botón de guardar; se muestra indicador de estado ("Saving… / Saved").

## Plan de implementación (fases)
1. **Scaffolding:** monorepo `/client` + `/server` + `docker-compose.yml` (Postgres). Esquema Prisma: tabla `tasks` (id, wbs, parentId, order, title, start, end, durationDays, isMilestone, owner, dependencies, descriptionMd) + migraciones y seed.
2. **Backend / API:** CRUD de tasks, endpoint de autosave, cálculo server-side de WBS y roll-up de padres, utilidades de fechas laborables (addWorkingDays, workingDaysBetween).
3. **Panel izquierdo (grid):** grid editable, edición inline, recálculo Start↔End↔Duration, autocomplete de Owner, modal con editor Markdown, indent/outdent, add/delete, reordenar, WBS jerárquico, roll-up de padres.
4. **Panel derecho (Gantt):** barras alineadas, escala Day/Week/Month, marcador "hoy", scroll sincronizado, flechas de dependencia, milestones como rombo.
5. **Camino crítico:** motor CPM sobre las Dependencies + toggle rojo.
6. **Pulido:** autosave con debounce + indicador, validaciones, manejo de errores.

## Decisiones tomadas
1. **Tipos de dependencia (v1):** FS, SS y FF. SF queda fuera del alcance. ✅
2. **Arquitectura Docker:** una imagen por componente (granular), no monolítica. Dev = 3 contenedores (db, server, client con hot-reload). Prod = opción A, 3 contenedores (db, server, client servido por nginx). ✅
3. **Alcance de entrega:** fase por fase, validando cada fase antes de pasar a la siguiente. ✅
4. **Auto-scheduling por dependencias:** editar una dependencia reprograma las fechas del sucesor según el tipo (FS/SS/FF), conservando la Duration; con varias, gana la más tardía. El roll-up de padres se recalcula desde los hijos ya reprogramados. ✅
5. **Link de edición en la columna ID** (no en WBS). El diálogo de borrado es un **modal propio** (no el `confirm()` del navegador). ✅
6. **Pulido (Fase 6):**
   - El recálculo Start/End/Duration y el redibujado del Gantt ocurren al **perder el foco** del campo (blur), no en cada tecla. ✅
   - Las columnas de **fin de semana** (sáb/dom) se muestran en **gris claro** en el panel derecho. ✅
   - El **rombo del milestone** se dibuja **centrado** dentro de la columna de su día. ✅
   - Notificaciones/errores por **modal propio** (nunca `alert()`/`confirm()` del navegador). ✅
