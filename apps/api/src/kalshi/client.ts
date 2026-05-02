import type { KalshiMarketCandidate, KalshiMarketDetails, NormalizedOrderBook } from "@forecastedge/core";
import { env } from "../config/env.js";

interface KalshiMarketsResponse {
  markets?: Array<Record<string, unknown>>;
  cursor?: string;
}

interface KalshiMarketResponse {
  market?: Record<string, unknown>;
}

interface KalshiOrderBookResponse {
  orderbook?: { yes?: number[][]; no?: number[][] };
  orderbook_fp?: { yes_dollars?: string[][]; no_dollars?: string[][] };
}

interface KalshiTradesResponse {
  trades?: Array<Record<string, unknown>>;
  cursor?: string;
}

interface KalshiCandlesticksResponse {
  ticker?: string;
  candlesticks?: Array<Record<string, unknown>>;
}

export type KalshiHistoricalMarket = KalshiMarketCandidate & {
  status: string | null;
  result: "yes" | "no" | "scalar" | "" | null;
  settlementTs: string | null;
  settlementValue: number | null;
};

export type KalshiTradePrint = {
  id: string;
  marketTicker: string;
  count: number;
  yesPrice: number | null;
  noPrice: number | null;
  takerSide: string | null;
  createdTime: string;
  rawPayload: Record<string, unknown>;
};

export type KalshiCandlestick = {
  marketTicker: string;
  endPeriodTs: number;
  endPeriodAt: string;
  yesBid: Ohlc;
  yesAsk: Ohlc;
  price: Ohlc & { mean: number | null; previous: number | null };
  volume: number | null;
  openInterest: number | null;
  rawPayload: Record<string, unknown>;
};

type Ohlc = {
  open: number | null;
  low: number | null;
  high: number | null;
  close: number | null;
};

type PagedRequest = {
  ticker?: string;
  minTs?: number;
  maxTs?: number;
  limit?: number;
  maxPages?: number;
};

type CandleRequest = {
  startTs: number;
  endTs: number;
  periodInterval: 1 | 60 | 1440;
  includeLatestBeforeStart?: boolean;
};

export async function discoverWeatherMarkets(): Promise<KalshiMarketCandidate[]> {
  const seen = new Map<string, KalshiMarketCandidate>();

  for (const seriesTicker of configuredWeatherSeries()) {
    for (const item of await fetchMarkets({ seriesTicker })) {
      const candidate = normalizeMarket(item);
      if (candidate) seen.set(candidate.ticker, candidate);
    }
  }

  if (seen.size > 0) return [...seen.values()];

  const terms = ["weather", "temperature", "rain", "snow", "wind", "hurricane"];
  for (const term of terms) {
    for (const item of await fetchMarkets({ search: term })) {
      const candidate = normalizeMarket(item);
      if (candidate && isPlausibleWeatherMarket(candidate)) seen.set(candidate.ticker, candidate);
    }
  }
  return [...seen.values()];
}

async function fetchMarkets(filters: { seriesTicker?: string; search?: string }) {
  const markets: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  for (let page = 0; page < env.KALSHI_MARKET_DISCOVERY_MAX_PAGES; page += 1) {
    const url = new URL(`${env.KALSHI_PROD_BASE_URL}/markets`);
    url.searchParams.set("limit", String(env.KALSHI_MARKET_DISCOVERY_LIMIT));
    url.searchParams.set("status", "open");
    if (filters.seriesTicker) url.searchParams.set("series_ticker", filters.seriesTicker);
    if (filters.search) url.searchParams.set("search", filters.search);
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url);
    if (!response.ok) break;
    const payload = (await response.json()) as KalshiMarketsResponse;
    markets.push(...(payload.markets ?? []));
    cursor = payload.cursor && payload.cursor.length > 0 ? payload.cursor : null;
    if (!cursor) break;
  }
  return markets;
}

