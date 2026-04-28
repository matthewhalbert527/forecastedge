"use client";

import { Activity, AlertTriangle, BarChart3, BriefcaseBusiness, CircleHelp, ClipboardList, Gauge, LineChart, Play, Power, ShieldCheck, ShoppingCart, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type DashboardData = {
  mode: "watch" | "paper" | "demo" | "live";
  locations: Array<{ id: string; city: string; state: string; pollingIntervalMinutes: number }>;
  forecastSnapshots: Array<{ id: string; provider: string; createdAt: string; daily: Array<{ targetDate: string; highTempF: number | null; lowTempF: number | null; precipitationProbabilityPct: number | null }> }>;
  stationObservations: Array<{ stationId: string; stationName: string; observedAt: string; temperatureF: number | null }>;
  forecastDeltas: Array<{ id: string; city: string; state: string; variable: string; targetDate: string; oldValue: number; newValue: number; absoluteChange: number; confidence: string; reason: string; createdAt: string }>;
  markets: Array<{ ticker: string; title: string; yesBid: number | null; yesAsk: number | null; volume: number | null; openInterest: number | null }>;
  mappings: Array<{ marketTicker: string; title: string; variable: string; threshold: number | null; targetDate: string | null; confidence: string; accepted: boolean; reviewReason: string | null; liquidityScore: number; location: { city: string; state?: string } | null; station: { stationId: string; stationName: string } | null; settlementSource: string }>;
  signals: Array<{ id: string; marketTicker: string; status: string; edge: number; limitPrice: number; contracts: number; explanation: string; skipReason: string | null; createdAt: string }>;
  paperOrders: Array<{ id: string; marketTicker: string; side: string; action: string; requestedContracts: number; limitPrice: number; status: string; filledContracts: number; unfilledContracts: number; simulatedAvgFillPrice: number | null; reason: string; timestamp: string }>;
  paperPositions: Array<{ id: string; marketTicker: string; side: string; contracts: number; avgEntryPrice: number; realizedPnl: number; markPrice: number | null; openedAt: string; closedAt: string | null; settlementId: string | null }>;
  settlements: Array<{ id: string; marketTicker: string; result: string; settledPrice: number; source: string; createdAt: string }>;
  modelForecasts: Array<{ id: string; city: string; state: string; stationId: string | null; model: string; targetDate: string; horizonHours: number; highTempF: number | null; lowTempF: number | null; precipitationAmountIn: number | null; windGustMph: number | null; confidence: string; createdAt: string }>;
  ensembles: Array<{ id: string; city: string; state: string; stationId: string | null; targetDate: string; variable: string; prediction: number | null; uncertaintyStdDev: number | null; confidence: string; contributingModels: string[]; disagreement: number | null; reason: string; createdAt: string }>;
  performance: { totalTrades: number; simulatedContracts: number; averageEntryPrice: number; totalCost: number; rejectedOrders: number; realizedPnl: number; unrealizedExposure: number; winRate: number; roi: number; maxDrawdown: number; longestLosingStreak: number; settledTrades: number; openPositions: number };
  auditLogs: Array<{ id: string; timestamp: string; type: string; message: string }>;
  scanReports: Array<{
    id: string;
    startedAt: string;
    completedAt: string | null;
    status: string;
    trigger: string;
    providerResults: Array<{ provider: string; status: string; message: string; stationId?: string }>;
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
      modelForecasts: number;
      ensembles: number;
    };
    decisions: Array<{ stage: string; itemId: string; status: string; reason: string }>;
  }>;
  safety: { liveTradingEnabled: boolean; killSwitchEnabled: boolean; requireManualConfirmation: boolean; demoConfigured: boolean; prodCredentialConfigured: boolean };
};

type ColumnHeader = {
  label: string;
  help: string;
};

const ensembleHeaders: ColumnHeader[] = [
  { label: "Location", help: "City and state for the forecast target." },
  { label: "Station", help: "Settlement weather station used when available." },
  { label: "Date", help: "Market or forecast target date." },
  { label: "Variable", help: "Weather variable being predicted, such as high temperature or wind gust." },
  { label: "Prediction", help: "Blended model value used for scoring." },
  { label: "Uncertainty", help: "Estimated model spread. Lower usually means stronger agreement." },
  { label: "Confidence", help: "Internal confidence bucket for this forecast." },
  { label: "Models", help: "Forecast models contributing to this blended value." },
  { label: "Reason", help: "Why the ensemble was produced or how it should be interpreted." }
];

