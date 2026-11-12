// Setup: the registration order, the cleanup stack that undoes it, and the internal test seam.
//
// Order (each step runs only after the one before it succeeded):
//   1. parse the options and check the host, before anything is registered;
//   2. (skills) load and validate the skill files, outside every transform;
//   3. create the cleanup stack, the diagnostics, the server observation and the guard, which starts blocked;
//   4. register the `openrouter` server entry, then the in-place native dispatch guard, before any tool exists;
//   5. the default rules, which mark the policy installation ready only when they apply. A failure here does not
//      abort setup: the guard stays registered and blocked, so an adopted server's tools refuse every call;
//   6. the Code Mode namespace text, only for the plugin's own or the user's adopted server;
//   7. (skills, status, tools RPC) the skills, the status command, the status RPC and the tools RPC;
//   8. the `/connect` watcher, last, because it reads what the steps before it registered;
//   9. return the cleanup, which undoes everything in reverse order.
// A failure part-way runs every cleanup accumulated so far, then rethrows one sanitised, actionable error. Unloading
// blocks the guard first, then undoes the rest.
import { Plugin } from "@opencode/plugin"
import { errorText, NAMESPACE_DESCRIPTION, PLUGIN_ID, SERVER_NAME } from "./constants.js"
import { createGuard, registerGuard, type PolicyHealth } from "./guard.js"
import { checkHost, type HostCheck } from "./host-version.js"
import { watchIntegration } from "./integration.js"
import { isOwned, PENDING, registerServer, serverConfig, type EndpointSeam, type ServerObservation } from "./mcp.js"
import { parseOptions, type Options } from "./options.js"
import { registerDefaultRules, unguardedAgents, type Rule } from "./permissions.js"
import { reasonOf } from "./redact.js"

/** Internal seam: tests point the server at a loopback fake and read the plugin's state. Not a public option. */
export interface OpenRouterSeam extends EndpointSeam {
  /** Receives the plugin's live state once setup has created it. */
  readonly inspect?: (state: PluginState) => void
  /** Makes the default rules fail: their registration (`register`) or a transform pass (`apply`), checked each time. */
  readonly policyFault?: () => "register" | "apply" | undefined
  /** Runs on every guard check, so a test can count checks per call. */
  readonly guardCheck?: () => void
}

/** What the plugin knows about itself, in memory only. Later surfaces (status, guard, scripts) read it. */
export interface PluginState {
  readonly options: Options
  readonly host: HostCheck
  /** The latest MCP transform's observation, `pending` before the host runs it. */
  readonly server: () => ServerObservation
  /** Whether the plugin may act on the `openrouter` server: its own entry or the user's exact one. */
  readonly owned: () => boolean
  /** Where the default rules stand, with any problem for status. */
  readonly policy: () => PolicyHealth
  /** Throws `POLICY_UNAVAILABLE` unless OpenRouter's tools may run now. The tools RPC calls it before dispatch. */
  readonly assertOperational: () => void
  /** The agents where an OpenRouter change would run under the base allow because the block is missing. */
  readonly unguardedAgents: () => Promise<string[]>
}

/** Anything the plugin registered that must be undone, newest first. */
type Undo = () => Promise<void> | void

/** A last-in, first-out list of undo steps. `run` undoes each once, even when one fails, and reports the failures. */
export function cleanupStack() {
  const steps: Undo[] = []
  return {
    /** Registers an undo step, or a host registration's `dispose`. */
    defer(step: Undo | { readonly dispose: () => Promise<void> }) {
      steps.push(typeof step === "function" ? step : () => step.dispose())
    },
    async run() {
      const failures: unknown[] = []
      for (const step of steps.splice(0).reverse()) {
        try {
          await step()
        } catch (error) {
          failures.push(error)
        }
      }
      return failures
    },
  }
}

/** A setup failure as the host shows it: the plugin's own errors keep their code, anything else is sanitised. */
export function setupFailure(error: unknown) {
  if (error instanceof Error && "code" in error && "nextStep" in error) return error
  const failure = new Error(
    errorText("SETUP_FAILED", `The OpenRouter plugin could not finish starting (${reasonOf(error)}), and removed what it had registered.`, "Restart OpenCode; if it fails again, run /plugins to see the error."),
  )
  return Object.assign(failure, { code: "SETUP_FAILED" as const })
}

export function createOpenRouterPlugin(seam: OpenRouterSeam) {
  return Plugin.define({
    id: PLUGIN_ID,
    async setup(ctx) {
      // 1. Nothing is registered before the options and the host are known to be good.
      const options = parseOptions(ctx.options)
      const host = checkHost(ctx.app.version, options.allowUntestedHost)

      // 3. The plugin's memory: replays overwrite the observation, so nothing accumulates.
      const cleanup = cleanupStack()
      let server: ServerObservation = PENDING
      const owned = () => isOwned(server.source)
      const guard = createGuard(() => server.source, seam.guardCheck)
      const state: PluginState = {
        options,
        host,
        server: () => server,
        owned,
        policy: guard.health,
        assertOperational: guard.assertOperational,
        unguardedAgents: async () => unguardedAgents((await ctx.agent.list()).data.map((agent) => ({ id: agent.id, permissions: agent.permissions as readonly Rule[] })), options.access),
      }

      try {
        // 4. The server entry. The user's config is applied before plugin transforms, so an existing entry is theirs.
        cleanup.defer(await registerServer(ctx.mcp, serverConfig(seam), (next) => void (server = next)))
        // The guard, registered before the host has discovered any tool, so every pass that adds one decorates it.
        cleanup.defer(await registerGuard(ctx.tool, guard, () => server.source))
        // 5. The default rules. Only their success makes the guard healthy; a failure leaves it blocked, not setup.
        try {
          if (seam.policyFault?.() === "register") throw new Error("injected registration failure")
          cleanup.defer(await registerDefaultRules(ctx.agent, options.access, guard.policyReport, () => seam.policyFault?.() === "apply"))
        } catch (error) {
          guard.policyReport(reasonOf(error))
        }
        // 6. Code Mode's catalog describes the namespace with this text; another server keeps its own.
        cleanup.defer(
          await ctx.tool.transform((editor) => {
            if (owned()) editor.namespace({ name: SERVER_NAME, description: NAMESPACE_DESCRIPTION })
          }),
        )
        // 8. Last: the watcher reads the server's row and renames only the MCP integration OpenCode made for it.
        cleanup.defer(watchIntegration(ctx, owned))
      } catch (error) {
        guard.close()
        await cleanup.run()
        throw setupFailure(error)
      }
      seam.inspect?.(state)
      return async () => {
        guard.close()
        await cleanup.run()
      }
    },
  })
}
