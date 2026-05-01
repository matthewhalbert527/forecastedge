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
  await retryDatabasePush(schema);
  schemaReady = true;
}

async function retryDatabasePush(schema: string) {
  const attempts = 4;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await execFileAsync("npx", ["prisma", "db", "push", "--skip-generate", `--schema=${schema}`], {
        env: {
          ...process.env,
          DATABASE_URL: withConnectTimeout(process.env.DATABASE_URL)
        },
        timeout: 120_000
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await delay(5_000 * attempt);
    }
  }
  throw lastError;
}

function withConnectTimeout(value: string | undefined) {
  if (!value) return value;
  const url = new URL(value);
  if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "30");
  return url.toString();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
