// The one reviewed record of OpenRouter's MCP tools. No imports: everything else (default rules, script methods, status
// counts and the Jelly declaration) derives from this table, never from a hand-written copy.
//
// Evidence: the 31 names, with their descriptions, schemas and annotations, come from a signed-in, read-only capture of
// OpenRouter's MCP server (test/fixtures/live-tools.json, 2026-11-12); 17 of them are also on OpenRouter's MCP page
// (test/fixtures/documented-tools.json). The schemas live in the fixture, not here. The effect, spend, visibility and
// script columns are this plugin's reviewed policy, read from each tool's live description and annotations: a tool
// whose description says it bills the user, or that may spend in any way, is `spend`; when in doubt, `spend`. That
// capture stored descriptions only as digests, so each tool records the evidence behind its spend judgement separately:
// an OpenRouter documentation page, or `assumed` with the reason.

/**
 * What a call does. The family's shared script adapter uses the same union and has no spend class, so spending is the
 * separate `spend` column. `write` here means an execution side effect; `send` reaches someone (feedback).
 */
export type ToolEffect = "read" | "write" | "send" | "export" | "destructive"

/**
 * What a tool exposes or acts on: OpenRouter's public catalogue data, the signed-in account's own data, an execution
 * with side effects, or a recipe (instructions retrieved as text, which authorise nothing).
 */
export type ToolVisibility = "public-data" | "account-data" | "execution" | "recipe"

/**
 * The evidence labels: stated in OpenRouter's or OpenCode's documentation, read in the pinned host packages, observed
 * against this repository's loopback fake, or observed against OpenRouter's real server with a signed-in account.
 */
export type Evidence = "documented" | "source-verified" | "synthetic" | "live-observed"

/** How well a classification judgement is supported: an evidence label, or `assumed` where nothing confirms it yet. */
export type Judgement = Evidence | "assumed"

/** The evidence behind a tool's spend judgement, and where to check it. */
export interface SpendEvidence {
  readonly level: Judgement
  /** An OpenRouter documentation URL for `documented`; for `assumed`, why nothing confirms it. */
  readonly source: string
}

/**
 * The effect a change takes in the contract's `actions` (phase 4b), derived here once so no later pass re-derives it: a
 * paid call is `spend`, and feedback, which reaches OpenRouter's team, is `notify`. A read is not an action; it becomes
 * a `sources` entry instead.
 */
export type ActionEffect = "spend" | "notify"

export interface ReviewedTool {
  /** The upstream name, hyphens included. The native tool id and permission action is `openrouter_<name>`. */
  readonly name: string
  readonly effect: ToolEffect
  /** Whether one call bills the signed-in account: the contract's `actions[].effect: "spend"` in phase 4b. */
  readonly spend: boolean
  readonly visibility: ToolVisibility
  /** Whether scripts may call it through the tools RPC. */
  readonly rpc: boolean
  /**
   * Why a tool is native-only: `native-media-required` when its useful result is media the shared script adapter drops
   * (it keeps text and structured content only); `key-metadata` when its result describes the signed-in API key
   * (label, limits, usage), which the plugin keeps out of scripts.
   */
  readonly rpcExclusion?: "native-media-required" | "key-metadata"
  /**
   * For a script method: the strongest evidence that its useful result fits the tools RPC's `{ output?, text }` result,
   * which keeps structured content and text and drops every other content block. Only a signed-in capture makes it
   * `live-observed`; until then a method stays a script method on this evidence, and a capture whose useful result is
   * media removes it from the script methods.
   */
  readonly scriptOutput?: Evidence
  /**
   * The evidence behind `effect`: the server's `readOnlyHint` and `destructiveHint` annotations, recorded in the live
   * capture and checked against the catalog by the reconcile, so `live-observed` for every tool.
   */
  readonly effectEvidence: Judgement
  /** The evidence behind `spend`. When in doubt a tool is `spend`, so a paid tool may rest on `assumed`. */
  readonly spendEvidence: SpendEvidence
}

/** OpenRouter's MCP page, which documents the first 17 tools and which of them spend. */
export const MCP_DOCS = "https://openrouter.ai/docs/guides/overview/mcp-server"
const docs = (source: string): SpendEvidence => ({ level: "documented", source })
const ON_MCP_PAGE = docs(MCP_DOCS)
/** A read the capture saw marked read-only, whose freedom from charge no OpenRouter page states. */
const UNSTATED_FREE: SpendEvidence = {
  level: "assumed",
  source: "Marked read-only by the live server; no OpenRouter page states that it is free. Its description, read at the 2026-11-12 capture but stored only as a digest, mentioned no charge.",
}

const read = (name: string, visibility: ToolVisibility, scriptOutput: Evidence, spendEvidence: SpendEvidence = ON_MCP_PAGE): ReviewedTool => ({
  name, effect: "read", spend: false, visibility, rpc: true, scriptOutput, effectEvidence: "live-observed", spendEvidence,
})
const spending = (name: string, scriptOutput: Evidence, spendEvidence: SpendEvidence): ReviewedTool => ({
  name, effect: "write", spend: true, visibility: "execution", rpc: true, scriptOutput, effectEvidence: "live-observed", spendEvidence,
})
const media = (name: string, spendEvidence: SpendEvidence): ReviewedTool => ({
  name, effect: "write", spend: true, visibility: "execution", rpc: false, rpcExclusion: "native-media-required", effectEvidence: "live-observed", spendEvidence,
})

/**
 * Reads first (public data, the account's own data, then the recipes), then the executions, each group sorted by name.
 * `scriptOutput`: `live-observed` for the free reads the capture called and whose result was text; `documented` where
 * OpenRouter declares the result (an output schema on the live server, or its documentation for send-message);
 * `synthetic` where only the loopback fake has run it.
 */
