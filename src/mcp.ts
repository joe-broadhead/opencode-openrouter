// The `openrouter` MCP server entry: registration, adoption of the user's own exact entry, and conflicts.
//
// OpenCode owns the connection, discovery, OAuth and credentials. The plugin contributes `{ type: "remote", url }` and
// nothing else: no client ID, redirect URI, scope, protocol, timeout or header, so OpenCode's own sign-in runs the flow
// OpenRouter's metadata advertises. Of a user's entry only its type, URL, `disabled` and whether `oauth` is false are
// read, never its headers, which may hold a key.
import type { Mcp, Plugin } from "@opencode/plugin"
import { errorText, SERVER_NAME } from "./constants.js"
import { reasonOf, shortReason } from "./redact.js"

/** Internal seam: tests point the server at a loopback fake, with OAuth off unless they test the sign-in. */
export interface EndpointSeam {
  readonly endpoint: string
  readonly oauth?: false
}

export type RemoteConfig = Extract<Mcp.ServerConfig, { type: "remote" }>

/** Who the `openrouter` entry belongs to. `pending` until the host has run the MCP transform once. */
export type ServerSource =
  | { readonly type: "plugin" }
  | { readonly type: "adopted"; readonly signIn: "oauth" | "user-managed" }
  | { readonly type: "disabled" }
  | { readonly type: "conflict"; readonly safeDescription: string }
  | { readonly type: "pending" }

/** What the latest MCP transform found. Replays replace it whole, so nothing accumulates. */
export interface ServerObservation {
  readonly source: ServerSource
  /** Other entries that point at OpenRouter's MCP host under another name: never taken over. */
  readonly duplicates: readonly string[]
  /** Other entries whose tool ids would start with `openrouter_`, and so match this plugin's permission actions. */
  readonly collisions: readonly string[]
  /** Diagnostics for status, already in the `CODE: What happened. Next step: …` form. */
  readonly problems: readonly string[]
}

export const PENDING: ServerObservation = { source: { type: "pending" }, duplicates: [], collisions: [], problems: [] }

/** The plugin's server entry: the remote URL alone, with OAuth left to the host's default. */
export const serverConfig = (seam: EndpointSeam): RemoteConfig => ({
  type: "remote",
  url: seam.endpoint,
  ...(seam.oauth === false ? { oauth: false as const } : {}),
})

/**
 * The host's tool namespace for a server name: every character outside `[A-Za-z0-9_-]` becomes `_`. Native tool ids
 * are `<namespace>_<tool>`, with the tool name normalised the same way, so hyphens survive.
 */
export const namespaceOf = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_")

/** The native tool id, which is also the permission action, of an upstream tool: `openrouter_send-message`. */
export const nativeToolId = (name: string) => `${namespaceOf(SERVER_NAME)}_${namespaceOf(name)}`

/** The one entry the plugin owns or adopts: exactly the canonical URL. */
export const isCanonicalEndpoint = (url: string, expected: string) => url === expected

/**
 * Why a URL is not the plugin's endpoint, from the actual URL, never a redacted display of it, as a phrase that names
 * no part of the URL beyond a lookalike host's name. Undefined when it is exactly the endpoint. The comparison is
 * exact: a trailing slash, an explicit default port or a differently cased host is a fixable mismatch, because
 * OpenCode keys a sign-in by the URL string and the plugin claims only the one it registers.
 */
export function endpointMismatch(url: string, expected: string): string | undefined {
  if (isCanonicalEndpoint(url, expected)) return undefined
  let actual: URL
  try {
    actual = new URL(url)
  } catch {
    return "is not a valid URL"
  }
  const want = new URL(expected)
  if (actual.username !== "" || actual.password !== "") return "has user credentials in the URL"
  if (actual.protocol !== want.protocol) return `uses ${shortReason(actual.protocol) ?? "another scheme"} instead of ${want.protocol}`
  if (actual.hostname !== want.hostname) return `points at another host (${shortReason(actual.hostname) ?? "unknown"})`
  if (actual.port !== want.port) return `uses port ${actual.port || "default"} instead of ${want.port || "the default"}`
  if (actual.search !== "") return "has a query string"
  if (actual.hash !== "") return "has a fragment"
  if (actual.pathname === `${want.pathname}/`) return "ends with a trailing slash"
  if (actual.pathname !== want.pathname) return "uses another path"
  return "is not written in the canonical form"
}

type McpEditor = Parameters<Parameters<Plugin.Context["mcp"]["transform"]>[0]>[0]
type Entry = NonNullable<ReturnType<McpEditor["get"]>>
type Editor = Pick<McpEditor, "get" | "set" | "list">

