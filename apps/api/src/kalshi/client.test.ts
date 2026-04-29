import { afterEach, describe, expect, it, vi } from "vitest";
import { getHistoricalMarketCandlesticks, getHistoricalTrades, getLiveMarketCandlesticks, getMarketDetails, isPlausibleWeatherMarket } from "./client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Kalshi weather discovery filter", () => {
  it("filters esports and cross-category market leakage from Kalshi search", () => {
    expect(
      isPlausibleWeatherMarket({
        ticker: "KXMVESPORTSMULTIGAMEEXTENDED-S20267D70ABAA8C8-844C19F0A4B",
        eventTicker: "KXMVESPORTSMULTIGAMEEXTENDED-S20267D70ABAA8C8",
        title: "Esports multi-game extended market",
        subtitle: undefined
      })
    ).toBe(false);

    expect(
      isPlausibleWeatherMarket({
        ticker: "KXMVECROSSCATEGORY-S2026E21356140F9-0E7D26BB0C7",
        eventTicker: "KXMVECROSSCATEGORY-S2026E21356140F9",
        title: "Cross-category market",
        subtitle: undefined
      })
    ).toBe(false);
  });

  it("keeps plausible station-based weather markets", () => {
    expect(
      isPlausibleWeatherMarket({
        ticker: "KXHIGHMIA-26APR27-B85",
        eventTicker: "KXHIGHMIA-26APR27",
        title: "Will the high temperature at Miami International Airport be above 85 F on 2026-04-27?",
        subtitle: "Weather market"
      })
    ).toBe(true);
  });

  it("keeps Kalshi documented weather series tickers even when title is terse", () => {
    expect(
      isPlausibleWeatherMarket({
        ticker: "KXHIGHNY-26APR27-T80",
        eventTicker: "KXHIGHNY-26APR27",
        title: "Above 80",
        subtitle: undefined
      })
    ).toBe(true);
  });

  it("normalizes settled market result from Kalshi market details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          market: {
            ticker: "KXHIGHCHI-26MAY02-B85",
            event_ticker: "KXHIGHCHI-26MAY02",
            title: "Will the high temperature in Chicago be above 85°F?",
            status: "settled",
            result: "yes",
            yes_bid: 100,
            yes_ask: 100,
            no_bid: 0,
            no_ask: 0,
            last_price: 100
          }
        })
      }))
    );
    const market = await getMarketDetails("KXHIGHCHI-26MAY02-B85");
    expect(market?.canSettle).toBe(true);
    expect(market?.result).toBe("yes");
  });

  it("fetches and normalizes historical trades with ticker and timestamp filters", async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      expect(url.pathname).toBe("/trade-api/v2/historical/trades");
      expect(url.searchParams.get("ticker")).toBe("KXHIGHCHI-26MAY02-B85");
      expect(url.searchParams.get("min_ts")).toBe("1770000000");
      return {
        ok: true,
        json: async () => ({
          trades: [{
            trade_id: "trade_1",
            ticker: "KXHIGHCHI-26MAY02-B85",
            count_fp: "7.00",
            yes_price_dollars: "0.6200",
            no_price_dollars: "0.3800",
            taker_side: "yes",
            created_time: "2026-05-02T12:00:00Z"
          }],
          cursor: ""
        })
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const trades = await getHistoricalTrades({ ticker: "KXHIGHCHI-26MAY02-B85", minTs: 1770000000, maxPages: 1 });
    expect(trades).toEqual([expect.objectContaining({ id: "trade_1", count: 7, yesPrice: 0.62, noPrice: 0.38 })]);
  });

  it("fetches historical and live candlesticks with required interval parameters", async () => {
    const fetchMock = vi.fn(async (url: URL) => ({
      ok: true,
      json: async () => ({
        ticker: url.pathname.includes("/series/") ? "KXHIGHCHI-26MAY02-B85" : undefined,
        candlesticks: [{
          end_period_ts: 1770003600,
          yes_ask: { close: "0.5700", close_dollars: "0.5700" },
          price: { close: "0.5600", previous: "0.5500", close_dollars: "0.5600", previous_dollars: "0.5500" },
          volume: "10.00",
          open_interest: "12.00"
        }]
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    const historical = await getHistoricalMarketCandlesticks("KXHIGHCHI-26MAY02-B85", { startTs: 1770000000, endTs: 1770007200, periodInterval: 60 });
    const live = await getLiveMarketCandlesticks("KXHIGHCHI", "KXHIGHCHI-26MAY02-B85", { startTs: 1770000000, endTs: 1770007200, periodInterval: 1, includeLatestBeforeStart: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/historical/markets/KXHIGHCHI-26MAY02-B85/candlesticks");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/series/KXHIGHCHI/markets/KXHIGHCHI-26MAY02-B85/candlesticks");
    expect(historical[0]).toEqual(expect.objectContaining({ marketTicker: "KXHIGHCHI-26MAY02-B85", endPeriodTs: 1770003600, volume: 10 }));
    expect(live[0]?.price.previous).toBe(0.55);
  });
});
