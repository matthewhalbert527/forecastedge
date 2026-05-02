import { type NextRequest } from "next/server";

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return proxyRequest(request, context);
}

async function proxyRequest(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const apiBaseUrl = resolveApiBaseUrl(request);
  if (apiBaseUrl instanceof Response) return apiBaseUrl;

  const upstreamUrl = new URL(`/api/${path.join("/")}`, apiBaseUrl);
  upstreamUrl.search = request.nextUrl.search;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const apiToken = process.env.FORECASTEDGE_API_TOKEN ?? process.env.SCHEDULED_JOB_TOKEN;
  if (apiToken) {
    headers.set("x-forecastedge-token", apiToken);
    headers.set("x-job-token", apiToken);
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    cache: "no-store"
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown upstream fetch error";
    return Response.json({ error: "ForecastEdge API proxy upstream request failed", message }, { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const key of ["content-type", "content-disposition"]) {
    const value = upstream.headers.get(key);
    if (value) responseHeaders.set(key, value);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}

function resolveApiBaseUrl(request: NextRequest) {
  const configured = process.env.FORECASTEDGE_API_URL;
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      return Response.json({ error: "FORECASTEDGE_API_URL must be configured for the ForecastEdge API proxy" }, { status: 500 });
    }
    return "http://localhost:4000";
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return Response.json({ error: "FORECASTEDGE_API_URL must be an absolute http(s) URL" }, { status: 500 });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Response.json({ error: "FORECASTEDGE_API_URL must use http or https" }, { status: 500 });
  }
  if (url.origin === request.nextUrl.origin) {
    return Response.json({ error: "FORECASTEDGE_API_URL must point to the Fastify API, not the web app origin" }, { status: 500 });
  }

  return url.toString().replace(/\/$/, "");
}
