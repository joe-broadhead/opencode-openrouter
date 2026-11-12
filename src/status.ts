// One status model for `/openrouter-status`, the `/openrouter` dialog and the status RPC `openrouter.models` /
// `status`. It is built from local host state only: the plugin's own observations (the server entry, the rules, the
// guard, the skills) and OpenCode's lists of MCP servers, tools and agents. It never calls OpenRouter: no ping, no
// credit read, no model list, no generation lookup. A user who wants a health check asks for `ping` through the
// ordinary permitted tool path.
import type { Plugin, Rpc } from "@opencode/plugin"
import { codeText, PLUGIN_ID, SERVER_NAME, TESTED_HOSTS } from "./constants.js"
import { isSupportedHost, type HostCheck } from "./host-version.js"
import type { ServerSource } from "./mcp.js"
import { CHANGE_TOOLS, NATIVE_ONLY, RPC_TOOLS, TOOL_NAMES, LIVE_VERIFIED_SCRIPT_METHODS } from "./openrouter-tools.js"
import { ACCESS, type Access } from "./options.js"
import { defaultRules, type AgentCoverage } from "./permissions.js"
import { shortReason } from "./redact.js"
import type { SkillState, SkillStatus } from "./skills.js"
import { VERSION } from "./version.js"

/** The connection's state, in machine form; the report shows `sign-in required` and so on. */
export type State = "connecting" | "connected" | "sign_in_required" | "disabled" | "failed" | "not_configured" | "conflict" | "policy_unavailable"

/** The MCP server's own status, as `ctx.mcp.list()` reports it. */
export type ServerStatus = "connected" | "pending" | "disabled" | "failed" | "needs_auth"

/** What status is built from: the plugin's own observations and OpenCode's lists, read at the time of the call. */
export interface StatusFacts {
  readonly host: HostCheck
  readonly access: Access
  /** Who the `openrouter` entry belongs to, from the plugin's latest MCP transform. */
  readonly source: ServerSource
  /** The server's row in `ctx.mcp.list()`, or undefined when OpenCode lists no `openrouter` server. */
  readonly server?: { readonly status: ServerStatus; readonly error?: string }
  /** The upstream names of the tools OpenCode lists in the `openrouter` namespace. */
  readonly tools: readonly string[]
  /** True while the server changed status moments ago, so no tools yet means "still listing", not "none". */
  readonly settling: boolean
  /** When the plugin's tool transform last found OpenRouter's tools; undefined before it has. */
  readonly lastObservedAt?: string
  readonly policy: { readonly installation: "pending" | "ready" | "failed"; readonly problems: readonly string[] }
  readonly coverage: AgentCoverage
  readonly skills: readonly SkillStatus[]
  /** Diagnostics already in the `CODE: What happened. Next step: …` form: the server entry's and the skills'. */
  readonly problems: readonly string[]
}

export interface Problem {
  readonly code: string
  /** The whole line: `CODE: What happened. Next step: What to do.` */
  readonly message: string
}

/**
 * The status every surface shows. `version`, `host`, `state`, `unguardedAgents` and `nextStep` are the fields every
 * plugin of this family shares; the rest are OpenRouter's own.
 */
export interface Status {
  readonly version: string
  readonly host: HostCheck
  readonly state: State
  readonly access: Access
  /** Who the `openrouter` entry belongs to: the plugin, the user (adopted unchanged), a disabled or conflicting entry. */
  readonly source: ServerSource["type"]
  /** For a failed connection only: OpenCode's reason, one line of at most 160 characters, redacted. */
  readonly error?: string
  readonly catalog: {
    /** `pending` while connecting or still listing, `ready` once connected and listed, `unavailable` otherwise. */
    readonly state: "pending" | "ready" | "unavailable"
    /** How many tools OpenCode lists for the server. */
    readonly observed: number
    /** How many of them the plugin's catalog has reviewed. */
    readonly reviewedPresent: number
    /** How many it has not; `unknown` names at most 20 of them. */
    readonly unknownCount: number
    readonly unknown: readonly string[]
    /** Reviewed tools a ready catalog does not list. */
    readonly missingReviewed: readonly string[]
    /** When the plugin last found OpenRouter's tools; omitted before it has, never replaced by the current time. */
    readonly lastObservedAt?: string
  }
  readonly scripting: {
    /** The reviewed tools scripts may call through the tools RPC. */
    readonly reviewedMethodCount: number
    /** Reviewed tools that run only natively, never as a script method. */
    readonly nativeOnly: readonly string[]
    /** How many script methods have output checked against OpenRouter's live server. */
    readonly liveVerifiedCount: number
  }
  readonly policy: { readonly installation: "pending" | "ready" | "failed" }
  readonly skills: readonly { readonly name: string; readonly state: SkillState; readonly shadowedBy?: string }[]
  /** Agents where a billable, feedback or unreviewed OpenRouter call would run with no prompt under a broad allow. */
  readonly unguardedAgents: readonly string[]
  /** Agents whose own rule allows such a call: an intentional decision, shown, never overridden. */
  readonly explicitlyAllowedAgents: readonly string[]
  readonly problems: readonly Problem[]
  /** The one next step: "Nothing to do." when nothing is needed. */
  readonly nextStep: string
}

