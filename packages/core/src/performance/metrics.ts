import type { PaperOrder } from "../types.js";

export function summarizePaperOrders(orders: PaperOrder[]) {
  const filled = orders.filter((order) => order.filledContracts > 0);
  const totalCost = filled.reduce((sum, order) => sum + (order.simulatedAvgFillPrice ?? 0) * order.filledContracts, 0);
  return {
    totalTrades: filled.length,
    simulatedContracts: filled.reduce((sum, order) => sum + order.filledContracts, 0),
    averageEntryPrice: filled.length ? Number((totalCost / filled.reduce((sum, order) => sum + order.filledContracts, 0)).toFixed(4)) : 0,
    totalCost: Number(totalCost.toFixed(2)),
    rejectedOrders: orders.filter((order) => order.status === "REJECTED").length
  };
}
