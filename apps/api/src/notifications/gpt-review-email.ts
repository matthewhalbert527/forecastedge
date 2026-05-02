import { env } from "../config/env.js";

export interface GptReviewEmailInput {
  layer: string;
  reportDate: string;
  subject: string;
  markdown: string;
  appliedPatch: {
    applied: boolean;
    reason: string;
    patchId?: string | null;
  };
  codexHandoff: string;
}

export async function sendGptReviewEmail(input: GptReviewEmailInput) {
  if (!env.RESEND_API_KEY || !env.DAILY_REPORT_EMAIL_TO || !env.DAILY_REPORT_EMAIL_FROM) {
    return { sent: false, reason: "Daily email is not configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.DAILY_REPORT_EMAIL_FROM,
      to: env.DAILY_REPORT_EMAIL_TO.split(",").map((item) => item.trim()).filter(Boolean),
      subject: input.subject,
      text: plainText(input),
      html: html(input)
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      sent: false,
      reason: `Resend rejected the GPT review email with ${response.status}`,
      metadata: body
    };
  }
  return { sent: true, reason: "GPT review email sent", metadata: body };
}

function plainText(input: GptReviewEmailInput) {
  return [
    input.subject,
    "",
    input.markdown,
    "",
    `Applied patch: ${input.appliedPatch.applied ? "yes" : "no"} - ${input.appliedPatch.reason}`,
    input.appliedPatch.patchId ? `Patch ID: ${input.appliedPatch.patchId}` : null,
    "",
    "Codex handoff:",
    input.codexHandoff
  ].filter((line): line is string => line !== null).join("\n");
}

function html(input: GptReviewEmailInput) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.45;color:#18201d">
      <h2>${escapeHtml(input.subject)}</h2>
      <pre style="white-space:pre-wrap;background:#f6f8f6;border:1px solid #d6ded9;padding:12px;border-radius:8px">${escapeHtml(input.markdown)}</pre>
      <p><strong>Applied patch:</strong> ${input.appliedPatch.applied ? "yes" : "no"} - ${escapeHtml(input.appliedPatch.reason)}</p>
      ${input.appliedPatch.patchId ? `<p><strong>Patch ID:</strong> ${escapeHtml(input.appliedPatch.patchId)}</p>` : ""}
      <h3>Codex handoff</h3>
      <pre style="white-space:pre-wrap;background:#f6f8f6;border:1px solid #d6ded9;padding:12px;border-radius:8px">${escapeHtml(input.codexHandoff)}</pre>
    </div>
  `;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
