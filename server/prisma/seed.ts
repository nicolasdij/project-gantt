// Seed de ejemplo para Project Gantt.
// Crea un proyecto pequeño con jerarquía (padres/hijos), dependencias, avances
// parciales y un milestone.
// Nota: WBS y roll-up de padres se calcularán server-side en la Fase 2; aquí se dejan
// valores iniciales coherentes para poder visualizar datos desde ya.

import { PrismaClient } from "@prisma/client";
import { recomputeProject } from "../src/services/project.ts";

const prisma = new PrismaClient();

// Helper: fecha (medianoche UTC) a partir de "YYYY-MM-DD".
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function main() {
  // Limpia la tabla y REINICIA el autoincrement, para que un re-seed devuelva
  // siempre los mismos ids 1..7 (importante: los ids son la columna "ID" visible
  // y se referencian en Dependencies).
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "tasks" RESTART IDENTITY CASCADE');

  // --- Fila raíz 1: Fase de definición ---
  const planning = await prisma.task.create({
    data: { wbs: "1", order: 1, title: "Definición del proyecto", durationDays: 10 },
  });

  const requirements = await prisma.task.create({
    data: {
      wbs: "1.1",
      parentId: planning.id,
      order: 2,
      title: "Toma de requisitos",
      start: d("2026-08-03"),
      end: d("2026-08-07"),
      durationDays: 5,
      owner: "Ana",
      progress: 100,
    },
  });

  await prisma.task.create({
    data: {
      wbs: "1.2",
      parentId: planning.id,
      order: 3,
      title: "Diseño de solución",
      start: d("2026-08-10"),
      end: d("2026-08-14"),
      durationDays: 5,
      owner: "Ana",
      progress: 60,
      // Empieza cuando termina "Toma de requisitos".
      dependencies: `${requirements.id}FS`,
    },
  });

  // --- Fila raíz 2: Desarrollo ---
  const dev = await prisma.task.create({
    data: { wbs: "2", order: 4, title: "Desarrollo", durationDays: 10 },
  });

  const backend = await prisma.task.create({
    data: {
      wbs: "2.1",
      parentId: dev.id,
      order: 5,
      title: "Backend / API",
      start: d("2026-08-17"),
      end: d("2026-08-21"),
      durationDays: 5,
      owner: "Beto",
      progress: 30,
      dependencies: "3FS", // tras "Diseño de solución" (id 3)
    },
  });

  await prisma.task.create({
    data: {
      wbs: "2.2",
      parentId: dev.id,
      order: 6,
      title: "Front-end / Grid + Gantt",
      start: d("2026-08-17"),
      end: d("2026-08-28"),
      durationDays: 10,
      owner: "Carla",
      dependencies: `${backend.id}SS`, // arranca a la vez que Backend (Start-Start)
    },
  });

  // --- Milestone de lanzamiento (start == end, duración 0) ---
  await prisma.task.create({
    data: {
      wbs: "3",
      order: 7,
      title: "Lanzamiento v1",
      start: d("2026-08-31"),
      end: d("2026-08-31"),
      durationDays: 0,
      isMilestone: true,
      dependencies: "6FF", // termina cuando termina el Front-end (id 6, Finish-Finish)
    },
  });

  // Normaliza WBS/orden y aplica el scheduling por dependencias + roll-up,
  // para que el estado inicial ya sea consistente al primer render.
  await recomputeProject();

  const count = await prisma.task.count();
  console.log(`Seed completado: ${count} tareas creadas (recalculadas).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
