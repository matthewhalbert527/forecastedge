process.env.RUN_BACKGROUND_WORKER ??= "false";
process.env.RUN_ON_STARTUP ??= "false";
process.env.RUN_QUOTE_REFRESH_WORKER ??= "false";
if (process.env.SMOKE_USE_DATABASE !== "true") process.env.DATABASE_URL = "";

const { buildServer } = await import("./server.js");
const app = buildServer();
const health = await app.inject({ method: "GET", url: "/health" });
if (health.statusCode !== 200) {
  throw new Error(`health failed: ${health.statusCode} ${health.body}`);
}
const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
if (dashboard.statusCode !== 200) {
  throw new Error(`dashboard failed: ${dashboard.statusCode} ${dashboard.body}`);
}
const researchExport = await app.inject({ method: "GET", url: "/api/research/nightly-export?lookbackHours=24" });
if (researchExport.statusCode !== 200) {
  throw new Error(`research export failed: ${researchExport.statusCode} ${researchExport.body}`);
}
await app.close();
console.log("API smoke passed");
