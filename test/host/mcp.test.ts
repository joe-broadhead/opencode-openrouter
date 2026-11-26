/**
 * The per-alias MCP servers must be registered in the real OpenCode 2.4.1 host.
 *
 * The contract's `createHost` cannot see `mcp.list`, so this test drives `@opencode/sdk` directly with an empty temporary
 * project and an isolated `HOME`/`XDG_*`. It records what the plugin passes to `ctx.mcp.transform` and checks the host's
 * own server list: the default server is `openrouter`, and two aliases are `openrouter-work` and `openrouter-personal`,
 * each pointing at the vendor URL with its own OAuth.
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { OpenCode } from "@opencode/sdk"
import type { Plugin } from "@opencode/plugin"
import { MCP_URL } from "../../src/provider/mcp.ts"

const root = fileURLToPath(new URL("../..", import.meta.url))
const entry = join(root, "dist", "index.js")

/** One server config the plugin set, as recorded from the transform editor. */
type RecordedConfig = { readonly type?: unknown; readonly url?: unknown; readonly oauth?: unknown }

/** Poll with a bound; the SDK activates a plugin after the first prompt. */
async function until(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

/** The setup context with the plugin options and an MCP editor that records every `set`. */
function recordedContext(context: Plugin.Context, options: Readonly<Record<string, unknown>>, servers: Map<string, RecordedConfig>): Plugin.Context {
  return new Proxy(context, {
    get(target, property, receiver) {
      if (property === "options") return options
      if (property !== "mcp") return Reflect.get(target, property, receiver)
      const mcp = target.mcp
      return new Proxy(mcp, {
        get(mcpTarget, mcpProperty, mcpReceiver) {
          if (mcpProperty !== "transform") {
            const value = Reflect.get(mcpTarget, mcpProperty, mcpReceiver)
            return typeof value === "function" ? value.bind(mcpTarget) : value
          }
          return (callback: (editor: unknown) => void) =>
            mcpTarget.transform((editor) => {
              const proxied = new Proxy(editor, {
                get(editorTarget, field, editorReceiver) {
                  if (field !== "set") {
                    const value = Reflect.get(editorTarget, field, editorReceiver)
                    return typeof value === "function" ? value.bind(editorTarget) : value
                  }
                  return (name: string, config: unknown) => {
                    servers.set(name, config as RecordedConfig)
                    return (editorTarget.set as (name: string, config: unknown) => void)(name, config)
                  }
                },
              })
              callback(proxied)
            })
        },
      })
    },
  })
}

/** Start one host, activate the plugin, and return it. */
async function activated(options: Readonly<Record<string, unknown>>, directory: string, servers: Map<string, RecordedConfig>): Promise<OpenCode.Interface> {
  const loaded = (await import(pathToFileURL(entry).href)) as { default?: Plugin.Plugin }
  const plugin = loaded.default
  assert.ok(plugin !== undefined, `${entry} exports no Plugin.define value`)
  const wrapped: Plugin.Plugin = {
    id: plugin.id,
    setup: (context) => plugin.setup(recordedContext(context, options, servers)),
  }
  const sdk = await import("@opencode/sdk")
  const host = await sdk.OpenCode.create({
    plugins: [wrapped],
    config: { directory },
    app: { name: "opencode", version: "2.4.1" },
    log: { level: "error", emit: () => undefined },
  })
  try {
    const session = await host.sessions.create({ location: { directory }, agent: "build", permissions: [] })
    await host.sessions.prompt({ sessionID: session.id, text: "activate the mcp test", delivery: "queue" }).catch(() => undefined)
    const active = await until(async () => {
      const list = await host.plugin.list({ location: { directory } })
      return list.data.some((item: { id: string }) => item.id === "openrouter")
    })
    assert.ok(active, "the plugin did not activate in the host within 30 seconds")
    return host
  } catch (error) {
    await host.close().catch(() => undefined)
    throw error
  }
}

test("the host lists the default and per-alias MCP servers at the vendor URL", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "openrouter-mcp-"))
  const environment = ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"] as const
  const saved = new Map(environment.map((key) => [key, process.env[key]]))
  process.env.HOME = workspace
  process.env.XDG_CONFIG_HOME = join(workspace, "c")
  process.env.XDG_CACHE_HOME = join(workspace, "k")
  process.env.XDG_DATA_HOME = join(workspace, "d")
  process.env.XDG_STATE_HOME = join(workspace, "s")

  try {
    const defaultProject = join(workspace, "default")
    mkdirSync(defaultProject)
    const defaultServers = new Map<string, RecordedConfig>()
    const defaultHost = await activated({}, defaultProject, defaultServers)
    try {
      const list = await defaultHost.mcp.list({ location: { directory: defaultProject } })
      assert.ok(list.data.some((item: { name: string }) => item.name === "openrouter"), "the host lists no default openrouter server")
      assert.deepEqual(defaultServers.get("openrouter"), { type: "remote", url: MCP_URL, oauth: {} })
    } finally {
      await defaultHost.close()
    }

    const aliasProject = join(workspace, "aliases")
    mkdirSync(aliasProject)
    const aliasServers = new Map<string, RecordedConfig>()
    const aliasHost = await activated({ accounts: { work: {}, personal: {} } }, aliasProject, aliasServers)
    try {
      const list = await aliasHost.mcp.list({ location: { directory: aliasProject } })
      for (const name of ["openrouter-work", "openrouter-personal"]) {
        assert.ok(list.data.some((item: { name: string }) => item.name === name), `the host lists no server ${name}`)
        assert.deepEqual(aliasServers.get(name), { type: "remote", url: MCP_URL, oauth: {} }, name)
      }
      assert.equal(aliasServers.has("openrouter"), false, "two aliases must not also register the default server")
    } finally {
      await aliasHost.close()
    }
  } finally {
    for (const key of environment) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(workspace, { recursive: true, force: true })
  }
})
