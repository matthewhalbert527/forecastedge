import { z } from "zod";
import { env } from "../config/env.js";
import type { PersistentStore, StrategyConfigPatchPayload } from "../data/persistent-store.js";
import { sendGptReviewEmail } from "../notifications/gpt-review-email.js";
import type { ForecastEdgePipeline } from "../jobs/pipeline.js";

export type GptDecisionReviewLayer = "intraday" | "deep" | "daily";

const PROMPT_VERSION = "forecastedge-gpt-review-v1";

const ReviewOutputSchema = z.object({
  summary: z.string(),
  keyFindings: z.array(z.string()).max(10),
  counterfactuals: z.array(z.object({
    name: z.string(),
    outcome: z.string(),
    relativePerformance: z.string(),
    supportedBySettlements: z.boolean()
  })).max(10),
  proposedPatch: z.object({
    reason: z.string(),
    minEdgeAdjustment: z.number().nullable().optional(),
    minNetEdgeAdjustment: z.number().nullable().optional(),
    maxSpread: z.number().nullable().optional(),
    minLiquidityScore: z.number().nullable().optional(),
    maxEntryPrice: z.number().nullable().optional(),
    variableEdgeAdjustments: z.array(z.object({
      variable: z.string(),
      minEdgeAdjustment: z.number(),
      reason: z.string()
    })).max(6).optional()
  }).nullable(),
  safeToApply: z.boolean(),
  confidence: z.enum(["low", "medium", "high"]),
  emailSubject: z.string(),
  emailMarkdown: z.string(),
  codexHandoff: z.string()
});

type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

