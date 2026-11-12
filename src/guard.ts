// The operational guard: OpenRouter's native tools run only while the plugin's policy is in place. It is a small
// in-place decorator around each tool's own executor, registered with `ctx.tool.transform`, that checks the plugin's
// health and then delegates to the host's executor exactly once. It adds no prompt and decides no permission: the
// host's executor still asserts `openrouter_<name>` against the agent's rules before it calls the server.
//
// Health starts blocked. It becomes healthy only when the default permission rules applied in every agent with a base
// allow, the server is the plugin's own or the user's exact entry, and the last tool transform pass succeeded. Losing
// any of these, or unloading the plugin, blocks it again. The check is live, so a wrapper captured from an earlier
// pass stops too.
import type { Plugin } from "@opencode/plugin"
import { errorText, pluginError, SERVER_NAME } from "./constants.js"
import { namespaceOf, nativeToolId, type ServerSource } from "./mcp.js"
import { reasonOf, shortReason } from "./redact.js"

/** Where the default rules stand: not applied yet, applied in every agent with a base allow, or failed. */
export type PolicyInstallation = "pending" | "ready" | "failed"

export interface PolicyHealth {
  readonly installation: PolicyInstallation
  /** Diagnostics for status, in the `CODE: What happened. Next step: …` form. Empty while healthy. */
  readonly problems: readonly string[]
}

/** The image tool runs only as a direct tool: Code Mode's result path is not shown to keep its image. */
export const IMAGE_TOOL = nativeToolId("generate-image")

const NAMESPACE = namespaceOf(SERVER_NAME)

/** Why calls are held: the sentence and the one step that fixes it. */
interface Block {
  readonly message: string
  readonly nextStep: string
}

const RESTART = "Restart OpenCode; if it fails again, run /plugins to see the error."
const WAIT = "Wait a moment and try again; if this persists, restart OpenCode."

const policyFailed = (reason: string): Block => ({
  message: `OpenRouter's default permission rules could not be applied (${reason}), so the plugin blocks its tools before anything is sent.`,
  nextStep: RESTART,
})
const guardFailed = (reason: string): Block => ({
  message: `The plugin could not put its guard on OpenRouter's tools (${reason}), so it removed or blocks them.`,
  nextStep: RESTART,
})
const text = (block: Block) => errorText("POLICY_UNAVAILABLE", block.message, block.nextStep)

/** `observe` runs on every check; only the tests' seam passes it, to count checks per call. */
export function createGuard(source: () => ServerSource, observe?: () => void) {
  let policy: { installation: PolicyInstallation; reason?: string } = { installation: "pending" }
  let transformFailure: string | undefined
  let unnamespaced: readonly string[] = []
  let closed = false

  /** Why a call may not run now; undefined when the plugin is operational. */
  const blocked = (): Block | undefined => {
    if (closed) return { message: "The OpenRouter plugin is unloaded, so its tools no longer run.", nextStep: "Restart OpenCode, or add the plugin again." }
    const server = source()
    if (server.type === "pending") return { message: `The plugin has not checked the ${SERVER_NAME} server entry yet, so its tools are held.`, nextStep: WAIT }
    if (server.type !== "plugin" && server.type !== "adopted") {
      return {
        message: `The ${SERVER_NAME} server entry is no longer the plugin's own or your exact entry, so the plugin stopped its tools.`,
        nextStep: `Set mcp.servers.${SERVER_NAME} back to the plugin's endpoint, then restart OpenCode.`,
      }
    }
    if (policy.installation === "failed") return policyFailed(policy.reason ?? "no reason given")
    if (policy.installation === "pending") return { message: "OpenRouter's default permission rules are not applied yet, so its tools are held.", nextStep: WAIT }
    if (transformFailure) return guardFailed(transformFailure)
    return undefined
  }

  return {
    /** Throws `POLICY_UNAVAILABLE` unless the plugin is operational. Called before every native and scripted dispatch. */
    assertOperational() {
      observe?.()
      const block = blocked()
      if (block) throw pluginError("POLICY_UNAVAILABLE", block.message, block.nextStep)
    },
    operational: () => blocked() === undefined,
    /** Records the default rules' latest pass: `undefined` on success, or the reason it failed. */
    policyReport(failure: string | undefined) {
      policy = failure === undefined ? { installation: "ready" } : { installation: "failed", reason: failure }
    },
    /** Records the tool transform's latest pass. */
    transformReport(pass: GuardPass) {
      transformFailure = pass.failure
      unnamespaced = pass.unnamespaced
    },
    health(): PolicyHealth {
      const problems: string[] = []
      if (policy.installation === "failed") problems.push(text(policyFailed(policy.reason ?? "no reason given")))
      if (transformFailure) problems.push(text(guardFailed(transformFailure)))
      if (unnamespaced.length) {
        problems.push(
          errorText(
            "TOOL_NAMESPACE_MISSING",
            `OpenCode listed ${unnamespaced.join(", ")} with no tool namespace, so the plugin treats ${unnamespaced.length === 1 ? "it" : "them"} as OpenRouter's and guards ${unnamespaced.length === 1 ? "it" : "them"}.`,
            "If a tool here is not OpenRouter's, rename the plugin or server that adds it; otherwise update OpenCode.",
          ),
        )
      }
      return { installation: policy.installation, problems }
    },
    /** Blocks every call for good: the plugin is unloading. */
    close() {
      closed = true
    },
  }
}