const NOTHING_TO_DO = "Nothing to do."
const UNKNOWN_LIMIT = 20
// A tool name comes from the server: list only plain names. OpenRouter's own names carry hyphens.
const SAFE_NAME = /^[a-z][a-z0-9_-]{0,63}$/

const SIGN_IN = `Run /connect and choose OpenRouter tools, or /mcps and choose ${SERVER_NAME} (in a terminal, run opencode mcp auth ${SERVER_NAME} from the project folder where the plugin is installed); never paste an OpenRouter key into the chat.`
const AGENTS_NEXT_STEP =
  "Put the default rules shown by /openrouter-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your own rules for OpenRouter tools."

const STATE_OF: Record<ServerStatus, State> = { connected: "connected", pending: "connecting", needs_auth: "sign_in_required", failed: "failed", disabled: "disabled" }

/** A diagnostic line as a problem: its code is the text before the first colon. */
const problemOf = (message: string): Problem => ({ code: /^([A-Z_]+):/.exec(message)?.[1] ?? "PROBLEM", message })

/** A problem's own next step, the text after `Next step: `. */
const stepOf = (problem: Problem | undefined) => problem?.message.split(" Next step: ")[1]

export function buildStatus(facts: StatusFacts): Status {
  const { source } = facts
  const policyProblems = facts.policy.problems.map(problemOf)
  const blocked = facts.policy.installation === "failed" || policyProblems.some((problem) => problem.code === "POLICY_UNAVAILABLE")
  const owned = source.type === "plugin" || source.type === "adopted"
  const state: State =
    source.type === "conflict"
      ? "conflict"
      : blocked
        ? "policy_unavailable"
        : source.type === "disabled"
          ? "disabled"
          : facts.server
            ? STATE_OF[facts.server.status]
            : source.type === "pending"
              ? "connecting"
              : "not_configured"
  // A conflicting entry is the user's own server: its tools are not OpenRouter's catalog as far as status goes.
  const listed = owned || source.type === "pending" ? facts.tools : []
  const connected = facts.server?.status === "connected" && (owned || source.type === "pending")
  const catalogState = connected ? (listed.length === 0 && facts.settling ? "pending" : "ready") : state === "connecting" ? "pending" : "unavailable"
  const unknown = listed.filter((name) => !TOOL_NAMES.includes(name))
  const error = state === "failed" && facts.server?.error ? shortReason(facts.server.error) : undefined
  const status: Omit<Status, "nextStep"> = {
    version: VERSION,
    host: facts.host,
    state,
    access: facts.access,
    source: source.type,
    ...(error ? { error } : {}),
    catalog: {
      state: catalogState,
      observed: listed.length,
      reviewedPresent: listed.filter((name) => TOOL_NAMES.includes(name)).length,
      unknownCount: unknown.length,
      unknown: unknown.filter((name) => SAFE_NAME.test(name)).slice(0, UNKNOWN_LIMIT),
      missingReviewed: catalogState === "ready" && listed.length > 0 ? TOOL_NAMES.filter((name) => !listed.includes(name)) : [],
      ...(facts.lastObservedAt ? { lastObservedAt: facts.lastObservedAt } : {}),
    },
    scripting: { reviewedMethodCount: RPC_TOOLS.length, nativeOnly: [...NATIVE_ONLY], liveVerifiedCount: LIVE_VERIFIED_SCRIPT_METHODS.length },
    policy: { installation: facts.policy.installation },
    skills: facts.skills.map(({ name, state: skillState, shadowedBy }) => ({ name, state: skillState, ...(shadowedBy ? { shadowedBy } : {}) })),
    unguardedAgents: facts.coverage.unguarded,
    explicitlyAllowedAgents: facts.coverage.explicitlyAllowed,
    problems: [...facts.problems.map(problemOf), ...policyProblems],
  }
  return { ...status, nextStep: nextStepOf(status, source) }
}

