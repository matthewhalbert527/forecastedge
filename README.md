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
- `FORECASTEDGE_API_TOKEN` protects production API routes except `/health` and public reference metadata
- `BACKGROUND_POLL_INTERVAL_MINUTES=15`
- `BACKGROUND_WORKER_MAX_RSS_MB=0` locally, `420` on Render
- `QUOTE_REFRESH_INTERVAL_MINUTES=5`
- `QUOTE_REFRESH_MAX_TICKERS=25`
- `QUOTE_REFRESH_MAX_PAPER_ORDERS=3`
- `KALSHI_MARKET_DISCOVERY_LIMIT=100`
- `KALSHI_MARKET_DISCOVERY_MAX_PAGES=1`
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

On Render this is enabled by `render.yaml`; the API uses a `standard` service instance, skips startup scans, runs the full background scan every 30 minutes, refreshes a bounded set of quote candidates every 5 minutes, and skips new background work when process RSS is at or above 1600 MB. The Render workspace/account plan is separate from each service's instance type; keep `forecastedge-api` above `starter` to avoid the 512 MB cap.
Set the same `FORECASTEDGE_API_TOKEN` on `forecastedge-api` and `forecastedge-web` so the dashboard can call protected API routes through its same-origin proxy. In production, `/health`, `/api/settlement-stations`, and `/api/data-sources` remain public; operational dashboard, audit, learning, export, job, and mutation routes require a token.

## Render Deployment

This repo includes `render.yaml` for a Blueprint deployment with:

- `forecastedge-api`
- `forecastedge-web`
- `forecastedge-db`

Push the repo to GitHub/GitLab/Bitbucket, create a Render Blueprint from the repo, then set matching `FORECASTEDGE_API_TOKEN` values on `forecastedge-api` and `forecastedge-web`. Keep `LIVE_TRADING_ENABLED=false` and `KILL_SWITCH_ENABLED=true`.

## Tests

```bash
npm run typecheck
npm run lint
npm test
npm run smoke
```

The current tests cover forecast delta detection, Kalshi title parsing, uncertain mapping rejection, probability/edge calculations, risk-limit rejection, and partial paper fills.

## Database

`prisma/schema.prisma` defines and now backs the paper-trading and backtesting records in Postgres:

- locations
- forecast snapshots and deltas
- Kalshi markets and mappings
- historical Kalshi market metadata
- historical/live Kalshi candlesticks and trade prints
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

`DATABASE_URL` must be set before `npm run db:push`; without it Prisma cannot create the historical backtest tables.

Manual paper settlement reconciliation:

```bash
curl -X POST http://localhost:4000/api/settlements/run-once
```

## Historical Backtesting

The Backtest tab can now sync historical Kalshi market data and replay strategy candidates against candle/trade-derived prices.

Historical sync from the dashboard supports:

- explicit comma-separated market tickers
- bulk series sync by `seriesTicker` such as `KXHIGHCHI`
- historical or live/recent candle endpoints
- 1-hour candles by default plus trade prints

API equivalent:

```bash
curl -X POST http://localhost:4000/api/historical/sync \
  -H 'Content-Type: application/json' \
  -d '{
    "seriesTicker": "KXHIGHCHI",
    "source": "historical",
    "startTs": 1770000000,
    "endTs": 1771000000,
    "periodInterval": 60,
    "includeTrades": true,
    "includeCandlesticks": true,
    "maxPages": 5
  }'
```

Guardrails:

- request windows are capped at 366 days
- explicit ticker sync is capped at 25 tickers per request
- either `seriesTicker` or `tickers` is required

Backtests use the first available replay price in this order:

1. Kalshi candlestick YES ask/price around the candidate timestamp
2. Kalshi historical/live trade prints
3. stored candidate snapshot entry price

Historical execution applies configurable slippage in cents. Current paper execution still uses the live orderbook endpoint for realistic yes/no bid book fills.

## Strategy Approval Pipeline

The backtesting lab now saves strategy versions and runs through a promotion workflow:

1. `Draft`
2. `Backtest Passed`
3. `Walk-Forward Passed`
4. `Paper Testing`
5. `Paper Approved`
6. `Rejected`

Each saved strategy version preserves the config, config hash, code version when supplied by the deployment environment, data-source version, backtest date, validation date, paper-trading start date, notes, approval status, and linked strategy runs. New runs create new version rows rather than overwriting old results.

Approval gates are configurable in `packages/core/src/strategy/decision-engine.ts` and currently check:

- minimum trade count
- positive test-period ROI
- max drawdown
- win rate or positive expectancy
- minimum liquidity
- longest losing streak
- single-trade P/L concentration
- risk of ruin
- data-quality score
- rare long-shot win dependence
- critical anti-overfitting warnings
- paper sample size and paper-edge degradation when running paper validation

