import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([^=]+)=(.*)$/);
  if (match) args.set(match[1], match[2]);
}

const baseUrl = (process.env.FORECASTEDGE_API_URL || args.get("api-url") || "https://forecastedge-api.onrender.com").replace(/\/$/, "");
const lookbackHours = Number(args.get("lookback-hours") || process.env.NIGHTLY_RESEARCH_LOOKBACK_HOURS || 24);
const url = new URL("/api/research/nightly-export", baseUrl);
url.searchParams.set("lookbackHours", String(Number.isFinite(lookbackHours) ? lookbackHours : 24));

const headers = { Accept: "application/json" };
if (process.env.SCHEDULED_JOB_TOKEN) headers["x-job-token"] = process.env.SCHEDULED_JOB_TOKEN;

const response = await fetch(url, { headers });
if (!response.ok) {
  throw new Error(`Nightly research export failed: ${response.status} ${await response.text()}`);
}

const payload = await response.json();
const outDir = join(process.cwd(), "tmp", "nightly-research");
await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const stampedPath = join(outDir, `forecastedge-nightly-${stamp}.json`);
const latestPath = join(outDir, "latest.json");
const body = `${JSON.stringify(payload, null, 2)}\n`;
await writeFile(stampedPath, body);
await writeFile(latestPath, body);

console.log(JSON.stringify({
  ok: true,
  url: url.toString(),
  latestPath,
  stampedPath,
  generatedAt: payload.generatedAt,
  recommendedAction: payload.codexBrief?.recommendedAction ?? null
}, null, 2));
