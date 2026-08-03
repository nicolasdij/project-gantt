// Instancia única de Prisma Client compartida por toda la app.
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
