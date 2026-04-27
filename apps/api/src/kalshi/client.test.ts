import { describe, expect, it } from "vitest";
import { isPlausibleWeatherMarket } from "./client.js";

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
});
