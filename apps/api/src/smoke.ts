import { buildServer } from "./server.js";

const app = buildServer();
const health = await app.inject({ method: "GET", url: "/health" });
if (health.statusCode !== 200) {
  throw new Error(`health failed: ${health.statusCode} ${health.body}`);
}
const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
if (dashboard.statusCode !== 200) {
  throw new Error(`dashboard failed: ${dashboard.statusCode} ${dashboard.body}`);
}
await app.close();
console.log("API smoke passed");
