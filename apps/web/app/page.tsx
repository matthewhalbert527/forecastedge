"use client";

import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  CircleHelp,
  Clock3,
  Database,
  Download,
  Gauge,
  ListChecks,
  RefreshCw,
  ThermometerSun
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

type DashboardData = {
  mode: "watch" | "paper" | "demo" | "live";
  paperLearningMode?: boolean;
  locations: Array<{ id: string; city: string; state: string; pollingIntervalMinutes: number }>;
  forecastDeltas: Array<{ id: string; city: string; state: string; variable: string; targetDate: string; oldValue: number; newValue: number; absoluteChange: number; confidence: string; reason: string; createdAt: string }>;
  markets: Array<{ ticker: string; eventTicker: string; title: string; subtitle?: string | null; closeTime?: string | null; settlementTime?: string | null; yesBid: number | null; yesAsk: number | null; noBid?: number | null; noAsk?: number | null; lastPrice?: number | null; volume: number | null; openInterest: number | null; rawPayload?: unknown }>;
  mappings: Array<{ marketTicker: string; title: string; variable: string; threshold: number | null; thresholdOperator: string; targetDate: string | null; confidence: string; accepted: boolean; reviewReason: string | null; liquidityScore: number; location: { city: string; state?: string } | null; station: { stationId: string; stationName: string } | null; settlementSource: string }>;
  signals: Array<{ id: string; marketTicker: string; status: string; edge: number; limitPrice: number; contracts: number; explanation: string; skipReason: string | null; createdAt: string }>;
  paperOrders: Array<{ id: string; marketTicker: string; side: string; action: string; requestedContracts: number; limitPrice: number; status: string; filledContracts: number; unfilledContracts: number; simulatedAvgFillPrice: number | null; reason: string; timestamp: string }>;
  paperPositions: Array<{ id: string; marketTicker: string; side: string; contracts: number; avgEntryPrice: number; realizedPnl: number; markPrice: number | null; openedAt: string; closedAt: string | null; settlementId: string | null }>;
  settlements: Array<{ id: string; marketTicker: string; result: string; settledPrice: number; source: string; rawPayload?: unknown; createdAt: string }>;
  trainingCandidates: Array<{ id: string; marketTicker: string; title: string; city: string | null; stationId: string | null; variable: string; targetDate: string | null; threshold: number | null; thresholdOperator: string; forecastValue: number | null; entryPrice: number | null; yesProbability: number | null; impliedProbability: number | null; edge: number | null; netEdge?: number | null; qualityScore?: number | null; uncertaintyPenalty?: number | null; fillPenalty?: number | null; diversificationPenalty?: number | null; recommendedStake?: number | null; recommendedContracts?: number | null; spread: number | null; liquidityScore: number; status: "WOULD_BUY" | "WATCH" | "BLOCKED"; blockers: string[]; settlementResult: string | null; counterfactualPnl: number | null; reason: string; createdAt: string }>;
  modelForecasts: Array<{ id: string; city: string; state: string; stationId: string | null; model: string; targetDate: string; horizonHours: number; highTempF: number | null; lowTempF: number | null; precipitationAmountIn: number | null; windGustMph: number | null; confidence: string; createdAt: string }>;
  ensembles: Array<{ id: string; city: string; state: string; stationId: string | null; targetDate: string; variable: string; prediction: number | null; uncertaintyStdDev: number | null; confidence: string; contributingModels: string[]; disagreement: number | null; reason: string; createdAt: string }>;
  performance: { totalTrades: number; simulatedContracts: number; averageEntryPrice: number; totalCost: number; rejectedOrders: number; realizedPnl: number; unrealizedExposure: number; winRate: number; roi: number; maxDrawdown: number; longestLosingStreak: number; settledTrades: number; openPositions: number };
  performanceWindows?: PerformanceWindow[];
  learning?: {
    collection: { quoteSnapshots: number; candidateSnapshots: number; paperTradeExamples: number; settledPaperTradeExamples: number; scanReports?: number; fullScans?: number; quoteRefreshScans?: number; historicalMarkets?: number; historicalCandlesticks?: number; historicalTrades?: number; latestQuoteAt: string | null; latestCandidateAt: string | null; latestFullScanAt?: string | null; latestQuoteRefreshAt?: string | null };
    backtest: BacktestSummary;
    recentPaperExamples: Array<{ orderId: string; marketTicker: string; openedAt: string; status: string; entryPrice: number | null; contracts: number; cost: number; modelProbability: number | null; impliedProbability: number | null; edge: number | null; settlementResult: string | null; pnl: number | null; roi: number | null }>;
  };
  research?: ResearchData;
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
  riskLimits?: { maxStakePerTrade: number; maxDailyTrades: number; maxOpenExposure: number; maxOpenPositions: number; maxContractsPerTrade: number; minQualityScore?: number; maxUncertaintyPenalty?: number; maxFillPenalty?: number; maxDiversificationPenalty?: number };
  backgroundWorker?: {
    enabled: boolean;
    running: boolean;
    intervalMinutes: number;
    lastRunAt: string | null;
    quoteRefresh?: { enabled: boolean; running: boolean; intervalMinutes: number; lastRunAt: string | null };
    learningCycle?: { enabled: boolean; running: boolean; intervalMinutes: number; minSettledExamples: number; backtestLookbackDays: number; lastRunAt: string | null; lastError?: string | null; runs?: number };
    memory?: MemoryStatus;
  };
  scheduledJobs?: Array<{ id: string; label: string; description: string; running: boolean; lastRun: { status: string; completedAt: string; message: string } | null }>;
  strategyDecisionEngine?: StrategyDecisionData;
  auditLogs?: Array<{ id: string; timestamp: string; type: string; message: string }>;
};

type PerformanceWindow = {
  key: "24h" | "3d" | "7d" | "14d" | "30d";
  label: string;
  hours: number;
  settledTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalCost: number;
  totalPayout: number;
  totalPnl: number;
  roi: number | null;
  positiveProfit: boolean | null;
  score: number | null;
};

type StrategyDecisionData = {
  statuses: { draft: number; backtestPassed: number; walkForwardPassed: number; paperTesting: number; paperApproved: number; rejected: number };
  approvedStrategies: StrategyRow[];
  paperTestingStrategies: StrategyRow[];
  rejectedStrategies: StrategyRow[];
  latestBacktestHealth: { runId?: string; approvalStatus?: string; evaluatedMarkets?: number | null; roi?: number | null; totalPnl?: number | null; dataQualityScore?: number | null; completedAt?: string | null } | BacktestSummary | null;
  latestPaperTradingHealth: { paperTrades: number | null; settledPaperTrades: number | null; expectedWinRate: number | null; observedWinRate: number | null; expectedPnlPerTrade: number | null; observedPnlPerTrade: number | null; liveEdgeDegraded: boolean } | null;
  latestOptimizerReport: {
    id: string;
    status: string;
    recommendation: string;
    champion: unknown;
    bestCandidate: { optimizerCandidateId?: string; approvalStatus?: string; score?: number; roi?: number; totalPnl?: number; evaluatedMarkets?: number; winRate?: number; parameters?: Record<string, unknown> } | null;
    challengers: Array<{ optimizerCandidateId?: string; approvalStatus?: string; score?: number; roi?: number; totalPnl?: number; evaluatedMarkets?: number }>;
    startedAt: string;
    completedAt: string | null;
  } | null;
  dataFreshness: { latestQuoteAt: string | null; latestCandidateAt: string | null; latestForecastAt: string | null; latestHistoricalCandleAt: string | null; latestHistoricalTradeAt: string | null };
  warningsRequiringReview: Array<{ runId: string; approvalStatus: string; severity: string; message: string; code: string; startedAt: string }>;
};

type StrategyRow = {
  id: string;
  strategyKey: string;
  configHash: string;
  codeVersion: string | null;
  dataSourceVersion: string;
  approvalStatus: string;
  backtestDate: string | null;
  validationDate: string | null;
  paperTradingStartDate: string | null;
  notes: string | null;
  latestRunId: string | null;
  latestRunAt: string | null;
  evaluatedMarkets: number | null;
  roi: number | null;
  totalPnl: number | null;
  summary: string | null;
};

type BacktestSummary = {
  method: string;
  parameters?: Record<string, unknown>;
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
  expectancy?: {
    expectedValuePerTrade: number;
    averageWin: number;
    averageLoss: number;
    payoffRatio: number | null;
    breakEvenWinRate: number | null;
    profitFactor: number | null;
    riskOfRuin: number;
    medianTradeReturn: number;
    outlierAdjustedReturn: number;
    singleTradePnlShare: number;
    rareLongShotWin: boolean;
  };
  dataQuality?: { score: number; reliability: string; warnings: string[] };
  overfitting?: { parameterFragility: string; warnings: Array<{ code: string; severity: string; message: string }>; concentration: { topCityShare: number; topDateShare: number; topEventPnlShare: number }; feeSensitivity: { rawRoi: number | null; feeAdjustedRoi: number | null; collapsePct: number | null } };
  paperValidation?: { paperTrades: number; settledPaperTrades: number; expectedWinRate: number | null; observedWinRate: number | null; expectedPnlPerTrade: number | null; observedPnlPerTrade: number | null; liveEdgeDegraded: boolean; skippedTrades: number; signalNoFill: number; fillEdgeDisappeared: number };
  approval?: { status: string; approvedForRecommendation: boolean; gates: Array<{ name: string; passed: boolean; actual: number | string | null; threshold: number | string; reason: string }>; warnings: Array<{ code: string; severity: string; message: string }>; explanation: { summary: string; edge: string; performsBest: string; failsWhen: string; liquidityConditions: string; riskLimits: string; paperOnly: boolean } };
  trades?: BacktestTrade[];
};