export async function runGptDecisionReview(input: {
  layer: GptDecisionReviewLayer;
  pipeline: ForecastEdgePipeline;
  persistentStore: PersistentStore | null;
}) {
  const persistentStore = input.persistentStore;
  if (!persistentStore) {
    return { status: "skipped" as const, message: "DATABASE_URL is required for GPT decision reviews", metadata: {} };
  }
  if (!env.GPT_ANALYSIS_ENABLED) {
    return { status: "skipped" as const, message: "GPT_ANALYSIS_ENABLED is false", metadata: {} };
  }

  const now = new Date();
  const lookbackHours = lookbackHoursForLayer(input.layer);
  const since = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  const review = await persistentStore.persistGptDecisionReview({
    layer: input.layer,
    status: env.OPENAI_API_KEY ? "running" : "skipped",
    model: env.OPENAI_API_KEY ? env.GPT_ANALYSIS_MODEL : null,
    promptVersion: PROMPT_VERSION,
    windowStart: since,
    windowEnd: now,
    inputSummary: { layer: input.layer, lookbackHours, reason: env.OPENAI_API_KEY ? "pending" : "OPENAI_API_KEY is not configured" },
    completedAt: env.OPENAI_API_KEY ? null : now
  });

  if (!env.OPENAI_API_KEY) {
    return {
      status: "skipped" as const,
      message: "OPENAI_API_KEY is not configured",
      metadata: { reviewId: review.id }
    };
  }

  try {
    const learning = await input.pipeline.learningSummary();
    const currentConfig = await persistentStore.activeTrainingCandidateConfigForReview();
    const deterministic = await deterministicCounterfactuals({
      layer: input.layer,
      pipeline: input.pipeline,
      settledExamples: learning.collection.settledPaperTradeExamples
    });
    const research = await input.pipeline.nightlyResearchExport(lookbackHours);
    const packet = compactDecisionPacket({
      layer: input.layer,
      research,
      learning,
      deterministic,
      currentConfig
    });
    await persistentStore.updateGptDecisionReview(review.id, { inputSummary: packet });
    const reviewOutput = await askOpenAI(packet);
    const applyResult = await maybeAutoApplyPatch({
      layer: input.layer,
      reviewId: review.id,
      output: reviewOutput,
      currentConfig,
      settledExamples: learning.collection.settledPaperTradeExamples,
      persistentStore
    });
    const email = await maybeEmailReview(input.layer, reviewOutput, applyResult);

    await persistentStore.updateGptDecisionReview(review.id, {
      status: "completed",
      output: reviewOutput,
      recommendation: reviewOutput.summary,
      safeToApply: reviewOutput.safeToApply,
      confidence: reviewOutput.confidence,
      emailSent: email.sent,
      emailMetadata: email,
      appliedPatchId: applyResult.patchId ?? null,
      completedAt: new Date()
    });

    return {
      status: "completed" as const,
      message: reviewOutput.summary,
      metadata: {
        reviewId: review.id,
        layer: input.layer,
        confidence: reviewOutput.confidence,
        safeToApply: reviewOutput.safeToApply,
        appliedPatch: applyResult,
        email
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown GPT decision review error";
    await persistentStore.updateGptDecisionReview(review.id, {
      status: "failed",
      recommendation: message,
      completedAt: new Date()
    });
    return { status: "failed" as const, message, metadata: { reviewId: review.id } };
  }
}

function lookbackHoursForLayer(layer: GptDecisionReviewLayer) {
  if (layer === "intraday") return 1;
  if (layer === "deep") return 6;
  return 24;
}

async function deterministicCounterfactuals(input: {
  layer: GptDecisionReviewLayer;
  pipeline: ForecastEdgePipeline;
  settledExamples: number;
}) {
  if (input.layer === "intraday") {
    return { skipped: true, reason: "Intraday reviews inspect behavior only; no strategy patching or backtest-heavy work." };
  }
  if (input.settledExamples < env.GPT_AUTO_APPLY_MIN_SETTLED_EXAMPLES) {
    return {
      skipped: true,
      reason: `Only ${input.settledExamples} settled paper examples; waiting for ${env.GPT_AUTO_APPLY_MIN_SETTLED_EXAMPLES}.`
    };
  }
  const window = reviewDateWindow(input.layer === "daily" ? 30 : 7);
  const alphaReport = await input.pipeline.runDailyAlphaReport({
    trigger: `gpt_${input.layer}_review`,
    validationMode: "walk_forward",
    slippageCents: 2,
    startDate: window.startDate,
    endDate: window.endDate
  });
  const optimizer = await input.pipeline.runStrategyOptimizer({
    trigger: `gpt_${input.layer}_review`,
    validationMode: "walk_forward",
    startDate: window.startDate,
    endDate: window.endDate
  });
  const counterfactualReplay = await input.pipeline.runCounterfactualReplay({
    trigger: `gpt_${input.layer}_review`,
    validationMode: "walk_forward",
    slippageCents: 2,
    startDate: window.startDate,
    endDate: window.endDate,
    lookbackDays: input.layer === "daily" ? 30 : 7
  });
  return {
    skipped: false,
    window,
    alphaReport: compactOptimization(alphaReport),
    optimizer: compactOptimization(optimizer),
    counterfactualReplay: compactOptimization(counterfactualReplay)
  };
}

function compactDecisionPacket(input: {
  layer: GptDecisionReviewLayer;
  research: Awaited<ReturnType<ForecastEdgePipeline["nightlyResearchExport"]>>;
  learning: Awaited<ReturnType<ForecastEdgePipeline["learningSummary"]>>;
  deterministic: unknown;
  currentConfig: unknown;
}) {
  const research = input.research as Record<string, any>;
  const packet = {
    layer: input.layer,
    generatedAt: new Date().toISOString(),
    objective: "Review ForecastEdge paper-trading decisions. Propose only bounded strategy-config patches, never code edits or live-trading changes.",
    guardrails: {
      liveTradingAllowed: false,
      intradayCanAutoApply: false,
      autoApplyRequiresSettledExamples: env.GPT_AUTO_APPLY_MIN_SETTLED_EXAMPLES,
      allowedAutoPatchTypes: [
        "raise minEdge",
        "raise minNetEdge",
        "tighten maxSpread",
        "raise minLiquidityScore",
        "add or lower maxEntryPrice cap",
        "raise variable-specific edge threshold"
      ]
    },
    currentConfig: input.currentConfig,
    collection: research.collection,
    dataFreshness: research.dataFreshness,
    paperTrading: compactPaperTrading(research.paperTrading),
    candidates: compactCandidates(research.candidates),
    optimizer: compactOptimizerBlock(research.optimizer),
    backtest: research.backtest,
    deterministicCounterfactuals: input.deterministic,
    warnings: research.warnings,
    learning: input.learning
  };
  return truncatePacket(packet, env.GPT_REVIEW_MAX_INPUT_CHARS);
}

function compactPaperTrading(value: any) {
  return {
    latestHealth: value?.latestHealth ?? null,
    windowStats: value?.windowStats ?? null,
    allTimeStats: value?.allTimeStats ?? null,
    examplesInWindow: Array.isArray(value?.examplesInWindow) ? value.examplesInWindow.slice(0, 30) : [],
    ordersInWindow: Array.isArray(value?.ordersInWindow) ? value.ordersInWindow.slice(0, 30) : []
  };
}

function compactCandidates(value: any) {
  return {
    countsByStatus: value?.countsByStatus ?? {},
    topBlockers: Array.isArray(value?.topBlockers) ? value.topBlockers.slice(0, 12) : [],
    recentSamples: Array.isArray(value?.recentSamples) ? value.recentSamples.slice(0, 40) : []
  };
}

function compactOptimizerBlock(value: any) {
  return {
    latest: value?.latest ? compactOptimization(value.latest) : null,
    runsInWindow: Array.isArray(value?.runsInWindow) ? value.runsInWindow.slice(0, 4).map(compactOptimization) : []
  };
}

function compactOptimization(value: any) {
  return {
    id: value?.id ?? null,
    status: value?.status ?? null,
    recommendation: value?.recommendation ?? null,
    champion: compactCandidate(value?.champion),
    bestCandidate: compactCandidate(value?.bestCandidate),
    challengers: Array.isArray(value?.challengers) ? value.challengers.slice(0, 8).map(compactCandidate) : [],
    searchSpace: value?.searchSpace ?? null,
    startedAt: value?.startedAt ?? null,
    completedAt: value?.completedAt ?? null
  };
}

function compactCandidate(value: any) {
  if (!value || typeof value !== "object") return null;
  return {
    optimizerCandidateId: value.optimizerCandidateId ?? null,
    approvalStatus: value.approvalStatus ?? null,
    evaluatedMarkets: numberOrNull(value.evaluatedMarkets),
    wins: numberOrNull(value.wins),
    losses: numberOrNull(value.losses),
    winRate: numberOrNull(value.winRate),
    totalPnl: numberOrNull(value.totalPnl),
    roi: numberOrNull(value.roi),
    expectedValuePerTrade: numberOrNull(value.expectedValuePerTrade),
    maxDrawdown: numberOrNull(value.maxDrawdown),
    score: numberOrNull(value.score),
    parameters: value.parameters ?? null
  };
}

function truncatePacket(packet: unknown, maxChars: number) {
  const json = JSON.stringify(packet);
  if (json.length <= maxChars) return packet;
  const compact = packet as Record<string, any>;
  return {
    ...compact,
    paperTrading: {
      ...compact.paperTrading,
      examplesInWindow: Array.isArray(compact.paperTrading?.examplesInWindow) ? compact.paperTrading.examplesInWindow.slice(0, 10) : [],
      ordersInWindow: Array.isArray(compact.paperTrading?.ordersInWindow) ? compact.paperTrading.ordersInWindow.slice(0, 10) : []
    },
    candidates: {
      ...compact.candidates,
      recentSamples: Array.isArray(compact.candidates?.recentSamples) ? compact.candidates.recentSamples.slice(0, 15) : []
    },
    truncated: true,
    originalApproxChars: json.length
  };
}

async function askOpenAI(packet: unknown): Promise<ReviewOutput> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.GPT_ANALYSIS_MODEL,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You are ForecastEdge's autonomous paper-trading research analyst.",
                "Analyze deterministic outputs only. Do not invent settled outcomes.",
                "Never recommend live trading, credential changes, routing changes, or code self-modification.",
                "Intraday reviews must set safeToApply=false.",
                "For deep/daily reviews, safeToApply may be true only when deterministic counterfactuals and settled paper evidence support a bounded tightening patch.",
                "Return JSON matching the requested schema."
              ].join(" ")
            }
          ]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(packet) }]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "forecastedge_gpt_decision_review",
          strict: true,
          schema: reviewJsonSchema()
        }
      },
      max_output_tokens: 2400
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`OpenAI review failed with ${response.status}: ${JSON.stringify(body)?.slice(0, 400)}`);
  }
  const text = extractOutputText(body);
  return ReviewOutputSchema.parse(JSON.parse(text));
}

