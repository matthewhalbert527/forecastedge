const jobId = process.argv[2] ?? "optimize_strategy_candidates";
const baseUrl = process.env.FORECASTEDGE_API_URL ?? "http://localhost:4000";
const token = process.env.SCHEDULED_JOB_TOKEN;

const headers = token ? { "x-job-token": token } : {};
const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/jobs/${encodeURIComponent(jobId)}/run`, {
  method: "POST",
  headers
});
const body = await response.json().catch(() => null);

if (!response.ok) {
  console.error(JSON.stringify({ jobId, status: response.status, body }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(body, null, 2));

if (body && typeof body === "object" && body.status === "failed") {
  process.exit(1);
}
