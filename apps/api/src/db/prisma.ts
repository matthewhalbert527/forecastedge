import { PrismaClient } from "@prisma/client";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let prisma: PrismaClient | null = null;
let schemaReady = false;

export function databaseEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPrisma() {
  if (!databaseEnabled()) return null;
  prisma ??= new PrismaClient();
  return prisma;
}

export async function ensureDatabaseSchema() {
  if (!databaseEnabled() || schemaReady) return;
  const schema = existsSync("prisma/schema.prisma") ? "prisma/schema.prisma" : "../../prisma/schema.prisma";
  await execFileAsync("npx", ["prisma", "db", "push", "--skip-generate", `--schema=${schema}`], {
    env: process.env,
    timeout: 120_000
  });
  schemaReady = true;
}
