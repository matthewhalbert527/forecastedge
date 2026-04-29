"use client";

import {
  AlertTriangle,
  BarChart3,
  BriefcaseBusiness,
  ChevronDown,
  CircleHelp,
  Clock3,
  Database,
  Download,
  Gauge,
  Play,
  RefreshCw,
  ShoppingCart,
  ThermometerSun,
  Trophy
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";

type DashboardData = {
  mode: "watch" | "paper" | "demo" | "live";
  locations: Array<{ id: string; city: string; state: string; pollingIntervalMinutes: number }>;
  forecastDeltas: Array<{ id: string; city: string; state: string; variable: string; targetDate: string; oldValue: number; newValue: number; absoluteChange: number; confidence: string; reason: string; createdAt: string }>;
  markets: Array<{ ticker: string; eventTicker: string; title: string; subtitle?: string | null; closeTime?: string | null; settlementTime?: string | null; yesBid: number | null; yesAsk: number | null; noBid?: number | null; noAsk?: number | null; lastPrice?: number | null; volume: number | null; openInterest: number | null; rawPayload?: unknown }>;
  mappings: Array<{ marketTicker: string; title: string; variable: string; threshold: number | null; thresholdOperator: string; targetDate: string | null; confidence: string; accepted: boolean; reviewReason: string | null; liquidityScore: number; location: { city: string; state?: string } | null; station: { stationId: string; stationName: string } | null; settlementSource: string }>;
  signals: Array<{ id: string; marketTicker: string; status: string; edge: number; limitPrice: number; contracts: number; explanation: string; skipReason: string | null; createdAt: string }>;
  paperOrders: Array<{ id: string; marketTicker: string; side: string; action: string; requestedContracts: number; limitPrice: number; status: string; filledContracts: number; unfilledContracts: number; simulatedAvgFillPrice: number | null; reason: string; timestamp: string }>;
  paperPositions: Array<{ id: string; marketTicker: string; side: string; contracts: number; avgEntryPrice: number; realizedPnl: number; markPrice: number | null; openedAt: string; closedAt: string | null; settlementId: string | null }>;
  settlements: Array<{ id: string; marketTicker: string; result: string; settledPrice: number; source: string; rawPayload?: unknown; createdAt: string }>;
  trainingCandidates: Array<{ id: string; marketTicker: string; title: string; city: string | null; stationId: string | null; variable: string; targetDate: string | null; threshold: number | null; thresholdOperator: string; forecastValue: number | null; entryPrice: number | null; yesProbability: number | null; impliedProbability: number | null; edge: number | null; spread: number | null; liquidityScore: number; status: "WOULD_BUY" | "WATCH" | "BLOCKED"; blockers: string[]; settlementResult: string | null; counterfactualPnl: number | null; reason: string; createdAt: string }>;
  modelForecasts: Array<{ id: string; city: string; state: string; stationId: string | null; model: string; targetDate: string; horizonHours: number; highTempF: number | null; lowTempF: number | null; precipitationAmountIn: number | null; windGustMph: number | null; confidence: string; createdAt: string }>;
  ensembles: Array<{ id: string; city: string; state: string; stationId: string | null; targetDate: string; variable: string; prediction: number | null; uncertaintyStdDev: number | null; confidence: string; contributingModels: string[]; disagreement: number | null; reason: string; createdAt: string }>;
  performance: { totalTrades: number; simulatedContracts: number; averageEntryPrice: number; totalCost: number; rejectedOrders: number; realizedPnl: number; unrealizedExposure: number; winRate: number; roi: number; maxDrawdown: number; longestLosingStreak: number; settledTrades: number; openPositions: number };
  learning?: {
    collection: { quoteSnapshots: number; candidateSnapshots: number; paperTradeExamples: number; settledPaperTradeExamples: number; scanReports?: number; fullScans?: number; quoteRefreshScans?: number; historicalMarkets?: number; historicalCandlesticks?: number; historicalTrades?: number; latestQuoteAt: string | null; latestCandidateAt: string | null; latestFullScanAt?: string | null; latestQuoteRefreshAt?: string | null };
    backtest: BacktestSummary;
    recentPaperExamples: Array<{ orderId: string; marketTicker: string; openedAt: string; status: string; entryPrice: number | null; contracts: number; cost: number; modelProbability: number | null; impliedProbability: number | null; edge: number | null; settlementResult: string | null; pnl: number | null; roi: number | null }>;
  };
  scanReports: Array<{
    id: string;
    startedAt: string;
    completedAt: string | null;
    status: string;
    trigger: string;
    providerResults: Array<{ provider: string; locationId?: string; status: string; message: string; stationId?: string }>;
    counts: {
      forecastSnapshots: number;
      stationObservations: number;
      forecastDeltas: number;
      marketsDiscovered: number;
      mappingsAccepted: number;
      mappingsRejected: number;
      signalsFired: number;
      signalsSkipped: number;
      paperOrders: number;
      trainingCandidates?: number;
      modelForecasts: number;
      ensembles: number;
    };
    decisions: Array<{ stage: string; itemId: string; status: string; reason: string }>;
  }>;
  safety: { liveTradingEnabled: boolean; killSwitchEnabled: boolean; requireManualConfirmation: boolean; demoConfigured: boolean; prodCredentialConfigured: boolean };
  riskLimits?: { maxStakePerTrade: number; maxDailyTrades: number; maxOpenExposure: number; maxOpenPositions: number; maxContractsPerTrade: number };
  backgroundWorker?: {
    enabled: boolean;
    running: boolean;
    intervalMinutes: number;
    lastRunAt: string | null;
    quoteRefresh?: { enabled: boolean; running: boolean; intervalMinutes: number; lastRunAt: string | null };
  };
};

type BacktestSummary = {
  method: string;
  parameters?: BacktestParameters;
  candidateSnapshots: number;
  eligibleSnapshots?: number;
  evaluatedMarkets: number;
  wins: number;
  losses: number;
  winRate: number;
  totalCost: number;
  totalPayout: number;
  totalPnl: number;
  roi: number;
  averageEntryPrice?: number | null;
  averageEdge?: number | null;
  averageLiquidityScore?: number | null;
  profitFactor?: number | null;
  maxDrawdown?: number;
  equityCurve?: Array<{ observedAt: string; equity: number; pnl: number }>;
  longestLosingStreak?: number;
  trades?: BacktestTrade[];
};

type BacktestParameters = {
  selection: "first_signal" | "best_edge" | "each_signal";
  status: string;
  minEdge: number | null;
  maxEntryPrice: number | null;
  minLiquidityScore: number | null;
  maxSpread: number | null;
  stakePerTrade: number;
  maxContracts: number;
  slippageCents: number;
  startDate: string | null;
  endDate: string | null;
};

type BacktestTrade = {
  marketTicker: string;
  observedAt: string;
  status: string;
  entryPrice: number;
  rawEntryPrice?: number;
  entrySource?: string;
  slippageCents?: number;
  contracts: number;
  cost: number;
  payout: number;
  pnl: number;
  roi: number;
  edge: number | null;
  modelProbability: number | null;
  impliedProbability: number | null;
  spread: number | null;
  liquidityScore: number;
  settlementResult: string;
  priceBefore?: number | null;
  priceAfter?: number | null;
  maxPriceAfter?: number | null;
  minPriceAfter?: number | null;
  impliedProbabilityMove?: number | null;
};

type View = "cockpit" | "buy" | "holdings" | "results" | "backtest" | "details";
type BusyAction = "scan" | "buy" | "settle" | "backtest" | null;

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? process.env.WEB_PUBLIC_API_URL ?? "http://localhost:4000";

const emptyPerformance: DashboardData["performance"] = {
  totalTrades: 0,
  simulatedContracts: 0,
  averageEntryPrice: 0,
  totalCost: 0,
  rejectedOrders: 0,
  realizedPnl: 0,
  unrealizedExposure: 0,
  winRate: 0,
  roi: 0,
  maxDrawdown: 0,
  longestLosingStreak: 0,
  settledTrades: 0,
  openPositions: 0
};

const navItems: Array<{ key: View; label: string; icon: typeof Gauge }> = [
  { key: "cockpit", label: "Overview", icon: Gauge },
  { key: "buy", label: "Buy", icon: ShoppingCart },
  { key: "holdings", label: "Holdings", icon: BriefcaseBusiness },
  { key: "results", label: "Results", icon: Trophy },
  { key: "backtest", label: "Backtest", icon: BarChart3 },
  { key: "details", label: "Details", icon: Database }
];

export default function Page() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [view, setView] = useState<View>("cockpit");
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [buyingTicker, setBuyingTicker] = useState<string | null>(null);
  const [backtest, setBacktest] = useState<BacktestSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`${apiUrl}/api/dashboard`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
    setData(await response.json());
  }

  async function runAction(action: BusyAction, endpoint: string) {
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiUrl}${endpoint}`, { method: "POST" });
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      await response.json().catch(() => null);
      await refresh();
      if (action === "buy") setView("holdings");
      if (action === "settle") setView("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown request error");
    } finally {
      setBusyAction(null);
    }
  }

  async function buyOne(marketTicker: string) {
    setBuyingTicker(marketTicker);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiUrl}/api/quotes/buy-one`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketTicker })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const apiError = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `Request failed with ${response.status}`;
        throw new Error(apiError);
      }
      await refresh();
      if (body && typeof body === "object" && "bought" in body && (body as { bought?: boolean }).bought) {
        setNotice(`Bought ${marketTicker} in paper mode.`);
        setView("holdings");
      } else {
        const reason = body && typeof body === "object" && "reason" in body ? String((body as { reason?: unknown }).reason) : "No paper order was created.";
        setNotice(reason);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown request error");
    } finally {
      setBuyingTicker(null);
    }
  }

  async function runBacktest(parameters: BacktestParameters) {
    setBusyAction("backtest");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiUrl}/api/backtests/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parameters)
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`Backtest failed with ${response.status}`);
      const summary = body && typeof body === "object" && "summary" in body ? (body as { summary: BacktestSummary }).summary : null;
      if (!summary) throw new Error("Backtest response did not include a summary");
      setBacktest(summary);
      setNotice(`Backtest evaluated ${summary.evaluatedMarkets} settled markets.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown backtest error");
    } finally {
      setBusyAction(null);
    }
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Unable to load dashboard"));
    const timer = window.setInterval(() => refresh().catch(() => undefined), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const model = useDashboardModel(data);
  const latestScan = data?.scanReports[0] ?? null;
  const scanVerdict = latestScan ? scanHealth(latestScan) : { label: "Waiting", tone: "watch" as const };
  const performance = { ...emptyPerformance, ...(data?.performance ?? {}) };
  const worker = data?.backgroundWorker;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><ThermometerSun size={20} /></div>
          <div>
            <h1>ForecastEdge</h1>
            <p>Paper trading</p>
          </div>
        </div>
        <nav className="nav" aria-label="Primary">
          {navItems.map(({ key, label, icon: Icon }) => (
            <button key={key} className={view === key ? "active" : ""} onClick={() => setView(key)}>
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <StatusDot tone={data?.safety?.killSwitchEnabled ? "watch" : "good"} label={data?.safety?.killSwitchEnabled ? "Paper safe" : "Ready"} />
          <span>{worker?.quoteRefresh?.enabled ? `Quotes every ${worker.quoteRefresh.intervalMinutes} min` : "Quote refresh idle"}</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{data?.mode ?? "paper"} mode</p>
            <h2>Paper trading cockpit</h2>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" onClick={() => runAction("scan", "/api/run-once")} disabled={busyAction !== null}>
              <RefreshCw size={16} />
              {busyAction === "scan" ? "Scanning" : "Full scan"}
            </button>
            <button className="ghost-button" onClick={() => runAction("settle", "/api/settlements/run-once")} disabled={busyAction !== null}>
              <Clock3 size={16} />
              {busyAction === "settle" ? "Checking" : "Check results"}
            </button>
            <button className="buy-button" onClick={() => runAction("buy", "/api/quotes/refresh-once")} disabled={busyAction !== null || model.strong.length === 0}>
              <ShoppingCart size={17} />
              {busyAction === "buy" ? "Buying" : "Buy strongest paper bets"}
            </button>
          </div>
        </header>

        {error ? <div className="alert"><AlertTriangle size={18} /> {error}</div> : null}
        {notice ? <div className="notice">{notice}</div> : null}
        {!data ? <div className="loading">Loading ForecastEdge from {apiUrl}</div> : null}

        {data ? (
          <>
            <section className="health-strip">
              <StatusDot tone={scanVerdict.tone} label={scanVerdict.label} />
              <span>{latestScan ? `${labelForTrigger(latestScan.trigger)} at ${time(latestScan.startedAt)}` : "No scan yet"}</span>
              <span>{model.strong.length} strong buys</span>
              <span>{model.openPositions.length} held</span>
            </section>

            {view === "cockpit" ? (
              <CockpitView
                model={model}
                performance={performance}
                buyAction={() => runAction("buy", "/api/quotes/refresh-once")}
                buyBusy={busyAction === "buy"}
              />
            ) : null}

            {view === "buy" ? <BuyView candidates={model.strong} watch={model.watch} heldStrongCount={model.heldStrong.length} riskBlockedStrongCount={model.riskBlockedStrong.length} buyAction={() => runAction("buy", "/api/quotes/refresh-once")} buyOne={buyOne} busy={busyAction === "buy"} buyingTicker={buyingTicker} /> : null}
            {view === "holdings" ? <HoldingsView positions={model.openPositions} /> : null}
            {view === "results" ? <ResultsView results={model.results} performance={performance} settleAction={() => runAction("settle", "/api/settlements/run-once")} busy={busyAction === "settle"} /> : null}
            {view === "backtest" ? <BacktestView latest={backtest ?? data.learning?.backtest ?? null} runBacktest={runBacktest} busy={busyAction === "backtest"} /> : null}
            {view === "details" ? <DetailsView data={data} model={model} /> : null}
          </>
        ) : null}
      </section>
    </main>
  );
}

function CockpitView({ model, performance, buyAction, buyBusy }: { model: DashboardModel; performance: DashboardData["performance"]; buyAction: () => void; buyBusy: boolean }) {
  const unavailableStrongText = unavailableStrongSummary(model);
  return (
    <section className="page-grid">
      <div className="hero-panel">
        <div>
          <h3>{model.strong.length > 0 ? `${model.strong.length} buyable model-approved bets` : unavailableStrongText ? "Strong bets unavailable" : "No buyable model-approved bets"}</h3>
          <p>{model.strong[0] ? `${model.strong[0].marketTicker} leads the buy board at ${formatPct(model.strong[0].edge)} edge.` : unavailableStrongText ?? "The next quote refresh will update the buy board."}</p>
        </div>
        <button className="buy-button large" onClick={buyAction} disabled={buyBusy || model.strong.length === 0}>
          <ShoppingCart size={18} />
          {buyBusy ? "Buying" : "Buy strongest paper bets"}
        </button>
      </div>

      <Metric label="Strong buys" value={model.strong.length} detail={`${model.watch.length} watch${model.heldStrong.length > 0 ? `, ${model.heldStrong.length} held` : ""}${model.riskBlockedStrong.length > 0 ? `, ${model.riskBlockedStrong.length} risk-blocked` : ""}`} />
      <Metric label="Open holdings" value={model.openPositions.length} detail={`${money(model.openCost)} at risk`} />
      <Metric label="Max payout" value={money(model.maxOpenPayout)} detail={`${model.openContracts} contracts`} />
      <Metric label="Settled P/L" value={money(model.realizedPnl)} detail={`${model.results.length || performance.settledTrades} settled`} />

      <Panel title="Best bets">
        <CandidateList candidates={model.strong.slice(0, 5)} empty="No strong paper buys right now" />
      </Panel>
      <Panel title="Currently held">
        <HoldingList positions={model.openPositions.slice(0, 5)} />
      </Panel>
      <Panel title="Recent results">
        <ResultList results={model.results.slice(0, 4)} />
      </Panel>
    </section>
  );
}

function unavailableStrongSummary(model: DashboardModel) {
  if (model.strong.length > 0) return null;
  const parts = [];
  if (model.heldStrong.length > 0) parts.push(`${model.heldStrong.length} already held`);
  if (model.riskBlockedStrong.length > 0) parts.push(`${model.riskBlockedStrong.length} blocked by risk limits`);
  return parts.length > 0 ? `Model still sees strong signals, but ${parts.join(" and ")}.` : null;
}

function BuyView({ candidates, watch, heldStrongCount, riskBlockedStrongCount, buyAction, buyOne, busy, buyingTicker }: { candidates: CandidateView[]; watch: CandidateView[]; heldStrongCount: number; riskBlockedStrongCount: number; buyAction: () => void; buyOne: (marketTicker: string) => void; busy: boolean; buyingTicker: string | null }) {
  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h3>Buy board</h3>
          <p>{candidates.length} buyable bets currently clear the model threshold{heldStrongCount > 0 ? `; ${heldStrongCount} strong signals are already held` : ""}{riskBlockedStrongCount > 0 ? `; ${riskBlockedStrongCount} are risk-blocked` : ""}.</p>
        </div>
        <button className="buy-button" onClick={buyAction} disabled={busy || candidates.length === 0}>
          <Play size={16} />
          {busy ? "Buying" : "Buy strongest paper bets"}
        </button>
      </div>
      <StrategyPanel />
      <CandidateList candidates={candidates} empty="No strong buys right now" expanded onBuy={buyOne} buyingTicker={buyingTicker} />
      <Disclosure title={`Watch list (${watch.length})`}>
        <CandidateList candidates={watch} empty="No positive-edge watch items" compact />
      </Disclosure>
    </section>
  );
}

function HoldingsView({ positions }: { positions: HoldingView[] }) {
  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h3>Holdings</h3>
          <p>{positions.length} paper positions waiting for final outcome.</p>
        </div>
      </div>
      <HoldingList positions={positions} expanded />
    </section>
  );
}

function ResultsView({ results, performance, settleAction, busy }: { results: ResultView[]; performance: DashboardData["performance"]; settleAction: () => void; busy: boolean }) {
  return (
    <section className="stack">
      <div className="section-head">
        <div>
          <h3>Results</h3>
          <p>{money(performance.realizedPnl)} settled paper P/L.</p>
        </div>
        <button className="ghost-button" onClick={settleAction} disabled={busy}>
          <Clock3 size={16} />
          {busy ? "Checking" : "Check results"}
        </button>
      </div>
      <ResultList results={results} expanded />
    </section>
  );
}

function BacktestView({ latest, runBacktest, busy }: { latest: BacktestSummary | null; runBacktest: (parameters: BacktestParameters) => void; busy: boolean }) {
  const [selection, setSelection] = useState<BacktestParameters["selection"]>(latest?.parameters?.selection ?? "first_signal");
  const [minEdge, setMinEdge] = useState(latest?.parameters?.minEdge !== null && latest?.parameters?.minEdge !== undefined ? String(latest.parameters.minEdge) : "0.05");
  const [maxEntryPrice, setMaxEntryPrice] = useState(latest?.parameters?.maxEntryPrice !== null && latest?.parameters?.maxEntryPrice !== undefined ? String(latest.parameters.maxEntryPrice) : "");
  const [minLiquidityScore, setMinLiquidityScore] = useState(latest?.parameters?.minLiquidityScore !== null && latest?.parameters?.minLiquidityScore !== undefined ? String(latest.parameters.minLiquidityScore) : "");
  const [maxSpread, setMaxSpread] = useState(latest?.parameters?.maxSpread !== null && latest?.parameters?.maxSpread !== undefined ? String(latest.parameters.maxSpread) : "");
  const [stakePerTrade, setStakePerTrade] = useState(String(latest?.parameters?.stakePerTrade ?? 5));
  const [maxContracts, setMaxContracts] = useState(String(latest?.parameters?.maxContracts ?? 10));
  const [slippageCents, setSlippageCents] = useState(String(latest?.parameters?.slippageCents ?? 1));
  const [startDate, setStartDate] = useState(latest?.parameters?.startDate ?? "");
  const [endDate, setEndDate] = useState(latest?.parameters?.endDate ?? "");
  const [syncTickers, setSyncTickers] = useState("");
  const [syncSeries, setSyncSeries] = useState("KXHIGHCHI");
  const [syncSource, setSyncSource] = useState<"historical" | "live">("historical");
  const [syncStartDate, setSyncStartDate] = useState("");
  const [syncEndDate, setSyncEndDate] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runBacktest({
      selection,
      status: "WOULD_BUY",
      minEdge: formNumber(minEdge),
      maxEntryPrice: formNumber(maxEntryPrice),
      minLiquidityScore: formNumber(minLiquidityScore),
      maxSpread: formNumber(maxSpread),
      stakePerTrade: formNumber(stakePerTrade) ?? 5,
      maxContracts: formNumber(maxContracts) ?? 10,
      slippageCents: formNumber(slippageCents) ?? 1,
      startDate: startDate || null,
      endDate: endDate || null
    });
  }

  async function syncHistorical(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSyncing(true);
    setSyncNotice(null);
    try {
      const response = await fetch(`${apiUrl}/api/historical/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickers: syncTickers,
          seriesTicker: syncSeries,
          source: syncSource,
          startTs: dateToEpochSeconds(syncStartDate, false),
          endTs: dateToEpochSeconds(syncEndDate, true),
          periodInterval: 60,
          includeTrades: true,
          includeCandlesticks: true,
          maxPages: 5
        })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `Sync failed with ${response.status}`;
        throw new Error(message);
      }
      const result = body as { markets?: number; tickers?: number; candlesticks?: number; trades?: number };
      setSyncNotice(`Synced ${result.tickers ?? 0} tickers, ${result.candlesticks ?? 0} candles, ${result.trades ?? 0} trades.`);
    } catch (err) {
      setSyncNotice(err instanceof Error ? err.message : "Historical sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="stack details-stack">
      <div className="section-head">
        <div>
          <h3>Backtest lab</h3>
          <p>{latest ? `${latest.method}; ${latest.evaluatedMarkets} settled trades evaluated.` : "Run candidate snapshots against settled market outcomes."}</p>
        </div>
      </div>

      <form className="backtest-controls sync-controls" onSubmit={syncHistorical}>
        <label>
          Tickers
          <input value={syncTickers} onChange={(event) => setSyncTickers(event.target.value)} placeholder="comma-separated or blank" />
        </label>
        <label>
          Series
          <input value={syncSeries} onChange={(event) => setSyncSeries(event.target.value.toUpperCase())} placeholder="KXHIGHCHI" />
        </label>
        <label>
          Source
          <select value={syncSource} onChange={(event) => setSyncSource(event.target.value as "historical" | "live")}>
            <option value="historical">Historical</option>
            <option value="live">Live/recent</option>
          </select>
        </label>
        <label>
          From
          <input type="date" value={syncStartDate} onChange={(event) => setSyncStartDate(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={syncEndDate} onChange={(event) => setSyncEndDate(event.target.value)} />
        </label>
        <button className="ghost-button" disabled={syncing}>
          <RefreshCw size={16} />
          {syncing ? "Syncing" : "Sync history"}
        </button>
        {syncNotice ? <span className="form-note">{syncNotice}</span> : null}
      </form>

      <form className="backtest-controls" onSubmit={submit}>
        <label>
          Selection
          <select value={selection} onChange={(event) => setSelection(event.target.value as BacktestParameters["selection"])}>
            <option value="first_signal">First signal per market</option>
            <option value="best_edge">Best edge per market</option>
            <option value="each_signal">Every eligible signal</option>
          </select>
        </label>
        <label>
          Min edge
          <input inputMode="decimal" value={minEdge} onChange={(event) => setMinEdge(event.target.value)} placeholder="0.05" />
        </label>
        <label>
          Max entry
          <input inputMode="decimal" value={maxEntryPrice} onChange={(event) => setMaxEntryPrice(event.target.value)} placeholder="optional" />
        </label>
        <label>
          Min liquidity
          <input inputMode="decimal" value={minLiquidityScore} onChange={(event) => setMinLiquidityScore(event.target.value)} placeholder="optional" />
        </label>
        <label>
          Max spread
          <input inputMode="decimal" value={maxSpread} onChange={(event) => setMaxSpread(event.target.value)} placeholder="optional" />
        </label>
        <label>
          Stake
          <input inputMode="decimal" value={stakePerTrade} onChange={(event) => setStakePerTrade(event.target.value)} />
        </label>
        <label>
          Max contracts
          <input inputMode="numeric" value={maxContracts} onChange={(event) => setMaxContracts(event.target.value)} />
        </label>
        <label>
          Slippage
          <input inputMode="decimal" value={slippageCents} onChange={(event) => setSlippageCents(event.target.value)} />
        </label>
        <label>
          From
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <button className="buy-button" disabled={busy}>
          <Play size={16} />
          {busy ? "Running" : "Run backtest"}
        </button>
      </form>

      {latest ? (
        <>
          <section className="page-grid">
            <Metric label="Trades" value={latest.evaluatedMarkets} detail={`${latest.eligibleSnapshots ?? latest.candidateSnapshots} eligible snapshots`} />
            <Metric label="Win rate" value={formatPct(latest.winRate)} detail={`${latest.wins} wins, ${latest.losses} losses`} />
            <Metric label="P/L" value={money(latest.totalPnl)} detail={`${formatPct(latest.roi)} ROI`} />
            <Metric label="Drawdown" value={money(latest.maxDrawdown ?? 0)} detail={`${latest.longestLosingStreak ?? 0} longest loss streak`} />
            <Metric label="Avg edge" value={formatPct(latest.averageEdge ?? null)} detail={`Avg entry ${price(latest.averageEntryPrice ?? null)}`} />
            <Metric label="Liquidity" value={latest.averageLiquidityScore === null || latest.averageLiquidityScore === undefined ? "n/a" : latest.averageLiquidityScore.toFixed(3)} detail={`Profit factor ${latest.profitFactor === null || latest.profitFactor === undefined ? "n/a" : latest.profitFactor.toFixed(2)}`} />
          </section>
          <section className="chart-grid">
            <MiniLineChart title="Equity curve" points={(latest.equityCurve ?? []).map((point) => point.equity)} format={money} />
            <MiniLineChart title="Implied probability move" points={(latest.trades ?? []).slice().reverse().map((trade) => trade.impliedProbabilityMove ?? 0)} format={formatPct} />
          </section>
          <Disclosure title="Recent simulated trades">
            <SimpleTable
              columns={["Time", "Ticker", "Entry", "Contracts", "Move", "Result", "P/L"]}
              rows={(latest.trades ?? []).slice(0, 30).map((trade) => [
                dateTime(trade.observedAt),
                trade.marketTicker,
                `${price(trade.entryPrice)} ${trade.entrySource ? `(${trade.entrySource}${trade.slippageCents ? ` +${trade.slippageCents}c` : ""})` : ""}`,
                String(trade.contracts),
                formatPct(trade.impliedProbabilityMove ?? null),
                trade.settlementResult,
                money(trade.pnl)
              ])}
              empty="No settled trades matched this backtest"
            />
          </Disclosure>
        </>
      ) : <EmptyState>No backtest has run yet</EmptyState>}
    </section>
  );
}

function DetailsView({ data, model }: { data: DashboardData; model: DashboardModel }) {
  const latestScan = (data.scanReports ?? [])[0] ?? null;
  const learning = data.learning ?? null;
  return (
    <section className="stack details-stack">
      <div className="section-head">
        <div>
          <h3>Technical details</h3>
          <p>Backend data is collapsed by default. Dataset download streams every saved scan row.</p>
        </div>
        <a className="ghost-button" href={`${apiUrl}/api/dataset/export`}>
          <Download size={16} />
          Download dataset
        </a>
      </div>
      <Disclosure title="Model candidates">
        <SimpleTable
          columns={["Ticker", "Status", "Forecast", "Ask", "Edge", "Reason"]}
          rows={(data.trainingCandidates ?? []).slice(0, 60).map((candidate) => [
            candidate.marketTicker,
            statusLabel(candidate.status),
            forecastText(candidate),
            price(candidate.entryPrice),
            formatPct(candidate.edge),
            candidate.reason
          ])}
          empty="No candidates"
        />
      </Disclosure>
      <Disclosure title="Latest scan">
        <SimpleTable
          columns={["Metric", "Value"]}
          rows={latestScan ? Object.entries(latestScan.counts).map(([key, value]) => [labelize(key), String(value)]) : []}
          empty="No scan report"
        />
      </Disclosure>
      <Disclosure title="Provider checks">
        <SimpleTable
          columns={["Provider", "Status", "Message"]}
          rows={(latestScan?.providerResults ?? []).map((item) => [item.provider, item.status, item.message])}
          empty="No provider checks"
        />
      </Disclosure>
      <Disclosure title="Signals and orders">
        <SimpleTable
          columns={["Time", "Ticker", "Status", "Edge", "Reason"]}
          rows={(data.signals ?? []).slice(0, 80).map((signal) => [time(signal.createdAt), signal.marketTicker, signal.status, formatPct(signal.edge), signal.skipReason ?? signal.explanation])}
          empty="No signals"
        />
      </Disclosure>
      <Disclosure title="Learning database">
        <SimpleTable
          columns={["Metric", "Value"]}
          rows={learning ? [
            ["Quote snapshots", String(learning.collection.quoteSnapshots)],
            ["Candidate decisions", String(learning.collection.candidateSnapshots)],
            ["Paper trade examples", String(learning.collection.paperTradeExamples)],
            ["Settled examples", String(learning.collection.settledPaperTradeExamples)],
            ["All scan reports", String(learning.collection.scanReports ?? 0)],
            ["Full scans", String(learning.collection.fullScans ?? 0)],
            ["1-minute quote scans", String(learning.collection.quoteRefreshScans ?? 0)],
            ["Historical markets", String(learning.collection.historicalMarkets ?? 0)],
            ["Historical candles", String(learning.collection.historicalCandlesticks ?? 0)],
            ["Historical trades", String(learning.collection.historicalTrades ?? 0)],
            ["Latest quote", learning.collection.latestQuoteAt ? dateTime(learning.collection.latestQuoteAt) : "pending"],
            ["Latest candidate", learning.collection.latestCandidateAt ? dateTime(learning.collection.latestCandidateAt) : "pending"],
            ["Latest full scan", learning.collection.latestFullScanAt ? dateTime(learning.collection.latestFullScanAt) : "pending"],
            ["Latest quote scan", learning.collection.latestQuoteRefreshAt ? dateTime(learning.collection.latestQuoteRefreshAt) : "pending"]
          ] : []}
          empty="No learning data yet"
        />
      </Disclosure>
      <Disclosure title="Backtest snapshot">
        <SimpleTable
          columns={["Method", "Trades", "Wins", "P/L", "ROI"]}
          rows={learning ? [[
            learning.backtest.method,
            String(learning.backtest.evaluatedMarkets),
            `${learning.backtest.wins}/${learning.backtest.losses}`,
            money(learning.backtest.totalPnl),
            formatPct(learning.backtest.roi)
          ]] : []}
          empty="No settled backtest sample yet"
        />
      </Disclosure>
      <Disclosure title="Paper training examples">
        <SimpleTable
          columns={["Time", "Ticker", "Status", "Contracts", "Edge", "P/L"]}
          rows={(learning?.recentPaperExamples ?? []).slice(0, 30).map((example) => [
            dateTime(example.openedAt),
            example.marketTicker,
            example.status,
            String(example.contracts),
            formatPct(example.edge),
            moneyOrPending(example.pnl)
          ])}
          empty="No paper training examples yet"
        />
      </Disclosure>
      <Disclosure title="Locations and mappings">
        <SimpleTable
          columns={["Market", "City", "Target", "Liquidity", "Status"]}
          rows={(data.mappings ?? []).slice(0, 80).map((mapping) => [mapping.marketTicker, mapping.location ? `${mapping.location.city}, ${mapping.location.state ?? ""}` : "unknown", mappingLine(mapping), mapping.liquidityScore.toFixed(3), mapping.accepted ? "accepted" : mapping.reviewReason ?? "review"])}
          empty="No mappings"
        />
      </Disclosure>
      <div className="quiet-summary">
        <span>{model.strong.length} strong</span>
        <span>{model.watch.length} watch</span>
        <span>{(data.markets ?? []).length} markets</span>
        <span>{(data.ensembles ?? []).length} forecasts</span>
        <span>{learning?.collection.quoteSnapshots ?? 0} quote snapshots</span>
        <span>{learning?.collection.scanReports ?? (data.scanReports ?? []).length} scans</span>
      </div>
    </section>
  );
}

function StrategyPanel() {
  return (
    <section className="strategy-panel" aria-label="Paper trading context">
      <div>
        <strong>Strong is a signal, not a guarantee.</strong>
        <p>Use paper results to learn the hit rate before treating a model-approved bet as live-trade worthy.</p>
      </div>
      <div>
        <strong>Size is capped by risk rules.</strong>
        <p>The API sizes each paper order from the max paper stake and current ask, then caps it at the per-trade contract limit. Ten contracts is the cap, not always the target.</p>
      </div>
      <div>
        <strong>Bulk or single bet.</strong>
        <p>Bulk buy attempts the strongest candidates. Row-level Buy refreshes that market and only fills it if it still passes the model.</p>
      </div>
    </section>
  );
}

function CandidateList({ candidates, empty, expanded = false, compact = false, onBuy, buyingTicker }: { candidates: CandidateView[]; empty: string; expanded?: boolean; compact?: boolean; onBuy?: (marketTicker: string) => void; buyingTicker?: string | null }) {
  if (candidates.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className={compact ? "candidate-list compact" : "candidate-list"}>
      {candidates.map((candidate) => (
        <article className="bet-row" key={candidate.marketTicker}>
          <div className="bet-main">
            <strong>{candidate.displayName}</strong>
            <span>{candidate.marketTicker}</span>
          </div>
          <div className="bet-facts">
            <Fact label="Forecast" value={candidate.forecast} help="The model forecast compared with the market line." />
            <Fact label="Ask" value={price(candidate.entryPrice)} help="The current YES ask used as the simulated entry price." />
            <Fact label="Edge" value={formatPct(candidate.edge)} good={candidate.status === "WOULD_BUY"} help="Model probability minus market-implied probability." />
            <Fact label="Model" value={formatPct(candidate.yesProbability)} help="The model's estimated chance that YES wins." />
            {expanded ? <Fact label="Target" value={candidate.target} help="The temperature line this market resolves against." /> : null}
            {expanded ? <Fact label="Expires" value={candidate.expiresAt} help="Last trading time for this Kalshi market when available." /> : null}
            {expanded ? <Fact label="Left" value={candidate.timeToExpiration} help="Approximate time until market close." /> : null}
          </div>
          <div className="bet-action">
            <StatusPill tone={candidate.status === "WOULD_BUY" ? "good" : candidate.status === "WATCH" ? "watch" : "neutral"}>{candidate.status === "WOULD_BUY" ? "Strong" : candidate.status === "WATCH" ? "Watch" : "Blocked"}</StatusPill>
            {onBuy ? (
              <button className="mini-buy-button" onClick={() => onBuy(candidate.marketTicker)} disabled={buyingTicker !== null}>
                <ShoppingCart size={14} />
                {buyingTicker === candidate.marketTicker ? "Buying" : "Buy"}
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function HoldingList({ positions, expanded = false }: { positions: HoldingView[]; expanded?: boolean }) {
  if (positions.length === 0) return <EmptyState>No paper holdings yet</EmptyState>;
  return (
    <div className="timeline-list">
      {positions.map((position) => (
        <article className="timeline-row" key={position.id}>
          <div className="timeline-dot" />
          <div className="timeline-content">
            <div className="row-title">
              <strong>{position.displayName}</strong>
              <StatusPill tone="good">Held</StatusPill>
            </div>
            <div className="fact-grid">
              <Fact label="Entry" value={price(position.avgEntryPrice)} help="Average simulated fill price per YES contract." />
              <Fact label="Current" value={moneyOrPending(position.currentValue)} help="Estimated exit value using the current YES bid when available." />
              <Fact label="P/L" value={moneyOrPending(position.unrealizedPnl)} good={(position.unrealizedPnl ?? 0) > 0} danger={(position.unrealizedPnl ?? 0) < 0} help="Current value minus entry cost; unrealized until settlement." />
              <Fact label="Expires" value={position.expiresAt} help="Last trading time for this market when available." />
              <Fact label="Left" value={position.timeToExpiration} help="Approximate time until market close." />
              {expanded ? <Fact label="Contracts" value={position.contracts} help="Number of paper YES contracts currently held." /> : null}
              {expanded ? <Fact label="Cost" value={money(position.cost)} help="Entry price times filled contracts." /> : null}
              {expanded ? <Fact label="Max payout" value={money(position.maxPayout)} help="Gross payout if every YES contract settles at $1." /> : null}
              {expanded ? <Fact label="Target" value={position.target} help="The weather line this market resolves against." /> : null}
              {expanded ? <Fact label="Opened" value={dateTime(position.openedAt)} help="When the paper order filled." /> : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function ResultList({ results, expanded = false }: { results: ResultView[]; expanded?: boolean }) {
  if (results.length === 0) return <EmptyState>No settled paper results yet</EmptyState>;
  return (
    <div className="result-list">
      {results.map((result) => (
        <article className="result-row" key={result.id}>
          <div>
            <div className="row-title">
              <strong>{result.displayName}</strong>
              <StatusPill tone={result.net >= 0 ? "good" : "danger"}>{result.net >= 0 ? "Won" : "Lost"}</StatusPill>
            </div>
            <span className="row-subtitle">{result.marketTicker}</span>
          </div>
          <div className="result-facts">
            <Fact label="Final temp" value={result.finalTemperature} />
            <Fact label="Outcome" value={result.result} />
            <Fact label="Cost" value={money(result.cost)} />
            <Fact label="Payout" value={money(result.payout)} />
            <Fact label="Net" value={money(result.net)} good={result.net >= 0} danger={result.net < 0} />
            {expanded ? <Fact label="Closed" value={dateTime(result.closedAt)} /> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function MiniLineChart({ title, points, format }: { title: string; points: number[]; format: (value: number) => string }) {
  const width = 420;
  const height = 130;
  const min = points.length > 0 ? Math.min(...points) : 0;
  const max = points.length > 0 ? Math.max(...points) : 0;
  const spread = max - min || 1;
  const path = points.map((point, index) => {
    const x = points.length <= 1 ? 0 : (index / (points.length - 1)) * width;
    const y = height - ((point - min) / spread) * height;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
  return (
    <div className="mini-chart">
      <div className="mini-chart-head">
        <strong>{title}</strong>
        <span>{points.length > 0 ? format(points.at(-1) ?? 0) : "n/a"}</span>
      </div>
      {points.length > 1 ? (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <path d={path} />
        </svg>
      ) : <EmptyState>No replay series yet</EmptyState>}
    </div>
  );
}

function Fact({ label, value, good = false, danger = false, help }: { label: string; value: ReactNode; good?: boolean; danger?: boolean; help?: string }) {
  return (
    <span className="fact">
      <small>
        {label}
        {help ? <HelpTip text={help} /> : null}
      </small>
      <b className={good ? "good-text" : danger ? "danger-text" : ""}>{value}</b>
    </span>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="help-tip" title={text} aria-label={text}>
      <CircleHelp size={12} />
    </span>
  );
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="disclosure">
      <summary>
        <span>{title}</span>
        <ChevronDown size={16} />
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

function SimpleTable({ columns, rows, empty }: { columns: string[]; rows: Array<Array<ReactNode>>; empty: string }) {
  if (rows.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="simple-table" style={{ "--columns": columns.length } as CSSProperties}>
      <div className="simple-row header">
        {columns.map((column) => <span key={column}>{column}</span>)}
      </div>
      {rows.map((row, index) => (
        <div className="simple-row" key={index}>
          {row.map((cell, cellIndex) => <span key={cellIndex}>{cell}</span>)}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

function StatusDot({ tone, label }: { tone: "good" | "watch" | "danger" | "neutral"; label: string }) {
  return (
    <span className={`status-dot ${tone}`}>
      <i />
      {label}
    </span>
  );
}

function StatusPill({ tone, children }: { tone: "good" | "watch" | "danger" | "neutral"; children: ReactNode }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

type DashboardModel = ReturnType<typeof buildDashboardModel>;
type MarketView = DashboardData["markets"][number];
type CandidateView = ReturnType<typeof candidateView>;
type HoldingView = ReturnType<typeof holdingView>;
type ResultView = ReturnType<typeof resultView>;

function useDashboardModel(data: DashboardData | null) {
  return useMemo(() => buildDashboardModel(data), [data]);
}

function buildDashboardModel(data: DashboardData | null) {
  const mappings = new Map((data?.mappings ?? []).map((mapping) => [mapping.marketTicker, mapping]));
  const markets = new Map((data?.markets ?? []).map((market) => [market.ticker, market]));
  const candidates = [...(data?.trainingCandidates ?? [])].sort((a, b) => (b.edge ?? -1) - (a.edge ?? -1));
  const settlements = new Map((data?.settlements ?? []).map((settlement) => [settlement.marketTicker, settlement]));
  const positions = data ? paperPositions(data.paperPositions ?? [], data.paperOrders ?? [], settlements) : [];
  const openPositionTickers = new Set(positions.filter((position) => !position.closedAt).map((position) => position.marketTicker));
  const strongCandidates = candidates.filter((candidate) => candidate.status === "WOULD_BUY");
  const riskState = buildRiskState(data, positions);
  const strong = strongCandidates.filter((candidate) => !openPositionTickers.has(candidate.marketTicker) && candidateRiskBlockers(candidate, riskState).length === 0).map((candidate) => candidateView(candidate, mappings.get(candidate.marketTicker), markets.get(candidate.marketTicker)));
  const heldStrong = strongCandidates.filter((candidate) => openPositionTickers.has(candidate.marketTicker)).map((candidate) => candidateView(candidate, mappings.get(candidate.marketTicker), markets.get(candidate.marketTicker)));
  const riskBlockedStrong = strongCandidates.filter((candidate) => !openPositionTickers.has(candidate.marketTicker) && candidateRiskBlockers(candidate, riskState).length > 0).map((candidate) => candidateView(candidate, mappings.get(candidate.marketTicker), markets.get(candidate.marketTicker)));
  const watch = candidates.filter((candidate) => candidate.status === "WATCH" && !openPositionTickers.has(candidate.marketTicker)).map((candidate) => candidateView(candidate, mappings.get(candidate.marketTicker), markets.get(candidate.marketTicker)));
  const openPositions = positions.filter((position) => !position.closedAt).map((position) => holdingView(position, mappings.get(position.marketTicker), markets.get(position.marketTicker)));
  const results = positions.filter((position) => position.closedAt).map((position) => resultView(position, mappings.get(position.marketTicker), settlements.get(position.marketTicker)));
  const openContracts = openPositions.reduce((sum, position) => sum + position.contracts, 0);
  const openCost = openPositions.reduce((sum, position) => sum + position.cost, 0);
  const realizedPnl = results.reduce((sum, result) => sum + result.net, 0);
  return {
    strong,
    heldStrong,
    riskBlockedStrong,
    watch,
    openPositions,
    results,
    openContracts,
    openCost,
    realizedPnl,
    maxOpenPayout: openContracts
  };
}

function buildRiskState(data: DashboardData | null, positions: DashboardData["paperPositions"]) {
  const openPositions = positions.filter((position) => !position.closedAt);
  const today = new Date().toISOString().slice(0, 10);
  return {
    limits: data?.riskLimits ?? null,
    tradesToday: (data?.paperOrders ?? []).filter((order) => order.timestamp.slice(0, 10) === today).length,
    openPositions: openPositions.length,
    openExposure: openPositions.reduce((sum, position) => sum + position.avgEntryPrice * position.contracts, 0)
  };
}

function candidateRiskBlockers(candidate: DashboardData["trainingCandidates"][number], riskState: ReturnType<typeof buildRiskState>) {
  const limits = riskState.limits;
  if (!limits) return [];

  const blockers: string[] = [];
  if (riskState.tradesToday >= limits.maxDailyTrades) blockers.push("daily trade limit reached");
  if (riskState.openPositions >= limits.maxOpenPositions) blockers.push("open position limit reached");
  if (candidate.entryPrice === null) blockers.push("entry unavailable");
  if (candidate.entryPrice !== null) {
    const contracts = Math.max(1, Math.min(limits.maxContractsPerTrade, Math.floor(limits.maxStakePerTrade / Math.max(candidate.entryPrice, 0.01))));
    const maxCost = contracts * candidate.entryPrice;
    if (maxCost > limits.maxStakePerTrade) blockers.push("entry exceeds max stake");
    if (riskState.openExposure + maxCost > limits.maxOpenExposure) blockers.push("open exposure limit reached");
  }
  return blockers;
}

function paperPositions(positions: DashboardData["paperPositions"], orders: DashboardData["paperOrders"], settlements: Map<string, DashboardData["settlements"][number]>): DashboardData["paperPositions"] {
  if (positions.length > 0) return positions;
  const grouped = new Map<string, DashboardData["paperOrders"]>();
  for (const order of orders) {
    if (order.filledContracts <= 0 || order.simulatedAvgFillPrice === null) continue;
    const key = `${order.marketTicker}:${order.side}`;
    grouped.set(key, [...(grouped.get(key) ?? []), order]);
  }
  return [...grouped.entries()].map(([key, groupedOrders]) => {
    const [marketTicker = "unknown", side = "YES"] = key.split(":");
    const contracts = groupedOrders.reduce((sum, order) => sum + order.filledContracts, 0);
    const cost = groupedOrders.reduce((sum, order) => sum + (order.simulatedAvgFillPrice ?? order.limitPrice) * order.filledContracts, 0);
    const settlement = settlements.get(marketTicker);
    const payout = settlement?.result?.toLowerCase() === side.toLowerCase() ? contracts : 0;
    return {
      id: `derived_${marketTicker}_${side}`,
      marketTicker,
      side,
      contracts,
      avgEntryPrice: contracts ? Number((cost / contracts).toFixed(4)) : 0,
      realizedPnl: settlement ? Number((payout - cost).toFixed(2)) : 0,
      markPrice: null,
      openedAt: groupedOrders.map((order) => order.timestamp).sort()[0] ?? new Date().toISOString(),
      closedAt: settlement?.createdAt ?? null,
      settlementId: settlement?.id ?? null
    };
  });
}

function candidateView(candidate: DashboardData["trainingCandidates"][number], mapping: DashboardData["mappings"][number] | undefined, market: MarketView | undefined) {
  const expiry = expiryView(market, mapping?.targetDate ?? candidate.targetDate);
  return {
    ...candidate,
    displayName: displayName(candidate.marketTicker, candidate.city, mapping?.location?.state, market?.title ?? mapping?.title),
    forecast: forecastText(candidate),
    target: mappingLine(mapping ?? candidate, market),
    expiresAt: expiry.label,
    timeToExpiration: expiry.timeLeft,
    entryPrice: candidate.entryPrice,
    edge: candidate.edge,
    yesProbability: candidate.yesProbability
  };
}

function holdingView(position: DashboardData["paperPositions"][number], mapping: DashboardData["mappings"][number] | undefined, market: MarketView | undefined) {
  const cost = position.avgEntryPrice * position.contracts;
  const markPrice = position.markPrice ?? market?.yesBid ?? market?.lastPrice ?? null;
  const currentValue = markPrice === null ? null : markPrice * position.contracts;
  const expiry = expiryView(market, mapping?.targetDate ?? null);
  return {
    ...position,
    displayName: displayName(position.marketTicker, mapping?.location?.city ?? null, mapping?.location?.state, market?.title ?? mapping?.title),
    target: mappingLine(mapping, market),
    cost,
    markPrice,
    currentValue,
    unrealizedPnl: currentValue === null ? null : currentValue - cost,
    maxPayout: position.contracts,
    expiresAt: expiry.label,
    timeToExpiration: expiry.timeLeft
  };
}

function resultView(position: DashboardData["paperPositions"][number], mapping: DashboardData["mappings"][number] | undefined, settlement: DashboardData["settlements"][number] | undefined) {
  const cost = position.avgEntryPrice * position.contracts;
  const payout = settlement?.result?.toLowerCase() === position.side.toLowerCase() ? position.contracts : 0;
  return {
    id: position.id,
    marketTicker: position.marketTicker,
    displayName: displayName(position.marketTicker, mapping?.location?.city ?? null, mapping?.location?.state, mapping?.title),
    result: settlement?.result ? settlement.result.toUpperCase() : "pending",
    finalTemperature: finalTemperature(settlement),
    cost,
    payout,
    net: position.realizedPnl,
    closedAt: position.closedAt ?? settlement?.createdAt ?? ""
  };
}

function displayName(ticker: string, city: string | null | undefined, state: string | undefined, title?: string | null) {
  if (city) return state ? `${city}, ${state}` : city;
  const titleCity = cityFromTitle(title);
  if (titleCity) return titleCity;
  return ticker.split("-")[0] ?? ticker;
}

function forecastText(candidate: DashboardData["trainingCandidates"][number]) {
  if (candidate.forecastValue === null) return mappingLine(candidate);
  return `${valueForVariable(candidate.variable, candidate.forecastValue)} vs ${mappingLine(candidate)}`;
}

function mappingLine(mapping: Pick<DashboardData["mappings"][number], "threshold" | "thresholdOperator" | "targetDate"> | Pick<DashboardData["trainingCandidates"][number], "threshold" | "thresholdOperator" | "targetDate"> | undefined, market?: Pick<MarketView, "title">) {
  if (!mapping || mapping.threshold === null) return market?.title ? compactMarketTitle(market.title) : "Target unavailable";
  const operator = mapping.thresholdOperator === "below" ? "below" : mapping.thresholdOperator === "above" ? "above" : mapping.thresholdOperator;
  return `${operator} ${mapping.threshold} F${mapping.targetDate ? ` on ${shortDate(mapping.targetDate)}` : ""}`;
}

function expiryView(market: MarketView | undefined, targetDate: string | null | undefined) {
  const closeIso = market?.closeTime ?? market?.settlementTime ?? null;
  if (closeIso) return { label: dateTime(closeIso), timeLeft: timeUntil(closeIso) };
  if (targetDate) return { label: shortDate(targetDate), timeLeft: "Time pending" };
  return { label: "Expiration pending", timeLeft: "Time pending" };
}

function timeUntil(iso: string) {
  const expiresAt = new Date(iso).getTime();
  if (!Number.isFinite(expiresAt)) return "Time pending";
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "Closed";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function cityFromTitle(title?: string | null) {
  if (!title) return null;
  const clean = title.replaceAll("**", "");
  const match = clean.match(/high temp in\s+(.+?)\s+be/i);
  const rawCity = match?.[1]?.trim();
  if (!rawCity) return null;
  if (rawCity === "NYC") return "New York, NY";
  if (rawCity === "LA") return "Los Angeles, CA";
  return rawCity;
}

function compactMarketTitle(title: string) {
  const clean = title.replaceAll("**", "").replace(/\?$/, "").trim();
  const highTempMatch = clean.match(/high temp in\s+.+?\s+be\s+(.+)$/i);
  if (highTempMatch?.[1]) return highTempMatch[1].trim();
  return clean.replace(/^Will the\s+/i, "").replace(/\s+on\s+/i, " on ").trim();
}

function finalTemperature(settlement: DashboardData["settlements"][number] | undefined) {
  const raw = settlement?.rawPayload;
  if (!raw || typeof raw !== "object") return "Not published";
  const record = raw as Record<string, unknown>;
  const value = numericValue(record.expiration_value) ?? numericValue(record.settlement_value) ?? numericValue(record.final_value);
  return value === null ? "Not published" : `${value.toFixed(1)} F`;
}

function numericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function statusLabel(status: string) {
  if (status === "WOULD_BUY") return "strong";
  return status.toLowerCase().replaceAll("_", " ");
}

function scanHealth(scan: DashboardData["scanReports"][number]) {
  const failedProviders = scan.providerResults.filter((result) => result.status === "error").length;
  if (scan.status.includes("error") || failedProviders > 0) return { label: `${failedProviders} provider errors`, tone: "watch" as const };
  if (scan.trigger === "quote_refresh") return { label: "Quotes refreshed", tone: "good" as const };
  if (scan.counts.marketsDiscovered === 0) return { label: "No markets", tone: "watch" as const };
  return { label: "Ready", tone: "good" as const };
}

function labelForTrigger(trigger: string) {
  if (trigger === "quote_refresh") return "Quotes refreshed";
  if (trigger === "manual") return "Full scan";
  return labelize(trigger);
}

function labelize(value: string) {
  return value.replace(/([A-Z])/g, " $1").replaceAll("_", " ").trim();
}

function valueForVariable(variable: string, value: number) {
  if (variable.includes("temp")) return `${value.toFixed(1)} F`;
  if (variable === "rainfall") return `${value.toFixed(2)} in`;
  if (variable === "wind_gust") return `${value.toFixed(1)} mph`;
  return value.toFixed(2);
}

function formatPct(value: number | null) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value.trim() !== "" ? parsed : null;
}

function dateToEpochSeconds(value: string, endOfDay: boolean) {
  if (!value) return undefined;
  const suffix = endOfDay ? "T23:59:59Z" : "T00:00:00Z";
  return Math.floor(new Date(`${value}${suffix}`).getTime() / 1000);
}

function price(value: number | null) {
  return value === null ? "n/a" : `$${value.toFixed(2)}`;
}

function money(value: number) {
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
}

function moneyOrPending(value: number | null) {
  return value === null ? "pending" : money(value);
}

function time(iso: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function shortDate(isoDate: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${isoDate}T12:00:00`));
}

function dateTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
