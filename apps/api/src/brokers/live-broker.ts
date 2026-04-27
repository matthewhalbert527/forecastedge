import { env } from "../config/env.js";

export class LiveBrokerSafetyShell {
  evaluateOrderIntent(order: unknown, uiConfirmed: boolean) {
    const reasons: string[] = [];
    if (!env.LIVE_TRADING_ENABLED) reasons.push("LIVE_TRADING_ENABLED is false");
    if (env.KILL_SWITCH_ENABLED) reasons.push("kill switch is enabled");
    if (env.REQUIRE_MANUAL_CONFIRMATION && !uiConfirmed) reasons.push("manual UI confirmation is required");
    if (!env.KALSHI_PROD_ACCESS_KEY || !env.KALSHI_PROD_PRIVATE_KEY_PEM) reasons.push("production credentials are not configured");
    return {
      allowed: reasons.length === 0,
      reasons,
      dryRunOrder: order
    };
  }
}
