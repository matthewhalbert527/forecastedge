import {
  checkRisk,
  detectForecastDeltas,
  estimateMarketProbability,
  generateSignal,
  parseKalshiWeatherMarket,
  simulatePaperOrder,
  summarizePaperOrders
} from "@forecastedge/core";
import { AuditLog } from "../audit/audit-log.js";
import { activeRiskLimits, env } from "../config/env.js";
import { MemoryStore } from "../data/store.js";
import { discoverWeatherMarkets, getOrderBook } from "../kalshi/client.js";
import { fetchAccuWeatherDailyForecast } from "../weather/accuweather.js";
import { fetchNwsLatestStationObservation } from "../weather/nws-station.js";
import { fetchOpenMeteoForecast } from "../weather/open-meteo.js";

export class ForecastEdgePipeline {
  constructor(
    private readonly store: MemoryStore,
    private readonly audit: AuditLog
  ) {}

  async runOnce() {
    for (const location of this.store.locations) {
      const previous = this.store.latestSnapshot(location.id, "open_meteo");
      const latest = await fetchOpenMeteoForecast(location);
      this.store.forecastSnapshots.unshift(latest);
      this.audit.record({ actor: "system", type: "forecast_snapshot", message: `Stored ${latest.provider} snapshot for ${location.city}`, metadata: { snapshotId: latest.id } });

      const stationObservation = await fetchNwsLatestStationObservation(location);
      if (stationObservation) {
        this.store.stationObservations.unshift(stationObservation);
        this.audit.record({
          actor: "system",
          type: "station_observation",
          message: `Stored ${stationObservation.stationId} observation at ${stationObservation.observedAt}`,
          metadata: stationObservation
        });
      }

      const accuweather = await fetchAccuWeatherDailyForecast(location);
      if (accuweather) {
        this.store.forecastSnapshots.unshift(accuweather);
        this.audit.record({ actor: "system", type: "forecast_snapshot", message: `Stored AccuWeather snapshot for ${location.city}`, metadata: { snapshotId: accuweather.id } });
      }

      const deltas = detectForecastDeltas(previous, latest);
      this.store.forecastDeltas.unshift(...deltas);
      for (const delta of deltas) {
        this.audit.record({ actor: "system", type: "forecast_delta", message: delta.reason, metadata: delta });
      }
    }

    this.store.markets = await discoverWeatherMarkets();
    this.store.mappings = this.store.markets.map((market) => parseKalshiWeatherMarket(market));
    for (const mapping of this.store.mappings) {
      this.audit.record({
        actor: "system",
        type: mapping.accepted ? "market_accepted" : "market_rejected",
        message: mapping.accepted ? `Accepted ${mapping.marketTicker}` : `Rejected ${mapping.marketTicker}: ${mapping.reviewReason}`,
        metadata: mapping
      });
    }

    if (env.APP_MODE === "watch") return this.summary();

    for (const delta of this.store.forecastDeltas.slice(0, 20)) {
      const mapping = this.store.mappings.find(
        (candidate) =>
          candidate.accepted &&
          candidate.location?.city === delta.city &&
          candidate.targetDate === delta.targetDate &&
          candidate.variable === delta.variable
      );
      if (!mapping) continue;
      const market = this.store.markets.find((candidate) => candidate.ticker === mapping.marketTicker);
      if (!market) continue;
      const estimate = estimateMarketProbability(mapping, delta, market, { sameDayTempStdDevF: 2, oneDayTempStdDevF: 3, multiDayTempStdDevF: 4.5, minEdge: env.MIN_EDGE_PERCENTAGE_POINTS / 100 });
      const riskState = {
        realizedPnlToday: 0,
        tradesToday: this.store.paperOrders.filter((order) => order.timestamp.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
        openExposure: this.store.paperOrders.reduce((sum, order) => sum + (order.simulatedAvgFillPrice ?? 0) * order.filledContracts, 0),
        openPositions: this.store.paperOrders.filter((order) => order.filledContracts > 0).length,
        losingStreak: 0,
        exposureByCity: {},
        exposureByWeatherType: {}
      };
      const now = new Date();
      const risk = checkRisk(
        { maxCost: env.MAX_STAKE_PER_TRADE_PAPER, contracts: Math.max(1, Math.floor(env.MAX_STAKE_PER_TRADE_PAPER / Math.max(market.yesAsk ?? 1, 0.01))) },
        riskState,
        activeRiskLimits,
        mapping,
        market,
        now.toISOString(),
        now.toISOString(),
        now
      );
      const signal = generateSignal(delta, market, mapping, estimate, risk, { minEdge: env.MIN_EDGE_PERCENTAGE_POINTS / 100, maxStake: env.MAX_STAKE_PER_TRADE_PAPER, maxLongshotPrice: 0.15 }, now);
      this.store.signals.unshift(signal);
      this.audit.record({ actor: "system", type: signal.status === "FIRED" ? "signal_fired" : "signal_skipped", message: signal.explanation, metadata: signal });

      if (env.APP_MODE === "paper" && signal.status === "FIRED") {
        const orderBook = await getOrderBook(signal.marketTicker);
        const order = simulatePaperOrder(signal, orderBook, undefined, now);
        this.store.paperOrders.unshift(order);
        this.audit.record({ actor: "system", type: "paper_order", message: `${order.status}: ${order.reason}`, metadata: order });
      }
    }

    return this.summary();
  }

  summary() {
    return {
      mode: env.APP_MODE,
      locations: this.store.locations,
      forecastSnapshots: this.store.forecastSnapshots.slice(0, 10),
      stationObservations: this.store.stationObservations.slice(0, 20),
      forecastDeltas: this.store.forecastDeltas.slice(0, 50),
      markets: this.store.markets.slice(0, 100),
      mappings: this.store.mappings.slice(0, 100),
      signals: this.store.signals.slice(0, 100),
      paperOrders: this.store.paperOrders.slice(0, 100),
      performance: summarizePaperOrders(this.store.paperOrders)
    };
  }
}
