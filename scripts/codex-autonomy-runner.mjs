import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const mode = args.get("mode") ?? process.env.CODEX_AUTONOMY_MODE ?? "daily";
const lookbackHours = numberArg(args.get("lookback-hours") ?? process.env.CODEX_AUTONOMY_LOOKBACK_HOURS, mode === "deep" ? 6 : 24);
const dryRun = args.has("dry-run") || process.env.CODEX_AUTONOMY_DRY_RUN === "true";
const outDir = join(repoRoot, "tmp", "codex-autonomy");
const logDir = join(outDir, "logs");
const reportDir = join(outDir, "reports");
const promptDir = join(outDir, "prompts");
const lockPath = join(outDir, "runner.lock");

await mkdir(logDir, { recursive: true });
await mkdir(reportDir, { recursive: true });
await mkdir(promptDir, { recursive: true });

const lock = await acquireLock(lockPath);
if (!lock.acquired) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: lock.reason }, null, 2));
  process.exit(0);
}

let finalExitCode = 0;
try {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = await fetchResearchExport(lookbackHours);
  const reportPath = join(reportDir, `forecastedge-${mode}-${stamp}.json`);
  const latestReportPath = join(reportDir, "latest.json");
  const reportBody = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(reportPath, reportBody);
  await writeFile(latestReportPath, reportBody);

  const prompt = buildPrompt({ mode, lookbackHours, reportPath, latestReportPath });
  const promptPath = join(promptDir, `prompt-${mode}-${stamp}.md`);
  await writeFile(promptPath, prompt);

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      mode,
      lookbackHours,
      reportPath,
      promptPath,
      recommendedAction: report.codexBrief?.recommendedAction ?? null
    }, null, 2));
  } else {
    const resultPath = join(logDir, `result-${mode}-${stamp}.md`);
    const eventLogPath = join(logDir, `events-${mode}-${stamp}.jsonl`);
    const command = codexCommand({ promptPath, resultPath });
    finalExitCode = await runCodex(command, eventLogPath);
    const latestResultPath = join(logDir, "latest-result.md");
    await copyIfExists(resultPath, latestResultPath);
    console.log(JSON.stringify({
      ok: finalExitCode === 0,
      exitCode: finalExitCode,
      mode,
      lookbackHours,
      reportPath,
      promptPath,
      resultPath,
      eventLogPath
    }, null, 2));
  }
} finally {
  await rm(lockPath, { force: true });
}

process.exit(finalExitCode);

function parseArgs(values) {
  const parsed = new Map();
  for (const value of values) {
    if (value.startsWith("--") && value.includes("=")) {
      const [key, ...rest] = value.slice(2).split("=");
      parsed.set(key, rest.join("="));
    } else if (value.startsWith("--")) {
      parsed.set(value.slice(2), "true");
    }
  }
  return parsed;
}

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function acquireLock(path) {
  try {
    const existing = JSON.parse(await readFile(path, "utf8"));
    const pid = Number(existing.pid);
    const startedAt = new Date(existing.startedAt).getTime();
    const stale = Number.isFinite(startedAt) && Date.now() - startedAt > 12 * 60 * 60 * 1000;
    if (pid && !stale && processAlive(pid)) {
      return { acquired: false, reason: `Codex autonomy runner is already active with pid ${pid}` };
    }
  } catch {
    // No usable lock exists.
  }
  await writeFile(path, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2));
  return { acquired: true };
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function fetchResearchExport(hours) {
  const explicitUrl = process.env.FORECASTEDGE_RESEARCH_EXPORT_URL;
  const baseUrl = (process.env.FORECASTEDGE_WEB_URL || "https://forecastedge-web.onrender.com").replace(/\/$/, "");
  const url = explicitUrl ? new URL(explicitUrl) : new URL("/api/forecastedge/research/nightly-export", baseUrl);
  url.searchParams.set("lookbackHours", String(hours));
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`ForecastEdge research export failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function buildPrompt(input) {
  return [
    "# ForecastEdge Autonomous Codex Improvement Run",
    "",
    `Mode: ${input.mode}`,
    `Lookback hours: ${input.lookbackHours}`,
    `Research report: ${input.reportPath}`,
    `Latest report alias: ${input.latestReportPath}`,
    "",
    "You are running locally through Codex CLI with the user's configured model and reasoning effort.",
    "",
    "Goal:",
    "- Review the ForecastEdge research export and decide whether a safe improvement is justified.",
    "- If justified, implement the smallest defensible code/config patch, validate it, commit it, push it to origin/main, and verify Render.",
    "- If not justified, do not change production code. Write a short decision note in tmp/codex-autonomy/latest-decision.md explaining why.",
    "",
    "Hard safety rules:",
    "- Do not enable live trading.",
    "- Do not add, print, or modify API keys/secrets.",
    "- Do not change Render base URLs, auth middleware, or routing for TimeTracker or Lee Workout.",
    "- Do not bypass the paper-trading learning gates just to force a change.",
    "- Do not make broad rewrites; prefer bounded threshold/config/backtest/data-quality improvements.",
    "- If the report lacks enough settled examples, preserve collection mode and write a no-change decision note.",
    "",
    "Required workflow:",
    "1. Run `git status --short` and inspect the research report.",
    "2. Check `codexBrief.recommendedAction`, optimizer/backtest results, paper-trade settlement counts, data-quality warnings, and risk warnings.",
    "3. If changing code/config, run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:api`, `npm run build:web`, and `npm run smoke`.",
    "4. Commit with a concise message and push to `origin main` only after verification passes.",
    "5. Verify Render API health/dashboard after deploy if a commit was pushed.",
    "6. Write the final decision to `tmp/codex-autonomy/latest-decision.md`.",
    "",
    "Expected final answer:",
    "- State whether a patch was applied.",
    "- State the evidence used.",
    "- State verification and deployment status.",
    "",
    "Begin now."
  ].join("\n");
}

function codexCommand(input) {
  const codexBin = process.env.CODEX_BIN || "/opt/homebrew/bin/codex";
  const model = process.env.CODEX_AUTONOMY_MODEL || "gpt-5.5";
  const reasoning = process.env.CODEX_AUTONOMY_REASONING || "xhigh";
  return {
    cmd: codexBin,
    args: [
      "exec",
      "-C",
      repoRoot,
      "-m",
      model,
      "-c",
      `model_reasoning_effort="${reasoning}"`,
      "-s",
      "danger-full-access",
      "-a",
      "never",
      "--json",
      "--output-last-message",
      input.resultPath,
      "-"
    ],
    promptPath: input.promptPath
  };
}

async function runCodex(command, eventLogPath) {
  await assertExecutable(command.cmd);
  const prompt = await readFile(command.promptPath);
  return new Promise((resolve, reject) => {
    const child = spawn(command.cmd, command.args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: process.env.HOME,
        CODEX_HOME: process.env.CODEX_HOME || join(process.env.HOME ?? "", ".codex"),
        PATH: process.env.PATH || "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let log = "";
    child.stdout.on("data", (chunk) => {
      log += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      log += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      await writeFile(eventLogPath, log);
      resolve(code ?? 1);
    });
    child.stdin.end(prompt);
  });
}

async function assertExecutable(path) {
  await access(path, constants.X_OK);
}

async function copyIfExists(from, to) {
  try {
    const metadata = await stat(from);
    if (!metadata.isFile()) return;
    await writeFile(to, await readFile(from));
  } catch {
    // Nothing to copy.
  }
}
