import { spawn } from "node:child_process";

const attempts = positiveInteger(process.env.DB_PUSH_ATTEMPTS, 8);
const baseDelayMs = positiveInteger(process.env.DB_PUSH_RETRY_DELAY_MS, 5_000);
const schema = process.env.PRISMA_SCHEMA ?? "prisma/schema.prisma";

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const result = await runPrismaDbPush(schema);
  if (result === 0) process.exit(0);
  if (attempt === attempts) process.exit(result);

  const delayMs = baseDelayMs * attempt;
  console.warn(`prisma db push failed with exit code ${result}; retrying in ${Math.round(delayMs / 1000)}s (${attempt}/${attempts})`);
  await delay(delayMs);
}

function runPrismaDbPush(schemaPath) {
  return new Promise((resolve) => {
    const child = spawn("npx", ["prisma", "db", "push", "--skip-generate", `--schema=${schemaPath}`], {
      env: {
        ...process.env,
        DATABASE_URL: withConnectTimeout(process.env.DATABASE_URL)
      },
      stdio: "inherit"
    });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      console.error(error);
      resolve(1);
    });
  });
}

function withConnectTimeout(value) {
  if (!value) return value;
  const url = new URL(value);
  if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "30");
  return url.toString();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
