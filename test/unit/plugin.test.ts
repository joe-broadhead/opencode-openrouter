// Setup against a narrow fake context: the registration order, refusal before anything is registered, rollback of a
// part-way failure with a sanitised error, the namespace only for an owned server, and a cleanup that leaves nothing.
import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { ENDPOINT, NAMESPACE_DESCRIPTION, PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import plugin from "../../src/index.js"
import { cleanupStack, createOpenRouterPlugin, setupFailure, type PluginState } from "../../src/plugin.js"
import { mcpEditor, timerProbe, transforms, type McpEditor, type ServerConfig } from "./fake.js"

type ToolEditor = Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0]
const KEY = "sk-or-v1-0123456789abcdef0123456789abcdef"

/** A context with the members setup uses; `fail` makes one registration throw. */
function context(options: { version?: string; options?: unknown; fail?: "mcp" | "tool" } = {}) {
  const mcp = transforms<McpEditor>()
  const tool = transforms<ToolEditor>()
  const log: string[] = []
  const ctx = {
    app: { version: options.version ?? "2.2.3" },
    options: options.options ?? {},
    mcp: {
      transform: (callback: (editor: McpEditor) => void) => {
        log.push("mcp")
        if (options.fail === "mcp") return Promise.reject(new Error(`mcp down Bearer ${KEY}`))
        return mcp.transform(callback)
      },
      list: async () => ({ data: [] }),
    },
    tool: {
      transform: (callback: (editor: ToolEditor) => void) => {
        log.push("tool")
        if (options.fail === "tool") return Promise.reject(new Error(`tool registry closed\nsecond line ${KEY}`))
        return tool.transform(callback)
      },
    },
    integration: { transform: async () => ({ dispose: async () => {} }), get: async () => ({ data: {} }), connection: {} },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
        },
      }),
    },
  } as unknown as Plugin.Context
  return { ctx, mcp, tool, log }
}

/** Runs the tool transforms on a fresh editor and returns the namespaces they declared. */
function namespaces(tool: ReturnType<typeof transforms<ToolEditor>>) {
  const declared: { name: string; description: string }[] = []
  tool.run({ namespace: (namespace: { name: string; description: string }) => void declared.push(namespace) } as unknown as ToolEditor)
  return declared
}

describe("the plugin", () => {
  test("the production entry is the openrouter.models plugin", () => {
    expect(plugin.id).toBe(PLUGIN_ID)
    expect(PLUGIN_ID).toBe("openrouter.models")
    expect(typeof plugin.setup).toBe("function")
  })

  test("registers the server, then the namespace, and the namespace only while the server is the plugin's", async () => {
    const timers = timerProbe()
    try {
      let state: PluginState | undefined
      const { ctx, mcp, tool, log } = context()
      const stop = await createOpenRouterPlugin({ endpoint: ENDPOINT, inspect: (value) => (state = value) }).setup(ctx)
      expect(log).toEqual(["mcp", "tool"])
      expect(state!.server().source).toEqual({ type: "pending" })
      expect(state!.owned()).toBe(false)
      expect(namespaces(tool)).toEqual([])

      const { editor, servers } = mcpEditor()
      mcp.run(editor)
      expect(servers.get(SERVER_NAME)).toEqual({ type: "remote", url: ENDPOINT } as ServerConfig)
      expect(state!.owned()).toBe(true)
      expect(namespaces(tool)).toEqual([{ name: SERVER_NAME, description: NAMESPACE_DESCRIPTION }])

      mcp.run(mcpEditor({ openrouter: { type: "remote", url: "https://example.com/mcp" } as ServerConfig }).editor)
      expect(state!.server().source.type).toBe("conflict")
      expect(namespaces(tool)).toEqual([])

      await (stop as () => Promise<void>)()
      expect(mcp.callbacks).toHaveLength(0)
      expect(tool.callbacks).toHaveLength(0)
      expect(timers.pending()).toBe(0)
    } finally {
      timers.stop()
    }
  })

  test("defaults the options to ask-changes and reports the host as tested", async () => {
    let state: PluginState | undefined
    const { ctx } = context({ options: {} })
    const stop = await createOpenRouterPlugin({ endpoint: ENDPOINT, inspect: (value) => (state = value) }).setup(ctx)
    expect(state!.options).toEqual({ access: "ask-changes", allowUntestedHost: false })
    expect(state!.host).toEqual({ version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true })
    await (stop as () => Promise<void>)()
  })

  test("refuses bad options or an out-of-range host before registering anything", async () => {
    for (const input of [{ options: { access: "everything" } }, { version: "2.3.0" }]) {
      const { ctx, log } = context(input)
      await expect(createOpenRouterPlugin({ endpoint: ENDPOINT }).setup(ctx)).rejects.toThrow(/^(OPTIONS_INVALID|HOST_UNTESTED): /)
      expect(log).toEqual([])
    }
  })

  test("a failure part-way undoes what was registered and rethrows one sanitised, actionable error", async () => {
    const timers = timerProbe()
    try {
      const { ctx, mcp, log } = context({ fail: "tool" })
      let error: unknown
      await Promise.resolve(createOpenRouterPlugin({ endpoint: ENDPOINT }).setup(ctx)).catch((caught: unknown) => (error = caught))
      expect(log).toEqual(["mcp", "tool"])
      // The server registration made before the failure is gone, and no watcher started.
      expect(mcp.callbacks).toHaveLength(0)
      expect(mcp.disposed()).toBe(1)
      expect(timers.pending()).toBe(0)
      const message = (error as Error).message
      expect(error).toMatchObject({ code: "SETUP_FAILED" })
      expect(message).toStartWith("SETUP_FAILED: The OpenRouter plugin could not finish starting (tool registry closed second line [redacted]), and removed what it had registered. Next step:")
      expect(message).not.toContain(KEY)
      expect(message).not.toContain("\n")
    } finally {
      timers.stop()
    }
  })

  test("a failure at the first registration leaves nothing behind", async () => {
    const { ctx, tool, log } = context({ fail: "mcp" })
    await expect(createOpenRouterPlugin({ endpoint: ENDPOINT }).setup(ctx)).rejects.toThrow(/^SETUP_FAILED: .*mcp down Bearer \[redacted\]/)
    expect(log).toEqual(["mcp"])
    expect(tool.callbacks).toHaveLength(0)
  })
})

describe("the cleanup stack", () => {
  test("undoes in reverse order, runs every step once even when one fails, and reports the failures", async () => {
    const order: string[] = []
    const stack = cleanupStack()
    stack.defer(() => void order.push("first"))
    stack.defer({ dispose: async () => void order.push("second") })
    stack.defer(() => {
      order.push("third")
      throw new Error("third failed")
    })
    const failures = await stack.run()
    expect(order).toEqual(["third", "second", "first"])
    expect(failures.map((failure) => (failure as Error).message)).toEqual(["third failed"])
    expect(await stack.run()).toEqual([])
    expect(order).toHaveLength(3)
  })

  test("keeps the plugin's own coded errors, and wraps anything else", () => {
    const coded = Object.assign(new Error("HOST_UNTESTED: x. Next step: y."), { code: "HOST_UNTESTED", nextStep: "y." })
    expect(setupFailure(coded)).toBe(coded)
    expect(setupFailure("plain").message).toStartWith("SETUP_FAILED: The OpenRouter plugin could not finish starting (plain)")
  })
})
