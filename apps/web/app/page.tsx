"use client";

import { Activity, AlertTriangle, BarChart3, CloudSun, Gauge, LineChart, LockKeyhole, Play, Power, Radar, Settings, ShieldCheck, WalletCards } from "lucide-react";
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
  performance: { totalTrades: number; simulatedContracts: number; averageEntryPrice: number; totalCost: number; rejectedOrders: number };
  auditLogs: Array<{ id: string; timestamp: string; type: string; message: string }>;
  safety: { liveTradingEnabled: boolean; killSwitchEnabled: boolean; requireManualConfirmation: boolean; demoConfigured: boolean; prodCredentialConfigured: boolean };
};

const tabs = [
  ["overview", Activity],
  ["forecast deltas", CloudSun],
  ["markets", Radar],
  ["signals", LineChart],
  ["paper trades", WalletCards],
  ["performance", BarChart3],
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

  useEffect(() => {
    refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Unable to load dashboard"));
    const timer = window.setInterval(() => refresh().catch(() => undefined), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const acceptedMappings = useMemo(() => data?.mappings.filter((mapping) => mapping.accepted).length ?? 0, [data]);

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
        </header>

        {error ? <div className="alert"><AlertTriangle size={18} /> {error}</div> : null}
        {!data ? <div className="empty">Loading ForecastEdge dashboard from {apiUrl}</div> : null}

        {data && tab === "overview" ? (
          <section className="grid">
            <Metric title="Active locations" value={data.locations.length} detail={data.locations.map((loc) => `${loc.city}, ${loc.state}`).join(", ")} />
            <Metric title="Recent deltas" value={data.forecastDeltas.length} detail="Meaningful changes retained with audit trail" />
            <Metric title="Accepted mappings" value={acceptedMappings} detail={`${data.mappings.length - acceptedMappings} queued for manual review`} />
            <Metric title="Paper P/L" value="$0.00" detail={`${data.performance.totalTrades} simulated trades, settlement pending`} />
            <div className="panel">
              <h2>Settlement station</h2>
              <Rows rows={data.stationObservations.slice(0, 3).map((obs) => [obs.stationId, obs.stationName, obs.temperatureF === null ? "n/a" : `${obs.temperatureF} F`, time(obs.observedAt)])} empty="No station observations yet" />
            </div>
            <div className="panel wide">
              <h2>Recent audit trail</h2>
              <Rows rows={data.auditLogs.slice(0, 8).map((log) => [time(log.timestamp), log.type, log.message])} empty="No audit entries yet" />
            </div>
            <div className="panel">
              <h2>System safety</h2>
              <StatusLine label="Live trading" value={data.safety.liveTradingEnabled ? "enabled" : "disabled"} danger={data.safety.liveTradingEnabled} />
              <StatusLine label="Manual confirmation" value={data.safety.requireManualConfirmation ? "required" : "not required"} />
              <StatusLine label="Production credentials" value={data.safety.prodCredentialConfigured ? "configured" : "not configured"} />
              <StatusLine label="Demo credentials" value={data.safety.demoConfigured ? "configured" : "not configured"} />
            </div>
          </section>
        ) : null}

        {data && tab === "forecast deltas" ? (
          <Panel title="Forecast deltas">
            <Rows rows={data.forecastDeltas.map((delta) => [`${delta.city}, ${delta.state}`, delta.variable, `${delta.oldValue} -> ${delta.newValue}`, `${delta.absoluteChange}`, delta.targetDate, delta.confidence])} empty="No meaningful deltas yet" />
          </Panel>
        ) : null}

        {data && tab === "markets" ? (
          <Panel title="Kalshi weather markets">
            <Rows rows={data.mappings.map((mapping) => [mapping.marketTicker, mapping.station ? `${mapping.station.stationId} ${mapping.station.stationName}` : "review", mapping.settlementSource, mapping.variable, mapping.threshold ?? "n/a", mapping.targetDate ?? "n/a", mapping.accepted ? "accepted" : mapping.reviewReason ?? "review", mapping.liquidityScore])} empty="No markets discovered yet" />
          </Panel>
        ) : null}

        {data && tab === "signals" ? (
          <Panel title="Signals">
            <Rows rows={data.signals.map((signal) => [time(signal.createdAt), signal.marketTicker, signal.status, `${(signal.edge * 100).toFixed(1)} pp`, `$${signal.limitPrice.toFixed(2)}`, signal.explanation])} empty="No signals yet" />
          </Panel>
        ) : null}

        {data && tab === "paper trades" ? (
          <Panel title="Paper trades">
            <Rows rows={data.paperOrders.map((order) => [time(order.timestamp), order.marketTicker, order.status, order.filledContracts, order.unfilledContracts, order.simulatedAvgFillPrice ? `$${order.simulatedAvgFillPrice.toFixed(2)}` : "n/a", order.reason])} empty="No paper orders yet" />
          </Panel>
        ) : null}

        {data && tab === "performance" ? (
          <section className="grid">
            <Metric title="Total trades" value={data.performance.totalTrades} detail={`${data.performance.rejectedOrders} rejected orders`} />
            <Metric title="Contracts" value={data.performance.simulatedContracts} detail="Filled simulated contracts" />
            <Metric title="Average entry" value={`$${data.performance.averageEntryPrice.toFixed(2)}`} detail="Weighted by contracts" />
            <Metric title="Capital deployed" value={`$${data.performance.totalCost.toFixed(2)}`} detail="Settlement not reconciled yet" />
            <div className="panel wide">
              <h2>Calibration queue</h2>
              <p className="muted">Estimated probability vs actual outcome will populate after settled markets are ingested.</p>
            </div>
          </section>
        ) : null}

        {data && tab === "settings" ? (
          <section className="grid">
            <div className="panel">
              <h2>Locations</h2>
              <Rows rows={data.locations.map((loc) => [`${loc.city}, ${loc.state}`, "settlement station", `${loc.pollingIntervalMinutes} min`])} empty="No locations configured" />
            </div>
            <div className="panel">
              <h2>Mode controls</h2>
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
