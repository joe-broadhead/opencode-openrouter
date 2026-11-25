/**
 * The provider: OpenRouter's hosted MCP server.
 *
 * OpenRouter owns every tool and every credential here. This module names the one URL, builds the server entry for an
 * account alias, and reads what OpenCode says about those servers. It never calls OpenRouter itself: an MCP tool runs
 * inside the server OpenCode signed in to.
 */
import { accountLabel, accountName, redactReason, type AccountSignal } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { manifest } from "../manifest.ts"

/** The vendor's hosted MCP server. This is the one place the URL is named. */
export const MCP_URL = "https://mcp.openrouter.ai/mcp"

/** OpenCode's state for one MCP server, as `ctx.mcp.list()` reports it. */
export type McpStatus = "connected" | "pending" | "disabled" | "failed" | "needs_auth"

/** One server's status: `error` is present when OpenCode reports a failure or a needed sign-in. */
export interface McpStatusEntry {
  readonly status: McpStatus
  readonly error?: string | undefined
}

/** One MCP server OpenCode lists. */
export interface McpServerEntry {
  readonly name: string
  readonly status: McpStatusEntry
}

/** The part of `ctx.mcp` this module reads: the live server list. `location` is passed through and unused. */
export interface McpList {
  list(): Promise<{ readonly location?: unknown; readonly data: readonly McpServerEntry[] }>
}

/** The MCP server name for an alias: `openrouter` for `default`, `openrouter-<alias>` otherwise. */
export function serverName(alias: string): string {
  return accountName(manifest.plugin.name, alias)
}

/** The label a person reads in OpenCode's server list: `OpenRouter` or `OpenRouter (<alias>)`. */
export function serverLabel(alias: string): string {
  return accountLabel(manifest.plugin.title, alias)
}

/** The vendor server one alias signs in to. Each alias is its own server, so each has its own OAuth. */
export function serverConfig(alias: string): Readonly<Record<string, unknown>> {
  return { type: "remote", url: MCP_URL, oauth: {}, title: serverLabel(alias) }
}

/** The contract's signal for one server entry, or for an alias OpenCode does not list. */
export function signalOf(entry: McpServerEntry | undefined): AccountSignal {
  if (entry === undefined) return { state: "error", reason: "OpenCode lists no such server" }
  const status = entry.status
  switch (status.status) {
    case "connected":
      return { state: "ready" }
    case "needs_auth":
      return { state: "needs_sign_in", ...(reasonOf(status.error) ?? { reason: "the server needs a sign-in" }) }
    case "failed":
      return { state: "error", ...(reasonOf(status.error) ?? { reason: "OpenCode could not connect to the server" }) }
    case "disabled":
      return { state: "error", reason: "the server is disabled" }
    case "pending":
      return { state: "error", reason: "the server is still connecting" }
  }
}

/** One redacted, single-line reason, or undefined when the server gave none. */
function reasonOf(error: string | undefined): { readonly reason: string } | undefined {
  if (error === undefined) return undefined
  const line = redactReason(error)
  return line === "" ? undefined : { reason: line }
}

/** What the handlers ask the provider. */
export interface Provider {
  /** Every server OpenCode lists now. */
  servers(): Promise<readonly McpServerEntry[]>
  /** The server entry for one name, or undefined when OpenCode lists none. */
  server(name: string): Promise<McpServerEntry | undefined>
  /** One contract signal per alias, in the order the aliases are named. */
  signals(aliases: readonly string[]): Promise<Readonly<Record<string, AccountSignal>>>
}

/** The provider over OpenCode's live MCP list. */
export function createMcpProvider(mcp: McpList): Provider {
  const servers = async (): Promise<readonly McpServerEntry[]> => (await mcp.list()).data
  return {
    servers,
    async server(name) {
      return (await servers()).find((entry) => entry.name === name)
    },
    async signals(aliases) {
      const entries = await servers()
      const signals: Record<string, AccountSignal> = {}
      for (const alias of aliases) {
        const name = serverName(alias)
        signals[alias] = signalOf(entries.find((entry) => entry.name === name))
      }
      return signals
    },
  }
}
