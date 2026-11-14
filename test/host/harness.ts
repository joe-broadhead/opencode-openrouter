// An embedded OpenCode host from the public @opencode/sdk, isolated in the temp root from ./isolate.js: the
// environment, config, database and project directory all live there, and any fetch that leaves loopback fails the
// run. The plugin is built with the internal seam, pointed at the loopback fake, and gets its options injected the way
// the host passes config options. A probe plugin, loaded after it, lends its context to the tests.
import { HOST_SDK_DIR, ROOT as root } from "./isolate.js"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { OpenCodeClient } from "@opencode/client"
import { Plugin } from "@opencode/plugin"
import { PLUGIN_ID } from "../../src/constants.js"
import { createOpenRouterPlugin, type OpenRouterSeam, type PluginState } from "../../src/plugin.js"
import { startFakeMcp, type FakeMcp, type FakeMcpOptions } from "./fake-mcp.js"

/** The SDK's `Interface`, which its own declarations resolve to `any`. */
type Client = Omit<OpenCodeClient, "plugin"> & {
  readonly sessions: OpenCodeClient["session"]
  readonly plugin: ((plugin: Plugin.Plugin) => Promise<void>) & OpenCodeClient["plugin"]
  readonly close: () => Promise<void>
}

/** The locked @opencode/sdk, or another 2.2.x installed outside the lockfile in HOST_SDK_DIR's node_modules. */
const SDK = HOST_SDK_DIR ? join(HOST_SDK_DIR, "node_modules", "@opencode", "sdk") : fileURLToPath(new URL("../../node_modules/@opencode/sdk", import.meta.url))
export const HOST_VERSION = (JSON.parse(readFileSync(join(SDK, "package.json"), "utf8")) as { version: string }).version

const offLoopback: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return realFetch(input, init)
    offLoopback.push(url.origin)
    return Promise.reject(new Error(`host test blocked a fetch to ${url.origin}`))
  },
  { preconnect: realFetch.preconnect },
) as typeof fetch

/** Removes the temp root; call once after every host in the file has closed. */
export const cleanup = () => rmSync(root, { recursive: true, force: true })

/** The plugin as a test loads it again, with `options`: by default `ask-changes`, as `startHost` uses. */
export function pluginWith(seam: OpenRouterSeam, options: Record<string, unknown> = { access: "ask-changes" }) {
  const openrouter = createOpenRouterPlugin(seam)
  return Plugin.define({ id: openrouter.id, setup: (ctx) => openrouter.setup({ ...ctx, options }) })
}

export interface HostInput {
  /**
   * Plugin options, as a user writes them in opencode.json. Without them a host runs under `access: "ask-changes"`, where
   * the plugin's rules and guard decide something; a suite of the default, `all`, passes `{}`.
   */
  readonly options?: Record<string, unknown>
  /** Extra user config: mcp servers and the like. `(url) => config` receives the fake server's URL. */
  readonly config?: (url: string) => Record<string, unknown>
  /** Register the server with OAuth, as the published plugin does, so the host gives it a /connect entry. */
  readonly oauth?: true
  readonly fake?: FakeMcpOptions
  /** Seam fault for the default rules, read on every registration and pass. */
  readonly policyFault?: () => "register" | "apply" | undefined
  /** Runs inside a probe plugin the host sets up before the OpenRouter plugin, so its transforms run before the plugin's. */
  readonly belowSetup?: (ctx: Plugin.Context) => Promise<void> | void
  /** Runs inside the probe plugin's setup, which the host runs after the OpenRouter plugin's. */
  readonly probeSetup?: (ctx: Plugin.Context) => Promise<void> | void
  /** Wait only until the plugin is active, not for the server to leave pending. */
  readonly early?: true
  /** Read the packaged skills from this folder instead of the repository's `skills/`. */
  readonly skillsDir?: string
}

let hosts = 0

