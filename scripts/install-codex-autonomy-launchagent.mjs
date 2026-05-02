import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const label = "com.forecastedge.codex-autonomy";
const uid = process.getuid?.() ?? Number(process.env.UID);
const home = process.env.HOME;
const plistPath = `${home}/Library/LaunchAgents/${label}.plist`;
const logDir = `${home}/Library/Logs/ForecastEdge`;

if (!home) throw new Error("HOME is required");

if (args.has("uninstall")) {
  bootout();
  await rm(plistPath, { force: true });
  console.log(JSON.stringify({ ok: true, uninstalled: true, plistPath }, null, 2));
  process.exit(0);
}

const hour = intArg(args.get("hour"), 9);
const minute = intArg(args.get("minute"), 30);
const nodeBin = process.execPath;
const codexBin = args.get("codex-bin") ?? process.env.CODEX_BIN ?? "/opt/homebrew/bin/codex";
const mode = args.get("mode") ?? "daily";
const lookbackHours = args.get("lookback-hours") ?? "24";

await mkdir(dirname(plistPath), { recursive: true });
await mkdir(logDir, { recursive: true });
await writeFile(plistPath, plist({
  label,
  nodeBin,
  codexBin,
  mode,
  lookbackHours,
  hour,
  minute
}));

bootout();
const bootstrap = spawnSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath], { encoding: "utf8" });
if (bootstrap.status !== 0) {
  throw new Error(`launchctl bootstrap failed: ${bootstrap.stderr || bootstrap.stdout}`);
}
const enable = spawnSync("launchctl", ["enable", `gui/${uid}/${label}`], { encoding: "utf8" });
if (enable.status !== 0) {
  throw new Error(`launchctl enable failed: ${enable.stderr || enable.stdout}`);
}

console.log(JSON.stringify({
  ok: true,
  installed: true,
  label,
  plistPath,
  schedule: { hour, minute, mode, lookbackHours },
  logs: {
    stdout: `${logDir}/codex-autonomy.out.log`,
    stderr: `${logDir}/codex-autonomy.err.log`
  }
}, null, 2));

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

function intArg(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function bootout() {
  spawnSync("launchctl", ["bootout", `gui/${uid}`, plistPath], { encoding: "utf8" });
}

function plist(input) {
  const programArguments = [
    input.nodeBin,
    `${repoRoot}/scripts/codex-autonomy-runner.mjs`,
    `--mode=${input.mode}`,
    `--lookback-hours=${input.lookbackHours}`
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(input.label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n")}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(repoRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${escapeXml(home)}</string>
    <key>CODEX_HOME</key>
    <string>${escapeXml(`${home}/.codex`)}</string>
    <key>CODEX_BIN</key>
    <string>${escapeXml(input.codexBin)}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${input.hour}</integer>
    <key>Minute</key>
    <integer>${input.minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(`${logDir}/codex-autonomy.out.log`)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(`${logDir}/codex-autonomy.err.log`)}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
