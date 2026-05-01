import { env } from "../config/env.js";

interface AlphaCandidate {
  optimizerCandidateId?: string;
  evaluatedMarkets?: number;
  wins?: number;
  losses?: number;
  winRate?: number;
  totalCost?: number;
  totalPayout?: number;
  totalPnl?: number;
  roi?: number;
}

interface DailyAlphaEmailInput {
  reportDate: string;
  recommendation: string;
  champion: AlphaCandidate | null;
  bestCandidate: AlphaCandidate | null;
  challengers: AlphaCandidate[];
}

export async function sendDailyAlphaEmail(input: DailyAlphaEmailInput) {
  if (!env.RESEND_API_KEY || !env.DAILY_REPORT_EMAIL_TO || !env.DAILY_REPORT_EMAIL_FROM) {
    return { sent: false, reason: "Daily email is not configured" };
  }

  const subject = `ForecastEdge daily alpha report - ${input.reportDate}`;
  const text = plainTextReport(input);
  const html = htmlReport(input);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.DAILY_REPORT_EMAIL_FROM,
      to: env.DAILY_REPORT_EMAIL_TO.split(",").map((item) => item.trim()).filter(Boolean),
      subject,
      text,
      html
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      sent: false,
      reason: `Resend rejected the daily email with ${response.status}`,
      metadata: body
    };
  }
  return { sent: true, reason: "Daily alpha email sent", metadata: body };
}

function plainTextReport(input: DailyAlphaEmailInput) {
  const best = input.bestCandidate;
  const baseline = input.champion;
  return [
    `ForecastEdge daily alpha report - ${input.reportDate}`,
    "",
    input.recommendation,
    "",
    `Best: ${label(best)} | P/L ${money(best?.totalPnl)} | ROI ${percent(best?.roi)} | trades ${best?.evaluatedMarkets ?? 0}`,
    `Baseline: ${label(baseline)} | P/L ${money(baseline?.totalPnl)} | ROI ${percent(baseline?.roi)} | trades ${baseline?.evaluatedMarkets ?? 0}`,
    "",
    "Candidates:",
    ...input.challengers.map((candidate) => `- ${label(candidate)}: ${candidate.evaluatedMarkets ?? 0} trades, ${candidate.wins ?? 0}-${candidate.losses ?? 0}, ${money(candidate.totalPnl)} P/L, ${percent(candidate.roi)} ROI`)
  ].join("\n");
}

function htmlReport(input: DailyAlphaEmailInput) {
  const rows = input.challengers.map((candidate) => `
    <tr>
      <td>${escapeHtml(label(candidate))}</td>
      <td>${candidate.evaluatedMarkets ?? 0}</td>
      <td>${candidate.wins ?? 0}-${candidate.losses ?? 0}</td>
      <td>${percent(candidate.winRate)}</td>
      <td>${money(candidate.totalPnl)}</td>
      <td>${percent(candidate.roi)}</td>
    </tr>
  `).join("");
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.45;color:#18201d">
      <h2>ForecastEdge daily alpha report - ${escapeHtml(input.reportDate)}</h2>
      <p>${escapeHtml(input.recommendation)}</p>
      <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;border:1px solid #d6ded9">
        <thead>
          <tr style="background:#f3f7f4">
            <th align="left">Strategy</th>
            <th align="right">Trades</th>
            <th align="right">W/L</th>
            <th align="right">Win rate</th>
            <th align="right">P/L</th>
            <th align="right">ROI</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function label(candidate: AlphaCandidate | null | undefined) {
  return candidate?.optimizerCandidateId ?? "none";
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${value < 0 ? "-" : ""}$${Math.abs(value).toFixed(2)}`;
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