export type Guard = ReturnType<typeof createGuard>

type ToolEditor = Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0]
type Tools = Pick<ToolEditor, "list" | "update" | "remove">
type Listed = ReturnType<ToolEditor["list"]>[number]

/**
 * Whether a registered tool is one of the `openrouter` server's native tools that the plugin may decorate: an
 * `openrouter_` id in the server's namespace, or with no namespace at all, while the entry is not another server the
 * user configured. A pending entry is decorated too, so a tool can never appear unguarded; the guard holds it until the
 * entry is checked. A tool with no namespace is decorated rather than skipped, so a host that stopped setting it fails
 * closed; another server whose name starts with `openrouter_` has its own namespace and is left alone.
 */
export const isOwnedOpenRouterTool = (tool: Pick<Listed, "id" | "options">, source: ServerSource) =>
  tool.id.startsWith(`${NAMESPACE}_`) &&
  (tool.options?.namespace === NAMESPACE || tool.options?.namespace === undefined) &&
  (source.type === "plugin" || source.type === "adopted" || source.type === "pending")

/** What one tool transform pass did. */
export interface GuardPass {
  /** Why some tools could not be decorated (and were removed), or undefined. */
  readonly failure: string | undefined
  /** `openrouter_` tools listed with no namespace, which the pass decorated anyway, at most 20, one line each. */
  readonly unnamespaced: readonly string[]
}

const NAME_LIMIT = 20

/**
 * One tool transform pass: decorates every owned OpenRouter tool's executor in place, and makes the image tool direct.
 * The original executor is captured inside this pass, before the assignment, and called exactly once; the wrapper never
 * calls the field it replaced, so replays never stack. Everything else about the tool (id, name, description, input and
 * output schema, options, permission) is left as the host made it. A tool that cannot be decorated is removed, so it
 * can never run unguarded. Synchronous and never throws.
 */
export function guardTools(editor: Tools, source: ServerSource, assertOperational: () => void): GuardPass {
  const failures: string[] = []
  const unnamespaced: string[] = []
  let tools: readonly Listed[]
  try {
    tools = editor.list()
  } catch (error) {
    return { failure: reasonOf(error), unnamespaced }
  }
  for (const tool of tools) {
    if (!isOwnedOpenRouterTool(tool, source)) continue
    if (tool.options?.namespace === undefined && unnamespaced.length < NAME_LIMIT) unnamespaced.push(shortReason(tool.id) ?? "an unnamed tool")
    try {
      editor.update(tool.id, (draft) => {
        const original = draft.execute
        draft.execute = async (input, context) => {
          assertOperational()
          return original(input, context)
        }
        // Only for the actual image tool of the plugin's own or the user's exact entry.
        if (tool.id === IMAGE_TOOL && (source.type === "plugin" || source.type === "adopted")) {
          const { pinned: _pinned, ...options } = draft.options ?? {}
          draft.options = { ...options, codemode: false }
        }
      })
    } catch (error) {
      failures.push(reasonOf(error))
      try {
        editor.remove(tool.id)
      } catch {
        // Removing failed too; the live check still refuses an older wrapper.
      }
    }
  }
  return { failure: failures.length ? `${failures.length} tool${failures.length === 1 ? "" : "s"} failed: ${failures[0]}` : undefined, unnamespaced }
}

/** Registers the guard as a tool transform. Each pass reads the latest server observation and reports its outcome. */
export function registerGuard(tool: Pick<Plugin.Context["tool"], "transform">, guard: Guard, source: () => ServerSource) {
  return tool.transform((editor) => guard.transformReport(guardTools(editor, source(), guard.assertOperational)))
}
