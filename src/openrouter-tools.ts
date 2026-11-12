// The one reviewed record of OpenRouter's MCP tools. No imports: everything else (default rules, script methods, status
// counts, the Jelly declaration and the drift check) derives from this table, never from a hand-written copy.
//
// Evidence: the 31 names, with their descriptions, schemas and annotations, come from a signed-in, read-only capture of
// OpenRouter's MCP server (test/fixtures/live-tools.json, 2026-11-12); 17 of them are also on OpenRouter's MCP page
// (test/fixtures/documented-tools.json). The schemas live in the fixture, not here. The effect, billing, visibility and
// script columns are this plugin's reviewed policy, read from each tool's live description and annotations: a tool
// whose description says it bills the user, or that may spend in any way, is billable; when in doubt, billable.

/**
 * What a call does. The family's shared script adapter uses the same union and has no spend class, so billing is the
 * separate `billable` column. `write` here means an execution side effect, spending included.
 */
export type ToolEffect = "read" | "write" | "send" | "export" | "destructive"

/**
 * What a tool exposes or acts on: OpenRouter's public catalogue data, the signed-in account's own data, an execution
 * with side effects, or a recipe (instructions retrieved as text, which authorise nothing).
 */
export type ToolVisibility = "public-data" | "account-data" | "execution" | "recipe"

/**
 * The evidence labels of docs/contract.md: stated in documentation, read in the pinned host packages, observed against
 * this repository's loopback fake, or observed against OpenRouter's real server with a signed-in account.
 */
export type Evidence = "documented" | "source-verified" | "synthetic" | "live-observed"

export interface ReviewedTool {
  /** The upstream name, hyphens included. The native tool id and permission action is `openrouter_<name>`. */
  readonly name: string
  readonly effect: ToolEffect
  /** Whether OpenRouter documents the call as billable inference. */
  readonly billable: boolean
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
}

const read = (name: string, visibility: ToolVisibility, scriptOutput: Evidence): ReviewedTool => ({ name, effect: "read", billable: false, visibility, rpc: true, scriptOutput })
const paid = (name: string, scriptOutput: Evidence): ReviewedTool => ({ name, effect: "write", billable: true, visibility: "execution", rpc: true, scriptOutput })
const media = (name: string): ReviewedTool => ({ name, effect: "write", billable: true, visibility: "execution", rpc: false, rpcExclusion: "native-media-required" })

/**
 * Reads first (public data, the account's own data, then the recipes), then the executions, each group sorted by name.
 * `scriptOutput`: `live-observed` for the free reads the capture called and whose result was text; `documented` where
 * OpenRouter declares the result (an output schema on the live server, or its documentation for send-message);
 * `synthetic` where only the loopback fake has run it.
 */
export const REVIEWED_TOOLS: readonly ReviewedTool[] = [
  read("get-endpoint-uptime-history", "public-data", "synthetic"),
  read("get-model", "public-data", "synthetic"),
  // Weekly cost-per-session statistics of published coding harnesses: aggregate public data, not the account's spend.
  read("get-session-cost", "public-data", "synthetic"),
  read("list-app-rankings", "public-data", "live-observed"),
  read("list-benchmarks", "public-data", "live-observed"),
  read("list-daily-model-rankings", "public-data", "live-observed"),
  read("list-model-endpoints", "public-data", "synthetic"),
  read("list-models", "public-data", "live-observed"),
  read("list-providers", "public-data", "live-observed"),
  read("list-task-classifications", "public-data", "live-observed"),
  read("ping", "public-data", "live-observed"),
  read("search-docs", "public-data", "live-observed"),
  read("get-batch", "account-data", "documented"),
  read("get-credits", "account-data", "live-observed"),
  // The signed-in key's label, spend limit, remaining limit and usage: native only, so a script never receives it.
  { name: "get-current-key", effect: "read", billable: false, visibility: "account-data", rpc: false, rpcExclusion: "key-metadata" },
  read("get-generation", "account-data", "documented"),
  read("get-preset", "account-data", "synthetic"),
  // A video job's status, cost and output links; it starts nothing. The links are in its structured result.
  read("get-video", "account-data", "documented"),
  read("list-batches", "account-data", "documented"),
  read("list-preset-versions", "account-data", "synthetic"),
  read("list-presets", "account-data", "synthetic"),
  // Recipe retrieval: the returned text describes later installer or evaluation commands; retrieving it runs nothing.
  read("install-ori-harness", "recipe", "synthetic"),
  read("spawn-ori-eval", "recipe", "synthetic"),
  // Billable inference whose result is media: an image block, an audio block, or a finished video. A script would pay
  // for a result its RPC drops, so they run only natively.
  media("generate-image"),
  media("generate-speech"),
  media("generate-video"),
  // Billable inference whose result is text or structured content.
  paid("send-batch", "documented"),
  paid("send-decision", "documented"),
  // OpenRouter documents send-message's reply as text with the generation id.
  paid("send-message", "documented"),
  paid("transcribe-audio", "documented"),
  // Feedback on one of the account's own generations, sent to OpenRouter's team.
  { name: "send-feedback", effect: "send", billable: false, visibility: "execution", rpc: true, scriptOutput: "synthetic" },
]

/** Every reviewed upstream name. */
export const TOOL_NAMES: readonly string[] = REVIEWED_TOOLS.map((tool) => tool.name)
/** The reads, account and recipe reads included. */
export const READ_TOOLS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.effect === "read").map((tool) => tool.name)
/** Every tool that is not a read: billable inference, media generation and feedback. */
export const CHANGE_TOOLS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.effect !== "read").map((tool) => tool.name)
/** The tools that bill the account: inference, batches, decisions, transcription and media generation. */
export const BILLABLE_TOOLS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.billable).map((tool) => tool.name)
/** The tools scripts may call through the tools RPC. */
export const RPC_TOOLS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.rpc).map((tool) => tool.name)
/** Reviewed tools that run only natively, never as a script method. */
export const NATIVE_ONLY: readonly string[] = REVIEWED_TOOLS.filter((tool) => !tool.rpc).map((tool) => tool.name)
/** The script methods whose output has been checked against OpenRouter's live server. */
export const LIVE_VERIFIED_SCRIPT_METHODS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.rpc && tool.scriptOutput === "live-observed").map((tool) => tool.name)

/** The reviewed entry for an upstream name, or undefined for a tool this table has not reviewed. */
export const reviewedTool = (name: string): ReviewedTool | undefined => REVIEWED_TOOLS.find((tool) => tool.name === name)