/**
 * The one next step, in priority order: a conflict or a failed policy, a disabled server, a sign-in, the connection and
 * the catalog, the skills, then agents without the rules, then any other problem.
 */
function nextStepOf(status: Omit<Status, "nextStep">, source: ServerSource): string {
  const find = (code: string) => status.problems.find((problem) => problem.code === code)
  switch (status.state) {
    case "conflict":
      return stepOf(find("SERVER_CONFLICT")) ?? `Set mcp.servers.${SERVER_NAME}.url in opencode.json to the plugin's endpoint, or rename or remove that entry, then restart OpenCode.`
    case "policy_unavailable":
      return stepOf(find("POLICY_UNAVAILABLE")) ?? "Restart OpenCode; if it fails again, run /plugins to see the error."
    case "disabled":
      return `Enable the ${SERVER_NAME} server in /mcps, or remove "disabled": true from mcp.servers.${SERVER_NAME} in opencode.json.`
    case "sign_in_required":
      return SIGN_IN
    case "connecting":
      return "OpenRouter tools are still connecting. Run /openrouter-status again in a few seconds."
    case "failed":
      // A user's own entry with `oauth: false` signs in with the headers it carries; the plugin never reads them.
      if (source.type === "adopted" && source.signIn === "user-managed") {
        return `Check the credential in the headers of your own mcp.servers.${SERVER_NAME}, then restart OpenCode.`
      }
      return `Check your network, then run /openrouter-status again; if it still fails, sign in again from /connect → OpenRouter tools.`
    case "not_configured":
      return `OpenCode has no ${SERVER_NAME} MCP server. Check that no organisation policy (mcp.use) or other plugin removes it, then restart OpenCode.`
  }
  if (status.catalog.state === "pending") return "OpenRouter is still listing its tools. Run /openrouter-status again in a few seconds."
  if (status.catalog.observed === 0) {
    return "OpenRouter lists no tools for this sign-in. Sign in again from /connect → OpenRouter tools, then run /openrouter-status."
  }
  const skills = find("SKILLS_INVALID")
  if (skills) return stepOf(skills)!
  const shadowed = status.skills.filter((skill) => skill.state === "shadowed")
  if (shadowed.length) {
    return `Rename or move ${list(shadowed.map((skill) => `the "${skill.name}" skill at ${skill.shadowedBy ?? "another path"}`))}, which OpenCode loads instead of the plugin's skill of the same name.`
  }
  if (status.unguardedAgents.length) return AGENTS_NEXT_STEP
  return stepOf(status.problems[0]) ?? NOTHING_TO_DO
}