const modelInputHeaders: ColumnHeader[] = [
  { label: "Location", help: "City and state for the raw forecast point." },
  { label: "Station", help: "Station this forecast is tied to, if known." },
  { label: "Model", help: "Forecast source or model family." },
  { label: "Date", help: "Target day for the forecast." },
  { label: "Horizon", help: "How far ahead the model is forecasting." },
  { label: "High", help: "Forecast high temperature in Fahrenheit." },
  { label: "Low", help: "Forecast low temperature in Fahrenheit." },
  { label: "Confidence", help: "Internal confidence bucket for this input." },
  { label: "Created", help: "When this forecast input was stored." }
];

const forecastDeltaHeaders: ColumnHeader[] = [
  { label: "Location", help: "City and state where the forecast changed." },
  { label: "Variable", help: "Weather value that moved enough to matter." },
  { label: "Move", help: "Previous value to latest value." },
  { label: "Change", help: "Absolute size of the move." },
  { label: "Date", help: "Target date affected by the move." },
  { label: "Confidence", help: "Internal confidence bucket for this delta." }
];

const marketHeaders: ColumnHeader[] = [
  { label: "Ticker", help: "Kalshi market ticker." },
  { label: "Station", help: "Settlement station matched to the market. Review means the parser could not confidently match it." },
  { label: "Source", help: "Weather source expected for settlement." },
  { label: "Variable", help: "Weather variable the market is about." },
  { label: "Threshold", help: "Market line, such as 85 degrees." },
  { label: "Date", help: "Market target date." },
  { label: "Status", help: "Accepted markets can generate signals. Review/rejected markets cannot trade." },
  { label: "Liquidity", help: "Internal liquidity score used by risk checks." }
];

const signalHeaders: ColumnHeader[] = [
  { label: "Time", help: "When the signal was generated." },
  { label: "Ticker", help: "Kalshi market ticker." },
  { label: "Status", help: "Fired means it passed checks. Skipped means it refused to trade." },
  { label: "Edge", help: "Model probability minus implied market probability, in percentage points." },
  { label: "Limit", help: "Maximum price the strategy was willing to pay." },
  { label: "Contracts", help: "Number of contracts requested by the strategy." },
  { label: "Why", help: "Short reason. Hover for the full explanation." }
];

const paperOrderHeaders: ColumnHeader[] = [
  { label: "Time", help: "When the paper order was recorded." },
  { label: "Ticker", help: "Kalshi market ticker." },
  { label: "Status", help: "Filled, partial, or rejected paper execution result." },
  { label: "Filled", help: "Contracts counted as held in paper mode." },
  { label: "Unfilled", help: "Contracts not filled. In current paper mode approved signals are held hypothetically." },
  { label: "Avg price", help: "Average simulated entry price." },
  { label: "Reason", help: "Execution note. Hover for the full text." }
];

const paperPositionHeaders: ColumnHeader[] = [
  { label: "Ticker", help: "Kalshi market ticker." },
  { label: "Side", help: "YES or NO position." },
  { label: "Contracts", help: "Open or settled contract count." },
  { label: "Entry", help: "Average entry price per contract." },
  { label: "Status", help: "Open positions are still being held; settled positions have a result." },
  { label: "P/L", help: "Realized profit or loss after settlement." },
  { label: "Settlement", help: "Settlement record id, or pending if not settled yet." }
];

const settlementHeaders: ColumnHeader[] = [
  { label: "Time", help: "When settlement was recorded." },
  { label: "Ticker", help: "Settled market ticker." },
  { label: "Result", help: "Official YES or NO outcome." },
  { label: "Source", help: "Source used to determine settlement." }
];

