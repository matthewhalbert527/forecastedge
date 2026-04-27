import type { KalshiMarketCandidate, NormalizedOrderBook } from "@forecastedge/core";
import { env } from "../config/env.js";

interface KalshiMarketsResponse {
  markets?: Array<Record<string, unknown>>;
}

interface KalshiOrderBookResponse {
  orderbook?: { yes?: number[][]; no?: number[][] };
  orderbook_fp?: { yes_dollars?: string[][]; no_dollars?: string[][] };
}

export async function discoverWeatherMarkets(): Promise<KalshiMarketCandidate[]> {
  const terms = ["weather", "temperature", "rain", "snow", "wind", "hurricane"];
  const seen = new Map<string, KalshiMarketCandidate>();
  for (const term of terms) {
    const url = new URL(`${env.KALSHI_PROD_BASE_URL}/markets`);
    url.searchParams.set("limit", "200");
    url.searchParams.set("status", "open");
    url.searchParams.set("search", term);
    const response = await fetch(url);
    if (!response.ok) continue;
    const payload = (await response.json()) as KalshiMarketsResponse;
    for (const item of payload.markets ?? []) {
      const candidate = normalizeMarket(item);
      if (candidate && isPlausibleWeatherMarket(candidate)) seen.set(candidate.ticker, candidate);
    }
  }
  return [...seen.values()];
}

export async function getOrderBook(marketTicker: string): Promise<NormalizedOrderBook | null> {
  const url = new URL(`${env.KALSHI_PROD_BASE_URL}/markets/${marketTicker}/orderbook`);
  url.searchParams.set("depth", "20");
  const response = await fetch(url);
  if (!response.ok) return null;
  const payload = (await response.json()) as KalshiOrderBookResponse;
  const orderbook = payload.orderbook;
  const fixedPoint = payload.orderbook_fp;
  return {
    marketTicker,
    yesBids: normalizeCentLevels(orderbook?.yes) ?? normalizeDollarLevels(fixedPoint?.yes_dollars),
    noBids: normalizeCentLevels(orderbook?.no) ?? normalizeDollarLevels(fixedPoint?.no_dollars),
    observedAt: new Date().toISOString()
  };
}

function normalizeMarket(raw: Record<string, unknown>): KalshiMarketCandidate | null {
  const ticker = stringValue(raw.ticker);
  const title = stringValue(raw.title);
  const eventTicker = stringValue(raw.event_ticker);
  if (!ticker || !title || !eventTicker) return null;
  const yesBid = cents(raw.yes_bid);
  const yesAsk = cents(raw.yes_ask);
  const noBid = cents(raw.no_bid);
  const noAsk = cents(raw.no_ask);
  return {
    ticker,
    eventTicker,
    title,
    subtitle: stringValue(raw.subtitle) ?? undefined,
    closeTime: stringValue(raw.close_time) ?? stringValue(raw.close_ts) ?? undefined,
    settlementTime: stringValue(raw.settlement_timer_seconds) ?? undefined,
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    lastPrice: cents(raw.last_price),
    volume: numeric(raw.volume),
    openInterest: numeric(raw.open_interest),
    rawPayload: raw
  };
}

export function isPlausibleWeatherMarket(market: Pick<KalshiMarketCandidate, "ticker" | "eventTicker" | "title" | "subtitle">) {
  const text = `${market.ticker} ${market.eventTicker} ${market.title} ${market.subtitle ?? ""}`.toLowerCase();
  if (/(esports|sports|multigame|crosscategory|crypto|bitcoin|ethereum|stock|earnings|fed|election|movie|box office)/.test(text)) return false;
  return /(weather|temperature|temp|high temperature|low temperature|rain|rainfall|precip|precipitation|snow|snowfall|wind|gust|hurricane|tornado|airport|climate|heat|cold|degrees|°f|\bf\b)/.test(text);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cents(value: unknown): number | null {
  const num = numeric(value);
  if (num === null) return null;
  return num > 1 ? Number((num / 100).toFixed(4)) : num;
}

function normalizeCentLevels(levels: number[][] | undefined) {
  if (!levels) return null;
  return levels.flatMap((level) => {
    const [price, contracts] = level;
    return typeof price === "number" && typeof contracts === "number" ? [{ price: price / 100, contracts }] : [];
  });
}

function normalizeDollarLevels(levels: string[][] | undefined) {
  if (!levels) return [];
  return levels.flatMap((level) => {
    const [price, contracts] = level;
    const parsedPrice = Number(price);
    const parsedContracts = Number(contracts);
    return Number.isFinite(parsedPrice) && Number.isFinite(parsedContracts) ? [{ price: parsedPrice, contracts: parsedContracts }] : [];
  });
}
