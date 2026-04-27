import { createSign } from "node:crypto";
import { env } from "../config/env.js";

export class KalshiDemoBroker {
  isConfigured() {
    return Boolean(env.KALSHI_DEMO_ACCESS_KEY && env.KALSHI_DEMO_PRIVATE_KEY_PEM);
  }

  async dryRunOrder(order: unknown) {
    return {
      environment: "demo",
      configured: this.isConfigured(),
      wouldSend: order,
      blockedReason: this.isConfigured() ? null : "demo credentials are not configured"
    };
  }

  signRequest(method: string, path: string, timestampMs = Date.now()) {
    if (!env.KALSHI_DEMO_PRIVATE_KEY_PEM || !env.KALSHI_DEMO_ACCESS_KEY) {
      throw new Error("Kalshi demo credentials are not configured");
    }
    const timestamp = String(timestampMs);
    const message = `${timestamp}${method.toUpperCase()}${path}`;
    const signer = createSign("RSA-SHA256");
    signer.update(message);
    signer.end();
    const signature = signer.sign(
      {
        key: env.KALSHI_DEMO_PRIVATE_KEY_PEM,
        padding: 6
      },
      "base64"
    );
    return {
      "KALSHI-ACCESS-KEY": env.KALSHI_DEMO_ACCESS_KEY,
      "KALSHI-ACCESS-SIGNATURE": signature,
      "KALSHI-ACCESS-TIMESTAMP": timestamp
    };
  }
}
