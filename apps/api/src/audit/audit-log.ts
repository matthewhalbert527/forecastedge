export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: "system" | "user";
  type:
    | "forecast_snapshot"
    | "station_observation"
    | "forecast_delta"
    | "scan_completed"
    | "market_accepted"
    | "market_rejected"
    | "signal_fired"
    | "signal_skipped"
    | "paper_order"
    | "demo_order"
    | "live_order_blocked"
    | "mode_change"
    | "error";
  message: string;
  metadata: unknown;
}

export class AuditLog {
  private entries: AuditEntry[] = [];

  record(entry: Omit<AuditEntry, "id" | "timestamp">) {
    const fullEntry = {
      ...entry,
      id: `audit_${Date.now()}_${this.entries.length}`,
      timestamp: new Date().toISOString()
    };
    this.entries.unshift(fullEntry);
    this.entries = this.entries.slice(0, 500);
    return fullEntry;
  }

  list(limit = 100) {
    return this.entries.slice(0, limit);
  }
}
