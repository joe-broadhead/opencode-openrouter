/**
 * OpenRouter's part of the tools RPC (`openrouter.models.tools`): the plugin value and the method table that the source
 * contract's `tools-rpc` module takes. The module (`@we-the-rebel-alliance/source-contract/tools-rpc`, bundled into
 * `dist/index.js`) is the transport the plugin family shares:
 *
 *   POST /api/rpc/openrouter.models.tools/<method>
 *   { "input": { "sessionID": "<session>", "input": <the tool's input> } }
 *
 * A script runs as a session and the agent it names; the rule for the method's permission action is resolved before
 * dispatch, and only `allow` runs. The plugin registers this value with `operationalShapers`, which runs its guard
 * before every dispatch.
 */
import { toolsRpcId, type Failure, type McpResult, type MethodSpec, type NextSteps, type ShapeCall, type Shapers, type ToolsRpcPlugin } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { PLUGIN_ID as OPENROUTER_PLUGIN_ID, SERVER_NAME } from "../constants.js"
import { REVIEWED_TOOLS } from "../openrouter-tools.js"

/** The plugin's id. The RPC id is `<PLUGIN_ID>.tools`. */
export const PLUGIN_ID = OPENROUTER_PLUGIN_ID

/** `openrouter.models.tools`. Scripts call it by name, so it never changes. */
export const TOOLS_RPC_ID = toolsRpcId(PLUGIN_ID)

/**
 * The reviewed OpenRouter tools a script may call, by exact upstream name with its hyphens, from the plugin's one
 * catalog in `src/openrouter-tools.ts`: every tool whose `rpc` is true, with its effect as the class (`read`, `write` for
 * a billable call, `send` for feedback). The native-only tools are not methods: the media generators, because the
 * transport's result keeps structured content and text and drops an image, audio or video block, so a script would pay
 * for media it never receives; and `get-current-key`, which describes the signed-in key. Their routes are unknown to
 * the contract, which refuses them before anything runs. A tool OpenRouter adds later is never a method until it is
 * reviewed in the catalog. The class never decides whether a call runs: the rules do.
 */
export const METHODS: readonly MethodSpec[] = REVIEWED_TOOLS.filter((tool) => tool.rpc).map((tool): MethodSpec => ({ kind: "mcp", name: tool.name, class: tool.effect }))

/**
 * What the model path's `execute.before` hooks do to an MCP call's arguments. OpenRouter has no such hook, so the
 * input passes unchanged. The plugin registers this module with {@link operationalShapers}, which runs its guard first.
 */
export function shapeInput(_method: string, input: unknown, _call: ShapeCall): unknown {
  return input
}

/** What the model path's `execute.after` hooks do to a result. OpenRouter has none: the result passes unchanged. */
export function shapeResult(_method: string, result: McpResult, _call: ShapeCall): McpResult {
  return result
}

/**
 * The shapers the plugin registers: the plugin's operational guard runs before every dispatch, so a script call, like a
 * native one, is refused with `POLICY_UNAVAILABLE` and nothing is sent while the plugin's rules are not in place, the
 * server entry is not the plugin's, or the plugin is unloading. The guard is per plugin instance, so it is passed in
 * rather than read from this module.
 */
export const operationalShapers = (assertOperational: () => void): Shapers => ({
  input(method, input, call) {
    assertOperational()
    return shapeInput(method, input, call)
  },
})

/**
 * OpenRouter's paid and feedback calls are not idempotent: after a call that may have reached OpenRouter (cancelled,
 * disconnected or failed upstream), repeating it may run and bill it twice. So these next steps never say "call again"
 * for them; a read can simply be repeated. Each is one sentence that ends with a full stop.
 */