/** The source an existing `openrouter` entry gives the plugin. */
export function classifyEntry(existing: Entry, expected: string): ServerSource {
  if (existing.type !== "remote") {
    return { type: "conflict", safeDescription: `mcp.servers.${SERVER_NAME} is a local command, not ${expected}` }
  }
  const mismatch = endpointMismatch(existing.url, expected)
  if (mismatch) return { type: "conflict", safeDescription: `mcp.servers.${SERVER_NAME} ${mismatch}; the plugin uses ${expected}` }
  if (existing.disabled === true) return { type: "disabled" }
  return { type: "adopted", signIn: existing.oauth === false ? "user-managed" : "oauth" }
}

/** Other entries at OpenRouter's MCP host, and other entries whose tool ids share the `openrouter_` prefix. */
export function otherEntries(entries: readonly (readonly [string, Entry])[], expected: string) {
  const host = new URL(expected).hostname
  const own = namespaceOf(SERVER_NAME)
  const duplicates: string[] = []
  const collisions: string[] = []
  for (const [name, entry] of entries) {
    if (name === SERVER_NAME) continue
    const namespace = namespaceOf(name)
    if (namespace === own || namespace.startsWith(`${own}_`)) collisions.push(name)
    if (entry.type !== "remote") continue
    try {
      if (new URL(entry.url).hostname === host) duplicates.push(name)
    } catch {
      // Not a URL: not OpenRouter's.
    }
  }
  return { duplicates: duplicates.map(safeName).sort(), collisions: collisions.map(safeName).sort() }
}

/** A server name as status may show it: one line, bounded. */
const safeName = (name: string) => shortReason(name) ?? "an unnamed entry"

/**
 * One MCP transform pass: adds the canonical entry when there is none, adopts the user's exact entry unchanged, and
 * leaves any other `openrouter` entry alone as a conflict. Synchronous, never throws, and replaces its observation
 * whole on every replay.
 */
export function reconcileServer(editor: Editor, config: RemoteConfig): ServerObservation {
  try {
    const existing = editor.get(SERVER_NAME)
    let source: ServerSource
    if (!existing) {
      editor.set(SERVER_NAME, config)
      source = { type: "plugin" }
    } else {
      source = classifyEntry(existing, config.url)
    }
    const { duplicates, collisions } = otherEntries(editor.list(), config.url)
    const problems: string[] = []
    if (source.type === "conflict") {
      problems.push(
        errorText(
          "SERVER_CONFLICT",
          `Your OpenCode config's ${source.safeDescription}. The plugin leaves it untouched and adds no rules, guard or label to it.`,
          `Set mcp.servers.${SERVER_NAME}.url to exactly ${config.url}, or rename or remove that entry so the plugin can add its own.`,
        ),
      )
    }
    if (duplicates.length) {
      problems.push(
        errorText(
          "SERVER_DUPLICATE",
          `${list(duplicates)} also point${duplicates.length === 1 ? "s" : ""} at OpenRouter's MCP host, outside this plugin's rules.`,
          `Remove ${duplicates.length === 1 ? "that entry" : "those entries"} from mcp.servers to use the plugin's ${SERVER_NAME} server, or keep ${duplicates.length === 1 ? "it" : "them"} and know the plugin does not cover ${duplicates.length === 1 ? "it" : "them"}.`,
        ),
      )
    }
    if (collisions.length) {
      problems.push(
        errorText(
          "NAMESPACE_COLLISION",
          `The tool ids of ${list(collisions)} start with ${namespaceOf(SERVER_NAME)}_, so this plugin's permission rules would match them.`,
          `Rename ${collisions.length === 1 ? "that server" : "those servers"} in mcp.servers to a name that does not start with ${SERVER_NAME}.`,
        ),
      )
    }
    return { source, duplicates, collisions, problems }
  } catch (error) {
    return {
      ...PENDING,
      problems: [errorText("SERVER_NOT_REGISTERED", `The ${SERVER_NAME} MCP server entry could not be read or written (${reasonOf(error)}).`, "Restart OpenCode.")],
    }
  }
}

const list = (names: readonly string[]) => names.map((name) => `mcp.servers.${name}`).join(", ")

/** Registers the reconcile pass as an MCP transform; `observe` receives each pass's observation. */
export function registerServer(mcp: Pick<Plugin.Context["mcp"], "transform">, config: RemoteConfig, observe: (observation: ServerObservation) => void) {
  return mcp.transform((editor) => observe(reconcileServer(editor, config)))
}

/** Whether the plugin may act on the `openrouter` server: its own entry, or the user's exact adopted one. */
export const isOwned = (source: ServerSource) => source.type === "plugin" || source.type === "adopted"
