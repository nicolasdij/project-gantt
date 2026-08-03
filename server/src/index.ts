// Servidor Fastify — punto de entrada.
// Fase 2: CRUD de tasks + autosave + recálculo de WBS/roll-up y fechas laborables.

import Fastify from "fastify";
import cors from "@fastify/cors";
import { prisma } from "./db.ts";
import { taskRoutes } from "./routes/tasks.ts";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

// Health-check: confirma que el proceso vive y que la DB responde.
app.get("/api/health", async () => {
  await prisma.$queryRaw`SELECT 1`;
  return { status: "ok", db: "up" };
});

await app.register(taskRoutes);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

const shutdown = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ port, host });
  app.log.info(`Server escuchando en http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
