import type { NormalizedOrderBook, OrderBookLevel, PaperOrder, Signal } from "../types.js";

export interface PaperExecutionOptions {
  staleQuoteMs: number;
  slippageCents: number;
}

export const defaultPaperExecutionOptions: PaperExecutionOptions = {
  staleQuoteMs: 120_000,
  slippageCents: 1
};

export function simulatePaperOrder(
  signal: Signal,
  orderBook: NormalizedOrderBook | null,
  options: PaperExecutionOptions = defaultPaperExecutionOptions,
  now = new Date()
): PaperOrder {
  if (signal.status !== "FIRED") return reject(signal, "signal was skipped", now);
  if (!orderBook) return reject(signal, "order book unavailable", now);
  if (now.getTime() - new Date(orderBook.observedAt).getTime() > options.staleQuoteMs) return reject(signal, "stale quote rejected", now);

  const asks = asksFor(signal.side, orderBook);
  const executableLimit = Number((signal.limitPrice - options.slippageCents / 100).toFixed(4));
  let remaining = signal.contracts;
  let filled = 0;
  let notional = 0;

  for (const level of asks) {
    if (level.price > signal.limitPrice) continue;
    const take = Math.min(remaining, level.contracts);
    filled += take;
    notional += take * Math.min(signal.limitPrice, level.price + options.slippageCents / 100);
    remaining -= take;
    if (remaining === 0) break;
  }

  if (filled === 0) return reject(signal, `no executable liquidity at limit; conservative limit floor ${executableLimit}`, now);

  const avg = Number((notional / filled).toFixed(4));
  return {
    id: `paper_${signal.id}`,
    timestamp: now.toISOString(),
    marketTicker: signal.marketTicker,
    side: signal.side,
    action: signal.action,
    requestedContracts: signal.contracts,
    limitPrice: signal.limitPrice,
    simulatedAvgFillPrice: avg,
    filledContracts: filled,
    unfilledContracts: remaining,
    status: remaining === 0 ? "FILLED" : "PARTIAL",
    reason: remaining === 0 ? "filled against reciprocal order book with conservative slippage" : "partial fill due to insufficient displayed liquidity",
    linkedSignalId: signal.id
  };
}

function asksFor(side: "YES" | "NO", orderBook: NormalizedOrderBook): OrderBookLevel[] {
  const reciprocalBids = side === "YES" ? orderBook.noBids : orderBook.yesBids;
  return reciprocalBids
    .map((bid) => ({ price: Number((1 - bid.price).toFixed(4)), contracts: bid.contracts }))
    .sort((a, b) => a.price - b.price);
}

function reject(signal: Signal, reason: string, now: Date): PaperOrder {
  return {
    id: `paper_${signal.id}`,
    timestamp: now.toISOString(),
    marketTicker: signal.marketTicker,
    side: signal.side,
    action: signal.action,
    requestedContracts: signal.contracts,
    limitPrice: signal.limitPrice,
    simulatedAvgFillPrice: null,
    filledContracts: 0,
    unfilledContracts: signal.contracts,
    status: "REJECTED",
    reason,
    linkedSignalId: signal.id
  };
}