const list = (items: readonly string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`)

const STATE_TEXT: Record<State, string> = {
  connected: "connected",
  connecting: "connecting",
  sign_in_required: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
  policy_unavailable: "blocked: the plugin's policy is not in place",
}

const SOURCE_TEXT: Record<ServerSource["type"], string> = {
  plugin: "registered by this plugin",
  adopted: `your own mcp.servers.${SERVER_NAME}, used unchanged`,
  disabled: `your mcp.servers.${SERVER_NAME}, disabled`,
  conflict: `your mcp.servers.${SERVER_NAME} points elsewhere and is left untouched`,
  pending: "not checked yet",
}

/** What the default rules do under `access`, derived from the catalog so it cannot go stale. */
const postureOf = (access: Access) => {
  const changes = `${CHANGE_TOOLS.join(", ")} and tools OpenRouter adds later`
  if (access === "all") return "every OpenRouter tool is allowed, billable inference and feedback included"
  return `reads run without asking; ${changes} ${access === "ask-changes" ? "ask first" : "are denied"}`
}

function catalogText({ catalog, access }: Status) {
  if (catalog.state === "unavailable") return "not listed (no connection)"
  if (catalog.state === "pending") return "none listed yet (OpenRouter is still listing them)"
  const seen = catalog.lastObservedAt ? `; last seen ${catalog.lastObservedAt}` : ""
  const missing = catalog.missingReviewed.length ? `; reviewed but not listed: ${catalog.missingReviewed.join(", ")}` : ""
  if (catalog.unknownCount === 0) return `${catalog.observed} listed, ${catalog.reviewedPresent} reviewed, 0 unknown${missing}${seen}`
  const more = catalog.unknownCount - catalog.unknown.length
  const names = catalog.unknown.length ? `: ${catalog.unknown.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : ""
  const effect = access === "all" ? "allowed" : access === "ask-changes" ? "asked about" : "denied"
  return `${catalog.observed} listed, ${catalog.reviewedPresent} reviewed, ${catalog.unknownCount} unknown${names} (${effect}, never a script method)${missing}${seen}`
}

function scriptingText({ scripting }: Status) {
  const verified =
    scripting.liveVerifiedCount === scripting.reviewedMethodCount
      ? "their output checked against OpenRouter's live server"
      : `output checked against a test server only, not yet against OpenRouter's live server (${scripting.liveVerifiedCount} of ${scripting.reviewedMethodCount} checked live)`
  return `${scripting.reviewedMethodCount} methods through ${PLUGIN_ID}.tools, ${verified}; ${list(scripting.nativeOnly)} only as a native tool, because the script result keeps text only`
}

function skillsText({ skills }: Status) {
  const loaded = skills.filter((skill) => skill.state === "loaded").length
  const other = skills.filter((skill) => skill.state !== "loaded").map((skill) => `${skill.name} ${skill.state}${skill.shadowedBy ? ` by ${skill.shadowedBy}` : ""}`)
  return `${loaded} of ${skills.length} loaded${other.length ? `; ${other.join("; ")}` : ""}`
}

const POLICY_TEXT = { pending: "not applied yet", ready: "applied", failed: "failed to apply" } as const

/** The default rules to paste into an agent's own permissions, one rule a line, as a JSON array body. */
const agentRules = (access: Access) =>
  defaultRules(access)
    .map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`)
    .join("\n")

const TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`

function hostText({ host }: Status) {
  const outside = host.version === null || !isSupportedHost(host.version)
  const note = outside ? `. It is outside the supported range; the plugin runs because allowUntestedHost is true. If OpenRouter's tools misbehave, use OpenCode ${TESTED_TEXT}` : ""
  return `${host.version ?? "unknown version"} (${host.tested ? "tested" : "untested"}; supported range ${host.range})${note}`
}

/** The report `/openrouter-status` posts and the dialog shows. */
export function formatStatus(status: Status) {
  const details = [status.error, SOURCE_TEXT[status.source]].filter(Boolean).join("; ")
  const agents = status.unguardedAgents
  return [
    "OpenRouter status",
    `- Connection: ${STATE_TEXT[status.state]} (${details})`,
    `- Access: ${status.access}: ${postureOf(status.access)}`,
    `- Default rules: ${POLICY_TEXT[status.policy.installation]}`,
    `- Tools: ${catalogText(status)}`,
    `- Scripts: ${scriptingText(status)}`,
    `- Skills: ${skillsText(status)}`,
    `- Agents without default rules: ${agents.length ? `${agents.join(", ")}\n${agentRules(status.access)}` : "none"}`,
    `- Agents that allow OpenRouter changes with their own rule: ${status.explicitlyAllowedAgents.length ? status.explicitlyAllowedAgents.join(", ") : "none"}`,
    `- OpenCode: ${hostText(status)}`,
    `- Problems: ${status.problems.length ? status.problems.map((problem) => `\n  ${problem.message}`).join("") : "none"}`,
    `- Next step: ${status.nextStep}`,
  ].join("\n")
}

/** What the plugin knows about itself, as status reads it: a narrow view of the plugin's state. */
export interface StatusSource {
  readonly host: HostCheck
  readonly options: { readonly access: Access }
  readonly server: () => { readonly source: ServerSource; readonly problems: readonly string[] }
  readonly policy: () => { readonly installation: "pending" | "ready" | "failed"; readonly problems: readonly string[] }
  readonly agentCoverage: () => Promise<AgentCoverage>
  readonly skills: () => Promise<readonly SkillStatus[]>
  readonly skillProblems: readonly string[]
  readonly lastObservedAt: () => string | undefined
  /** When the server last changed status, or the plugin started, in milliseconds since the epoch. */
  readonly serverChangedAt: () => number
}

export interface StatusContext {
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
  readonly tool: Pick<Plugin.Context["tool"], "list">
}

/** How long after a status change no tools still means "listing". */
export const LISTING_MS = 15_000

/** Reads the live facts through public host APIs and the plugin's own state; never calls OpenRouter. */
export async function readStatus(ctx: StatusContext, state: StatusSource): Promise<Status> {
  const [servers, tools, coverage, skills] = await Promise.all([ctx.mcp.list(), ctx.tool.list(), state.agentCoverage(), state.skills()])
  const row = servers.data.find((entry) => entry.name === SERVER_NAME)
  const observation = state.server()
  const lastObservedAt = state.lastObservedAt()
  const prefix = `${SERVER_NAME}_`
  return buildStatus({
    host: state.host,
    access: state.options.access,
    source: observation.source,
    ...(row ? { server: { status: row.status.status, ...(row.status.status === "failed" ? { error: row.status.error } : {}) } } : {}),
    tools: tools.filter((tool) => tool.options?.namespace === SERVER_NAME && tool.id.startsWith(prefix)).map((tool) => tool.id.slice(prefix.length)),
    settling: Date.now() - state.serverChangedAt() < LISTING_MS,
    ...(lastObservedAt ? { lastObservedAt } : {}),
    policy: state.policy(),
    coverage,
    skills,
    problems: [...observation.problems, ...state.skillProblems],
  })
}

/** Why status could not be read: a coded message and its next step. The reason is cut like a failure's. */
function unavailable(error: unknown) {
  const reason = shortReason(error instanceof Error ? error.message : String(error))
  return {
    message: codeText("STATUS_UNAVAILABLE", `Could not read OpenRouter's status${reason ? ` (${reason})` : ""}.`),
    nextStep: "Restart OpenCode, then run /openrouter-status again.",
  }
}

const strings = { type: "array", items: { type: "string" } }
const count = { type: "integer", minimum: 0 }
const nullableString = { type: ["string", "null"] }
const STATES: readonly State[] = ["connecting", "connected", "sign_in_required", "disabled", "failed", "not_configured", "conflict", "policy_unavailable"]

/**
 * One read-only method for the terminal UI and scripts, as plain JSON Schema. The UI part does not receive the plugin
 * options and cannot see the server part's observations, so it asks the server part for the same status the command
 * reports.
 */
export const StatusRpc = {
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["version", "host", "state", "access", "source", "catalog", "scripting", "policy", "skills", "unguardedAgents", "explicitlyAllowedAgents", "problems", "nextStep"],
        properties: {
          version: { type: "string" },
          host: { type: "object", required: ["version", "range", "tested"], properties: { version: nullableString, range: { type: "string" }, tested: { type: "boolean" } } },
          state: { enum: [...STATES] },
          access: { enum: [...ACCESS] },
          source: { enum: ["plugin", "adopted", "disabled", "conflict", "pending"] },
          error: { type: "string" },
          catalog: {
            type: "object",
            required: ["state", "observed", "reviewedPresent", "unknownCount", "unknown", "missingReviewed"],
            properties: {
              state: { enum: ["pending", "ready", "unavailable"] },
              observed: count,
              reviewedPresent: count,
              unknownCount: count,
              unknown: strings,
              missingReviewed: strings,
              lastObservedAt: { type: "string" },
            },
          },
          scripting: {
            type: "object",
            required: ["reviewedMethodCount", "nativeOnly", "liveVerifiedCount"],
            properties: { reviewedMethodCount: count, nativeOnly: strings, liveVerifiedCount: count },
          },
          policy: { type: "object", required: ["installation"], properties: { installation: { enum: ["pending", "ready", "failed"] } } },
          skills: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "state"],
              properties: { name: { type: "string" }, state: { enum: ["loaded", "missing", "invalid", "shadowed"] }, shadowedBy: { type: "string" } },
            },
          },
          unguardedAgents: strings,
          explicitlyAllowedAgents: strings,
          problems: { type: "array", items: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } },
          nextStep: { type: "string" },
        },
      },
      errors: { unavailable: { type: "object", required: ["nextStep"], properties: { nextStep: { type: "string" } } } },
    },
  },
  events: {},
} satisfies Rpc.PortableDefinition

