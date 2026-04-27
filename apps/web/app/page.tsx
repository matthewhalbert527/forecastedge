"use client";

import { Activity, AlertTriangle, BarChart3, BrainCircuit, ClipboardList, CloudSun, Gauge, LineChart, LockKeyhole, Play, Power, Radar, Settings, ShieldCheck, WalletCards } from "lucide-react";
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
  paperOrders: Array<{ id: string; marketTicker: string; status: string; filledContracts: number; unfilledContracts: number; simulatedAvgFillPrice: number | null; reason: string; timestamp: string }>;
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

const tabs = [
  ["overview", Activity],
  ["forecast deltas", CloudSun],
  ["model stack", BrainCircuit],
  ["markets", Radar],
  ["signals", LineChart],
  ["paper trades", WalletCards],
  ["performance", BarChart3],
  ["audit", ClipboardList],
  ["settings", Settings]
] as const;

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? process.env.WEB_PUBLIC_API_URL ?? "http://localhost:4000";

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

  const acceptedMappings = useMemo(() => data?.mappings.filter((mapping) => mapping.accepted).length ?? 0, [data]);
  const latestScan = data?.scanReports[0] ?? null;
  const scanVerdict = latestScan ? scanHealth(latestScan) : { label: "Waiting for first scan", tone: "warn" as const, detail: "Run a scan to check providers, market discovery, parser decisions, and signal generation." };
  const firedSignals = data?.signals.filter((signal) => signal.status === "FIRED").length ?? 0;
  const skippedSignals = data?.signals.filter((signal) => signal.status !== "FIRED").length ?? 0;

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
            <Guidance
              title="What to look for"
              items={[
                "Scan health should be OK. Provider failures, rejected mappings, or zero discovered markets mean the system is not ready to trust signals.",
                "Forecast changes are the trigger. No delta usually means no new trade decision, even if markets exist.",
                "Tradable mappings are markets the parser tied to a known settlement station, date, variable, and threshold.",
                "Paper orders only appear after a fired signal passes risk and the simulated order book fill rules."
              ]}
            />
            <div className="panel">
              <h2>Latest scan health</h2>
              <Badge tone={scanVerdict.tone}>{scanVerdict.label}</Badge>
              <p className="decision-note">{scanVerdict.detail}</p>
              {latestScan ? (
                <div className="summary-strip">
                  <SummaryItem label="Markets" value={latestScan.counts.marketsDiscovered} />
                  <SummaryItem label="Accepted" value={latestScan.counts.mappingsAccepted} />
                  <SummaryItem label="Rejected" value={latestScan.counts.mappingsRejected} />
                  <SummaryItem label="Signals" value={latestScan.counts.signalsFired} />
                </div>
              ) : null}
            </div>
            <Metric title="Stations monitored" value={data.locations.length} detail={data.locations.map((loc) => `${loc.city}, ${loc.state}`).join(", ")} />
            <Metric title="Forecast changes" value={data.forecastDeltas.length} detail="Meaningful provider changes that can trigger decisions" />
            <Metric title="Model ensembles" value={data.ensembles.length} detail="Weighted station forecasts used for calibration and future signal scoring" />
            <Metric title="Tradable mappings" value={acceptedMappings} detail={`${data.mappings.length - acceptedMappings} rejected or queued for manual review`} />
            <Metric title="Realized paper P/L" value={money(data.performance.realizedPnl)} detail={`${data.performance.settledTrades} settled positions, ${data.performance.openPositions} open`} />
            <Metric title="Open exposure" value={money(data.performance.unrealizedExposure)} detail="Capital still at risk in unsettled paper positions" />
            <div className="panel">
              <h2>Settlement station readings</h2>
              <p className="muted">These are the weather stations ForecastEdge is using to mirror Kalshi settlement locations when available.</p>
              <Rows rows={data.stationObservations.slice(0, 3).map((obs) => [obs.stationId, obs.stationName, obs.temperatureF === null ? "n/a" : `${obs.temperatureF} F`, time(obs.observedAt)])} empty="No station observations yet" />
            </div>
            <div className="panel wide">
              <h2>Recent audit trail</h2>
              <p className="muted">This is the chronological record of scans, rejected markets, generated signals, paper orders, errors, and mode changes.</p>
              <Rows rows={data.auditLogs.slice(0, 8).map((log) => [time(log.timestamp), log.type, log.message])} empty="No audit entries yet" />
            </div>
            <div className="panel">
              <h2>System safety</h2>
              <p className="muted">Live trading must stay disabled unless you deliberately enable every required backend and UI gate.</p>
              <StatusLine label="Live trading" value={data.safety.liveTradingEnabled ? "enabled" : "disabled"} danger={data.safety.liveTradingEnabled} />
              <StatusLine label="Manual confirmation" value={data.safety.requireManualConfirmation ? "required" : "not required"} />
              <StatusLine label="Production credentials" value={data.safety.prodCredentialConfigured ? "configured" : "not configured"} />
              <StatusLine label="Demo credentials" value={data.safety.demoConfigured ? "configured" : "not configured"} />
            </div>
          </section>
        ) : null}

        {data && tab === "model stack" ? (
          <section className="grid">
            <Guidance
              title="How to read model stack"
              items={[
                "ECMWF is the medium-range anchor. It is useful for spotting market consensus and 1-10 day directional shifts.",
                "HRRR, Meteomatics, GraphCast, GenCast, WeatherMesh, Earth-2, and ICON are represented in the adapter architecture; unavailable sources are not traded from until real data and calibration exist.",
                "The ensemble row is the station/date/variable blend. Look for low disagreement, fresh runs, and high confidence before trusting an edge."
              ]}
            />
            <div className="panel wide">
              <h2>Ensemble forecasts</h2>
              <Rows rows={data.ensembles.slice(0, 40).map((ensemble) => [`${ensemble.city}, ${ensemble.state}`, ensemble.stationId ?? "n/a", ensemble.targetDate, ensemble.variable, ensemble.prediction === null ? "n/a" : valueForVariable(ensemble.variable, ensemble.prediction), ensemble.uncertaintyStdDev === null ? "n/a" : `${ensemble.uncertaintyStdDev.toFixed(2)}`, ensemble.confidence, ensemble.contributingModels.join(", "), ensemble.reason])} empty="No model ensembles yet" />
            </div>
            <div className="panel wide">
              <h2>Model forecast inputs</h2>
              <Rows rows={data.modelForecasts.slice(0, 50).map((point) => [`${point.city}, ${point.state}`, point.stationId ?? "n/a", point.model, point.targetDate, `${point.horizonHours}h`, point.highTempF === null ? "n/a" : `${point.highTempF} F`, point.lowTempF === null ? "n/a" : `${point.lowTempF} F`, point.confidence, time(point.createdAt)])} empty="No model forecast inputs yet" />
            </div>
          </section>
        ) : null}

        {data && tab === "forecast deltas" ? (
          <Panel title="Forecast deltas">
            <p className="muted">A delta is a meaningful forecast move, such as a high/low temperature shift large enough to matter for a Kalshi threshold. Deltas are the main reason the signal engine wakes up.</p>
            <Rows rows={data.forecastDeltas.map((delta) => [`${delta.city}, ${delta.state}`, delta.variable, `${delta.oldValue} -> ${delta.newValue}`, `${delta.absoluteChange}`, delta.targetDate, delta.confidence])} empty="No meaningful deltas yet" />
          </Panel>
        ) : null}

        {data && tab === "markets" ? (
          <Panel title="Kalshi weather markets">
            <div className="explain-bar">
              <Badge tone="ok">accepted = eligible for signals</Badge>
              <Badge tone="warn">review/rejected = no trading</Badge>
              <span>Look for high-confidence rows with a known station, settlement source, threshold, date, and enough liquidity.</span>
            </div>
            <Rows rows={data.mappings.map((mapping) => [mapping.marketTicker, mapping.station ? `${mapping.station.stationId} ${mapping.station.stationName}` : "review", mapping.settlementSource, mapping.variable, mapping.threshold ?? "n/a", mapping.targetDate ?? "n/a", mapping.accepted ? "accepted" : mapping.reviewReason ?? "review", mapping.liquidityScore])} empty="No markets discovered yet" />
          </Panel>
        ) : null}

        {data && tab === "signals" ? (
          <Panel title="Signals">
            <div className="summary-strip inline">
              <SummaryItem label="Fired" value={firedSignals} />
              <SummaryItem label="Skipped" value={skippedSignals} />
              <SummaryItem label="Min edge" value="8 pp" />
            </div>
            <p className="muted">A fired signal means mapping, forecast movement, model edge, liquidity, spread, stale-data checks, and risk limits passed. Skipped signals are useful too: they explain why the system refused to trade.</p>
            <Rows rows={data.signals.map((signal) => [time(signal.createdAt), signal.marketTicker, signal.status, `${(signal.edge * 100).toFixed(1)} pp`, `$${signal.limitPrice.toFixed(2)}`, signal.explanation])} empty="No signals yet" />
          </Panel>
        ) : null}

        {data && tab === "paper trades" ? (
          <Panel title="Paper trades">
            <p className="muted">Paper trades are simulated against market prices and liquidity rules. Filled contracts are tracked separately from unfilled contracts so this does not assume perfect fills.</p>
            <Rows rows={data.paperOrders.map((order) => [time(order.timestamp), order.marketTicker, order.status, order.filledContracts, order.unfilledContracts, order.simulatedAvgFillPrice ? `$${order.simulatedAvgFillPrice.toFixed(2)}` : "n/a", order.reason])} empty="No paper orders yet" />
            <h2 className="subhead">Paper positions</h2>
            <Rows rows={data.paperPositions.map((position) => [position.marketTicker, position.side, position.contracts, `$${position.avgEntryPrice.toFixed(2)}`, position.closedAt ? "settled" : "open", money(position.realizedPnl), position.settlementId ?? "pending"])} empty="No paper positions yet" />
            <h2 className="subhead">Settlements</h2>
            <Rows rows={data.settlements.map((settlement) => [time(settlement.createdAt), settlement.marketTicker, settlement.result.toUpperCase(), settlement.source])} empty="No settled markets yet" />
          </Panel>
        ) : null}

        {data && tab === "performance" ? (
          <section className="grid">
            <Metric title="Total trades" value={data.performance.totalTrades} detail={`${data.performance.rejectedOrders} rejected orders`} />
            <Metric title="Contracts" value={data.performance.simulatedContracts} detail="Filled simulated contracts" />
            <Metric title="Average entry" value={`$${data.performance.averageEntryPrice.toFixed(2)}`} detail="Weighted by contracts" />
            <Metric title="Capital deployed" value={money(data.performance.totalCost)} detail="Total simulated entry cost" />
            <Metric title="Realized P/L" value={money(data.performance.realizedPnl)} detail={`${data.performance.settledTrades} settled positions`} />
            <Metric title="Win rate" value={`${(data.performance.winRate * 100).toFixed(1)}%`} detail="Closed winning positions / closed positions" />
            <Metric title="ROI" value={`${(data.performance.roi * 100).toFixed(1)}%`} detail="Realized P/L / settled entry cost" />
            <Metric title="Max drawdown" value={money(data.performance.maxDrawdown)} detail={`${data.performance.longestLosingStreak} longest losing streak`} />
            <div className="panel wide">
              <h2>Calibration queue</h2>
              <p className="muted">Estimated probability vs actual outcome will populate after settled markets are ingested.</p>
            </div>
          </section>
        ) : null}

        {data && tab === "audit" ? (
          <section className="grid">
            <Guidance
              title="How to audit a scan"
              items={[
                "Start with Scan reports. A clean scan should discover markets, accept known weather mappings, and show zero unexpected rejections.",
                "Provider status tells you whether weather and station data were fresh or degraded.",
                "Decision log is the review trail: every accepted, rejected, skipped, or fired decision includes a reason."
              ]}
            />
            <div className="panel wide">
              <h2>Scan reports</h2>
              <Rows rows={data.scanReports.slice(0, 10).map((scan) => [time(scan.startedAt), scan.trigger, scan.status, `${scan.counts.marketsDiscovered} markets`, `${scan.counts.mappingsAccepted}/${scan.counts.mappingsRejected} mappings`, `${scan.counts.signalsFired}/${scan.counts.signalsSkipped} signals`, `${scan.counts.stationObservations} station obs`, `${scan.counts.ensembles ?? 0} ensembles`])} empty="No scans recorded yet" />
            </div>
            <div className="panel">
              <h2>Provider status</h2>
              <Rows rows={(data.scanReports[0]?.providerResults ?? []).map((result) => [result.provider, result.stationId ?? "", result.status, result.message])} empty="No provider checks yet" />
            </div>
            <div className="panel wide">
              <h2>Decision log</h2>
              <Rows rows={(data.scanReports[0]?.decisions ?? []).slice(0, 50).map((decision) => [decision.stage, decision.status, decision.itemId, decision.reason])} empty="No decisions recorded for latest scan" />
            </div>
          </section>
        ) : null}

        {data && tab === "settings" ? (
          <section className="grid">
            <div className="panel">
              <h2>Locations</h2>
              <p className="muted">These are the monitored Kalshi-style settlement locations. More locations broaden market coverage but also require strict station/date parsing.</p>
              <Rows rows={data.locations.map((loc) => [`${loc.city}, ${loc.state}`, "settlement station", `${loc.pollingIntervalMinutes} min`])} empty="No locations configured" />
            </div>
            <div className="panel">
              <h2>Mode controls</h2>
              <p className="muted">This MVP is intended for watch and paper operation. Live execution remains blocked by backend safety gates.</p>
              <StatusLine label="Current mode" value={data.mode} />
              <StatusLine label="Live orders" value="blocked by default" />
              <StatusLine label="Kill switch" value={data.safety.killSwitchEnabled ? "enabled" : "disabled"} danger={data.safety.killSwitchEnabled} />
              <div className="secret-note"><LockKeyhole size={16} /> Credentials are checked server-side and never rendered.</div>
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

function Rows({ rows, empty }: { rows: Array<Array<React.ReactNode>>; empty: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <div className="rows">
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