/** The script methods that change something, from the catalog: the billable ones, then the rest (feedback). */
const PAID_METHODS = REVIEWED_TOOLS.filter((tool) => tool.rpc && tool.billable).map((tool) => tool.name)
const ASKING_METHODS = REVIEWED_TOOLS.filter((tool) => tool.rpc && tool.effect !== "read").map((tool) => tool.name)
const OTHER_CHANGES = ASKING_METHODS.filter((name) => !PAID_METHODS.includes(name))
const BEFORE_REPEATING = `for a billable method (${PAID_METHODS.join(", ")}) or ${OTHER_CHANGES.join(", ")} the call may already have run and been billed, so look for its generation or batch id in any output and check it with get-generation or get-batch, or check your activity on openrouter.ai, before you deliberately send it again`
export const NEXT_STEPS: NextSteps = {
  SESSION_UNKNOWN: `Create a session in the location you mean, such as POST /api/session with {"agent":"build"} sent with the header "x-opencode-directory: <dir>" or the location[directory] query, and pass its id.`,
  SESSION_AGENT_REQUIRED: `Create a session that names an agent this project has, with its project as the location, such as POST /api/session with {"agent":"build","location":{"directory":"/path/to/project"}}, and pass its id.`,
  PERMISSION_DENIED: `Add an allow rule for the tool to the session's agent or to the session, or use a session whose agent allows it; under access "ask-changes" ${ASKING_METHODS.join(", ")} ask, and a script cannot answer a prompt.`,
  SERVER_CONFLICT: `Run /openrouter-status, then set your own mcp.servers.${SERVER_NAME} in opencode.json to the URL it names or remove it, and restart OpenCode.`,
  AUTH_REQUIRED: `Run /connect and choose OpenRouter tools (in a terminal, opencode mcp auth ${SERVER_NAME} from the project folder where the plugin is installed); never put an OpenRouter key in a script.`,
  CONNECTING: `Wait a few seconds and run /openrouter-status; a read can be called again, but ${BEFORE_REPEATING}.`,
  CONNECTION_FAILED: `Check your network and run /openrouter-status; a read can be called again, but ${BEFORE_REPEATING}.`,
  DISABLED: `Enable the ${SERVER_NAME} server in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`,
  NOT_REGISTERED: "Run /openrouter-status and follow its next step.",
  TOOL_UNAVAILABLE: "Call describe to see which methods OpenCode lists now, and run /openrouter-status.",
  UPSTREAM_ERROR: `Check the input against the method's schema from describe; ${BEFORE_REPEATING}.`,
  CANCELLED: `The call may have reached OpenRouter before it was cancelled: a read can be called again, but ${BEFORE_REPEATING}.`,
}

/** The plugin's operational guard error, on the error itself or on the error OpenCode's executor wrapped. */
const guardRefusal = (error: unknown, depth = 0): { readonly message: string; readonly nextStep: string } | undefined => {
  if (typeof error !== "object" || error === null || depth > 3) return undefined
  const value = error as { code?: unknown; message?: unknown; nextStep?: unknown; error?: unknown; cause?: unknown }
  if (value.code === "POLICY_UNAVAILABLE" && typeof value.message === "string" && typeof value.nextStep === "string") return { message: value.message, nextStep: value.nextStep }
  return guardRefusal(value.error, depth + 1) ?? guardRefusal(value.cause, depth + 1)
}

/**
 * The plugin's own errors as a script's failure: the operational guard's `POLICY_UNAVAILABLE`, thrown by the input
 * shaper or by the guarded native executor, with what happened and the guard's one next step. Anything else is not the
 * plugin's.
 */
export function pluginError(error: unknown): Failure | undefined {
  const refusal = guardRefusal(error)
  if (!refusal) return undefined
  const what = refusal.message.replace(/^POLICY_UNAVAILABLE:\s*/, "").split(" Next step: ")[0]!.replace(/[.\s]+$/, "")
  return { code: "POLICY_UNAVAILABLE", what, next: refusal.nextStep }
}

/** OpenRouter's plugin value for the tools RPC. No method has a resource resolver. */
export const PLUGIN: ToolsRpcPlugin = { id: PLUGIN_ID, nextSteps: NEXT_STEPS, shapeInput, shapeResult, pluginError }
