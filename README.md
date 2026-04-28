# ForecastEdge

ForecastEdge monitors weather forecast changes, maps those changes to Kalshi weather markets, generates explainable signals, and starts with paper execution only. Live trading is intentionally disabled by default and blocked by multiple safety gates.

## Architecture

```text
Kalshi rules / Open-Meteo / NWS station observations / optional AccuWeather
  -> apps/api weather adapters
  -> model forecast stack / station-date ensembles
  -> settlement-station mapping
  -> normalized forecast snapshots and station observations
  -> forecast delta engine
  -> Kalshi public market scanner + conservative parser
  -> probability model + signal engine
  -> centralized risk manager
  -> paper broker / demo broker / disabled live shell
  -> audit log
  -> apps/web dashboard
```

## Modes

- `watch`: ingest forecasts, detect deltas, discover markets, and alert only.
- `paper`: run the full decision path and simulate orders from real order book data.
- `demo`: reserved for Kalshi demo API order-path exercises with demo credentials.
- `live`: disabled by default. The current MVP only includes a safety shell and dry-run intent evaluation.

## Setup

```bash
npm install
cp .env.example .env
docker compose up -d postgres redis
npm run dev
```

Open the dashboard at `http://localhost:3000`. The API runs on `http://localhost:4000`.

## Environment

Important defaults:

- `APP_MODE=paper`
- `LIVE_TRADING_ENABLED=false`
- `REQUIRE_MANUAL_CONFIRMATION=true`
- `KILL_SWITCH_ENABLED=true`
- `RUN_BACKGROUND_WORKER=false` locally, `true` on Render
- `BACKGROUND_POLL_INTERVAL_MINUTES=30`
- `ENABLE_MODEL_STACK=true`
- `OPEN_METEO_GFS_BASE_URL=https://api.open-meteo.com/v1/gfs`
- `OPEN_METEO_ECMWF_MODEL=ecmwf_ifs025`
- `KALSHI_PROD_BASE_URL=https://api.elections.kalshi.com/trade-api/v2`
- `KALSHI_DEMO_BASE_URL=https://demo-api.kalshi.co/trade-api/v2`

Do not put private keys in frontend environment variables. Demo and production credentials are separate and optional for the MVP.

## Running

```bash
npm run dev:api
npm run dev:web
```

Use the dashboard `Run scan` control or call:

```bash
curl -X POST http://localhost:4000/api/run-once
```

To run scans continuously in a server process:

```bash
RUN_BACKGROUND_WORKER=true npm run dev:api
```

On Render this is enabled by `render.yaml`; the API runs one scan on startup and then repeats every 30 minutes.

## Render Deployment

This repo includes `render.yaml` for a Blueprint deployment with:

- `forecastedge-api`
- `forecastedge-web`
- `forecastedge-db`

Push the repo to GitHub/GitLab/Bitbucket, create a Render Blueprint from the repo, then set `NEXT_PUBLIC_API_URL` on `forecastedge-web` to the deployed API URL. Keep `LIVE_TRADING_ENABLED=false` and `KILL_SWITCH_ENABLED=true`.

## Tests

```bash
npm run typecheck
npm run lint
npm test
npm run smoke
```

The current tests cover forecast delta detection, Kalshi title parsing, uncertain mapping rejection, probability/edge calculations, risk-limit rejection, and partial paper fills.

## Database

`prisma/schema.prisma` defines and now backs the paper-trading records in Postgres:

- locations
- forecast snapshots and deltas
- Kalshi markets and mappings
- signals and risk checks
- paper/demo/live order records
- paper positions and settlements
- model forecasts and ensembles
- strategy runs
- audit logs
- system events

When `DATABASE_URL` is configured, the API hydrates from Postgres on startup, persists scan artifacts, stores paper orders/positions, and reconciles paper settlement from Kalshi official market results. Without `DATABASE_URL`, the app falls back to the in-memory MVP path for local smoke testing.

Useful database commands:

```bash
npm run db:generate
npm run db:push
```

Manual paper settlement reconciliation:

```bash
curl -X POST http://localhost:4000/api/settlements/run-once
```

## Live Trading Safety

Live trading must remain disabled until paper and demo performance are reviewed. The backend rejects live order intents unless all of these are true:

- `LIVE_TRADING_ENABLED=true`
- `KILL_SWITCH_ENABLED=false`
- manual UI confirmation is present when required
- production credentials are configured
- risk checks pass

The frontend never receives private keys.

## Known Limitations

- Open-Meteo is implemented first; NWS alerts are available as an adapter but not yet merged into provider agreement logic.
- The model stack currently persists ECMWF-style Open-Meteo model runs plus short-range HRRR/GFS best-match rows from Open-Meteo’s NOAA endpoint and builds weighted station ensembles. Meteomatics US1k, GraphCast, GenCast, WeatherMesh-4, Earth-2, and ICON are represented in the model architecture but require real data adapters and calibration before they can affect trading decisions.
- Market title parsing is intentionally conservative and only recognizes a small city alias set.
- Paper settlement uses Kalshi official binary market results when available; unresolved or scalar/ambiguous results are skipped and audited.
- Mark-to-market for open paper positions is still limited; open exposure is based on entry cost.
- Demo broker currently includes credential detection, request signing, and dry-run order preview; real demo order submission/reconciliation is the next step.
- Redis/BullMQ scheduling is not wired yet; the MVP uses manual `run-once` scans.
- Temperature markets target specific settlement stations such as `KMIA`, `KMDW`, `KNYC`, and `KATT`; market rules remain authoritative and uncertain station mappings are rejected for review.
- AccuWeather is optional and should only be treated as authoritative when a market's rules explicitly name it.
- Market title parsing is intentionally conservative and only recognizes known station/city aliases.

## Next Model Improvement Tasks

After several days of paper data:

1. Persist forecast snapshots, order books, paper fills, and station observations in Postgres.
2. Persist NWS Daily Climate Report settlement values by station.
3. Build station-specific calibration buckets by horizon, station, season, and market type.
4. Estimate forecast error standard deviations from observed station outcomes instead of defaults.
5. Use HRRR same-day deltas as a signal input after enough settlement calibration exists.
6. Add commercial Meteomatics US1k behind optional credentials for hyper-local settlement station forecasts.
7. Add AI-model forecast adapters when real GraphCast/GenCast/WeatherNext feeds are available.
8. Tune edge thresholds against drawdown, not just win rate.
9. Expand conservative market parsing with reviewed examples and fixture tests.
10. Add provider disagreement logic using NWS model forecasts, Open-Meteo, and optional AccuWeather.
11. Move polling and market scans into Redis-backed scheduled jobs.
12. Run demo-mode order creation/cancel/reconcile tests before considering any live-mode work.

## Risk Disclaimer

Prediction market trading involves real financial risk. Paper or demo performance is not evidence of future live profitability. ForecastEdge is designed to preserve an audit trail and block unsafe execution paths, but it cannot eliminate market, model, liquidity, API, or operational risk.