async function maybeAutoApplyPatch(input: {
  layer: GptDecisionReviewLayer;
  reviewId: string;
  output: ReviewOutput;
  currentConfig: any;
  settledExamples: number;
  persistentStore: PersistentStore;
}) {
  if (!env.GPT_AUTO_APPLY_PATCHES) return { applied: false, reason: "GPT_AUTO_APPLY_PATCHES is false" };
  if (input.layer === "intraday") return { applied: false, reason: "Intraday reviews cannot auto-apply patches" };
  if (!input.output.safeToApply) return { applied: false, reason: "GPT marked this review unsafe to apply" };
  if (input.output.confidence === "low") return { applied: false, reason: "GPT confidence is low" };
  if (input.settledExamples < env.GPT_AUTO_APPLY_MIN_SETTLED_EXAMPLES) {
    return { applied: false, reason: `Only ${input.settledExamples} settled examples; need ${env.GPT_AUTO_APPLY_MIN_SETTLED_EXAMPLES}` };
  }

  const patch = sanitizePatch(input.output.proposedPatch, input.currentConfig);
  if (!patch) return { applied: false, reason: "No bounded tightening patch survived sanitization" };

  const appliedConfig = applyPatchSnapshot(input.currentConfig, patch);
  const row = await input.persistentStore.persistStrategyConfigPatch({
    source: `gpt_${input.layer}_review`,
    reviewId: input.reviewId,
    status: "applied",
    reason: input.output.proposedPatch?.reason ?? input.output.summary,
    previousConfig: input.currentConfig,
    patch,
    appliedConfig,
    safety: {
      autoApplied: true,
      layer: input.layer,
      confidence: input.output.confidence,
      settledExamples: input.settledExamples,
      policy: "Only tightening patches are allowed for autonomous application."
    },
    appliedAt: new Date()
  });

  return { applied: true, reason: "Bounded GPT strategy-config patch applied", patchId: row.id, patch };
}

