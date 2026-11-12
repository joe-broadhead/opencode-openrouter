// The one reviewed record of OpenRouter's MCP tools. No imports: everything else (default rules, script methods, status
// counts, the Jelly declaration and the drift check) derives from this table, never from a hand-written copy.
//
// Evidence: the 17 names and their purposes are documented on OpenRouter's MCP page
// (https://openrouter.ai/docs/guides/overview/mcp-server, read 2026-11-11); see test/fixtures/documented-tools.json.
// No signed-in tool list has been captured, so no input schema, output schema or annotation is recorded here. The
// effect, billing, visibility and script columns are this plugin's reviewed policy, not OpenRouter annotations.

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
  /** Why a tool is native-only: the shared script adapter returns text and drops media content. */
  readonly rpcExclusion?: "native-media-required"
  /**
   * For a script method: the strongest evidence that its useful result fits the tools RPC's `{ output?, text }` result,
   * which keeps structured content and text and drops every other content block. Only a signed-in capture makes it
   * `live-observed`; until then a method stays a script method on this evidence, and a capture whose useful result is
   * media removes it from the script methods.
   */
  readonly scriptOutput?: Evidence
}

const read = (name: string, visibility: ToolVisibility): ReviewedTool => ({ name, effect: "read", billable: false, visibility, rpc: true, scriptOutput: "synthetic" })

/** Sorted by name within each class: reads first, then the executions. */
export const REVIEWED_TOOLS: readonly ReviewedTool[] = [
  read("get-model", "public-data"),
  read("list-app-rankings", "public-data"),
  read("list-benchmarks", "public-data"),
  read("list-daily-model-rankings", "public-data"),
  read("list-model-endpoints", "public-data"),
  read("list-models", "public-data"),
  read("list-providers", "public-data"),
  read("list-task-classifications", "public-data"),
  read("ping", "public-data"),
  read("search-docs", "public-data"),
  read("get-credits", "account-data"),
  read("get-generation", "account-data"),
  // Recipe retrieval: the returned text describes later installer or evaluation commands; retrieving it runs nothing.
  read("install-ori-harness", "recipe"),
  read("spawn-ori-eval", "recipe"),
  // Billable inference: a test message to any model. OpenRouter documents its reply as text with the generation id.
  { name: "send-message", effect: "write", billable: true, visibility: "execution", rpc: true, scriptOutput: "documented" },
  // Billable inference whose image comes back as a content block. The script RPC would drop it after the spend.
  { name: "generate-image", effect: "write", billable: true, visibility: "execution", rpc: false, rpcExclusion: "native-media-required" },
  // Feedback on one of the account's own generations, sent to OpenRouter's team.
  { name: "send-feedback", effect: "send", billable: false, visibility: "execution", rpc: true, scriptOutput: "synthetic" },
]

/** Every reviewed upstream name. */
export const TOOL_NAMES: readonly string[] = REVIEWED_TOOLS.map((tool) => tool.name)
/** The reads, account and recipe reads included. */
export const READ_TOOLS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.effect === "read").map((tool) => tool.name)
/** Every tool that is not a read: billable inference and feedback. */
export const CHANGE_TOOLS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.effect !== "read").map((tool) => tool.name)
/** OpenRouter's documented billable inference tools. */
export const BILLABLE_TOOLS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.billable).map((tool) => tool.name)
/** The tools scripts may call through the tools RPC. */
export const RPC_TOOLS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.rpc).map((tool) => tool.name)
/** Reviewed tools that run only natively, never as a script method. */
export const NATIVE_ONLY: readonly string[] = REVIEWED_TOOLS.filter((tool) => !tool.rpc).map((tool) => tool.name)
/** The script methods whose output has been checked against OpenRouter's live server. */
export const LIVE_VERIFIED_SCRIPT_METHODS: readonly string[] = REVIEWED_TOOLS.filter((tool) => tool.rpc && tool.scriptOutput === "live-observed").map((tool) => tool.name)

/** The reviewed entry for an upstream name, or undefined for a tool this table has not reviewed. */
export const reviewedTool = (name: string): ReviewedTool | undefined => REVIEWED_TOOLS.find((tool) => tool.name === name)