export async function getHistoricalMarkets(filters: { tickers?: string[]; eventTicker?: string; seriesTicker?: string; limit?: number; maxPages?: number } = {}): Promise<KalshiHistoricalMarket[]> {
  const markets: KalshiHistoricalMarket[] = [];
  let cursor: string | null = null;
  const maxPages = Math.max(1, filters.maxPages ?? 5);
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${env.KALSHI_PROD_BASE_URL}/historical/markets`);
    url.searchParams.set("limit", String(Math.min(1000, Math.max(1, filters.limit ?? 1000))));
    if (filters.tickers?.length) url.searchParams.set("tickers", filters.tickers.join(","));
    if (filters.eventTicker) url.searchParams.set("event_ticker", filters.eventTicker);
    if (filters.seriesTicker) url.searchParams.set("series_ticker", filters.seriesTicker);
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url);
    if (!response.ok) break;
    const payload = (await response.json()) as KalshiMarketsResponse;
    markets.push(...(payload.markets ?? []).flatMap((market) => {
      const normalized = normalizeHistoricalMarket(market);
      return normalized ? [normalized] : [];
    }));
    cursor = payload.cursor && payload.cursor.length > 0 ? payload.cursor : null;
    if (!cursor) break;
  }
  return markets;
}

export async function getHistoricalTrades(request: PagedRequest = {}): Promise<KalshiTradePrint[]> {
  return getTradesFromPath("/historical/trades", request, "historical");
}

export async function getLiveTrades(request: PagedRequest = {}): Promise<KalshiTradePrint[]> {
  return getTradesFromPath("/markets/trades", request, "live");
}

export async function getHistoricalMarketCandlesticks(marketTicker: string, request: CandleRequest): Promise<KalshiCandlestick[]> {
  return getCandlesticksFromPath(`/historical/markets/${marketTicker}/candlesticks`, marketTicker, request);
}

export async function getLiveMarketCandlesticks(seriesTicker: string, marketTicker: string, request: CandleRequest): Promise<KalshiCandlestick[]> {
  return getCandlesticksFromPath(`/series/${seriesTicker}/markets/${marketTicker}/candlesticks`, marketTicker, request);
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

async function getTradesFromPath(path: string, request: PagedRequest, source: string): Promise<KalshiTradePrint[]> {
  const trades: KalshiTradePrint[] = [];
  let cursor: string | null = null;
  const maxPages = Math.max(1, request.maxPages ?? 5);
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${env.KALSHI_PROD_BASE_URL}${path}`);
    url.searchParams.set("limit", String(Math.min(1000, Math.max(1, request.limit ?? 1000))));
    if (request.ticker) url.searchParams.set("ticker", request.ticker);
    if (request.minTs !== undefined) url.searchParams.set("min_ts", String(request.minTs));
    if (request.maxTs !== undefined) url.searchParams.set("max_ts", String(request.maxTs));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url);
    if (!response.ok) break;
    const payload = (await response.json()) as KalshiTradesResponse;
    trades.push(...(payload.trades ?? []).flatMap((trade) => {
      const normalized = normalizeTrade(trade, source);
      return normalized ? [normalized] : [];
    }));
    cursor = payload.cursor && payload.cursor.length > 0 ? payload.cursor : null;
    if (!cursor) break;
  }
  return trades;
}

async function getCandlesticksFromPath(path: string, marketTicker: string, request: CandleRequest): Promise<KalshiCandlestick[]> {
  const url = new URL(`${env.KALSHI_PROD_BASE_URL}${path}`);
  url.searchParams.set("start_ts", String(request.startTs));
  url.searchParams.set("end_ts", String(request.endTs));
  url.searchParams.set("period_interval", String(request.periodInterval));
  if (request.includeLatestBeforeStart !== undefined) url.searchParams.set("include_latest_before_start", String(request.includeLatestBeforeStart));
  const response = await fetch(url);
  if (!response.ok) return [];
  const payload = (await response.json()) as KalshiCandlesticksResponse;
  return (payload.candlesticks ?? []).flatMap((candle) => {
    const normalized = normalizeCandlestick(payload.ticker ?? marketTicker, candle);
    return normalized ? [normalized] : [];
  });
}

export async function getMarketDetails(marketTicker: string): Promise<KalshiMarketDetails | null> {
  const url = new URL(`${env.KALSHI_PROD_BASE_URL}/markets/${marketTicker}`);
  const response = await fetch(url);
  if (!response.ok) return null;
  const payload = (await response.json()) as KalshiMarketResponse;
  const raw = payload.market;
  if (!raw) return null;
  const normalized = normalizeMarket(raw);
  if (!normalized) return null;
  const status = stringValue(raw.status);
  const rawResult = stringValue(raw.result) ?? stringValue(raw.market_result) ?? stringValue(raw.settlement_value);
  const result = normalizeResult(rawResult);
  return {
    ...normalized,
    status,
    result,
    canSettle: Boolean(result === "yes" || result === "no") && Boolean(status && ["closed", "settled", "determined"].includes(status))
  };
}

function normalizeHistoricalMarket(raw: Record<string, unknown>): KalshiHistoricalMarket | null {
  const normalized = normalizeMarket(raw);
  if (!normalized) return null;
  return {
    ...normalized,
    status: stringValue(raw.status),
    result: normalizeResult(stringValue(raw.result) ?? stringValue(raw.market_result) ?? stringValue(raw.settlement_value)),
    settlementTs: stringValue(raw.settlement_ts),
    settlementValue: price(raw.settlement_value_dollars) ?? price(raw.settlement_value)
  };
}

