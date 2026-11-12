// The default permission rules for OpenRouter's tools, generated from the reviewed catalog and `access`, and inserted
// into each agent with `ctx.agent.transform`. The host decides every call from them; this module never evaluates a
// call at run time and registers no permission hook.
//
// The block is the broad `openrouter_*` baseline first, then one exact rule per reviewed tool, because the host's last
// matching rule wins: a tool OpenRouter adds later falls under the baseline, and each reviewed tool gets its class's
// effect. It goes right after an agent's first base allow (`* * allow`), so every later rule (the agent's own stricter
// rules, the user's `permissions`, a session's rules and saved approvals) still wins over it.
import type { Plugin } from "@opencode/plugin"
import { SERVER_NAME } from "./constants.js"
import { nativeToolId, type ServerSource } from "./mcp.js"
import { CHANGE_TOOLS, REVIEWED_TOOLS, type ReviewedTool } from "./openrouter-tools.js"
import type { Access } from "./options.js"
import { reasonOf } from "./redact.js"

export interface Rule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "ask" | "deny"
}

/** The base allow the block follows. An agent without one is strict, and the block would loosen it, so it is skipped. */
export const BASE_ALLOW: Rule = { action: "*", resource: "*", effect: "allow" }

/** The pattern every OpenRouter tool's permission action matches, today's and any added later. */
export const BASELINE_ACTION = `${SERVER_NAME}_*`

/**
 * The effect of a tool the catalog has not reviewed, and of the reviewed changes: `all` allows, `ask-changes` asks,
 * `read-only` denies.
 */
export const changeEffect = (access: Access): Rule["effect"] => (access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny")

/** A reviewed tool's effect under `access`: every read is allowed; billable inference and feedback follow the access. */
export const effectOf = (tool: ReviewedTool, access: Access): Rule["effect"] => (tool.effect === "read" ? "allow" : changeEffect(access))

/** The exact block for `access`: the baseline, then every reviewed tool in catalog order. */
export const defaultRules = (access: Access): Rule[] => [
  { action: BASELINE_ACTION, resource: "*", effect: changeEffect(access) },
  ...REVIEWED_TOOLS.map((tool): Rule => ({ action: nativeToolId(tool.name), resource: "*", effect: effectOf(tool, access) })),
]

const same = (a: Rule, b: Rule) => a.action === b.action && a.resource === b.resource && a.effect === b.effect

/** Where the block would go: the index of the agent's first base allow, or -1 for a strict agent. */
const baseIndex = (permissions: readonly Rule[]) => permissions.findIndex((rule) => same(rule, BASE_ALLOW))

/**
 * True when the whole block for `access` appears, contiguous and in order, somewhere after the agent's first base allow.
 * Other plugins insert their own blocks at the same place, so it need not come first. A partial block, a block for
 * another access, or a block before the base allow is not installed. False for an agent without a base allow.
 */
export function hasDefaultRules(permissions: readonly Rule[], access: Access) {
  const base = baseIndex(permissions)
  if (base === -1) return false
  const block = defaultRules(access)
  for (let start = base + 1; start + block.length <= permissions.length; start++) {
    if (block.every((rule, offset) => same(permissions[start + offset]!, rule))) return true
  }
  return false
}

/**
 * Splices the block in right after the agent's first base allow. Leaves a strict agent (no base allow) and an agent
 * that already carries the whole block unchanged. Returns whether it inserted.
 */
export function insertRules(permissions: Rule[], access: Access) {
  const base = baseIndex(permissions)
  if (base === -1 || hasDefaultRules(permissions, access)) return false
  permissions.splice(base + 1, 0, ...defaultRules(access))
  return true
}

type AgentEditor = Parameters<Parameters<Plugin.Context["agent"]["transform"]>[0]>[0]
type Agents = Pick<AgentEditor, "list" | "update">

/** What one pass of the agent transform found: undefined when every agent with a base allow carries the block. */
export function applyDefaultRules(editor: Agents, access: Access): string | undefined {
  try {
    const missing: string[] = []
    for (const { id } of editor.list()) {
      editor.update(id, (agent) => {
        const permissions = agent.permissions as Rule[]
        insertRules(permissions, access)
        if (baseIndex(permissions) !== -1 && !hasDefaultRules(permissions, access)) missing.push(id)
      })
    }
    if (missing.length) return `the block is missing from ${missing.length} agent${missing.length === 1 ? "" : "s"} after insertion`
    return undefined
  } catch (error) {
    return reasonOf(error)
  }
}

/**
 * Whether the block belongs in the agents for this server entry: the plugin's own or the user's exact entry, and a
 * pending one, as the fail-safe before the first check. A conflicting or disabled entry is the user's own server, and
 * the plugin adds no rule for it; the replay that finds the conflict leaves the block out, so it ends with none.
 */
export const rulesApply = (source: ServerSource) => source.type === "plugin" || source.type === "adopted" || source.type === "pending"

/**
 * Registers the default rules for every agent. Each pass reports its outcome: `undefined` when the block is in every
 * agent with a base allow, or when the entry is not the plugin's and there is nothing to apply; otherwise the reason it
 * is not in place. Every pass starts from the agents' configured rules, so a pass that applies nothing removes the
 * block. Synchronous and never throws.
 */
export function registerDefaultRules(agent: Pick<Plugin.Context["agent"], "transform">, access: Access, source: () => ServerSource, report: (failure: string | undefined) => void, fault?: () => boolean) {
  return agent.transform((editor) => {
    if (fault?.()) return report("injected failure")
    report(rulesApply(source()) ? applyDefaultRules(editor, access) : undefined)
  })
}

const wildcard = (pattern: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`)

/** The rule the host's last-match evaluation picks for an MCP call (resource `*`), or undefined (the host asks). */
export const lastMatch = (permissions: readonly Rule[], action: string) =>
  permissions.findLast((rule) => wildcard(rule.action).test(action) && wildcard(rule.resource).test("*"))

/** A tool name the catalog has never reviewed, used to probe how an agent treats OpenRouter's future tools. */
const UNREVIEWED_PROBE = nativeToolId("unreviewed-tool")

/**
 * Agents where the plugin's block never arrived and an OpenRouter change would run only because of the broad base
 * allow: no block, and a billable, feedback or unreviewed tool's winning rule is a `*` allow. An agent whose own rules
 * name OpenRouter (an explicit allow included) made its own decision and is not listed. Under `all` the block would
 * allow everything too, so no agent is unguarded. Status shows each one with the exact block from `defaultRules`.
 */
export function unguardedAgents(agents: readonly { readonly id: string; readonly permissions: readonly Rule[] }[], access: Access) {
  if (access === "all") return []
  const probes = [...CHANGE_TOOLS.map(nativeToolId), UNREVIEWED_PROBE]
  return agents
    .filter((agent) => !hasDefaultRules(agent.permissions, access))
    .filter((agent) =>
      probes.some((action) => {
        const rule = lastMatch(agent.permissions, action)
        return rule?.action === "*" && rule.effect === "allow"
      }),
    )
    .map((agent) => agent.id)
}
