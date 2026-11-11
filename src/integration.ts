// The `/connect` entry of the `openrouter` MCP server. OpenCode creates that integration itself, under the server's
// name, with an ID it derives from the server's name and URL and `metadata.source` "mcp". The plugin reads the ID from
// the server's row in `ctx.mcp.list()`, never computes it, and never touches the built-in OpenRouter model provider's
// integration, whose credential OpenCode manages separately.
import type { Plugin } from "@opencode/plugin"
import { DISPLAY_NAME, SERVER_NAME } from "./constants.js"

export interface IntegrationContext {
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
  readonly integration: Pick<Plugin.Context["integration"], "transform" | "get" | "connection">
  readonly event: Pick<Plugin.Context["event"], "subscribe">
}

type Registration = Awaited<ReturnType<Plugin.Context["integration"]["transform"]>>

/** What `/connect` shows on the account while the server needs a new sign-in. The plugin clears only this text. */
export const SIGN_IN_AGAIN = "OpenRouter tools need a new sign-in. Choose this account to sign in again."

export const STARTUP_POLL_MS = 250
export const STARTUP_WINDOW_MS = 10_000
export const RESUBSCRIBE_MS = 5_000

/**
 * Keeps the `/connect` entry of the `openrouter` server named "OpenRouter tools", and marks its account while the
 * server needs a new sign-in. The host registers the integration after plugin setup, and again under the server name
 * whenever the MCP config reloads, so the rename is registered once the integration exists, and again each time the
 * host's name comes back. Events trigger a check; the first seconds are also polled, because a subscription has no
 * start acknowledgement. `owned` is false while `openrouter` is another server, which keeps its own name.
 *
 * Returns the stop function: it aborts the subscription and the polling, waits for the check in flight, and disposes
 * the rename. It never deletes a credential.
 */
export function watchIntegration(ctx: IntegrationContext, owned: () => boolean) {
  const stopped = new AbortController()
  let registration: Registration | undefined

  const sync = async () => {
    const server = owned() ? (await ctx.mcp.list()).data.find((item) => item.name === SERVER_NAME) : undefined
    const id = server?.integrationID
    if (!server || !id || stopped.signal.aborted) return
    const { data } = await ctx.integration.get({ integrationID: id })
    // Only the integration OpenCode made for an MCP server: never a provider's.
    if (data.metadata?.source !== "mcp") return
    if (data.name !== DISPLAY_NAME && !stopped.signal.aborted) {
      const previous = registration
      registration = await ctx.integration.transform((editor) => {
        if (editor.get(id)) editor.update(id, (integration) => void (integration.name = DISPLAY_NAME))
      })
      await previous?.dispose()
      // Stopped while the rename registered: undo it here, because stop has already run.
      if (stopped.signal.aborted) {
        await registration.dispose()
        registration = undefined
        return
      }
    }
    const connection = await ctx.integration.connection.active(id)
    if (connection?.type !== "credential" || stopped.signal.aborted) return
    // `active` returns the credential alone; the status the plugin set is projected by `get`. Read it there, so the
    // mark it wrote is the one it clears, and another plugin's or the host's message is left alone.
    const shown = (await ctx.integration.get({ integrationID: id })).data.connections?.find((item) => item.type === "credential" && item.id === connection.id)
    const status = shown?.type === "credential" ? shown.status : undefined
    const ours = status?.message === SIGN_IN_AGAIN
    if (server.status.status === "needs_auth" && !status) {
      await ctx.integration.connection.status({ integrationID: id, connection, status: { status: "needs_auth", message: SIGN_IN_AGAIN } })
    } else if (server.status.status === "connected" && ours) {
      await ctx.integration.connection.status({ integrationID: id, connection, status: undefined })
    }
  }

  // One check at a time; triggers that arrive meanwhile cause one more check after it.
  let running: Promise<void> | undefined
  let again = false
  const schedule = () => {
    if (stopped.signal.aborted) return
    if (running) return void (again = true)
    running = (async () => {
      do {
        again = false
        if (!stopped.signal.aborted) await sync().catch(() => undefined)
      } while (again && !stopped.signal.aborted)
    })().finally(() => (running = undefined))
  }

  const events = (async () => {
    while (!stopped.signal.aborted) {
      try {
        const stream = ctx.event.subscribe({ types: ["integration.updated", "mcp.status.changed", "credential.updated", "credential.switched"], signal: stopped.signal })
        for await (const event of stream) if (event.type !== "mcp.status.changed" || event.data.server === SERVER_NAME) schedule()
      } catch {
        // The stream failed; check, then subscribe again.
      }
      schedule()
      await delay(RESUBSCRIBE_MS, stopped.signal)
    }
  })()
  const startup = (async () => {
    for (const until = Date.now() + STARTUP_WINDOW_MS; Date.now() < until && !stopped.signal.aborted; ) {
      schedule()
      await delay(STARTUP_POLL_MS, stopped.signal)
    }
  })()

  return async () => {
    stopped.abort()
    await startup
    // The host ends the stream on abort; a stream that ignores it must not hold the unload.
    await settleWithin(events, STOP_GRACE_MS)
    await running
    await registration?.dispose()
    registration = undefined
  }
}

const STOP_GRACE_MS = 1_000

/** Waits for `work`, at most `ms`; the timer is cleared as soon as either settles. */
const settleWithin = (work: Promise<unknown>, ms: number) => {
  const timeout = new AbortController()
  return Promise.race([work.catch(() => undefined), delay(ms, timeout.signal)]).finally(() => timeout.abort())
}

/** Resolves after `ms`, or at once when `signal` aborts; either way its timer is cleared. */
export const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })
