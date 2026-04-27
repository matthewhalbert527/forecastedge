import type { Settlement } from "@forecastedge/core";
import type { AuditLog } from "../audit/audit-log.js";
import type { PersistentStore } from "../data/persistent-store.js";
import type { ScanReport } from "../data/store.js";
import { getMarketDetails } from "../kalshi/client.js";

export interface SettlementRunResult {
  checked: number;
  settled: number;
  skipped: number;
  errors: number;
}

export async function reconcilePaperSettlements(
  persistentStore: PersistentStore,
  audit: AuditLog,
  report?: ScanReport
): Promise<SettlementRunResult> {
  const result: SettlementRunResult = { checked: 0, settled: 0, skipped: 0, errors: 0 };
  const openPositions = await persistentStore.openPaperPositions();
  const marketTickers = [...new Set(openPositions.map((position) => position.marketTicker))];

  for (const marketTicker of marketTickers) {
    result.checked += 1;
    try {
      const market = await getMarketDetails(marketTicker);
      if (!market) {
        result.skipped += 1;
        recordDecision(audit, report, marketTicker, "skipped", "Kalshi market details unavailable");
        continue;
      }
      if (!market.canSettle || (market.result !== "yes" && market.result !== "no")) {
        result.skipped += 1;
        recordDecision(audit, report, marketTicker, "skipped", `Market not settled with binary result; status=${market.status ?? "unknown"} result=${market.result ?? "unknown"}`);
        continue;
      }

      const settlement: Settlement = {
        id: `settlement_${marketTicker}`,
        marketTicker,
        result: market.result,
        settledPrice: market.result === "yes" ? 1 : 0,
        source: "kalshi_market_result",
        rawPayload: market.rawPayload,
        createdAt: new Date().toISOString()
      };
      await persistentStore.persistSettlement(settlement);
      result.settled += 1;
      recordDecision(audit, report, marketTicker, "accepted", `Settled from Kalshi official result: ${market.result}`, settlement);
    } catch (error) {
      result.errors += 1;
      recordDecision(audit, report, marketTicker, "error", error instanceof Error ? error.message : "Unknown settlement error");
    }
  }

  return result;
}

function recordDecision(audit: AuditLog, report: ScanReport | undefined, marketTicker: string, status: "accepted" | "skipped" | "error", reason: string, metadata: unknown = {}) {
  report?.decisions.push({
    stage: "settlement",
    itemId: marketTicker,
    status,
    reason,
    metadata
  });
  audit.record({
    actor: "system",
    type: status === "accepted" ? "settlement" : "settlement_skipped",
    message: `${marketTicker}: ${reason}`,
    metadata
  });
}