export function registerStatusRpc(rpc: Pick<Plugin.Context["rpc"], "register">, read: () => Promise<Status>) {
  return rpc.register(StatusRpc, {
    status: (_input, { error }) =>
      read().catch((cause: unknown) => {
        const { message, nextStep } = unavailable(cause)
        return error("unavailable", message, { nextStep })
      }),
  })
}

export const STATUS_COMMAND = "openrouter-status"

/** `/openrouter-status`: posts the report into the session as a synthetic message, with no model turn. */
export function registerStatusCommand(
  ctx: { readonly command: Pick<Plugin.Context["command"], "transform">; readonly session: Pick<Plugin.Context["session"], "synthetic"> },
  read: () => Promise<Status>,
) {
  return ctx.command.transform((editor) =>
    editor.add({
      name: STATUS_COMMAND,
      description: "Show OpenRouter tools' connection, sign-in, rules, tools, scripts and the next step, without calling OpenRouter",
      execute: async ({ sessionID }) => {
        const text = await read().then(formatStatus, (cause: unknown) => {
          const { message, nextStep } = unavailable(cause)
          return `${message} Next step: ${nextStep}`
        })
        await ctx.session.synthetic({ sessionID, text, description: "OpenRouter status", resume: false })
      },
    }),
  )
}