const scanReportHeaders: ColumnHeader[] = [
  { label: "Started", help: "When the scan began." },
  { label: "Trigger", help: "Manual, startup, or scheduled run." },
  { label: "Status", help: "Whether the scan completed cleanly or with errors." },
  { label: "Markets", help: "Markets discovered during this scan." },
  { label: "Mappings", help: "Accepted/rejected market mappings." },
  { label: "Signals", help: "Fired/skipped signal decisions." },
  { label: "Obs", help: "Station observations collected." },
  { label: "Ensembles", help: "Model ensemble records produced." }
];

const providerHeaders: ColumnHeader[] = [
  { label: "Provider", help: "Weather, market, or station data provider." },
  { label: "Station", help: "Station id involved in the provider check, if any." },
  { label: "Status", help: "Provider check result." },
  { label: "Message", help: "Provider detail. Hover for the full message." }
];

const decisionHeaders: ColumnHeader[] = [
  { label: "Stage", help: "Pipeline stage that made the decision." },
  { label: "Status", help: "Accepted, rejected, fired, skipped, filled, partial, or error." },
  { label: "Item", help: "Identifier for the decision target." },
  { label: "Reason", help: "Decision explanation. Hover for the full text." }
];

const locationHeaders: ColumnHeader[] = [
  { label: "Location", help: "City and state being monitored." },
  { label: "Role", help: "Why this location is tracked." },
  { label: "Interval", help: "Configured polling interval for this location." }
];

const tabs = [
  ["overview", Activity],
  ["decisions", LineChart],
  ["paper", WalletCards],
  ["performance", BarChart3],
  ["data", ClipboardList]
] as const;

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