type BacktestTrade = {
  marketTicker: string;
  observedAt: string;
  status: string;
  city?: string | null;
  variable?: string | null;
  targetDate?: string | null;
  eventKey?: string | null;
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

type ResearchData = {
  days: number;
  totals: {
    candidateSnapshots: number;
    paperTrades: number;
    settledTrades: number;
    wins: number;
    losses: number;
    totalPnl: number;
    roi: number | null;
  };
  daily: Array<{
    date: string;
    candidateSnapshots: number;
    wouldBuy: number;
    watch: number;
    blocked: number;
    paperTrades: number;
    paperCost: number;
    settledTrades: number;
    settledCost: number;
    wins: number;
    losses: number;
    totalPnl: number;
    roi: number | null;
    winRate: number | null;
    netCapture: number | null;
  }>;
  qualityBuckets: Array<{ bucket: string; trades: number; wins: number; losses: number; totalPnl: number; roi: number | null; winRate: number | null }>;
  variables: Array<{ variable: string; trades: number; wins: number; losses: number; totalPnl: number; roi: number | null; winRate: number | null }>;
};

type View = "overview" | "decisions" | "learning" | "ledger";
type BusyAction = "scan" | "settle" | null;
type ManualAction = Exclude<BusyAction, null>;
type Tone = "good" | "watch" | "danger" | "neutral";
type MemoryStatus = { rssMb: number; maxRssMb: number | null };

const apiUrl = "/api/forecastedge";
const dashboardRefreshIntervalMs = 60_000;

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

const emptyPerformanceWindows: PerformanceWindow[] = [
  { key: "24h", label: "24 hours", hours: 24, settledTrades: 0, wins: 0, losses: 0, winRate: null, totalCost: 0, totalPayout: 0, totalPnl: 0, roi: null, positiveProfit: null, score: null },
  { key: "3d", label: "3 days", hours: 72, settledTrades: 0, wins: 0, losses: 0, winRate: null, totalCost: 0, totalPayout: 0, totalPnl: 0, roi: null, positiveProfit: null, score: null },
  { key: "7d", label: "7 days", hours: 168, settledTrades: 0, wins: 0, losses: 0, winRate: null, totalCost: 0, totalPayout: 0, totalPnl: 0, roi: null, positiveProfit: null, score: null },
  { key: "14d", label: "2 weeks", hours: 336, settledTrades: 0, wins: 0, losses: 0, winRate: null, totalCost: 0, totalPayout: 0, totalPnl: 0, roi: null, positiveProfit: null, score: null },
  { key: "30d", label: "1 month", hours: 720, settledTrades: 0, wins: 0, losses: 0, winRate: null, totalCost: 0, totalPayout: 0, totalPnl: 0, roi: null, positiveProfit: null, score: null }
];

const navItems: Array<{ key: View; label: string; icon: typeof Gauge }> = [
  { key: "overview", label: "Now", icon: Gauge },
  { key: "decisions", label: "Buys", icon: ListChecks },
  { key: "learning", label: "Learning", icon: BarChart3 },
  { key: "ledger", label: "History", icon: Database }
];

export default function Page() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [view, setView] = useState<View>("overview");
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  async function refresh(options: { force?: boolean } = {}) {
    if (refreshInFlight.current) {
      if (!options.force) return refreshInFlight.current;
      await refreshInFlight.current.catch(() => undefined);
    }

    const request = (async () => {
      const response = await fetch(`${apiUrl}/dashboard`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
      setData(await response.json());
      setError(null);
    })().finally(() => {
      refreshInFlight.current = null;
    });
    refreshInFlight.current = request;
    return request;
  }

  async function runAction(action: ManualAction, endpoint: string) {
    setBusyAction(action);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${apiUrl}${endpoint}`, { method: "POST" });
      if (!response.ok) throw new Error(`Request failed with ${response.status}`);
      await response.json().catch(() => null);
      await refresh({ force: true });
      setNotice(actionNotice(action));
      if (action === "settle") setView("ledger");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown request error");
    } finally {
      setBusyAction(null);
    }
  }

  async function retryDashboardLoad() {
    setIsRetrying(true);
    setError(null);
    try {
      await refresh({ force: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load dashboard");
    } finally {
      setIsRetrying(false);
    }
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Unable to load dashboard"));
    const timer = window.setInterval(() => refresh().catch(() => undefined), dashboardRefreshIntervalMs);
    return () => window.clearInterval(timer);
  }, []);

  const model = useDashboardModel(data);
  const latestScan = data?.scanReports[0] ?? null;
  const scanVerdict = latestScan ? scanHealth(latestScan) : { label: "Waiting", tone: "watch" as const };
  const performance = { ...emptyPerformance, ...(data?.performance ?? {}) };
  const worker = data?.backgroundWorker;
  const strategy = data?.strategyDecisionEngine ?? null;
  const latestLearning = data?.learning?.backtest ?? null;
  const showInitialLoading = !data && !error;
  const showInitialError = Boolean(error && !data);
  const auditIssues = recentAuditIssues(data);
  const freshnessVerdict = dataFreshnessStatus(strategy?.dataFreshness);
  const optimizerDisplay = optimizerStatusDisplay(strategy?.latestOptimizerReport);

  return (
    <main className="app-shell" aria-busy={showInitialLoading || isRetrying || busyAction !== null}>
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
            <button key={key} type="button" className={view === key ? "active" : ""} aria-pressed={view === key} onClick={() => setView(key)}>
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <StatusDot tone={worker?.quoteRefresh?.enabled ? "good" : "watch"} label={worker?.quoteRefresh?.enabled ? "Autonomous" : "Idle"} />
          <span>{worker?.quoteRefresh?.enabled ? `Rechecks every ${worker.quoteRefresh.intervalMinutes} min` : "Quote loop paused"}</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{data?.mode ?? "paper"} mode</p>
            <h2>{viewTitle(view)}</h2>
          </div>
          <div className="topbar-actions">
            <button type="button" className="ghost-button" aria-busy={isRetrying} onClick={retryDashboardLoad} disabled={isRetrying || busyAction !== null}>
              <RefreshCw size={16} />
              {isRetrying ? "Refreshing" : "Refresh view"}
            </button>
            <button type="button" className="ghost-button" aria-busy={busyAction === "scan"} onClick={() => runAction("scan", "/run-once")} disabled={busyAction !== null}>
              <RefreshCw size={16} />
              {busyAction === "scan" ? "Scanning" : "Full scan"}
            </button>
            <button type="button" className="ghost-button" aria-busy={busyAction === "settle"} onClick={() => runAction("settle", "/settlements/run-once")} disabled={busyAction !== null}>
              <Clock3 size={16} />
              {busyAction === "settle" ? "Checking" : "Check results"}
            </button>
          </div>
        </header>

        {error && data ? (
          <div className="alert" role="alert">
            <AlertTriangle size={18} />
            <span className="alert-message">{error}</span>
            <button type="button" className="alert-action" onClick={retryDashboardLoad} disabled={isRetrying}>
              <RefreshCw size={14} />
              {isRetrying ? "Retrying" : "Retry"}
            </button>
          </div>
        ) : null}
        {notice ? <div className="notice" role="status" aria-live="polite">{notice}</div> : null}
        {showInitialLoading ? (
          <DashboardState
            tone="neutral"
            label="Loading"
            title="Loading dashboard data"
            detail="Fetching the latest ForecastEdge snapshot."
          />
        ) : null}
        {showInitialError ? (
          <DashboardState
            tone="watch"
            label="Needs attention"
            title="Dashboard data is unavailable"
            detail={error ?? "The dashboard request failed before any data loaded."}
            action={
              <button type="button" className="ghost-button" onClick={retryDashboardLoad} disabled={isRetrying}>
                <RefreshCw size={16} />
                {isRetrying ? "Retrying" : "Retry"}
              </button>
            }
          />
        ) : null}

        {data ? (
          <>
            <section className="health-strip" role="status" aria-live="polite">
              <StatusDot tone={scanVerdict.tone} label={scanVerdict.label} />
              <span>{latestScan ? `${labelForTrigger(latestScan.trigger)} at ${time(latestScan.startedAt)}` : "No scan yet"}</span>
              {view === "overview" ? (
                <>
                  <span>Optimizer {optimizerDisplay.label}</span>
                  <span>{latestBacktestStatus(strategy?.latestBacktestHealth ?? latestLearning)} replay</span>
                  <span>{data.learning?.collection.settledPaperTradeExamples ?? 0}/{worker?.learningCycle?.minSettledExamples ?? 10} settled examples</span>
                </>
              ) : (
                <>
                  <span>{model.strong.length} buys ready</span>
                  <span>{model.openPositions.length} open positions</span>
                  <span>{auditIssueLabel(auditIssues)}</span>
                </>
              )}
              <StatusDot tone={freshnessVerdict.tone} label={freshnessVerdict.label} />
              <span>{worker?.memory ? memoryLabel(worker.memory) : data.paperLearningMode ? "learning mode" : "risk capped"}</span>
            </section>

            {view === "overview" ? (
              <OverviewView
                data={data}
                model={model}
                performance={performance}
                performanceWindows={data.performanceWindows ?? []}
                strategy={strategy}
                latest={latestLearning}
              />
            ) : null}

            {view === "decisions" ? <DecisionsView model={model} /> : null}
            {view === "learning" ? <LearningView data={data} strategy={strategy} jobs={data.scheduledJobs ?? []} latest={latestLearning} learning={data.learning ?? null} /> : null}
            {view === "ledger" ? <LedgerView data={data} model={model} performance={performance} settleAction={() => runAction("settle", "/settlements/run-once")} busy={busyAction === "settle"} /> : null}
          </>
        ) : null}
      </section>
    </main>
  );
}

function OverviewView({ data, model, performance, performanceWindows, strategy, latest }: { data: DashboardData; model: DashboardModel; performance: DashboardData["performance"]; performanceWindows: PerformanceWindow[]; strategy: StrategyDecisionData | null; latest: BacktestSummary | null }) {
  const latestScan = data.scanReports[0] ?? null;
  const action = primaryAction(data, model, strategy, latest);
  const bestWindow = bestPerformanceWindow(performanceWindows);
  const latestBacktest = strategy?.latestBacktestHealth ?? latest;
  const latestReplayStatus = latestBacktestStatus(latestBacktest);
  const latestReplayRoi = latestBacktestRoi(latestBacktest);
  const dataQualityScore = latestBacktestDataQualityScore(latestBacktest);
  const dataQuality = latestBacktestDataQuality(latestBacktest);
  const optimizerDisplay = optimizerStatusDisplay(strategy?.latestOptimizerReport);
  const optimizerCompletedAt = strategy?.latestOptimizerReport?.completedAt;
  const analytics = resultAnalytics(model.results);
  const allTimeSettled = analytics.allTime.wins + analytics.allTime.losses + analytics.allTime.flats;
  const allTimeWinRate = allTimeSettled > 0 ? analytics.allTime.wins / allTimeSettled : null;
  const reviewBlockers = uniqueReviewBlockerCount(strategy);
  const settledExamples = data.learning?.collection.settledPaperTradeExamples ?? 0;
  const minSettledExamples = data.backgroundWorker?.learningCycle?.minSettledExamples ?? 10;
  const scheduledEvents = upcomingEventRows(data, strategy);
  return (
    <section className="overview-stack">
      <section className={`focus-panel ${action.tone}`}>
        <div>
          <StatusPill tone={action.tone}>{action.label}</StatusPill>
          <h3>{action.title}</h3>
          <p>{action.detail}</p>
        </div>
        <div className="focus-facts">
          <Fact label="Last scan" value={latestScan ? dateTime(latestScan.startedAt) : "pending"} />
          <Fact label="Optimizer" value={optimizerDisplay.label} good={optimizerDisplay.tone === "good"} danger={optimizerDisplay.tone === "danger"} />
          <Fact label="Latest replay" value={latestReplayStatus} danger={latestReplayStatus === "Rejected"} />
          <Fact label="Data quality" value={dataQuality} good={dataQualityScore !== null && dataQualityScore >= 80} danger={dataQualityScore !== null && dataQualityScore < 60} />
        </div>
      </section>
      <section className="page-grid primary-grid">
        <Metric label="Optimizer" value={optimizerDisplay.label} detail={optimizerCompletedAt ? `last reviewed ${dateTime(optimizerCompletedAt)}` : "latest automatic adjustment state"} />
        <Metric label="Latest replay" value={latestReplayStatus} detail={`${latestReplayRoi === null ? "n/a" : formatPct(latestReplayRoi)} ROI`} />
        <Metric label="Best score" value={bestWindow ? scoreLabel(bestWindow.score) : "n/a"} detail={bestWindow ? `${bestWindow.label}, ${bestWindow.settledTrades} settled` : "waiting for settled outcomes"} />
        <Metric label="Settled evidence" value={`${settledExamples}/${minSettledExamples}`} detail={`${data.learning?.collection.paperTradeExamples ?? 0} paper examples stored`} />
      </section>
      <section className="overview-columns simple-columns">
        <Panel title="Algorithm adjustments" action={<span className="panel-note">{reviewBlockers} blockers</span>}>
          <ImprovementSnapshot strategy={strategy} latest={latest} learning={data.learning ?? null} />
        </Panel>
        <Panel title="Success data" action={<span className="panel-note">{allTimeSettled} settled</span>}>
          <SimpleTable
            columns={["Metric", "Value"]}
            rows={[
              ["Win rate", formatPct(allTimeWinRate)],
              ["Wins / losses", `${analytics.allTime.wins} / ${analytics.allTime.losses}`],
              ["Paper P/L", money(performance.realizedPnl)],
              ["Best score", bestWindow ? `${scoreLabel(bestWindow.score)} over ${bestWindow.label}` : "waiting"],
              ["Replay ROI", latestReplayRoi === null ? "n/a" : formatPct(latestReplayRoi)],
              ["Data quality", dataQuality]
            ]}
            empty="No success data yet"
          />
        </Panel>
      </section>
      <section className="single-column">
        <Panel title="Upcoming event schedule" action={<span className="panel-note">{scheduledEvents.length} events</span>}>
          <SimpleTable
            columns={["Event", "Next", "Last outcome"]}
            rows={scheduledEvents}
            empty="No scheduled events configured"
          />
        </Panel>
      </section>
      <Disclosure title="Learning and performance details">
        <PerformanceScorePanel windows={performanceWindows} />
        <SimpleTable
          columns={["Metric", "Value"]}
          rows={[
            ["Quote snapshots", String(data.learning?.collection.quoteSnapshots ?? 0)],
            ["Candidate decisions", String(data.learning?.collection.candidateSnapshots ?? 0)],
            ["Paper examples", String(data.learning?.collection.paperTradeExamples ?? 0)],
            ["Settled examples", `${settledExamples}/${minSettledExamples}`],
            ["Review blockers", String(reviewBlockers)]
          ]}
          empty="No learning detail yet"
        />
        <div className="quiet-summary">
          <span>Best score: {bestWindow ? `${scoreLabel(bestWindow.score)} over ${bestWindow.label}` : "waiting for settled trades"}</span>
          <span>Mode: {data.mode}</span>
          <span>{data.paperLearningMode ? "Paper learning mode is on" : "Standard risk caps are on"}</span>
        </div>
      </Disclosure>
    </section>
  );
}

function upcomingEventRows(data: DashboardData, strategy: StrategyDecisionData | null): Array<Array<ReactNode>> {
  const rows: Array<Array<ReactNode>> = [];
  const quoteRefresh = data.backgroundWorker?.quoteRefresh;
  const learningCycle = data.backgroundWorker?.learningCycle;
  const latestQuoteRefreshAt = quoteRefresh?.lastRunAt ?? data.learning?.collection.latestQuoteRefreshAt ?? data.scanReports.find((scan) => scan.trigger === "quote_refresh")?.startedAt ?? null;

  if (quoteRefresh) {
    rows.push([
      "Quote refresh",
      quoteRefresh.running ? "running now" : quoteRefresh.enabled ? nextIntervalRun(latestQuoteRefreshAt, quoteRefresh.intervalMinutes) : "paused",
      quoteRefresh.running ? "running now" : latestQuoteRefreshAt ? `Refreshed ${dateTime(latestQuoteRefreshAt)}` : "Not run yet"
    ]);
  }

  if (learningCycle) {
    rows.push([
      "Learning cycle",
      learningCycle.running ? "running now" : learningCycle.enabled ? nextIntervalRun(learningCycle.lastRunAt, learningCycle.intervalMinutes) : "paused",
      learningCycle.running ? "running now" : learningCycle.lastError ? `Error: ${compactText(learningCycle.lastError)}` : learningCycle.lastRunAt ? `Completed ${dateTime(learningCycle.lastRunAt)}` : "Not run yet"
    ]);
  }

  for (const job of data.scheduledJobs ?? []) {
    rows.push([
      job.label,
      job.running ? "running now" : inferScheduledJobNextRun(job, strategy),
      scheduledJobOutcome(job)
    ]);
  }

  return rows.slice(0, 12);
}

function nextIntervalRun(lastRunAt: string | null, intervalMinutes: number) {
  if (!lastRunAt) return intervalMinutes > 0 ? `within ${intervalMinutes} min` : "scheduled";
  const next = addMinutes(new Date(lastRunAt), intervalMinutes);
  if (!Number.isFinite(next.getTime())) return "scheduled";
  return next.getTime() <= Date.now() ? "due now" : dateTime(next.toISOString());
}

function inferScheduledJobNextRun(job: NonNullable<DashboardData["scheduledJobs"]>[number], strategy: StrategyDecisionData | null) {
  const label = `${job.id} ${job.label}`.toLowerCase();
  if (job.lastRun?.status?.toLowerCase().includes("disabled")) return "paused";
  if (label.includes("intraday")) return "intraday";
  if (label.includes("daily")) return "daily review";
  if (label.includes("nightly")) return "nightly";
  if (label.includes("deep")) return "deep review window";
  if (label.includes("replay") || label.includes("backtest") || label.includes("counterfactual")) return "scheduled replay";
  if (label.includes("optimizer") || label.includes("strategy")) {
    return strategy?.latestOptimizerReport?.completedAt ? `after ${dateTime(strategy.latestOptimizerReport.completedAt)}` : "after enough evidence";
  }
  if (label.includes("historical") || label.includes("archive")) return "background refresh";
  return job.lastRun?.completedAt ? `after ${dateTime(job.lastRun.completedAt)}` : "scheduled";
}

function scheduledJobOutcome(job: NonNullable<DashboardData["scheduledJobs"]>[number]) {
  if (job.running) return "running now";
  if (!job.lastRun) return job.description || "Not run yet";
  const status = sentenceCase(labelize(job.lastRun.status.toLowerCase()));
  const message = compactText(job.lastRun.message);
  return message ? `${status} ${dateTime(job.lastRun.completedAt)}: ${message}` : `${status} ${dateTime(job.lastRun.completedAt)}`;
}

function PerformanceScorePanel({ windows }: { windows: PerformanceWindow[] }) {
  const windowByKey = new Map(windows.map((window) => [window.key, window]));
  const displayWindows = emptyPerformanceWindows.map((window) => windowByKey.get(window.key) ?? window);
  return (
    <section className="score-panel">
      <div className="panel-head">
        <h3>Prediction score</h3>
      </div>
      <div className="score-grid">
        {displayWindows.map((window) => (
          <article className={`score-card ${scoreTone(window.score)}`} key={window.key}>
            <span>{window.label}</span>
            <strong>{window.score === null ? "n/a" : window.score}</strong>
            <small>{window.settledTrades > 0 ? `${formatPct(window.winRate)} win, ${money(window.totalPnl)} P/L` : "No settled trades"}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function scoreTone(score: number | null) {
  if (score === null) return "neutral";
  if (score >= 70) return "good";
  if (score >= 45) return "watch";
  return "danger";
}

function DecisionsView({ model }: { model: DashboardModel }) {
  return (
    <section className="stack">
      <section className="section-head simple-head">
        <div>
          <h3>Buy board</h3>
          <p>Only the buyable candidates stay open here. Held, watch, and blocked markets are collapsed unless you need to audit them.</p>
        </div>
      </section>
      <section className="page-grid">
        <Metric label="Approved now" value={model.strong.length} detail="clear model and risk checks" />
        <Metric label="Already held" value={model.heldStrong.length} detail="not doubled up" />
        <Metric label="Watching" value={model.watch.length} detail="positive edge, not enough yet" />
        <Metric label="Risk blocked" value={model.riskBlockedStrong.length} detail="held back by limits" />
      </section>
      <section className="single-column">
        <Panel title="Approved now">
          <CandidateList candidates={model.strong} empty="No approved buys right now" expanded />
        </Panel>
      </section>
      <Disclosure title={`Already held (${model.openPositions.length})`}>
        <HoldingList positions={model.openPositions} expanded />
      </Disclosure>
      <Disclosure title={`Watch list (${model.watch.length})`}>
        <div className="single-column">
          <CandidateList candidates={model.watch.slice(0, 12)} empty="No positive-edge watch items" compact />
        </div>
      </Disclosure>
      <Disclosure title={`Risk blocked (${model.riskBlockedStrong.length})`}>
        <div className="single-column">
          <CandidateList candidates={model.riskBlockedStrong.slice(0, 12)} empty="No risk-blocked strong signals" compact />
        </div>
      </Disclosure>
    </section>
  );
}

function LearningView({ data, strategy, jobs, latest, learning }: { data: DashboardData; strategy: StrategyDecisionData | null; jobs: NonNullable<DashboardData["scheduledJobs"]>; latest: BacktestSummary | null; learning: DashboardData["learning"] | null }) {
  const paper = strategy?.latestPaperTradingHealth;
  const settledExamples = learning?.collection.settledPaperTradeExamples ?? 0;
  const minSettledExamples = data.backgroundWorker?.learningCycle?.minSettledExamples ?? 10;
  const auditIssues = recentAuditIssues(data);
  const reviewBlockers = strategyReviewBlockers(strategy);
  const latestBacktest = strategy?.latestBacktestHealth ?? latest;
  const latestReplayStatus = latestBacktestStatus(latestBacktest);
  const latestReplayRoi = latestBacktestRoi(latestBacktest);
  const dataQualityScore = latestBacktestDataQualityScore(latestBacktest);
  const freshness = dataFreshnessStatus(strategy?.dataFreshness);
  const optimizerStatus = strategy?.latestOptimizerReport?.status ?? "";
  const optimizerDisplay = optimizerStatusDisplay(strategy?.latestOptimizerReport);
  const evidenceGateActive = settledExamples < minSettledExamples || latestReplayStatus === "Rejected" || optimizerStatus.startsWith("completed_no_");
  const learningTone: Tone = paper?.liveEdgeDegraded || evidenceGateActive ? "watch" : settledExamples >= minSettledExamples ? "good" : "neutral";
  const learningLabel = paper?.liveEdgeDegraded ? "Needs review" : evidenceGateActive ? "Evidence gate" : "Learning loop";
  return (
    <section className="stack details-stack">
      <section className="focus-panel neutral">
        <div>
          <StatusPill tone={learningTone}>{learningLabel}</StatusPill>
          <h3>Automatic learning</h3>
          <p>{learningNarrative(strategy, latest, learning, minSettledExamples)}</p>
        </div>
        <div className="focus-facts">
          <Fact label="Data quality" value={latestBacktestDataQuality(latestBacktest)} good={dataQualityScore !== null && dataQualityScore >= 80} danger={dataQualityScore !== null && dataQualityScore < 60} />
          <Fact label="Freshness" value={freshness.label} good={freshness.tone === "good"} danger={freshness.tone === "watch" || freshness.tone === "danger"} />
          <Fact label="Paper edge" value={paper?.liveEdgeDegraded ? "degraded" : paper ? "preserved" : "pending"} good={Boolean(paper && !paper.liveEdgeDegraded)} danger={Boolean(paper?.liveEdgeDegraded)} />
          <Fact label="Optimizer" value={optimizerDisplay.label} good={optimizerDisplay.tone === "good"} danger={optimizerDisplay.tone === "danger"} />
        </div>
      </section>
      <section className="page-grid">
        <Metric label="Settled examples" value={`${settledExamples}/${minSettledExamples}`} detail="minimum before changing thresholds" />
        <Metric label="Data quality" value={latestBacktestDataQuality(latestBacktest)} detail={freshness.label} />
        <Metric label="Latest replay" value={latestReplayStatus} detail={`${latestReplayRoi === null ? "n/a" : formatPct(latestReplayRoi)} ROI`} />
        <Metric label="Review blockers" value={reviewBlockers.length} detail={`${strategy?.warningsRequiringReview.length ?? 0} total warning records`} />
      </section>
      <section className="learning-flow">
        <FlowStep title="Collect" value={learning?.collection.quoteSnapshots ?? 0} detail="quote snapshots" />
        <FlowStep title="Decide" value={learning?.collection.candidateSnapshots ?? 0} detail="candidate decisions" />
        <FlowStep title="Paper trade" value={learning?.collection.paperTradeExamples ?? 0} detail="paper examples" />
        <FlowStep title="Adjust" value={optimizerDisplay.label} detail={strategy?.latestOptimizerReport?.completedAt ? dateTime(strategy.latestOptimizerReport.completedAt) : "waiting for optimizer"} />
      </section>
      <Disclosure title="Optimizer details">
        <SimpleTable
          columns={["Signal", "Value"]}
          rows={[
            ["Optimizer", optimizerDisplay.label],
            ["Recommendation", strategy?.latestOptimizerReport?.recommendation ?? "No optimizer recommendation yet"],
            ["Best candidate", strategy?.latestOptimizerReport?.bestCandidate?.optimizerCandidateId ?? "none"],
            ["Hypothetical P/L", moneyOrPending(strategy?.latestOptimizerReport?.bestCandidate?.totalPnl ?? null)],
            ["Best ROI", formatPct(strategy?.latestOptimizerReport?.bestCandidate?.roi ?? null)],
            ["Replay trades", String(strategy?.latestOptimizerReport?.bestCandidate?.evaluatedMarkets ?? 0)],
            ["Paper edge", paper?.liveEdgeDegraded ? "degraded" : paper ? "preserved" : "pending"]
          ]}
          empty="No automatic adjustment data"
        />
      </Disclosure>
      <Disclosure title="Paper validation">
        <SimpleTable
          columns={["Metric", "Value"]}
          rows={paper ? [
            ["Paper trades", String(paper.paperTrades ?? 0)],
            ["Settled paper trades", String(paper.settledPaperTrades ?? 0)],
            ["Expected win rate", formatPct(paper.expectedWinRate)],
            ["Observed win rate", formatPct(paper.observedWinRate)],
            ["Expected P/L trade", moneyOrPending(paper.expectedPnlPerTrade)],
            ["Observed P/L trade", moneyOrPending(paper.observedPnlPerTrade)]
          ] : []}
          empty="No paper validation sample yet"
        />
      </Disclosure>
      <Disclosure title="System details">
        <div className="detail-summary-grid">
          <Panel title="Data freshness">
            <SimpleTable
              columns={["Feed", "Latest"]}
              rows={strategy ? [
                ["Quotes", dateTimeOrPending(strategy.dataFreshness.latestQuoteAt)],
                ["Candidates", dateTimeOrPending(strategy.dataFreshness.latestCandidateAt)],
                ["Forecasts", dateTimeOrPending(strategy.dataFreshness.latestForecastAt)],
                ["Historical candles", dateTimeOrPending(strategy.dataFreshness.latestHistoricalCandleAt)],
                ["Historical trades", dateTimeOrPending(strategy.dataFreshness.latestHistoricalTradeAt)]
              ] : []}
              empty="No freshness data"
            />
          </Panel>
          <Panel title="Scheduled work">
            <SimpleTable
              columns={["Job", "State", "Last run", "Last message"]}
              rows={jobs.map((job) => [
                job.label,
                job.running ? "running" : job.lastRun?.status ?? "ready",
                dateTimeOrNever(job.lastRun?.completedAt ?? null),
                job.lastRun?.message ?? job.description
              ])}
              empty="No job registry"
            />
          </Panel>
          <Panel title="Recent audit issues">
            <SimpleTable
              columns={["Time", "Type", "Message"]}
              rows={auditIssues.slice(0, 6).map((log) => [
                dateTime(log.timestamp),
                labelize(log.type),
                log.message
              ])}
              empty="No recent audit issues"
            />
          </Panel>
        </div>
      </Disclosure>
      {latest ? (
        <Disclosure title="Replay charts">
          <section className="chart-grid">
            <MiniLineChart title="Automatic replay equity" points={(latest.equityCurve ?? []).map((point) => point.equity)} format={money} />
            <MiniLineChart title="Probability movement" points={(latest.trades ?? []).slice().reverse().map((trade) => trade.impliedProbabilityMove ?? 0)} format={formatPct} />
          </section>
        </Disclosure>
      ) : null}
      <Disclosure title={`Review blockers (${reviewBlockers.length})`}>
        <SimpleTable
          columns={["Latest", "Status", "Severity", "Code", "Seen", "Message"]}
          rows={reviewBlockers.map((warning) => [
            dateTime(warning.startedAt),
            warning.approvalStatus,
            warning.severity,
            warning.code,
            String(warning.count),
            warning.message
          ])}
          empty="No warnings requiring review"
        />
      </Disclosure>
      <Disclosure title="Research details">
        <ResearchDetails data={data} />
      </Disclosure>
    </section>
  );
}

function ResearchDetails({ data }: { data: DashboardData }) {
  const research = data.research;
  const recentDaily = (research?.daily ?? []).slice(-14).reverse();
  return (
    <section className="stack nested-stack">
      <section className="page-grid">
        <Metric label="Lookback" value={`${research?.days ?? 0}d`} detail="persisted research window" />
        <Metric label="Candidates" value={research?.totals.candidateSnapshots ?? 0} detail="candidate snapshots captured" />
        <Metric label="Paper trades" value={research?.totals.paperTrades ?? 0} detail="orders converted into training examples" />
        <Metric label="Settled trades" value={research?.totals.settledTrades ?? 0} detail="examples available for evaluation" />
      </section>
      <section className="page-grid">
        <Metric label="Wins" value={research?.totals.wins ?? 0} detail="settled YES outcomes" />
        <Metric label="Losses" value={research?.totals.losses ?? 0} detail="settled NO outcomes" />
        <Metric label="Settled P/L" value={money(research?.totals.totalPnl ?? 0)} detail="realized paper result in window" />
        <Metric label="Settled ROI" value={formatPct(research?.totals.roi ?? null)} detail="P/L divided by settled cost" />
      </section>
      <section className="overview-columns">
        <Panel title="Daily capture">
          <SimpleTable
            columns={["Date", "Candidates", "Strong", "Paper", "Settled", "Win rate", "P/L"]}
            rows={recentDaily.map((row) => [
              row.date,
              String(row.candidateSnapshots),
              String(row.wouldBuy),
              String(row.paperTrades),
              String(row.settledTrades),
              formatPct(row.winRate),
              money(row.totalPnl)
            ])}
            empty="No daily research rows yet"
          />
        </Panel>
        <Panel title="Quality buckets">
          <SimpleTable
            columns={["Bucket", "Trades", "Win rate", "ROI", "P/L"]}
            rows={(research?.qualityBuckets ?? []).map((bucket) => [
              bucket.bucket,
              String(bucket.trades),
              formatPct(bucket.winRate),
              formatPct(bucket.roi),
              money(bucket.totalPnl)
            ])}
            empty="No settled quality buckets yet"
          />
        </Panel>
        <Panel title="Variable performance">
          <SimpleTable
            columns={["Variable", "Trades", "Win rate", "ROI", "P/L"]}
            rows={(research?.variables ?? []).slice(0, 8).map((row) => [
              labelize(row.variable),
              String(row.trades),
              formatPct(row.winRate),
              formatPct(row.roi),
              money(row.totalPnl)
            ])}
            empty="No settled variable rows yet"
          />
        </Panel>
        <Panel title="Learning controls">
          <SimpleTable
            columns={["Control", "Value"]}
            rows={[
              ["Paper learning mode", data.paperLearningMode ? "enabled" : "disabled"],
              ["Daily trade cap", data.paperLearningMode ? "uncapped for learning" : String(data.riskLimits?.maxDailyTrades ?? 0)],
              ["Open position cap", data.paperLearningMode ? "uncapped for learning" : String(data.riskLimits?.maxOpenPositions ?? 0)],
              ["Quote refresh orders", data.paperLearningMode ? "uncapped for learning" : "standard"],
              ["Per-trade paper stake", money(data.riskLimits?.maxStakePerTrade ?? 0)]
            ]}
            empty="No learning controls"
          />
        </Panel>
      </section>
      <Disclosure title="Daily research rows">
        <SimpleTable
          columns={["Date", "Candidates", "Watch", "Blocked", "Paper", "Capture", "Settled", "ROI", "P/L"]}
          rows={(research?.daily ?? []).slice().reverse().map((row) => [
            row.date,
            String(row.candidateSnapshots),
            String(row.watch),
            String(row.blocked),
            String(row.paperTrades),
            formatPct(row.netCapture),
            String(row.settledTrades),
            formatPct(row.roi),
            money(row.totalPnl)
          ])}
          empty="No research rows yet"
        />
      </Disclosure>
    </section>
  );
}

function LedgerView({ data, model, performance, settleAction, busy }: { data: DashboardData; model: DashboardModel; performance: DashboardData["performance"]; settleAction: () => void; busy: boolean }) {
  const analytics = resultAnalytics(model.results);
  const latestScan = data.scanReports[0] ?? null;
  const learning = data.learning ?? null;
  return (
    <section className="stack details-stack">
      <section className="section-head simple-head">
        <div>
          <h3>History</h3>
          <p>{money(performance.realizedPnl)} settled P/L across {performance.settledTrades || model.results.length} settled outcomes. Detailed audit data is collapsed below.</p>
        </div>
        <div className="topbar-actions">
          <button type="button" className="ghost-button" aria-busy={busy} onClick={settleAction} disabled={busy}>
            <Clock3 size={16} />
            {busy ? "Checking" : "Check results"}
          </button>
          <a className="ghost-button" href={`${apiUrl}/dataset/export`}>
            <Download size={16} />
            Dataset
          </a>
        </div>
      </section>
      <section className="result-graphs" aria-label="Settled paper result charts">
        <ResultStatsPanel title="Last local day" stats={analytics.yesterday} empty="No settled outcomes yesterday" />
        <ResultStatsPanel title="All time" stats={analytics.allTime} empty="No settled paper outcomes yet" />
      </section>
      <section className="single-column">
        <Panel title="Recent settled results">
          <ResultList results={model.results.slice(0, 5)} />
        </Panel>
      </section>
      <Disclosure title={`Settled results (${model.results.length})`}>
        <ResultList results={model.results} expanded />
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
      <Disclosure title="Paper training examples">
        <SimpleTable
          columns={["Time", "Ticker", "Status", "Contracts", "Edge", "P/L"]}
          rows={(learning?.recentPaperExamples ?? []).slice(0, 40).map((example) => [
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
      <Disclosure title="All model candidates">
        <SimpleTable
          columns={["Ticker", "Status", "Forecast", "Ask", "Edge", "Reason"]}
          rows={(data.trainingCandidates ?? []).slice(0, 80).map((candidate) => [
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
    </section>
  );
}

function ImprovementSnapshot({ strategy, latest, learning }: { strategy: StrategyDecisionData | null; latest: BacktestSummary | null; learning: DashboardData["learning"] | null }) {
  const optimizer = strategy?.latestOptimizerReport;
  const paper = strategy?.latestPaperTradingHealth;
  const settledExamples = learning?.collection.settledPaperTradeExamples ?? 0;
  const evidenceGateActive = optimizer?.status === "completed_no_settled_markets" || settledExamples === 0;
  const optimizerDisplay = optimizerStatusDisplay(optimizer);
  return (
    <div className="improvement-copy">
      <StatusPill tone={evidenceGateActive || paper?.liveEdgeDegraded ? "watch" : optimizerDisplay.tone}>
        {evidenceGateActive ? "Evidence gate" : paper?.liveEdgeDegraded ? "Review" : optimizerDisplay.label}
      </StatusPill>
      <p>{evidenceGateActive ? evidenceGateMessage(settledExamples, optimizer?.recommendation) : optimizer?.recommendation ?? "Waiting for enough settled paper outcomes before changing thresholds."}</p>
      <div className="mini-facts">
        <span>{learning?.collection.candidateSnapshots ?? 0} decisions</span>
        <span>{settledExamples} settled examples</span>
        <span>{latestBacktestStatus(strategy?.latestBacktestHealth ?? latest)}</span>
      </div>
    </div>
  );
}

function FlowStep({ title, value, detail }: { title: string; value: ReactNode; detail: string }) {
  return (
    <article className="flow-step">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function viewTitle(view: View) {
  if (view === "decisions") return "Buy board";
  if (view === "learning") return "Learning";
  if (view === "ledger") return "History";
  return "Now";
}

function primaryAction(data: DashboardData, model: DashboardModel, strategy: StrategyDecisionData | null, latest: BacktestSummary | null): { tone: Tone; label: string; title: string; detail: string } {
  const quote = data.backgroundWorker?.quoteRefresh;
  const settledExamples = data.learning?.collection.settledPaperTradeExamples ?? 0;
  const minSettledExamples = data.backgroundWorker?.learningCycle?.minSettledExamples ?? 10;
  const optimizerStatus = strategy?.latestOptimizerReport?.status ?? "";
  const optimizerRecommendation = strategy?.latestOptimizerReport?.recommendation;
  const warningRecords = strategy?.warningsRequiringReview.length ?? 0;
  const reviewBlockers = uniqueReviewBlockerCount(strategy);
  const backtestStatus = latestBacktestStatus(strategy?.latestBacktestHealth ?? latest);
  const paper = strategy?.latestPaperTradingHealth;

  if (!quote?.enabled) {
    return {
      tone: "danger",
      label: "Paused",
      title: "Autonomy is paused",
      detail: "The quote loop is not enabled, so new paper decisions will not update until a scan runs or the worker is re-enabled."
    };
  }

  if (quote.running) {
    return {
      tone: "good",
      label: "Scanning",
      title: "Reevaluating markets now",
      detail: "ForecastEdge is refreshing quotes, reranking candidates, and collecting paper outcomes under the current model gates."
    };
  }

  if (settledExamples < minSettledExamples || optimizerStatus === "completed_no_settled_markets" || optimizerStatus === "completed_no_candidate" || backtestStatus === "Rejected") {
    let gateReason = `${settledExamples} settled training examples are available, and ${minSettledExamples} are required before threshold changes are trustworthy.`;
    if (optimizerStatus === "completed_no_settled_markets") {
      gateReason = "No settled candidate markets are available yet, so optimizer changes stay blocked.";
    } else if (optimizerStatus === "completed_no_candidate") {
      gateReason = optimizerRecommendation ?? "No challenger passed approval gates, so optimizer changes stay blocked.";
    } else if (backtestStatus === "Rejected") {
      gateReason = "The latest replay is rejected, so threshold changes stay blocked until validation improves.";
    }
    const reviewDetail = paper?.liveEdgeDegraded || warningRecords > 0
      ? ` ${reviewBlockers} review blocker${reviewBlockers === 1 ? "" : "s"} should still be checked before promotion.`
      : "";
    return {
      tone: "watch",
      label: optimizerStatus.startsWith("completed_no_") ? "Evidence gate" : "Collecting",
      title: "Keep collecting before changing the algorithm",
      detail: `${gateReason} The system can keep collecting outcomes under the current gates.${reviewDetail}`
    };
  }

  if (paper?.liveEdgeDegraded || warningRecords > 0) {
    return {
      tone: "watch",
      label: "Review",
      title: "Paper results need review",
      detail: paper?.liveEdgeDegraded
        ? "Observed paper performance is trailing the expected edge, so the next improvement should come from reviewing fills, liquidity, and filters."
        : `${reviewBlockers} review blocker${reviewBlockers === 1 ? "" : "s"} still need attention before promoting a change.`
    };
  }

  if (model.strong.length > 0) {
    return {
      tone: "good",
      label: "Active",
      title: "Current gates are producing approved decisions",
      detail: `The quote loop is checking every ${quote.intervalMinutes} minute${quote.intervalMinutes === 1 ? "" : "s"} while the learning loop measures whether the current algorithm keeps improving.`
    };
  }

  return {
    tone: "neutral",
    label: "Watching",
    title: "Monitoring the current algorithm",
    detail: `ForecastEdge is still checking every ${quote.intervalMinutes} minute${quote.intervalMinutes === 1 ? "" : "s"} and collecting decisions for the next optimizer review.`
  };
}

function actionNotice(action: ManualAction) {
  if (action === "settle") return "Result check complete. Dashboard refreshed with the latest paper outcomes.";
  return "Full scan complete. Dashboard refreshed with the latest markets and decisions.";
}

function bestPerformanceWindow(windows: PerformanceWindow[]) {
  return windows
    .filter((window) => window.score !== null)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0] ?? null;
}

function scoreLabel(score: number | null) {
  return score === null ? "n/a" : String(score);
}

function learningNarrative(strategy: StrategyDecisionData | null, latest: BacktestSummary | null, learning: DashboardData["learning"] | null, minSettledExamples: number) {
  const optimizer = strategy?.latestOptimizerReport;
  const settled = learning?.collection.settledPaperTradeExamples ?? 0;
  const status = latestBacktestStatus(strategy?.latestBacktestHealth ?? latest);
  if (settled < minSettledExamples) {
    const gate = `Collecting settled paper outcomes before tightening selectivity. ${settled}/${minSettledExamples} settled examples are available.`;
    return optimizer?.recommendation ? `${gate} Latest optimizer: ${optimizer.recommendation}` : gate;
  }
  if (status === "Rejected") return "Latest replay is rejected, so strategy changes stay blocked until validation improves.";
  if (optimizer?.status?.startsWith("completed_no_")) return optimizer.recommendation ?? "No optimizer challenger passed approval gates, so threshold changes stay blocked.";
  if (optimizer?.recommendation) return optimizer.recommendation;
  return `Latest automatic strategy status: ${status}.`;
}

function optimizerStatusDisplay(report: StrategyDecisionData["latestOptimizerReport"] | null | undefined): { label: string; tone: Tone } {
  const label = optimizerStatusLabel(report?.status);
  if (!report) return { label, tone: "neutral" };
  if (report.status === "failed") return { label, tone: "danger" };
  if (report.status === "running") return { label, tone: "neutral" };
  if (report.status?.startsWith("completed_no_")) return { label, tone: "watch" };

  if (report.status === "completed") {
    const approvalStatus = typeof report.bestCandidate?.approvalStatus === "string" ? report.bestCandidate.approvalStatus.toLowerCase() : "";
    const roi = numericValue(report.bestCandidate?.roi);
    const totalPnl = numericValue(report.bestCandidate?.totalPnl);
    if (approvalStatus.includes("rejected") || (roi !== null && roi <= 0) || (totalPnl !== null && totalPnl <= 0)) {
      return { label: "No promotion", tone: "watch" };
    }
    return { label, tone: "good" };
  }

  return { label, tone: "neutral" };
}

function optimizerStatusLabel(status: string | null | undefined) {
  if (!status) return "Pending";
  const labels: Record<string, string> = {
    completed: "Completed",
    completed_no_candidate: "No candidate passed",
    completed_no_settled_markets: "No settled markets",
    failed: "Failed",
    running: "Running"
  };
  return labels[status] ?? labelize(status);
}

function evidenceGateMessage(settledExamples: number, recommendation?: string) {
  if (recommendation) return `${recommendation} ForecastEdge can keep paper trading with current gates, but threshold changes should wait.`;
  return `${settledExamples} settled examples are available. ForecastEdge can keep paper trading with current gates, but threshold changes should wait.`;
}

function recentAuditIssues(data: DashboardData | null) {
  return (data?.auditLogs ?? []).filter((log) => log.type === "error" || log.type === "live_order_blocked");
}

function strategyReviewBlockers(strategy: StrategyDecisionData | null) {
  const grouped = new Map<string, StrategyDecisionData["warningsRequiringReview"][number] & { count: number }>();
  for (const warning of strategy?.warningsRequiringReview ?? []) {
    const key = `${warning.severity}:${warning.code}:${warning.message}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...warning, count: 1 });
      continue;
    }
    existing.count += 1;
    if (new Date(warning.startedAt).getTime() > new Date(existing.startedAt).getTime()) {
      existing.startedAt = warning.startedAt;
      existing.approvalStatus = warning.approvalStatus;
    }
  }
  return [...grouped.values()].sort((a, b) => {
    const severityDelta = severityRank(b.severity) - severityRank(a.severity);
    if (severityDelta !== 0) return severityDelta;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });
}