function sanitizePatch(proposed: ReviewOutput["proposedPatch"], currentConfig: any): StrategyConfigPatchPayload | null {
  if (!proposed) return null;
  const patch: StrategyConfigPatchPayload = {};
  const minEdgeAdjustment = clamp(numberOrZero(proposed.minEdgeAdjustment), 0, 0.04);
  if (minEdgeAdjustment > 0) patch.minEdgeAdjustment = minEdgeAdjustment;
  const minNetEdgeAdjustment = clamp(numberOrZero(proposed.minNetEdgeAdjustment), 0, 0.03);
  if (minNetEdgeAdjustment > 0) patch.minNetEdgeAdjustment = minNetEdgeAdjustment;
  const currentMaxSpread = numberOrNull(currentConfig?.maxSpread);
  if (currentMaxSpread !== null && typeof proposed.maxSpread === "number" && Number.isFinite(proposed.maxSpread) && proposed.maxSpread < currentMaxSpread) {
    patch.maxSpread = clamp(proposed.maxSpread, 0.02, currentMaxSpread);
  }
  const currentLiquidity = numberOrNull(currentConfig?.minLiquidityScore);
  if (currentLiquidity !== null && typeof proposed.minLiquidityScore === "number" && Number.isFinite(proposed.minLiquidityScore) && proposed.minLiquidityScore > currentLiquidity) {
    patch.minLiquidityScore = clamp(proposed.minLiquidityScore, currentLiquidity, 1);
  }
  const currentMaxEntry = numberOrNull(currentConfig?.maxEntryPrice) ?? 0.9;
  if (typeof proposed.maxEntryPrice === "number" && Number.isFinite(proposed.maxEntryPrice) && proposed.maxEntryPrice < currentMaxEntry) {
    patch.maxEntryPrice = clamp(proposed.maxEntryPrice, 0.4, currentMaxEntry);
  }
  const variableEdgeAdjustments = (proposed.variableEdgeAdjustments ?? [])
    .filter((item) => item.variable && Number.isFinite(item.minEdgeAdjustment))
    .map((item) => ({
      variable: item.variable,
      minEdgeAdjustment: clamp(item.minEdgeAdjustment, 0, 0.04),
      reason: item.reason
    }))
    .filter((item) => item.minEdgeAdjustment > 0)
    .slice(0, 6);
  if (variableEdgeAdjustments.length > 0) patch.variableEdgeAdjustments = variableEdgeAdjustments;
  return Object.keys(patch).length > 0 ? patch : null;
}