function normalizeMarket(raw: Record<string, unknown>): KalshiMarketCandidate | null {
  const ticker = stringValue(raw.ticker);
  const title = stringValue(raw.title);
  const eventTicker = stringValue(raw.event_ticker);
  if (!ticker || !title || !eventTicker) return null;
  const yesBid = price(raw.yes_bid) ?? price(raw.yes_bid_dollars);
  const yesAsk = price(raw.yes_ask) ?? price(raw.yes_ask_dollars);
  const noBid = price(raw.no_bid) ?? price(raw.no_bid_dollars);
  const noAsk = price(raw.no_ask) ?? price(raw.no_ask_dollars);
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
    lastPrice: price(raw.last_price) ?? price(raw.last_price_dollars),
    volume: numeric(raw.volume) ?? numeric(raw.volume_fp) ?? numeric(raw.volume_24h_fp),
    openInterest: numeric(raw.open_interest) ?? numeric(raw.open_interest_fp),
    rawPayload: raw
  };
}

function normalizeTrade(raw: Record<string, unknown>, source: string): KalshiTradePrint | null {
  const id = stringValue(raw.trade_id) ?? `${source}_${stringValue(raw.ticker) ?? "unknown"}_${stringValue(raw.created_time) ?? Date.now()}_${numeric(raw.count_fp) ?? 0}`;
  const marketTicker = stringValue(raw.ticker);
  const createdTime = stringValue(raw.created_time);
  if (!marketTicker || !createdTime) return null;
  return {
    id,
    marketTicker,
    count: numeric(raw.count_fp) ?? numeric(raw.count) ?? 0,
    yesPrice: price(raw.yes_price_dollars) ?? price(raw.yes_price),
    noPrice: price(raw.no_price_dollars) ?? price(raw.no_price),
    takerSide: stringValue(raw.taker_side),
    createdTime,
    rawPayload: raw
  };
}

function normalizeCandlestick(marketTicker: string, raw: Record<string, unknown>): KalshiCandlestick | null {
  const endPeriodTs = numeric(raw.end_period_ts);
  if (endPeriodTs === null) return null;
  return {
    marketTicker,
    endPeriodTs,
    endPeriodAt: new Date(endPeriodTs * 1000).toISOString(),
    yesBid: normalizeOhlc(raw.yes_bid),
    yesAsk: normalizeOhlc(raw.yes_ask),
    price: {
      ...normalizeOhlc(raw.price),
      mean: nestedPrice(raw.price, "mean") ?? nestedPrice(raw.price, "mean_dollars"),
      previous: nestedPrice(raw.price, "previous") ?? nestedPrice(raw.price, "previous_dollars")
    },
    volume: numeric(raw.volume_fp) ?? numeric(raw.volume),
    openInterest: numeric(raw.open_interest_fp) ?? numeric(raw.open_interest),
    rawPayload: raw
  };
}

function normalizeOhlc(value: unknown): Ohlc {
  return {
    open: nestedPrice(value, "open") ?? nestedPrice(value, "open_dollars"),
    low: nestedPrice(value, "low") ?? nestedPrice(value, "low_dollars"),
    high: nestedPrice(value, "high") ?? nestedPrice(value, "high_dollars"),
    close: nestedPrice(value, "close") ?? nestedPrice(value, "close_dollars")
  };
}

function nestedPrice(value: unknown, key: string) {
  if (!value || typeof value !== "object") return null;
  return price((value as Record<string, unknown>)[key]);
}

export function isPlausibleWeatherMarket(market: Pick<KalshiMarketCandidate, "ticker" | "eventTicker" | "title" | "subtitle">) {
  const text = `${market.ticker} ${market.eventTicker} ${market.title} ${market.subtitle ?? ""}`.toLowerCase();
  if (/(esports|sports|multigame|crosscategory|crypto|bitcoin|ethereum|stock|earnings|fed|election|movie|box office)/.test(text)) return false;
  if (configuredWeatherSeries().some((series) => market.eventTicker.toUpperCase().startsWith(series) || market.ticker.toUpperCase().startsWith(series))) return true;
  return /(weather|temperature|temp|high temperature|low temperature|rain|rainfall|precip|precipitation|snow|snowfall|wind|gust|hurricane|tornado|airport|climate|heat|cold|degrees|°f|\bf\b)/.test(text);
}

function configuredWeatherSeries() {
  return env.KALSHI_WEATHER_SERIES_TICKERS.split(",")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeResult(value: string | null): KalshiMarketDetails["result"] {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized === "yes" || normalized === "no" || normalized === "scalar") return normalized;
  return "";
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function price(value: unknown): number | null {
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