function uniqueReviewBlockerCount(strategy: StrategyDecisionData | null) {
  return strategyReviewBlockers(strategy).length;
}

function severityRank(severity: string) {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function auditIssueLabel(issues: ReturnType<typeof recentAuditIssues>) {
  if (issues.length === 0) return "No audit issues";
  return `${issues.length} audit issue${issues.length === 1 ? "" : "s"}`;
}

function dataFreshnessStatus(freshness: StrategyDecisionData["dataFreshness"] | null | undefined): { tone: Tone; label: string } {
  if (!freshness) return { tone: "neutral", label: "Freshness pending" };

  const quoteAge = ageMs(freshness.latestQuoteAt);
  const candidateAge = ageMs(freshness.latestCandidateAt);
  const liveStaleMs = 2 * 60 * 60 * 1000;

  if (quoteAge === null && candidateAge === null) return { tone: "watch", label: "Live data pending" };
  if (quoteAge !== null && quoteAge > liveStaleMs) return { tone: "watch", label: `Quotes ${compactAge(quoteAge)} old` };
  if (candidateAge !== null && candidateAge > liveStaleMs) return { tone: "watch", label: `Candidates ${compactAge(candidateAge)} old` };

  const historicalAges = [freshness.latestHistoricalCandleAt, freshness.latestHistoricalTradeAt]
    .map(ageMs)
    .filter((age): age is number => age !== null);
  const historicalStaleMs = 14 * 24 * 60 * 60 * 1000;

  if (historicalAges.length === 0) return { tone: "watch", label: "Historical data pending" };
  const newestHistoricalAge = Math.min(...historicalAges);
  if (newestHistoricalAge > historicalStaleMs) return { tone: "watch", label: `Historical ${compactAge(newestHistoricalAge)} old` };

  return { tone: "good", label: "Data fresh" };
}

function ageMs(iso: string | null) {
  if (!iso) return null;
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Date.now() - timestamp);
}

