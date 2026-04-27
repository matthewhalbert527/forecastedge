import type { KalshiMarketCandidate, MarketMapping, WeatherVariable } from "../types.js";
import { findSettlementStation } from "./stations.js";

export function parseKalshiWeatherMarket(market: KalshiMarketCandidate): MarketMapping {
  const text = `${market.title} ${market.subtitle ?? ""} ${market.ticker}`.toLowerCase();
  const variable = parseVariable(text);
  const threshold = parseThreshold(text, variable);
  const thresholdOperator = parseOperator(text);
  const station = findSettlementStation(text);
  const location = station ? { city: station.city, state: station.state } : null;
  const settlementSource = parseSettlementSource(text, station?.settlementSource ?? "unknown");
  const targetDate = parseDate(text, market.closeTime);
  const liquidityScore = computeLiquidityScore(market);
  const reasons: string[] = [];

  if (variable === "unknown") reasons.push("weather variable not recognized");
  if (!location) reasons.push("location not recognized");
  if ((variable === "high_temp" || variable === "low_temp") && !station) reasons.push("settlement station not recognized");
  if (settlementSource === "unknown" && (variable === "high_temp" || variable === "low_temp")) reasons.push("settlement source not recognized");
  if (threshold === null && variable !== "hurricane") reasons.push("threshold not recognized");
  if (!targetDate) reasons.push("target date not recognized");
  if (thresholdOperator === "unknown" && variable !== "hurricane") reasons.push("threshold direction not recognized");

  const accepted = reasons.length === 0;
  return {
    marketTicker: market.ticker,
    eventTicker: market.eventTicker,
    title: market.title,
    location,
    station,
    settlementSource,
    variable,
    threshold,
    thresholdOperator,
    targetDate,
    confidence: accepted ? "high" : reasons.length <= 2 ? "medium" : "low",
    accepted,
    reviewReason: accepted ? null : reasons.join("; "),
    liquidityScore
  };
}

function parseVariable(text: string): MarketMapping["variable"] {
  if (/(high|maximum|max).*(temp|temperature)|temp.*(above|over|exceed|high)/.test(text)) return "high_temp";
  if (/(low|minimum|min).*(temp|temperature)/.test(text)) return "low_temp";
  if (/(rain|precip|precipitation)/.test(text)) return "rainfall";
  if (/(snow|snowfall)/.test(text)) return "snowfall";
  if (/(wind|gust)/.test(text)) return "wind_gust";
  if (/hurricane/.test(text)) return "hurricane";
  return "unknown";
}

function parseThreshold(text: string, variable: WeatherVariable | "hurricane" | "unknown"): number | null {
  const tickerThreshold = text.match(/-(?:t|b)(\d{2,3}(?:\.\d+)?)\b/);
  if (tickerThreshold?.[1]) return Number(tickerThreshold[1]);
  if (variable === "rainfall" || variable === "snowfall") {
    const inchMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:inches|inch|in\b|")/);
    return inchMatch?.[1] ? Number(inchMatch[1]) : null;
  }
  const degreeMatch = text.match(/(?:above|over|exceed|at least|reach|under|below|less than)\s*(\d{2,3})(?:\s*°?\s*f)?/);
  if (degreeMatch?.[1]) return Number(degreeMatch[1]);
  const generic = text.match(/(\d{2,3})\s*°?\s*f/);
  if (generic?.[1]) return Number(generic[1]);
  return null;
}

function parseOperator(text: string): MarketMapping["thresholdOperator"] {
  if (/(above|over|exceed|at least|reach|greater than|more than)/.test(text)) return "above";
  if (/(below|under|less than|fewer than)/.test(text)) return "below";
  if (/(between)/.test(text)) return "between";
  if (/-(?:t|b)\d{2,3}(?:\.\d+)?\b/.test(text)) return "above";
  return "unknown";
}

function parseSettlementSource(text: string, fallback: MarketMapping["settlementSource"]): MarketMapping["settlementSource"] {
  if (/(daily climate|climatological report|source agency.*national weather service|nws|noaa)/.test(text)) return "nws_daily_climate_report";
  if (/(asos|airport station|station observation)/.test(text)) return "nws_asos";
  if (/accuweather/.test(text)) return "accuweather";
  return fallback;
}

function parseDate(text: string, closeTime?: string): string | null {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso?.[1]) return iso[1];
  if (/\btoday\b/.test(text)) return new Date().toISOString().slice(0, 10);
  if (/\btomorrow\b/.test(text)) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }
  if (closeTime) return new Date(closeTime).toISOString().slice(0, 10);
  return null;
}

function computeLiquidityScore(market: KalshiMarketCandidate): number {
  const spread = market.yesAsk !== null && market.yesBid !== null ? Math.max(0, market.yesAsk - market.yesBid) : 1;
  const volume = Math.min(1, (market.volume ?? 0) / 10000);
  const openInterest = Math.min(1, (market.openInterest ?? 0) / 10000);
  return Number(Math.max(0, volume * 0.5 + openInterest * 0.4 + (1 - spread) * 0.1).toFixed(3));
}
