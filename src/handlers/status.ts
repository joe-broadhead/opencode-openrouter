/**
 * `status`: what a person and an app read before anything else. It carries no content and no credential.
 *
 * The contract's `statusAnswer` assembles the whole answer from the manifest, the two versions, the account states, the
 * problems setup recorded and the agents whose rules no longer match. The handler keeps no state of its own: the agent
 * list comes from the call, which `register` fills from its own registration, and an unreadable agent list is answered
 * as `{ ok: false, error }`, which `statusAnswer` turns into a problem.
 */
import { accountStatuses, redactReason, STATUS_SCHEMA, statusAnswer, type AccountSignal } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { EMPTY } from "./shared.ts"
import type { HandlerRuntime } from "./index.ts"

/** `status`: name, version, host, state, one entry per alias, unguarded agents and a next step. */
export function statusHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description: "Read the plugin's version, OpenCode host, every account alias and any next step.",
    input: EMPTY,
    output: STATUS_SCHEMA,
    async run(_input, call) {
      const aliases = runtime.accounts.map((account) => account.alias)
      const problems = [...runtime.accountProblems]

      // An unreadable MCP server list is unknown, never zero: every alias is an error, not silently ready or missing.
      let signals: Readonly<Record<string, AccountSignal>> = {}
      try {
        signals = await runtime.provider.signals(aliases)
      } catch (error) {
        const reason = redactReason(error instanceof Error ? error.message : String(error))
        problems.push(reason)
        const failed: Record<string, AccountSignal> = {}
        for (const alias of aliases) failed[alias] = { state: "error", reason }
        signals = failed
      }

      return statusAnswer({
        manifest: runtime.manifest,
        version: runtime.version,
        hostVersion: runtime.hostVersion,
        accounts: accountStatuses(runtime.accounts, signals),
        problems,
        unguardedAgents: await call.unguardedAgents(),
      })
    },
  }
}