export async function startHost(input: HostInput = {}) {
  const base = join(root, `host-${++hosts}`)
  const work = join(base, "work")
  mkdirSync(work, { recursive: true })
  const fake = await startFakeMcp(input.fake)
  const states: PluginState[] = []
  const cleanups = { started: 0, finished: 0 }
  const checks = { count: 0 }
  const seam = {
    endpoint: fake.url,
    ...(input.oauth ? {} : { oauth: false as const }),
    ...(input.skillsDir ? { skillsDir: input.skillsDir } : {}),
    inspect: (state: PluginState) => void states.push(state),
    policyFault: () => input.policyFault?.(),
    guardCheck: () => void checks.count++,
  }
  const openrouter = createOpenRouterPlugin(seam)
  const withOptions = Plugin.define({
    id: openrouter.id,
    setup: async (ctx) => {
      const stop = await openrouter.setup({ ...ctx, options: input.options ?? { access: "ask-changes" } })
      return async () => {
        cleanups.started++
        await stop?.()
        cleanups.finished++
      }
    },
  })
  const probes = new Map<string, Plugin.Context>()
  const probe = Plugin.define({
    id: "openrouter.host-test.probe",
    setup: async (ctx) => {
      await input.probeSetup?.(ctx)
      probes.set(ctx.location.directory, ctx)
    },
  })
  const config = {
    // Keep the built-in local providers from probing their default ports.
    providers: { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
    ...input.config?.(fake.url),
  }
  const { OpenCode } = (await import(pathToFileURL(join(SDK, "dist", "index.js")).href)) as typeof import("@opencode/sdk")
  const client: Client = await OpenCode.create({
    plugins: [...(input.belowSetup ? [Plugin.define({ id: "openrouter.host-test.below", setup: input.belowSetup })] : []), withOptions, probe],
    // An embedded host reports "unknown" unless told, and the plugin's host guard refuses that.
    app: { version: HOST_VERSION },
    config: { content: JSON.stringify(config), directory: join(base, "config"), project: false, claude: false },
    database: { path: join(base, "opencode.db") },
    models: { fetch: false },
    fs: { filewatcher: false },
    log: { level: "error" },
  })
  const location = { directory: work }
  const host = {
    client,
    location,
    fake,
    seam,
    cleanups,
    /** How many guard checks the plugin has run. */
    checks,
    /** The plugin's live state in this host's location: the newest setup's. */
    state: () => {
      const state = states.at(-1)
      if (!state) throw new Error("the plugin has not finished setup")
      return state
    },
    probe: () => {
      const ctx = probes.get(work)
      if (!ctx) throw new Error("the probe plugin has not loaded")
      return ctx
    },
    async close() {
      await client.close()
      await fake.close()
      if (offLoopback.length) throw new Error(`the host tried to leave loopback: ${[...new Set(offLoopback)].join(", ")}`)
    },
  }
  try {
    await until("the plugin is active and the openrouter server has left pending", async () => {
      const { data: plugins } = await client.plugin.list({ location })
      const state = plugins.find((plugin) => plugin.id === PLUGIN_ID)?.state
      if (state?.status === "failed") throw new Error(`the OpenRouter plugin failed: ${state.error}`)
      const { data: servers } = await client.mcp.list({ location })
      return state?.status === "active" && (input.early || servers.some((server) => server.status.status !== "pending")) && probes.has(work)
    })
  } catch (error) {
    await host.close().catch(() => {})
    throw error
  }
  return host
}

export type Host = Awaited<ReturnType<typeof startHost>>

/** Polls `check` until it returns a value. */
export async function until<T>(what: string, check: () => Promise<T | false | undefined>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`)
    await Bun.sleep(50)
  }
}

/** The `openrouter` row of the host's MCP list, once it is there. */
export const serverRow = async (host: Host) => (await host.client.mcp.list({ location: host.location })).data.find((server) => server.name === "openrouter")

/** An integration as the host's API returns it, or undefined. */
export async function integration(host: Host, integrationID: string) {
  try {
    return (await host.client.integration.get({ integrationID, location: host.location })).data as {
      id: string
      name: string
      metadata?: { source?: string }
      methods: { id: string; type: string }[]
      connections?: { type: string; id?: string; status?: { status: string; message?: string } }[]
    }
  } catch {
    return undefined
  }
}

export type { FakeMcp }

export type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }

export const session = async (host: Host, agent = "build") => (await host.client.sessions.create({ agent, location: host.location })).id

let attempts = 0

/**
 * Runs an OpenRouter tool through the executor the host lists, which a model turn uses too: the plugin's guard, then
 * the host's own executor, which asserts `openrouter_<tool>` for the session's agent before it calls the server. A
 * prompt, if one appears, is answered with `decision`. Reports whether it asked and how the call ended.
 */
export async function attempt(host: Host, sessionID: string, agent: string, tool: string, decision: "once" | "always" | "reject" = "reject") {
  const id = `openrouter_${tool}`
  const executor = await until(`${id} is registered`, async () => (await host.probe().tool.list()).find((item) => item.id === id))
  const context = { sessionID, agent, messageID: "msg_host_test", id: `call_guard_test_${++attempts}`, signal: new AbortController().signal, progress: async () => {} }
  let settled = false
  const run = executor
    .execute({}, context as never)
    .then(
      (result: unknown) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error: describeError(error) }),
    )
    .finally(() => (settled = true))
  let asked: string | undefined
  while (!settled) {
    const pending = await host.client.permission.list({ sessionID })
    const request = pending.find((item) => item.action === id)
    if (request) {
      asked = request.action
      await host.client.permission.reply({ sessionID, requestID: request.id, decision })
      break
    }
    await Promise.race([run, Bun.sleep(25)])
  }
  return { asked, ...(await run) }
}

/**
 * A rejection as `name: message`, followed by the name of the error it wraps. A declined prompt reaches the caller as a
 * `Tool.Error` wrapping `Permission.DeclinedError`, which is how the host's session loop recognises a decline.
 */
export function describeError(error: unknown) {
  if (!(error instanceof Error)) return String(error)
  const cause = (error as { error?: unknown }).error
  return `${error.name}: ${error.message}${cause instanceof Error ? ` [${cause.name}]` : ""}`
}

export const agentRules = async (host: Host) =>
  new Map((await host.client.agent.list({ location: host.location })).data.map((agent) => [agent.id as string, agent.permissions as Rule[]]))

/** The host's own last-match evaluation for an MCP call (resource `*`), via its permission API. */
export async function effect(host: Host, agent: string, action: string) {
  const sessionID = await session(host, agent)
  return (await host.client.permission.create({ sessionID, agent, action, resources: ["*"] })).effect
}
