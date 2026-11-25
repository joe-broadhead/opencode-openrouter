/**
 * The handlers, driven through their real entry, against a fixed OpenCode MCP list.
 *
 * The list is the boundary OpenCode owns: `ctx.mcp.list()` answers `{ location, data }` with one entry per server and
 * its status. The fake below sends exactly that shape, so the provider mapping and the handlers see what the real host
 * sends; the real host itself is proven by `plugin-kit check`'s T1 run.
 */
import { accountsOf, type AccountProfile } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { UnguardedAgentsResult } from "@we-the-rebel-alliance/plugin-contract/access"
import type { Bus } from "@we-the-rebel-alliance/plugin-contract/bus"
import type { MethodCall } from "@we-the-rebel-alliance/plugin-contract/register"
import { handlersFor, type HandlerRuntime } from "../../src/handlers/index.ts"
import { manifest, version } from "../../src/manifest.ts"
import { createMcpProvider, serverName, type McpServerEntry, type McpStatus } from "../../src/provider/mcp.ts"

/** The options the fixture and the T1 host use: two aliases, each with an empty profile. */
export const OPTIONS = { accounts: { work: {}, personal: {} } } as const

/** The two aliases, in the order the options name them. */
export function aliases(): readonly AccountProfile[] {
  const plan = accountsOf(manifest, OPTIONS)
  if (!plan.ok) throw new Error(plan.problems.join("; "))
  return plan.value.accounts
}

/** One server entry as OpenCode lists it, with a status and, for a failure, its error. */
export function entry(alias: string, status: McpStatus = "connected", error?: string): McpServerEntry {
  return { name: serverName(alias), status: { status, ...(error === undefined ? {} : { error }) } }
}

/** Both aliases connected: the runtime a happy path uses. */
export function connected(): readonly McpServerEntry[] {
  return [entry("work"), entry("personal")]
}

/** A runtime with the real manifest, the two aliases and a fixed MCP list. */
export function runtimeFor(entries: readonly McpServerEntry[] = connected(), overrides: Partial<HandlerRuntime> = {}): HandlerRuntime {
  return {
    manifest,
    version,
    hostVersion: "2.4.1",
    accounts: aliases(),
    accountProblems: [],
    provider: createMcpProvider({ list: async () => ({ location: { directory: "/tmp/openrouter-plugin" }, data: [...entries] }) }),
    ...overrides,
  }
}

/** What a test may change about the call: the one piece `register` would fill from the host. */
export interface CallOptions {
  /** The agents whose rules no longer match; `{ ok: false, error }` models an unreadable agent list. */
  readonly unguardedAgents?: () => Promise<UnguardedAgentsResult>
}

/** The call context a handler sees, as `register` builds it. The bus is register-owned and unused by these handlers. */
function callFor(account: string, options: CallOptions = {}): MethodCall {
  const bus: Bus = { name: manifest.plugin.name, emit: async () => ({ ok: true }) }
  return {
    sessionID: "ses_test",
    agent: "build",
    messageID: "msg_test",
    id: "call_test",
    signal: new AbortController().signal,
    progress: async () => undefined,
    account,
    bus,
    unguardedAgents: options.unguardedAgents ?? (async () => ({ ok: true, agents: [] })),
    door: "tool",
  }
}

/** Run one handler with an account and the input `register` would pass. */
export async function run(
  runtime: HandlerRuntime,
  method: "status" | "probe",
  input: Readonly<Record<string, unknown>>,
  account = "work",
  options: CallOptions = {},
): Promise<unknown> {
  return handlersFor(runtime)[method]!.run(input, callFor(account, options))
}