function compactAge(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function CandidateList({ candidates, empty, compact = false }: { candidates: CandidateView[]; empty: string; expanded?: boolean; compact?: boolean }) {
  if (candidates.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className={compact ? "candidate-list compact" : "candidate-list"}>
      {candidates.map((candidate) => {
        const isRiskBlocked = candidate.riskBlockers.length > 0;
        const pillTone = isRiskBlocked ? "watch" : candidate.status === "WOULD_BUY" ? "good" : candidate.status === "WATCH" ? "watch" : "neutral";
        const pillLabel = isRiskBlocked ? "Risk blocked" : candidate.status === "WOULD_BUY" ? "Strong" : candidate.status === "WATCH" ? "Watch" : "Blocked";
        return (
          <details className="bet-row expandable-card" key={candidate.marketTicker}>
            <summary className="bet-summary">
              <div className="bet-main">
                <strong>{candidate.displayName}</strong>
                <span>{candidate.marketTicker}</span>
              </div>
              <div className="bet-quick-facts">
                <Fact label="Ask" value={price(candidate.entryPrice)} />
                <Fact label="Edge" value={formatPct(candidate.edge)} good={candidate.status === "WOULD_BUY" && !isRiskBlocked} />
              </div>
              <div className="bet-action">
                <StatusPill tone={pillTone}>{pillLabel}</StatusPill>
                <span className="row-expand-label" aria-hidden="true"><ChevronDown size={16} /></span>
              </div>
            </summary>
            <div className="expandable-body">
              <div className="fact-grid">
                <Fact label="Forecast" value={candidate.forecast} help="The model forecast compared with the market line." />
                <Fact label="Model" value={formatPct(candidate.yesProbability)} help="The model's estimated chance that YES wins." />
                <Fact label="Net edge" value={formatPct(candidate.netEdge ?? null)} help="Edge after estimated execution costs and penalties." />
                <Fact label="Quality" value={candidate.qualityScore === null || candidate.qualityScore === undefined ? "n/a" : candidate.qualityScore.toFixed(2)} help="Composite score used to rank candidates." />
                <Fact label="Spread" value={formatPct(candidate.spread)} help="YES ask minus YES bid." />
                <Fact label="Liquidity" value={formatPct(candidate.liquidityScore)} help="Market liquidity score from the mapping layer." />
                <Fact label="Target" value={candidate.target} help="The temperature line this market resolves against." />
                <Fact label="Expires" value={candidate.expiresAt} help="Last trading time for this Kalshi market when available." />
                <Fact label="Left" value={candidate.timeToExpiration} help="Approximate time until market close." />
                <Fact label="Contracts" value={candidate.recommendedContracts ?? "n/a"} help="Recommended paper contract count before risk checks." />
                <Fact label="Stake" value={moneyOrPending(candidate.recommendedStake ?? null)} help="Recommended paper stake before risk checks." />
              </div>
              {isRiskBlocked ? <p className="row-note warning">Risk blocker: {candidate.riskBlockers.join("; ")}</p> : null}
              <p className="row-note">{candidate.reason}</p>
            </div>
          </details>
        );
      })}
    </div>
  );
}

function HoldingList({ positions }: { positions: HoldingView[]; expanded?: boolean }) {
  if (positions.length === 0) return <EmptyState>No paper holdings yet</EmptyState>;
  return (
    <div className="timeline-list">
      {positions.map((position) => (
        <details className="timeline-row expandable-card" key={position.id}>
          <summary className="timeline-summary">
            <div className="timeline-dot" />
            <div className="timeline-content">
              <div className="row-title">
                <strong>{position.displayName}</strong>
                <StatusPill tone="good">Held</StatusPill>
              </div>
              <span className="row-subtitle">{position.marketTicker}</span>
            </div>
            <div className="bet-quick-facts">
              <Fact label="P/L" value={moneyOrPending(position.unrealizedPnl)} good={(position.unrealizedPnl ?? 0) > 0} danger={(position.unrealizedPnl ?? 0) < 0} />
              <Fact label="Left" value={position.timeToExpiration} />
            </div>
            <span className="row-expand-label" aria-hidden="true"><ChevronDown size={16} /></span>
          </summary>
          <div className="expandable-body">
            <div className="fact-grid">
              <Fact label="Entry" value={price(position.avgEntryPrice)} help="Average simulated fill price per YES contract." />
              <Fact label="P/L" value={moneyOrPending(position.unrealizedPnl)} good={(position.unrealizedPnl ?? 0) > 0} danger={(position.unrealizedPnl ?? 0) < 0} help="Current value minus entry cost; unrealized until settlement." />
              <Fact label="Left" value={position.timeToExpiration} help="Approximate time until market close." />
              <Fact label="Current" value={moneyOrPending(position.currentValue)} help="Estimated exit value using the current YES bid when available." />
              <Fact label="Expires" value={position.expiresAt} help="Last trading time for this market when available." />
              <Fact label="Contracts" value={position.contracts} help="Number of paper YES contracts currently held." />
              <Fact label="Cost" value={money(position.cost)} help="Entry price times filled contracts." />
              <Fact label="Max payout" value={money(position.maxPayout)} help="Gross payout if every YES contract settles at $1." />
              <Fact label="Target" value={position.target} help="The weather line this market resolves against." />
              <Fact label="Opened" value={dateTime(position.openedAt)} help="When the paper order filled." />
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

function ResultList({ results }: { results: ResultView[]; expanded?: boolean }) {
  if (results.length === 0) return <EmptyState>No settled paper results yet</EmptyState>;
  return (
    <div className="result-list">
      {results.map((result) => {
        const outcome = resultOutcome(result.net);
        return (
          <details className="result-row expandable-card" key={result.id}>
            <summary className="result-summary">
              <div>
                <div className="row-title">
                  <strong>{result.displayName}</strong>
                  <StatusPill tone={outcome.tone}>{outcome.label}</StatusPill>
                </div>
                <span className="row-subtitle">{result.marketTicker}</span>
              </div>
              <div className="bet-quick-facts">
                <Fact label="Outcome" value={result.result} />
                <Fact label="Net" value={money(result.net)} good={result.net > 0} danger={result.net < 0} />
              </div>
              <span className="row-expand-label" aria-hidden="true"><ChevronDown size={16} /></span>
            </summary>
            <div className="expandable-body">
              <div className="result-facts">
                <Fact label="Final temp" value={result.finalTemperature} />
                <Fact label="Outcome" value={result.result} />
                <Fact label="Net" value={money(result.net)} good={result.net > 0} danger={result.net < 0} />
                <Fact label="Cost" value={money(result.cost)} />
                <Fact label="Payout" value={money(result.payout)} />
                <Fact label="Closed" value={dateTime(result.closedAt)} />
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}

type ResultStats = {
  wins: number;
  losses: number;
  flats: number;
  grossProfit: number;
  grossLoss: number;
};

function ResultStatsPanel({ title, stats, empty }: { title: string; stats: ResultStats; empty: string }) {
  const settledCount = stats.wins + stats.losses + stats.flats;
  const maxCount = Math.max(1, stats.wins, stats.losses, stats.flats);
  const maxMoney = Math.max(1, stats.grossProfit, stats.grossLoss);
  return (
    <section className="result-chart-panel">
      <div className="result-chart-head">
        <strong>{title}</strong>
        <span>{settledCount} settled</span>
      </div>
      {settledCount > 0 ? (
        <div className="result-bars">
          <ResultBar label="Wins" value={stats.wins} display={String(stats.wins)} max={maxCount} tone="good" />
          <ResultBar label="Losses" value={stats.losses} display={String(stats.losses)} max={maxCount} tone="danger" />
          <ResultBar label="Flat" value={stats.flats} display={String(stats.flats)} max={maxCount} tone="neutral" />
          <ResultBar label="Profit" value={stats.grossProfit} display={money(stats.grossProfit)} max={maxMoney} tone="good" />
          <ResultBar label="Amount lost" value={stats.grossLoss} display={money(stats.grossLoss)} max={maxMoney} tone="danger" />
        </div>
      ) : <EmptyState>{empty}</EmptyState>}
    </section>
  );
}

function ResultBar({ label, value, display, max, tone }: { label: string; value: number; display: string; max: number; tone: "good" | "danger" | "neutral" }) {
  const width = `${Math.max(value > 0 ? 6 : 0, Math.min(100, (value / Math.max(max, 1)) * 100))}%`;
  return (
    <div className="result-bar-row">
      <span>{label}</span>
      <div className="result-bar-track" aria-hidden="true">
        <i className={tone} style={{ width }} />
      </div>
      <b className={tone === "good" ? "good-text" : tone === "danger" ? "danger-text" : ""}>{display}</b>
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
    <span className="help-tip" title={text} aria-label={text} tabIndex={0}>
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
  const summaryColumns = Math.min(columns.length, 3);
  const hasHiddenDetails = columns.length > summaryColumns;
  if (!hasHiddenDetails) {
    return (
      <div className="simple-table" role="table" aria-colcount={columns.length} aria-rowcount={rows.length + 1} style={{ "--columns": columns.length } as CSSProperties}>
        <div className="simple-row header" role="row">
          {columns.map((column) => <span key={column} role="columnheader">{column}</span>)}
        </div>
        {rows.map((row, index) => (
          <div className="simple-row readable-row" key={index} role="row">
            {row.map((cell, cellIndex) => (
              <span key={cellIndex} role="cell">
                <small>{columns[cellIndex]}</small>
                <b>{cell}</b>
              </span>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="simple-table collapsible-table" role="table" aria-colcount={columns.length} aria-rowcount={rows.length + 1} style={{ "--columns": columns.length, "--summary-columns": summaryColumns } as CSSProperties}>
      <div className="simple-row header" role="row">
        {columns.slice(0, summaryColumns).map((column) => <span key={column} role="columnheader">{column}</span>)}
        <span role="columnheader" aria-label="Details" />
      </div>
      {rows.map((row, index) => (
        <details className="simple-row expandable-table-row" key={index} role="row">
          <summary className="simple-row-summary">
            {row.slice(0, summaryColumns).map((cell, cellIndex) => (
              <span key={cellIndex} role="cell">
                <small>{columns[cellIndex]}</small>
                <b>{cell}</b>
              </span>
            ))}
            <span className="row-expand-label table-expand" aria-hidden="true"><ChevronDown size={16} /></span>
          </summary>
          <div className="simple-row-details" role="group">
            {row.slice(summaryColumns).map((cell, offset) => {
              const cellIndex = summaryColumns + offset;
              return (
              <span className="detail-pair" key={cellIndex}>
                <small>{columns[cellIndex]}</small>
                <b>{cell}</b>
              </span>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}

function DashboardState({ tone, label, title, detail, action }: { tone: Tone; label: string; title: string; detail: string; action?: ReactNode }) {
  const isAlert = tone === "watch" || tone === "danger";
  return (
    <section className={`state-panel ${tone}`} role={isAlert ? "alert" : "status"} aria-live={isAlert ? "assertive" : "polite"}>
      <div className="state-icon" aria-hidden="true">
        {isAlert ? <AlertTriangle size={22} /> : <RefreshCw size={22} />}
      </div>
      <div className="state-copy">
        <StatusPill tone={tone}>{label}</StatusPill>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
      {action ? <div className="state-actions">{action}</div> : null}
    </section>
  );
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
  const candidates = [...(data?.trainingCandidates ?? [])].sort((a, b) => (b.qualityScore ?? b.edge ?? -1) - (a.qualityScore ?? a.edge ?? -1));
  const settlements = new Map((data?.settlements ?? []).map((settlement) => [settlement.marketTicker, settlement]));
  const positions = data ? paperPositions(data.paperPositions ?? [], data.paperOrders ?? [], settlements) : [];
  const openPositionTickers = new Set(positions.filter((position) => !position.closedAt).map((position) => position.marketTicker));
  const strongCandidates = candidates.filter((candidate) => candidate.status === "WOULD_BUY");
  const riskState = buildRiskState(data, positions);
  const strong = strongCandidates.filter((candidate) => !openPositionTickers.has(candidate.marketTicker) && candidateRiskBlockers(candidate, riskState).length === 0).map((candidate) => candidateView(candidate, mappings.get(candidate.marketTicker), markets.get(candidate.marketTicker)));
  const heldStrong = strongCandidates.filter((candidate) => openPositionTickers.has(candidate.marketTicker)).map((candidate) => candidateView(candidate, mappings.get(candidate.marketTicker), markets.get(candidate.marketTicker)));
  const riskBlockedStrong = strongCandidates
    .map((candidate) => ({ candidate, riskBlockers: candidateRiskBlockers(candidate, riskState) }))
    .filter(({ candidate, riskBlockers }) => !openPositionTickers.has(candidate.marketTicker) && riskBlockers.length > 0)
    .map(({ candidate, riskBlockers }) => candidateView(candidate, mappings.get(candidate.marketTicker), markets.get(candidate.marketTicker), riskBlockers));
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
    const contracts = Math.max(0, Math.min(limits.maxContractsPerTrade, candidate.recommendedContracts ?? Math.floor(limits.maxStakePerTrade / Math.max(candidate.entryPrice, 0.01))));
    const maxCost = candidate.recommendedStake ?? contracts * candidate.entryPrice;
    if (contracts <= 0) blockers.push("no fillable recommended size");
    if (maxCost > limits.maxStakePerTrade) blockers.push("entry exceeds max stake");
    if (riskState.openExposure + maxCost > limits.maxOpenExposure) blockers.push("open exposure limit reached");
  }
  if (candidate.netEdge !== undefined && candidate.netEdge !== null && candidate.netEdge <= 0) blockers.push("net edge is not positive");
  if (candidate.qualityScore !== undefined && candidate.qualityScore !== null && limits.minQualityScore !== undefined && candidate.qualityScore < limits.minQualityScore) blockers.push("quality score is too low");
  if ((candidate.uncertaintyPenalty ?? 0) > (limits.maxUncertaintyPenalty ?? Infinity)) blockers.push("forecast uncertainty or ensemble disagreement is too high");
  if ((candidate.fillPenalty ?? 0) > (limits.maxFillPenalty ?? Infinity)) blockers.push("expected fill quality is too low");
  if ((candidate.diversificationPenalty ?? 0) > (limits.maxDiversificationPenalty ?? Infinity)) blockers.push("portfolio diversification penalty is too high");
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

function candidateView(candidate: DashboardData["trainingCandidates"][number], mapping: DashboardData["mappings"][number] | undefined, market: MarketView | undefined, riskBlockers: string[] = []) {
  const expiry = expiryView(market, mapping?.targetDate ?? candidate.targetDate);
  return {
    ...candidate,
    riskBlockers,
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

function resultAnalytics(results: ResultView[]) {
  const yesterdayKey = localDateKey(addDays(new Date(), -1));
  return {
    yesterday: summarizeResultWindow(results.filter((result) => localDateKey(new Date(result.closedAt)) === yesterdayKey)),
    allTime: summarizeResultWindow(results)
  };
}

function summarizeResultWindow(results: ResultView[]): ResultStats {
  return results.reduce<ResultStats>((stats, result) => {
    if (result.net > 0) {
      stats.wins += 1;
      stats.grossProfit += result.net;
    } else if (result.net < 0) {
      stats.losses += 1;
      stats.grossLoss += Math.abs(result.net);
    } else {
      stats.flats += 1;
    }
    return stats;
  }, { wins: 0, losses: 0, flats: 0, grossProfit: 0, grossLoss: 0 });
}

function resultOutcome(net: number): { label: string; tone: Tone } {
  if (net > 0) return { label: "Won", tone: "good" };
  if (net < 0) return { label: "Lost", tone: "danger" };
  return { label: "Flat", tone: "neutral" };
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMinutes(date: Date, minutes: number) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function localDateKey(date: Date) {
  if (!Number.isFinite(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function sentenceCase(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

function compactText(value: string, maxLength = 120) {
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trim()}...`;
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

function price(value: number | null) {
  return value === null ? "n/a" : `$${value.toFixed(2)}`;
}

function money(value: number) {
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
}

function moneyOrPending(value: number | null) {
  return value === null ? "pending" : money(value);
}

function memoryLabel(memory: MemoryStatus) {
  return memory.maxRssMb ? `${memory.rssMb}/${memory.maxRssMb} MB` : `${memory.rssMb} MB`;
}

function memoryNearLimit(memory: MemoryStatus | undefined) {
  return Boolean(memory?.maxRssMb && memory.rssMb > memory.maxRssMb * 0.8);
}

function time(iso: string) {
  const date = dateFromIso(iso);
  return date ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date) : "time pending";
}

function shortDate(isoDate: string) {
  const datePart = isoDate.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const date = datePart ? dateFromIso(`${datePart}T12:00:00`) : dateFromIso(isoDate);
  return date ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date) : "date pending";
}

function dateTime(iso: string) {
  const date = dateFromIso(iso);
  return date ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "date pending";
}

function dateFromIso(iso: string) {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dateTimeOrPending(iso: string | null) {
  return iso ? dateTime(iso) : "pending";
}

function dateTimeOrNever(iso: string | null) {
  return iso ? dateTime(iso) : "never";
}

function latestBacktestStatus(value: StrategyDecisionData["latestBacktestHealth"] | BacktestSummary | null) {
  if (!value) return "pending";
  if ("approvalStatus" in value && value.approvalStatus) return value.approvalStatus;
  if ("approval" in value && value.approval?.status) return value.approval.status;
  return "not scored";
}

function latestBacktestRoi(value: StrategyDecisionData["latestBacktestHealth"] | BacktestSummary | null) {
  if (!value) return null;
  if ("roi" in value && typeof value.roi === "number") return value.roi;
  return null;
}

function latestBacktestDataQuality(value: StrategyDecisionData["latestBacktestHealth"] | BacktestSummary | null) {
  const score = latestBacktestDataQualityScore(value);
  if (score !== null) return `${score}/100`;
  if (!value) return "pending";
  return "not scored";
}

function latestBacktestDataQualityScore(value: StrategyDecisionData["latestBacktestHealth"] | BacktestSummary | null) {
  if (!value) return null;
  if ("dataQualityScore" in value && typeof value.dataQualityScore === "number" && Number.isFinite(value.dataQualityScore)) return value.dataQualityScore;
  if ("dataQuality" in value && value.dataQuality && Number.isFinite(value.dataQuality.score)) return value.dataQuality.score;
  return null;
}