The decision engine also calculates expected value per trade, average win, average loss, payoff ratio, break-even win rate, profit factor, risk-of-ruin estimate, median trade return, and outlier-adjusted return. Strategies are rejected when profitability depends on one rare long-shot win or collapses after fees/slippage.

Safe promotion path:

1. Run a normal backtest in the Backtest tab and fix any data-quality or overfitting warnings.
2. Re-run with `Validation = Walk-forward` over an out-of-sample date range.
3. Leave the strategy in paper mode and re-run with `Validation = Paper validation` once enough paper fills exist.
4. Promote only strategies with `Paper Approved`; `Backtest Passed` and `Walk-Forward Passed` remain paper-only until live fills preserve the edge.

Rejected strategies are visible in the Research tab with failed gates and warnings. Review the failed gate, inspect recent simulated trades, then save a new strategy version with changed parameters instead of mutating the old run.

## Scheduled Job Hooks

The API exposes deployment-safe job definitions without adding another infinite loop:

- `refresh_historical_market_data`
- `refresh_forecast_archive_data`
- `optimize_strategy_candidates`
- `run_nightly_backtests`
- `update_paper_strategy_performance`
- `generate_strategy_health_report`

List jobs with:

```bash
curl http://localhost:4000/api/jobs
```

Run one explicitly with:

```bash
curl -X POST http://localhost:4000/api/jobs/run_nightly_backtests/run
```

Run the bounded optimizer explicitly with:

```bash
curl -X POST http://localhost:4000/api/jobs/optimize_strategy_candidates/run
```

Codex nightly research export:

```bash
npm run research:nightly-export -- --lookback-hours=24
```

This calls `/api/research/nightly-export`, writes `tmp/nightly-research/latest.json`, and gives Codex a compact payload with strategy status, optimizer recommendations, data-quality warnings, paper-trading degradation, recent candidates, rejected strategy reasons, and required validation steps. The endpoint accepts `x-job-token` or `Authorization: Bearer ...` when `SCHEDULED_JOB_TOKEN` is configured.

For production, set `SCHEDULED_JOB_TOKEN` on both `forecastedge-api` and `forecastedge-nightly-optimizer`. When set, scheduled job POSTs must include the matching `x-job-token` header.

`render.yaml` includes a `forecastedge-nightly-optimizer` cron service scheduled as `0 8 * * *`. Render cron schedules are UTC, so this corresponds to 3am America/Chicago during daylight time. The cron job calls `https://forecastedge-api.onrender.com/api/jobs/optimize_strategy_candidates/run` once and exits.

The local Codex-side automation is installed with:

```bash
npm run codex:autonomy:install
```

By default it installs a macOS LaunchAgent named `com.forecastedge.codex-autonomy` that runs daily at 9:30am local time. It pulls the production research export through the web proxy, runs `codex exec` with the local Codex config/model, decides whether a code/config improvement is justified, runs validation, pushes to `origin/main` if it changed anything, and verifies Render. The Render cron jobs score candidates inside the app; the local Codex automation is the code-changing layer.

Useful local commands:

```bash
npm run codex:autonomy -- --dry-run
npm run codex:autonomy
npm run codex:autonomy:uninstall
```

Runner outputs are under `tmp/codex-autonomy/`. LaunchAgent stdout/stderr logs are under `~/Library/Logs/ForecastEdge/`.

Historical refresh is opt-in and bounded by:

- `SCHEDULED_HISTORICAL_SERIES_TICKERS`
- `SCHEDULED_HISTORICAL_LOOKBACK_DAYS`
- `SCHEDULED_HISTORICAL_MAX_SERIES`
- `SCHEDULED_HISTORICAL_MAX_MARKETS_PER_SERIES`
- `STRATEGY_OPTIMIZER_MAX_RUNS`
- `STRATEGY_OPTIMIZER_MIN_EDGE_GRID`
- `STRATEGY_OPTIMIZER_MIN_LIQUIDITY_GRID`
- `STRATEGY_OPTIMIZER_MAX_SPREAD_GRID`
- `STRATEGY_OPTIMIZER_SLIPPAGE_CENTS_GRID`
- `STRATEGY_OPTIMIZER_SELECTION_GRID`

The dataset export includes:

- `historical_kalshi_markets`
- `kalshi_market_candlesticks`
- `kalshi_market_trades`
- `strategy_versions`
- `strategy_optimization_runs`
- replay-enriched backtest strategy runs

## Vercel

Vercel is a good fit for the `apps/web` Next.js dashboard and preview deployments. Keep the Fastify API, background worker, and Postgres-backed historical sync on Render unless the API is intentionally refactored into request-scoped functions.

Recommended split:

- Render: `forecastedge-api`, background polling, Postgres, historical sync/backtest data persistence.
- Vercel: `apps/web`, with `FORECASTEDGE_API_URL=https://forecastedge-api.onrender.com` and the same `FORECASTEDGE_API_TOKEN` used by the API.

Do not move only one app's base URL or routing without verifying the shared production domain still serves the other app paths.

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
