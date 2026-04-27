import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient | null = null;

export function databaseEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPrisma() {
  if (!databaseEnabled()) return null;
  prisma ??= new PrismaClient();
  return prisma;
}
