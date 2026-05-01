import type { PaperOrder, PaperPerformanceSummary, PaperPerformanceWindowSummary, PaperPosition, Settlement } from "../types.js";

export const defaultPaperPerformanceWindows: Array<Pick<PaperPerformanceWindowSummary, "key" | "label" | "hours">> = [
  { key: "24h", label: "24 hours", hours: 24 },
  { key: "3d", label: "3 days", hours: 72 },
  { key: "7d", label: "7 days", hours: 168 },
  { key: "14d", label: "2 weeks", hours: 336 },
  { key: "30d", label: "1 month", hours: 720 }
];

export function summarizePaperOrders(orders: PaperOrder[], positions: PaperPosition[] = [], settlements: Settlement[] = []): PaperPerformanceSummary {
  const filled = orders.filter((order) => order.filledContracts > 0);
  const totalCost = filled.reduce((sum, order) => sum + (order.simulatedAvgFillPrice ?? 0) * order.filledContracts, 0);
  const closed = positions.filter((position) => position.closedAt);
  const settled = new Map(settlements.map((settlement) => [settlement.marketTicker, settlement]));
  const realizedPnl = closed.reduce((sum, position) => sum + position.realizedPnl, 0);
  const unrealizedExposure = positions.filter((position) => !position.closedAt).reduce((sum, position) => sum + position.avgEntryPrice * position.contracts, 0);
  const winningClosed = closed.filter((position) => position.realizedPnl > 0).length;
  const settledCost = closed.reduce((sum, position) => sum + position.avgEntryPrice * position.contracts, 0);
  return {
    totalTrades: filled.length,
    simulatedContracts: filled.reduce((sum, order) => sum + order.filledContracts, 0),
    averageEntryPrice: filled.length ? Number((totalCost / filled.reduce((sum, order) => sum + order.filledContracts, 0)).toFixed(4)) : 0,
    totalCost: Number(totalCost.toFixed(2)),
    rejectedOrders: orders.filter((order) => order.status === "REJECTED").length,
    realizedPnl: Number(realizedPnl.toFixed(2)),
    unrealizedExposure: Number(unrealizedExposure.toFixed(2)),
    winRate: closed.length ? Number((winningClosed / closed.length).toFixed(4)) : 0,
    roi: settledCost > 0 ? Number((realizedPnl / settledCost).toFixed(4)) : 0,
    maxDrawdown: computeMaxDrawdown(closed),
    longestLosingStreak: computeLongestLosingStreak(closed),
    settledTrades: closed.filter((position) => settled.has(position.marketTicker)).length,
    openPositions: positions.filter((position) => !position.closedAt).length
  };
}

export function buildPaperPositionsFromOrders(orders: PaperOrder[], settlements: Settlement[] = []): PaperPosition[] {
  const byMarketSide = new Map<string, PaperOrder[]>();
  for (const order of orders) {
    if (order.filledContracts <= 0 || order.simulatedAvgFillPrice === null) continue;
    const key = `${order.marketTicker}:${order.side}`;
    byMarketSide.set(key, [...(byMarketSide.get(key) ?? []), order]);
  }

  const settlementByMarket = new Map(settlements.map((settlement) => [settlement.marketTicker, settlement]));
  return [...byMarketSide.entries()].map(([key, groupedOrders]) => {
    const [marketTicker, side] = key.split(":") as [string, PaperPosition["side"]];
    const contracts = groupedOrders.reduce((sum, order) => sum + order.filledContracts, 0);
    const cost = groupedOrders.reduce((sum, order) => sum + (order.simulatedAvgFillPrice ?? 0) * order.filledContracts, 0);
    const settlement = settlementByMarket.get(marketTicker);
    const payout = settlement ? settlementPayout(side, settlement.result, contracts) : 0;
    return {
      id: `paper_position_${marketTicker}_${side}`,
      marketTicker,
      side,
      contracts,
      avgEntryPrice: contracts ? Number((cost / contracts).toFixed(4)) : 0,
      realizedPnl: settlement ? Number((payout - cost).toFixed(2)) : 0,
      markPrice: null,
      openedAt: groupedOrders.map((order) => order.timestamp).sort()[0] ?? new Date(0).toISOString(),
      closedAt: settlement?.createdAt ?? null,
      settlementId: settlement?.id ?? null
    };
  });
}

export function summarizePaperPerformanceWindows(
  positions: PaperPosition[],
  windows = defaultPaperPerformanceWindows,
  now = new Date()
): PaperPerformanceWindowSummary[] {
  const settled = positions.filter((position) => position.closedAt);
  return windows.map((window) => {
    const since = now.getTime() - window.hours * 60 * 60 * 1000;
    const windowPositions = settled.filter((position) => {
      const closedAt = new Date(position.closedAt ?? "").getTime();
      return Number.isFinite(closedAt) && closedAt >= since && closedAt <= now.getTime();
    });
    const wins = windowPositions.filter((position) => position.realizedPnl > 0).length;
    const losses = windowPositions.filter((position) => position.realizedPnl < 0).length;
    const totalCost = windowPositions.reduce((sum, position) => sum + position.avgEntryPrice * position.contracts, 0);
    const totalPnl = windowPositions.reduce((sum, position) => sum + position.realizedPnl, 0);
    const totalPayout = totalCost + totalPnl;
    const winRate = windowPositions.length > 0 ? wins / windowPositions.length : null;
    const positiveProfit = windowPositions.length > 0 ? totalPnl > 0 : null;
    return {
      ...window,
      settledTrades: windowPositions.length,
      wins,
      losses,
      winRate: roundNullable(winRate),
      totalCost: roundMoney(totalCost),
      totalPayout: roundMoney(totalPayout),
      totalPnl: roundMoney(totalPnl),
      roi: totalCost > 0 ? roundNullable(totalPnl / totalCost) : null,
      positiveProfit,
      score: scorePredictionWindow(winRate, totalPnl, windowPositions.length)
    };
  });
}

export function settlementPayout(side: PaperPosition["side"], result: Settlement["result"], contracts: number) {
  return (side.toLowerCase() === result ? contracts : 0);
}

function scorePredictionWindow(winRate: number | null, totalPnl: number, settledTrades: number) {
  if (settledTrades === 0 || winRate === null) return null;
  const profitScore = totalPnl > 0 ? 1 : totalPnl === 0 ? 0.5 : 0;
  return Math.round((winRate * 0.7 + profitScore * 0.3) * 100);
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function roundNullable(value: number | null) {
  return value === null ? null : Number(value.toFixed(4));
}

function computeMaxDrawdown(closed: PaperPosition[]) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const position of [...closed].sort((a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? ""))) {
    equity += position.realizedPnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return Number(maxDrawdown.toFixed(2));
}

function computeLongestLosingStreak(closed: PaperPosition[]) {
  let current = 0;
  let longest = 0;
  for (const position of [...closed].sort((a, b) => (a.closedAt ?? "").localeCompare(b.closedAt ?? ""))) {
    if (position.realizedPnl < 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}