export default function Page() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`${apiUrl}/api/dashboard`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Dashboard API returned ${response.status}`);
    setData(await response.json());
  }

  async function runOnce() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/api/run-once`, { method: "POST" });
      if (!response.ok) throw new Error(`Run failed with ${response.status}`);
      setData(await response.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown run error");
    } finally {
      setLoading(false);
    }
  }

  async function runSettlements() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/api/settlements/run-once`, { method: "POST" });
      if (!response.ok) throw new Error(`Settlement run failed with ${response.status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown settlement error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Unable to load dashboard"));
    const timer = window.setInterval(() => refresh().catch(() => undefined), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const locations = data?.locations ?? [];
  const forecastDeltas = data?.forecastDeltas ?? [];
  const mappings = data?.mappings ?? [];
  const signals = data?.signals ?? [];
  const paperOrders = data?.paperOrders ?? [];
  const paperPositions = data?.paperPositions ?? [];
  const settlements = data?.settlements ?? [];
  const modelForecasts = data?.modelForecasts ?? [];
  const ensembles = data?.ensembles ?? [];
  const scanReports = data?.scanReports ?? [];
  const acceptedMappings = useMemo(() => mappings.filter((mapping) => mapping.accepted).length, [mappings]);
  const latestScan = scanReports[0] ?? null;
  const scanVerdict = latestScan ? scanHealth(latestScan) : { label: "Waiting for first scan", tone: "warn" as const, detail: "Run a scan to check providers, market discovery, parser decisions, and signal generation." };
  const firedSignals = signals.filter((signal) => signal.status === "FIRED").length;
  const skippedSignals = signals.filter((signal) => signal.status !== "FIRED").length;
  const latestRunOrderIds = new Set((latestScan?.decisions ?? []).filter((decision) => decision.stage === "paper_order").map((decision) => decision.itemId));
  const performance = { ...emptyPerformance, ...(data?.performance ?? {}) };
  const latestRunBuyOrders = paperOrders.filter((order) => {
    if (latestRunOrderIds.size > 0) return latestRunOrderIds.has(order.id);
    if (!latestScan) return false;
    const completedAt = latestScan.completedAt ?? new Date().toISOString();
    return order.timestamp >= latestScan.startedAt && order.timestamp <= completedAt;
  });
  const openPaperPositions = paperPositions.filter((position) => !position.closedAt);
  const skippedSignalRows = signals.filter((signal) => signal.status !== "FIRED");
  const nearMisses = [...skippedSignalRows].sort((a, b) => b.edge - a.edge).slice(0, 8);
  const blockerCounts = summarizeBlockers(skippedSignalRows);
  const latestRunSummary = latestScan ? summarizeLatestRun(latestScan) : "No scan has completed yet.";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Gauge size={28} />
          <div>
            <h1>ForecastEdge</h1>
            <p>Weather market monitor</p>
          </div>
        </div>
        <nav className="nav">
          {tabs.map(([name, Icon]) => (
            <button key={name} className={tab === name ? "active" : ""} onClick={() => setTab(name)}>
              <Icon size={17} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="section-label">Mode</p>
            <div className="mode-row">
              <span className={`mode mode-${data?.mode ?? "paper"}`}>{data?.mode ?? "paper"}</span>
              {data?.safety.killSwitchEnabled ? <span className="status danger"><Power size={14} /> Kill switch on</span> : <span className="status ok"><ShieldCheck size={14} /> Kill switch off</span>}
            </div>
          </div>
          <button className="primary" onClick={runOnce} disabled={loading}>
            <Play size={16} />
            {loading ? "Running" : "Run scan"}
          </button>
          <button className="secondary" onClick={runSettlements} disabled={loading}>
            Reconcile settlements
          </button>
        </header>

        {error ? <div className="alert"><AlertTriangle size={18} /> {error}</div> : null}
        {!data ? <div className="empty">Loading ForecastEdge dashboard from {apiUrl}</div> : null}

        {data && tab === "overview" ? (
          <section className="grid">
            <div className="panel overview-hero wide">
              <div>
                <p className="section-label">Latest run</p>
                <h2>{latestScan ? `${latestRunBuyOrders.length} buy decision${latestRunBuyOrders.length === 1 ? "" : "s"}` : "No scan run yet"}</h2>
                <p className="muted">{latestScan ? `Last scan ${time(latestScan.startedAt)}. ${scanVerdict.detail}` : "Run a scan to let ForecastEdge evaluate markets and create paper orders."}</p>
              </div>
              <Badge tone={scanVerdict.tone}>{scanVerdict.label}</Badge>
            </div>
            <Metric title="Currently held" value={openPaperPositions.length} detail={`${performance.simulatedContracts} simulated contracts, ${money(performance.unrealizedExposure)} open exposure`} />
            <Metric title="Paper P/L" value={money(performance.realizedPnl)} detail={`${performance.settledTrades} settled, ${performance.openPositions} open`} />
            <div className="panel decision-brief wide">
              <h2>Buy readiness</h2>
              <p className="decision-note">{latestRunSummary}</p>
              <div className="blocker-list">
                {blockerCounts.length === 0 ? (
                  <span className="blocker ok">No recent skipped-signal blockers</span>
                ) : (
                  blockerCounts.slice(0, 4).map((blocker) => (
                    <span className="blocker" key={blocker.reason}>{blocker.reason}: {blocker.count}</span>
                  ))
                )}
              </div>
            </div>
            <div className="panel trade-list wide">
              <div className="panel-heading">
                <ShoppingCart size={18} />
                <h2>Bought on last run</h2>
              </div>
              {latestRunBuyOrders.length === 0 ? (
                <EmptyState title="No buy orders on the last run" detail="A scan can finish cleanly without buying when no signal passes edge, liquidity, price, and risk checks." />
              ) : (
                <div className="decision-list">
                  {latestRunBuyOrders.map((order) => (
                    <OrderCard key={order.id} order={order} />
                  ))}
                </div>
              )}
            </div>
            <div className="panel trade-list wide">
              <div className="panel-heading">
                <BriefcaseBusiness size={18} />
                <h2>Currently held</h2>
              </div>
              {openPaperPositions.length === 0 ? (
                <EmptyState title="No open paper positions" detail="Filled paper orders will appear here as hypothetical holdings until settlement reconciliation closes them." />
              ) : (
                <div className="holding-list">
                  {openPaperPositions.map((position) => (
                    <HoldingCard key={position.id} position={position} />
                  ))}
                </div>
              )}
            </div>
            <div className="panel overview-status">
              <h2>Run summary</h2>
              {latestScan ? (
                <>
                  <StatusLine label="Fired signals" value={`${latestScan.counts.signalsFired}`} />
                  <StatusLine label="Paper orders" value={`${latestScan.counts.paperOrders}`} />
                  <StatusLine label="Accepted mappings" value={`${latestScan.counts.mappingsAccepted}`} />
                  <StatusLine label="Rejected mappings" value={`${latestScan.counts.mappingsRejected}`} danger={latestScan.counts.mappingsRejected > 0} />
                </>
              ) : (
                <p className="muted">No scan report is available yet.</p>
              )}
            </div>
            <div className="panel overview-status">
              <h2>Paper readiness</h2>
              <StatusLine label="Mode" value={data.mode} />
              <StatusLine label="Tradable mappings" value={`${acceptedMappings}`} />
              <StatusLine label="Live trading" value={data.safety.liveTradingEnabled ? "enabled" : "disabled"} danger={data.safety.liveTradingEnabled} />
              <StatusLine label="Kill switch" value={data.safety.killSwitchEnabled ? "enabled" : "disabled"} danger={data.safety.killSwitchEnabled} />
            </div>
          </section>
        ) : null}

        {data && tab === "data" ? (
          <section className="grid">
            <Guidance
              title="Data room"
              items={[
                "This area keeps the detailed model, market, scan, and configuration data available without crowding the daily trading view.",
                "Use it when you need to diagnose stale data, mapping coverage, provider failures, or model inputs.",
                "The Overview and Decisions tabs are the primary operating surfaces."
              ]}
            />
            <div className="panel wide">
              <h2>Ensemble forecasts <HelpTip text="The blended forecast ForecastEdge uses when scoring market edges." /></h2>
              <Rows headers={ensembleHeaders} rows={ensembles.slice(0, 40).map((ensemble) => [`${ensemble.city}, ${ensemble.state}`, ensemble.stationId ?? "n/a", ensemble.targetDate, ensemble.variable, ensemble.prediction === null ? "n/a" : valueForVariable(ensemble.variable, ensemble.prediction), ensemble.uncertaintyStdDev === null ? "n/a" : `${ensemble.uncertaintyStdDev.toFixed(2)}`, ensemble.confidence, ensemble.contributingModels.join(", "), <HoverText key={ensemble.id} label={shorten(ensemble.reason, 80)} detail={ensemble.reason} />])} empty="No model ensembles yet" />
            </div>
            <div className="panel wide">
              <h2>Model forecast inputs <HelpTip text="Raw model points that feed the ensemble before signals are generated." /></h2>
              <Rows headers={modelInputHeaders} rows={modelForecasts.slice(0, 50).map((point) => [`${point.city}, ${point.state}`, point.stationId ?? "n/a", point.model, point.targetDate, `${point.horizonHours}h`, point.highTempF === null ? "n/a" : `${point.highTempF} F`, point.lowTempF === null ? "n/a" : `${point.lowTempF} F`, point.confidence, time(point.createdAt)])} empty="No model forecast inputs yet" />
            </div>
            <div className="panel wide">
              <h2>Forecast deltas <HelpTip text="Meaningful forecast changes that can wake up signal generation." /></h2>
              <Rows headers={forecastDeltaHeaders} rows={forecastDeltas.map((delta) => [`${delta.city}, ${delta.state}`, delta.variable, `${delta.oldValue} -> ${delta.newValue}`, `${delta.absoluteChange}`, delta.targetDate, delta.confidence])} empty="No meaningful deltas yet" />
            </div>
            <div className="panel wide">
              <h2>Scan reports</h2>
              <Rows headers={scanReportHeaders} rows={scanReports.slice(0, 10).map((scan) => [time(scan.startedAt), scan.trigger, scan.status, scan.counts.marketsDiscovered, `${scan.counts.mappingsAccepted}/${scan.counts.mappingsRejected}`, `${scan.counts.signalsFired}/${scan.counts.signalsSkipped}`, scan.counts.stationObservations, scan.counts.ensembles ?? 0])} empty="No scans recorded yet" />
            </div>
            <div className="panel">
              <h2>Provider status</h2>
              <Rows headers={providerHeaders} rows={(scanReports[0]?.providerResults ?? []).map((result) => [result.provider, result.stationId ?? "", result.status, <HoverText key={`${result.provider}-${result.stationId ?? "none"}`} label={shorten(result.message, 60)} detail={result.message} />])} empty="No provider checks yet" />
            </div>
            <div className="panel wide">
              <h2>Decision log</h2>
              <Rows headers={decisionHeaders} rows={(scanReports[0]?.decisions ?? []).slice(0, 50).map((decision) => [decision.stage, decision.status, decision.itemId, <HoverText key={`${decision.stage}-${decision.itemId}`} label={shorten(decision.reason, 70)} detail={decision.reason} />])} empty="No decisions recorded for latest scan" />
            </div>
            <div className="panel">
              <h2>Locations</h2>
              <Rows headers={locationHeaders} rows={locations.map((loc) => [`${loc.city}, ${loc.state}`, "settlement station", `${loc.pollingIntervalMinutes} min`])} empty="No locations configured" />
            </div>
          </section>
        ) : null}

        {data && tab === "decisions" ? (
          <section className="grid">
            <div className="panel wide">
              <h2>Decision watchlist <HelpTip text="Skipped signals ranked by closest edge. This is where you can see if the model is almost ready to buy." /></h2>
              <p className="muted">A buy needs a fresh forecast move, accepted mapping, positive edge above the threshold, tradable price, tolerable spread, enough liquidity, and open risk capacity.</p>
              <Rows headers={signalHeaders} rows={nearMisses.map((signal) => [time(signal.createdAt), signal.marketTicker, signal.status, `${(signal.edge * 100).toFixed(1)} pp`, `$${signal.limitPrice.toFixed(2)}`, signal.contracts, <HoverText key={signal.id} label={signalSummary(signal)} detail={signal.explanation} />])} empty="No skipped signals yet. If the latest scan had no forecast deltas, the model had nothing new to score." />
            </div>
            <div className="panel overview-status">
              <h2>Common blockers</h2>
              {blockerCounts.length === 0 ? <p className="muted">No skipped-signal blockers recorded yet.</p> : blockerCounts.slice(0, 8).map((blocker) => <StatusLine key={blocker.reason} label={blocker.reason} value={`${blocker.count}`} />)}
            </div>
            <Panel title="All signals">
            <div className="summary-strip inline">
              <SummaryItem label="Fired" value={firedSignals} />
              <SummaryItem label="Skipped" value={skippedSignals} />
              <SummaryItem label="Min edge" value="8 pp" />
            </div>
            <p className="muted">A fired signal means mapping, forecast movement, model edge, liquidity, spread, stale-data checks, and risk limits passed. Skipped signals are useful too: they explain why the system refused to trade.</p>
            <Rows headers={signalHeaders} rows={signals.map((signal) => [time(signal.createdAt), signal.marketTicker, signal.status, `${(signal.edge * 100).toFixed(1)} pp`, `$${signal.limitPrice.toFixed(2)}`, signal.contracts, <HoverText key={signal.id} label={signalSummary(signal)} detail={signal.explanation} />])} empty="No signals yet" />
            </Panel>
            <Panel title="Tradable market coverage">
              <div className="explain-bar">
                <Badge tone="ok">accepted = eligible for signals</Badge>
                <Badge tone="warn">review/rejected = no trading</Badge>
                <span>Use this when the model is not finding enough opportunities.</span>
              </div>
              <Rows headers={marketHeaders} rows={mappings.map((mapping) => [mapping.marketTicker, mapping.station ? `${mapping.station.stationId} ${mapping.station.stationName}` : "review", mapping.settlementSource, mapping.variable, mapping.threshold ?? "n/a", mapping.targetDate ?? "n/a", mapping.accepted ? "accepted" : <HoverText key={mapping.marketTicker} label="review" detail={mapping.reviewReason ?? "Needs manual review before trading."} />, mapping.liquidityScore])} empty="No markets discovered yet" />
            </Panel>
          </section>
        ) : null}

        {data && tab === "paper" ? (
          <Panel title="Paper trades">
            <p className="muted">Paper trades are simulated against market prices and liquidity rules. Filled contracts are tracked separately from unfilled contracts so this does not assume perfect fills.</p>
            <Rows headers={paperOrderHeaders} rows={paperOrders.map((order) => [time(order.timestamp), order.marketTicker, order.status, order.filledContracts, order.unfilledContracts, order.simulatedAvgFillPrice ? `$${order.simulatedAvgFillPrice.toFixed(2)}` : "n/a", <HoverText key={order.id} label={shorten(order.reason, 54)} detail={order.reason} />])} empty="No paper orders yet" />
            <h2 className="subhead">Paper positions</h2>
            <Rows headers={paperPositionHeaders} rows={paperPositions.map((position) => [position.marketTicker, position.side, position.contracts, `$${position.avgEntryPrice.toFixed(2)}`, position.closedAt ? "settled" : "open", money(position.realizedPnl), position.settlementId ?? "pending"])} empty="No paper positions yet" />
            <h2 className="subhead">Settlements</h2>
            <Rows headers={settlementHeaders} rows={settlements.map((settlement) => [time(settlement.createdAt), settlement.marketTicker, settlement.result.toUpperCase(), settlement.source])} empty="No settled markets yet" />
          </Panel>
        ) : null}

        {data && tab === "performance" ? (
          <section className="grid">
            <Metric title="Total trades" value={performance.totalTrades} detail={`${performance.rejectedOrders} rejected orders`} />
            <Metric title="Contracts" value={performance.simulatedContracts} detail="Filled simulated contracts" />
            <Metric title="Average entry" value={`$${performance.averageEntryPrice.toFixed(2)}`} detail="Weighted by contracts" />
            <Metric title="Capital deployed" value={money(performance.totalCost)} detail="Total simulated entry cost" />
            <Metric title="Realized P/L" value={money(performance.realizedPnl)} detail={`${performance.settledTrades} settled positions`} />
            <Metric title="Win rate" value={`${(performance.winRate * 100).toFixed(1)}%`} detail="Closed winning positions / closed positions" />
            <Metric title="ROI" value={`${(performance.roi * 100).toFixed(1)}%`} detail="Realized P/L / settled entry cost" />
            <Metric title="Max drawdown" value={money(performance.maxDrawdown)} detail={`${performance.longestLosingStreak} longest losing streak`} />
            <div className="panel wide">
              <h2>Calibration queue</h2>
              <p className="muted">Estimated probability vs actual outcome will populate after settled markets are ingested.</p>
            </div>
          </section>
        ) : null}

      </section>
    </main>
  );
}

function Metric({ title, value, detail }: { title: string; value: React.ReactNode; detail: string }) {
  return (
    <div className="panel metric">
      <p className="section-label">{title}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel wide">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function Guidance({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="panel guidance wide">
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Badge({ tone, children }: { tone: "ok" | "warn" | "danger" | "neutral"; children: React.ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function SummaryItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function OrderCard({ order }: { order: DashboardData["paperOrders"][number] }) {
  const filledCost = (order.simulatedAvgFillPrice ?? order.limitPrice) * order.filledContracts;
  return (
    <article className="trade-card">
      <div>
        <div className="trade-title">
          <strong>{order.marketTicker}</strong>
          <Badge tone={order.status === "FILLED" ? "ok" : order.status === "PARTIAL" ? "warn" : "neutral"}>{order.status}</Badge>
        </div>
        <p className="muted">{order.reason}</p>
      </div>
      <div className="trade-facts">
        <span>{order.side} {order.action}</span>
        <span>{order.filledContracts}/{order.requestedContracts} filled</span>
        <span>{order.simulatedAvgFillPrice === null ? `limit $${order.limitPrice.toFixed(2)}` : `${money(filledCost)} at $${order.simulatedAvgFillPrice.toFixed(2)}`}</span>
      </div>
    </article>
  );
}

function HoldingCard({ position }: { position: DashboardData["paperPositions"][number] }) {
  const exposure = position.avgEntryPrice * position.contracts;
  return (
    <article className="trade-card holding-card">
      <div>
        <div className="trade-title">
          <strong>{position.marketTicker}</strong>
          <Badge tone="ok">Open</Badge>
        </div>
        <p className="muted">Opened {time(position.openedAt)}. Settlement pending.</p>
      </div>
      <div className="trade-facts">
        <span>{position.side}</span>
        <span>{position.contracts} contracts</span>
        <span>{money(exposure)} at ${position.avgEntryPrice.toFixed(2)}</span>
      </div>
    </article>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <span className="help-tip" tabIndex={0} aria-label={text} title={text}>
      <CircleHelp size={13} />
    </span>
  );
}

function HoverText({ label, detail }: { label: string; detail: string }) {
  return (
    <span className="hover-text" tabIndex={0} title={detail}>
      {label}
      <HelpTip text={detail} />
    </span>
  );
}

function Rows({ headers, rows, empty }: { headers?: ColumnHeader[]; rows: Array<Array<React.ReactNode>>; empty: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="rows">
      {headers ? (
        <div className="row row-header">
          {headers.map((header) => (
            <span key={header.label}>
              {header.label}
              <HelpTip text={header.help} />
            </span>
          ))}
        </div>
      ) : null}
      {rows.map((row, index) => (
        <div className="row" key={index}>
          {row.map((cell, cellIndex) => (
            <span key={cellIndex}>{cell}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function signalSummary(signal: DashboardData["signals"][number]) {
  if (signal.status === "FIRED") return `Buy ${signal.contracts} at $${signal.limitPrice.toFixed(2)}; edge ${(signal.edge * 100).toFixed(1)} pp`;
  return shorten(signal.skipReason ?? signal.explanation, 72);
}

function summarizeBlockers(signals: DashboardData["signals"]) {
  const counts = new Map<string, number>();
  for (const signal of signals) {
    for (const reason of (signal.skipReason ?? "unknown skip reason").split(";")) {
      const normalized = reason.trim();
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

function summarizeLatestRun(scan: DashboardData["scanReports"][number]) {
  if (scan.counts.paperOrders > 0) return `${scan.counts.paperOrders} paper order${scan.counts.paperOrders === 1 ? "" : "s"} recorded on the latest scan.`;
  if (scan.counts.signalsFired > 0) return `${scan.counts.signalsFired} signal${scan.counts.signalsFired === 1 ? "" : "s"} fired, but no paper order was recorded. Check the decision log.`;
  if (scan.counts.signalsSkipped > 0) return `${scan.counts.signalsSkipped} signal${scan.counts.signalsSkipped === 1 ? "" : "s"} scored, but every one was skipped. Open Decisions to see the blockers.`;
  if (scan.counts.forecastDeltas === 0) return "No meaningful forecast delta on the latest scan, so the model did not have a new trade setup to score.";
  return "The latest scan found data but did not produce a buy setup. Open Data for provider and decision details.";
}

function shorten(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function StatusLine({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="status-line">
      <span>{label}</span>
      <strong className={danger ? "danger-text" : ""}>{value}</strong>
    </div>
  );
}

function time(iso: string) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function money(value: number) {
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
}

function valueForVariable(variable: string, value: number) {
  if (variable.includes("temp")) return `${value.toFixed(1)} F`;
  if (variable === "rainfall") return `${value.toFixed(2)} in`;
  if (variable === "wind_gust") return `${value.toFixed(1)} mph`;
  return value.toFixed(2);
}

function scanHealth(scan: DashboardData["scanReports"][number]) {
  const failedProviders = scan.providerResults.filter((result) => result.status !== "ok").length;
  if (scan.status.includes("error")) {
    return { label: "Scan has errors", tone: "danger" as const, detail: "Open Provider status and Decision log before trusting any signal from this run." };
  }
  if (failedProviders > 0) {
    return { label: "Provider degraded", tone: "warn" as const, detail: `${failedProviders} provider check failed or degraded. Signals may be skipped because data freshness is uncertain.` };
  }
  if (scan.counts.marketsDiscovered === 0) {
    return { label: "No markets found", tone: "warn" as const, detail: "Kalshi discovery returned no markets, so the scanner has nothing to map or trade." };
  }
  if (scan.counts.mappingsRejected > 0) {
    return { label: "Review rejected mappings", tone: "warn" as const, detail: `${scan.counts.mappingsRejected} markets were rejected. This is safe behavior, but review the reasons before expanding trading.` };
  }
  return { label: "Scan OK", tone: "ok" as const, detail: "Providers responded, weather markets were discovered, and mappings were accepted without parser rejects." };
}