function applyPatchSnapshot(currentConfig: any, patch: StrategyConfigPatchPayload) {
  return {
    ...currentConfig,
    minEdge: round(clamp(numberOrZero(currentConfig?.minEdge) + numberOrZero(patch.minEdgeAdjustment), 0, 0.25)),
    minNetEdge: round(clamp(numberOrZero(currentConfig?.minNetEdge) + numberOrZero(patch.minNetEdgeAdjustment), 0, 0.2)),
    maxSpread: patch.maxSpread ?? currentConfig?.maxSpread ?? null,
    minLiquidityScore: patch.minLiquidityScore ?? currentConfig?.minLiquidityScore ?? null,
    maxEntryPrice: patch.maxEntryPrice ?? currentConfig?.maxEntryPrice ?? null,
    learnedEdgeAdjustments: [
      ...(Array.isArray(currentConfig?.learnedEdgeAdjustments) ? currentConfig.learnedEdgeAdjustments : []),
      ...(patch.variableEdgeAdjustments ?? []).map((item) => ({
        id: `gpt_${item.variable}`,
        label: `GPT ${item.variable.replaceAll("_", " ")}`,
        variable: item.variable,
        minEdgeAdjustment: item.minEdgeAdjustment,
        reason: item.reason
      }))
    ].slice(0, 8)
  };
}

async function maybeEmailReview(layer: GptDecisionReviewLayer, output: ReviewOutput, appliedPatch: Awaited<ReturnType<typeof maybeAutoApplyPatch>>) {
  const layers = env.GPT_REVIEW_EMAIL_LAYERS.split(",").map((item) => item.trim()).filter(Boolean);
  if (!layers.includes(layer)) return { sent: false, reason: `${layer} review email disabled by GPT_REVIEW_EMAIL_LAYERS` };
  return sendGptReviewEmail({
    layer,
    reportDate: centralDateDaysAgo(0),
    subject: output.emailSubject || `ForecastEdge GPT ${layer} review`,
    markdown: output.emailMarkdown,
    appliedPatch,
    codexHandoff: output.codexHandoff
  });
}

function reviewDateWindow(days: number) {
  return {
    startDate: centralDateDaysAgo(days),
    endDate: centralDateDaysAgo(0)
  };
}

function centralDateDaysAgo(daysAgo: number, now = new Date()) {
  const central = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const [year = "1970", month = "01", day = "01"] = central.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) - Math.max(0, Math.floor(daysAgo))));
  return date.toISOString().slice(0, 10);
}

function extractOutputText(body: any) {
  if (typeof body?.output_text === "string") return body.output_text;
  const chunks = Array.isArray(body?.output) ? body.output.flatMap((item: any) => Array.isArray(item.content) ? item.content : []) : [];
  const text = chunks.map((chunk: any) => chunk.text ?? "").join("");
  if (!text) throw new Error("OpenAI response did not include output text");
  return text;
}

function reviewJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "keyFindings", "counterfactuals", "proposedPatch", "safeToApply", "confidence", "emailSubject", "emailMarkdown", "codexHandoff"],
    properties: {
      summary: { type: "string" },
      keyFindings: { type: "array", items: { type: "string" } },
      counterfactuals: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "outcome", "relativePerformance", "supportedBySettlements"],
          properties: {
            name: { type: "string" },
            outcome: { type: "string" },
            relativePerformance: { type: "string" },
            supportedBySettlements: { type: "boolean" }
          }
        }
      },
      proposedPatch: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            additionalProperties: false,
            required: ["reason", "minEdgeAdjustment", "minNetEdgeAdjustment", "maxSpread", "minLiquidityScore", "maxEntryPrice", "variableEdgeAdjustments"],
            properties: {
              reason: { type: "string" },
              minEdgeAdjustment: { anyOf: [{ type: "number" }, { type: "null" }] },
              minNetEdgeAdjustment: { anyOf: [{ type: "number" }, { type: "null" }] },
              maxSpread: { anyOf: [{ type: "number" }, { type: "null" }] },
              minLiquidityScore: { anyOf: [{ type: "number" }, { type: "null" }] },
              maxEntryPrice: { anyOf: [{ type: "number" }, { type: "null" }] },
              variableEdgeAdjustments: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["variable", "minEdgeAdjustment", "reason"],
                  properties: {
                    variable: { type: "string" },
                    minEdgeAdjustment: { type: "number" },
                    reason: { type: "string" }
                  }
                }
              }
            }
          }
        ]
      },
      safeToApply: { type: "boolean" },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      emailSubject: { type: "string" },
      emailMarkdown: { type: "string" },
      codexHandoff: { type: "string" }
    }
  };
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrZero(value: unknown) {
  return numberOrNull(value) ?? 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Number(value.toFixed(4));
}