export const REVIEWED_TOOLS: readonly ReviewedTool[] = [
  read("get-endpoint-uptime-history", "public-data", "synthetic", UNSTATED_FREE),
  read("get-model", "public-data", "synthetic"),
  // Weekly cost-per-session statistics of published coding harnesses: aggregate public data, not the account's spend.
  read("get-session-cost", "public-data", "synthetic", UNSTATED_FREE),
  read("list-app-rankings", "public-data", "live-observed"),
  read("list-benchmarks", "public-data", "live-observed"),
  read("list-daily-model-rankings", "public-data", "live-observed"),
  read("list-model-endpoints", "public-data", "synthetic"),
  read("list-models", "public-data", "live-observed"),
  read("list-providers", "public-data", "live-observed"),
  read("list-task-classifications", "public-data", "live-observed"),
  read("ping", "public-data", "live-observed"),
  read("search-docs", "public-data", "live-observed"),
  read("get-batch", "account-data", "documented", UNSTATED_FREE),
  read("get-credits", "account-data", "live-observed"),
  // The signed-in key's label, spend limit, remaining limit and usage: native only, so a script never receives it.
  { name: "get-current-key", effect: "read", spend: false, visibility: "account-data", rpc: false, rpcExclusion: "key-metadata", effectEvidence: "live-observed", spendEvidence: UNSTATED_FREE },
  read("get-generation", "account-data", "documented"),
  read("get-preset", "account-data", "synthetic", UNSTATED_FREE),
  // A video job's status, cost and output links; it starts nothing. The links are in its structured result.
  read("get-video", "account-data", "documented", UNSTATED_FREE),
  read("list-batches", "account-data", "documented", UNSTATED_FREE),
  read("list-preset-versions", "account-data", "synthetic", UNSTATED_FREE),
  read("list-presets", "account-data", "synthetic", UNSTATED_FREE),
  // Recipe retrieval: the returned text describes later installer or evaluation commands; retrieving it runs nothing.
  read("install-ori-harness", "recipe", "synthetic"),
  read("spawn-ori-eval", "recipe", "synthetic"),
  // Spending inference whose result is media: an image block, an audio block, or a finished video. A script would pay
  // for a result its RPC drops, so they run only natively.
  media("generate-image", ON_MCP_PAGE),
  media("generate-speech", docs("https://openrouter.ai/docs/cookbook/audio/two-voice-podcast")),
  media("generate-video", docs("https://openrouter.ai/docs/cookbook/video-generation/text-to-video")),
  // Spending inference whose result is text or structured content.
  spending("send-batch", "documented", docs("https://openrouter.ai/docs/batch-quickstart")),
  spending("send-decision", "documented", docs("https://openrouter.ai/docs/cookbook/evaluate-and-optimize/jev-classification")),
  // OpenRouter documents send-message's reply as text with the generation id.
  spending("send-message", "documented", ON_MCP_PAGE),
  spending("transcribe-audio", "documented", { level: "assumed", source: "Classified spend by the rule that any tool which may spend is spend. Its live description, stored only as a digest, said it bills the user; no OpenRouter page found states it." }),
  // Feedback on one of the account's own generations, sent to OpenRouter's team.
  { name: "send-feedback", effect: "send", spend: false, visibility: "execution", rpc: true, scriptOutput: "synthetic", effectEvidence: "live-observed", spendEvidence: ON_MCP_PAGE },
]

/** Every reviewed upstream name. */
export const TOOL_NAMES: readonly string[] = REVIEWED_TOOLS.map((tool) => tool.name)
/** The reads, account and recipe reads included. */
export const READ_TOOLS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.effect === "read").map((tool) => tool.name)
/** Every tool that is not a read: spending inference, media generation and feedback. */
export const CHANGE_TOOLS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.effect !== "read").map((tool) => tool.name)
/** The tools that spend the account's credit: inference, batches, decisions, transcription and media generation. */
export const SPEND_TOOLS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.spend).map((tool) => tool.name)
/** The tools that reach someone without spending: feedback on a generation. */
export const NOTIFY_TOOLS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.effect === "send").map((tool) => tool.name)
/** The tools scripts may call through the tools RPC. */
export const RPC_TOOLS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.rpc).map((tool) => tool.name)
/** Reviewed tools that run only natively, never as a script method. */
export const NATIVE_ONLY: readonly string[] = REVIEWED_TOOLS.filter((tool) => !tool.rpc).map((tool) => tool.name)
/** The script methods whose output has been checked against OpenRouter's live server. */
export const LIVE_VERIFIED_SCRIPT_METHODS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.rpc && tool.scriptOutput === "live-observed").map((tool) => tool.name)

/** The reviewed entry for an upstream name, or undefined for a tool this table has not reviewed. */
export const reviewedTool = (name: string): ReviewedTool | undefined => REVIEWED_TOOLS.find((tool) => tool.name === name)

/**
 * The contract's `actions[].effect` for a reviewed tool: `spend` for a call that bills the account, `notify` for
 * feedback, and undefined for a read, which is a source rather than an action. Phase 4b's manifest takes this value;
 * the input, output and cost of each action are declared there, not here.
 */
export const actionEffectOf = (tool: ReviewedTool): ActionEffect | undefined =>
  tool.effect === "read" ? undefined : tool.spend ? "spend" : "notify"

/** Every reviewed change with its contract effect, in catalog order: the list phase 4b turns into `actions`. */
export const ACTION_EFFECTS: readonly { readonly name: string; readonly effect: ActionEffect }[] = REVIEWED_TOOLS.flatMap((tool) => {
  const effect = actionEffectOf(tool)
  return effect === undefined ? [] : [{ name: tool.name, effect }]
})
