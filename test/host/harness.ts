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
import { createOpenRouterPlugin, type PluginState } from "../../src/plugin.js"
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

export interface HostInput {
  /** Plugin options, as a user writes them in opencode.json. */
  readonly options?: Record<string, unknown>
  /** Extra user config: mcp servers and the like. `(url) => config` receives the fake server's URL. */
  readonly config?: (url: string) => Record<string, unknown>
  /** Register the server with OAuth, as the published plugin does, so the host gives it a /connect entry. */
  readonly oauth?: true
  readonly fake?: FakeMcpOptions
}

let hosts = 0

export async function startHost(input: HostInput = {}) {
  const base = join(root, `host-${++hosts}`)
  const work = join(base, "work")
  mkdirSync(work, { recursive: true })
  const fake = await startFakeMcp(input.fake)
  const states: PluginState[] = []
  const cleanups = { started: 0, finished: 0 }
  const seam = { endpoint: fake.url, ...(input.oauth ? {} : { oauth: false as const }), inspect: (state: PluginState) => void states.push(state) }
  const openrouter = createOpenRouterPlugin(seam)
  const withOptions = Plugin.define({
    id: openrouter.id,
    setup: async (ctx) => {
      const stop = await openrouter.setup({ ...ctx, options: input.options ?? {} })
      return async () => {
        cleanups.started++
        await stop?.()
        cleanups.finished++
      }
    },
  })
  const probes = new Map<string, Plugin.Context>()
  const probe = Plugin.define({ id: "openrouter.host-test.probe", setup: (ctx) => void probes.set(ctx.location.directory, ctx) })
  const config = {
    // Keep the built-in local providers from probing their default ports.
    providers: { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
    ...input.config?.(fake.url),
  }
  const { OpenCode } = (await import(pathToFileURL(join(SDK, "dist", "index.js")).href)) as typeof import("@opencode/sdk")
  const client: Client = await OpenCode.create({
    plugins: [withOptions, probe],
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
      return state?.status === "active" && servers.some((server) => server.status.status !== "pending") && probes.has(work)
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
