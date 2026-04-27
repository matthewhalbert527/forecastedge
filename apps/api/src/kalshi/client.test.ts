import { afterEach, describe, expect, it, vi } from "vitest";
import { getMarketDetails, isPlausibleWeatherMarket } from "./client.js";

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
});
