import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("ForecastEdge API privileged route auth", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it("disables production API routes when no token is configured", async () => {
    const app = await buildTestServer({ NODE_ENV: "production" });
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    const dataset = await app.inject({ method: "GET", url: "/api/dataset/export" });
    await app.close();

    expect(dashboard.statusCode).toBe(503);
    expect(dataset.statusCode).toBe(503);
  });

  it("rejects bad tokens and accepts configured tokens on operational API routes", async () => {
    const app = await buildTestServer({ NODE_ENV: "production", FORECASTEDGE_API_TOKEN: "secret-token" });

    const rejected = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { "x-forecastedge-token": "wrong-token" }
    });
    const accepted = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: { "x-forecastedge-token": "secret-token" }
    });
    await app.close();

    expect(rejected.statusCode).toBe(401);
    expect(accepted.statusCode).toBe(200);
  });

  it("keeps health and public reference routes available without a token", async () => {
    const app = await buildTestServer({ NODE_ENV: "production", FORECASTEDGE_API_TOKEN: "secret-token" });

    const health = await app.inject({ method: "GET", url: "/health" });
    const stations = await app.inject({ method: "GET", url: "/api/settlement-stations" });
    const dataSources = await app.inject({ method: "GET", url: "/api/data-sources" });
    await app.close();

    expect(health.statusCode).toBe(200);
    expect(stations.statusCode).toBe(200);
    expect(dataSources.statusCode).toBe(200);
  });
});

async function buildTestServer(env: Record<string, string>) {
  vi.resetModules();
  process.env = {
    ...originalEnv,
    DATABASE_URL: "",
    RUN_BACKGROUND_WORKER: "false",
    RUN_ON_STARTUP: "false",
    RUN_QUOTE_REFRESH_WORKER: "false",
    FORECASTEDGE_API_TOKEN: "",
    SCHEDULED_JOB_TOKEN: "",
    ...env
  };
  const { buildServer } = await import("./server.js");
  return buildServer();
}
