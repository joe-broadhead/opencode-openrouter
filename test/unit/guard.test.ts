// The operational guard: health starts blocked and opens only with an owned server and applied rules; the decorator
// captures the original inside each pass, checks first, delegates exactly once and returns its result unchanged; replays
// never stack; only owned OpenRouter tools are decorated; the image tool becomes direct only for an owned server; and a
// tool that cannot be decorated is removed rather than left unguarded.
import { describe, expect, test } from "bun:test"
import { createGuard, guardTools, IMAGE_TOOL, isOwnedOpenRouterTool, registerGuard } from "../../src/guard.js"
import type { ServerSource } from "../../src/mcp.js"
import { transforms } from "./fake.js"

type Execute = (input: unknown, context: unknown) => Promise<unknown>
type Tool = { id: string; name: string; description: string; input: unknown; output?: unknown; options?: Record<string, unknown>; execute: Execute }

const PLUGIN: ServerSource = { type: "plugin" }
const CONFLICT: ServerSource = { type: "conflict", safeDescription: "points elsewhere" }

/** A tool editor over fresh tools, as each host rebuild makes them; `calls` counts the host executors' dispatches. */
/** The OpenRouter tools in `registry()`: ping, send-message and the image tool. */
const TOOL_COUNT = 3

function registry(extra: Tool[] = []) {
  const calls: string[] = []
  const tool = (id: string, options: Record<string, unknown> = { namespace: id.split("_")[0], codemode: true }): Tool => ({
    id,
    name: id,
    description: `synthetic ${id}`,
    input: { type: "object" },
    output: {},
    options,
    execute: async (input) => {
      calls.push(id)
      return { output: { id, input }, content: [{ type: "text", text: id }] }
    },
  })
  const tools = new Map<string, Tool>(
    [tool("openrouter_ping"), tool("openrouter_send-message"), tool(IMAGE_TOOL, { namespace: "openrouter", codemode: true, pinned: true, permission: "openrouter_generate-image" }), tool("openrouter_x_other", { namespace: "openrouter_x" }), tool("github_issue"), ...extra].map((item) => [item.id, item]),
  )
  const editor = {
    list: () => [...tools.values()],
    update: (id: string, update: (draft: Tool) => void) => {
      const current = tools.get(id)
      if (!current) return
      const draft = { ...current, options: current.options && { ...current.options } }
      update(draft)
      tools.set(id, draft)
    },
    remove: (id: string) => void tools.delete(id),
  }
  return { tools, editor, calls }
}

const healthy = () => {
  const guard = createGuard(() => PLUGIN)
  guard.policyReport(undefined)
  return guard
}

describe("health", () => {
  test("starts blocked, opens only with an owned server and applied rules, and closes for good", () => {
    let source: ServerSource = { type: "pending" }
    const guard = createGuard(() => source)
    expect(guard.operational()).toBe(false)
    expect(guard.health()).toEqual({ installation: "pending", problems: [] })
    source = PLUGIN
    expect(() => guard.assertOperational()).toThrow("POLICY_UNAVAILABLE: OpenRouter's default permission rules are not applied yet, so its tools are held. Next step: Wait a moment and try again; if this persists, restart OpenCode.")
    guard.policyReport(undefined)
    expect(guard.operational()).toBe(true)
    source = { type: "adopted", signIn: "user-managed" }
    expect(guard.operational()).toBe(true)
    for (const lost of [CONFLICT, { type: "disabled" } as ServerSource]) {
      source = lost
      expect(() => guard.assertOperational()).toThrow(/^POLICY_UNAVAILABLE: The openrouter server entry is no longer the plugin's own or your exact entry/)
    }
    source = PLUGIN
    guard.policyReport("agent store closed")
    expect(() => guard.assertOperational()).toThrow("POLICY_UNAVAILABLE: OpenRouter's default permission rules could not be applied (agent store closed), so the plugin blocks its tools before anything is sent. Next step: Restart OpenCode; if it fails again, run /plugins to see the error.")
    expect(guard.health()).toMatchObject({ installation: "failed", problems: [expect.stringMatching(/^POLICY_UNAVAILABLE: .*agent store closed/)] })
    guard.policyReport(undefined)
    guard.transformReport({ failure: "1 tool failed: frozen", unnamespaced: [], observed: 1 })
    expect(() => guard.assertOperational()).toThrow(/^POLICY_UNAVAILABLE: The plugin could not put its guard on OpenRouter's tools \(1 tool failed: frozen\)/)
    expect(guard.health().problems).toHaveLength(1)
    guard.transformReport({ failure: undefined, unnamespaced: [], observed: 1 })
    expect(guard.operational()).toBe(true)
    guard.close()
    guard.policyReport(undefined)
    expect(() => guard.assertOperational()).toThrow(/^POLICY_UNAVAILABLE: The OpenRouter plugin is unloaded/)
  })

  test("the thrown error carries its code and next step", () => {
    const guard = createGuard(() => PLUGIN)
    try {
      guard.assertOperational()
      throw new Error("not thrown")
    } catch (error) {
      expect(error).toMatchObject({ code: "POLICY_UNAVAILABLE", nextStep: "Wait a moment and try again; if this persists, restart OpenCode." })
    }
  })
})

describe("the decorator", () => {
  test("checks first, delegates once, and returns the original result unchanged", async () => {
    const guard = healthy()
    let checks = 0
    const { tools, editor, calls } = registry()
    const original = tools.get("openrouter_ping")!
    const results: unknown[] = []
    const host = original.execute
    original.execute = async (input, context) => {
      const result = await host(input, context)
      results.push(result)
      return result
    }
    expect(guardTools(editor as never, PLUGIN, () => (checks++, guard.assertOperational()))).toEqual({ failure: undefined, unnamespaced: [], observed: TOOL_COUNT })
    const wrapped = tools.get("openrouter_ping")!
    const context = { sessionID: "ses_1", signal: new AbortController().signal }
    const result = await wrapped.execute({ query: "q" }, context)
    expect(result).toBe(results[0])
    expect(calls).toEqual(["openrouter_ping"])
    expect(checks).toBe(1)
  })

  test("refuses before the original runs while blocked, and the check stays live in an older wrapper", async () => {
    let source: ServerSource = PLUGIN
    const guard = createGuard(() => source)
    guard.policyReport(undefined)
    const { tools, editor, calls } = registry()
    guardTools(editor as never, PLUGIN, guard.assertOperational)
    const captured = tools.get("openrouter_send-message")!.execute
    source = CONFLICT
    await expect(captured({}, {})).rejects.toThrow(/^POLICY_UNAVAILABLE: /)
    guard.close()
    await expect(captured({}, {})).rejects.toThrow(/^POLICY_UNAVAILABLE: The OpenRouter plugin is unloaded/)
    expect(calls).toEqual([])
  })

  test("preserves everything but the executor, and passes input and context through", async () => {
    const guard = healthy()
    const { tools, editor } = registry()
    const before = structuredClone({ ...tools.get("openrouter_send-message")!, execute: undefined })
    let seen: unknown[] = []
    const host = tools.get("openrouter_send-message")!
    host.execute = async (...args) => ((seen = args), "ok")
    guardTools(editor as never, PLUGIN, guard.assertOperational)
    const after = tools.get("openrouter_send-message")!
    expect({ ...after, execute: undefined }).toEqual(before)
    const context = { sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", signal: new AbortController().signal, progress: async () => {} }
    await after.execute({ prompt: "p" }, context)
    expect(seen[0]).toEqual({ prompt: "p" })
    expect(seen[1]).toBe(context)
  })

  test("repeated passes never stack: each pass on fresh tools adds one guard, and a pass over a guarded tool adds one more layer only", async () => {
    const guard = healthy()
    let checks = 0
    const assert = () => (checks++, guard.assertOperational())
    for (let pass = 0; pass < 3; pass++) {
      const { tools, editor, calls } = registry()
      guardTools(editor as never, PLUGIN, assert)
      checks = 0
      await tools.get("openrouter_ping")!.execute({}, {})
      expect({ checks, calls }).toEqual({ checks: 1, calls: ["openrouter_ping"] })
    }
  })

  test("decorates only the openrouter server's own tools, and none of a conflicting entry", async () => {
    const guard = createGuard(() => PLUGIN)
    const { tools, editor } = registry()
    const originals = new Map([...tools].map(([id, tool]) => [id, tool.execute]))
    guardTools(editor as never, PLUGIN, guard.assertOperational)
    const changed = [...tools].filter(([id, tool]) => tool.execute !== originals.get(id)).map(([id]) => id).sort()
    expect(changed).toEqual([IMAGE_TOOL, "openrouter_ping", "openrouter_send-message"])

    const other = registry()
    const before = new Map([...other.tools].map(([id, tool]) => [id, tool.execute]))
    guardTools(other.editor as never, CONFLICT, guard.assertOperational)
    expect([...other.tools].every(([id, tool]) => tool.execute === before.get(id))).toBe(true)
    expect(other.tools.get(IMAGE_TOOL)!.options).toMatchObject({ codemode: true, pinned: true })
  })

  test("a pending entry's tools are decorated, so none is ever exposed unguarded, but the image tool stays as it is", () => {
    const guard = createGuard(() => ({ type: "pending" }))
    const { tools, editor } = registry()
    const original = tools.get("openrouter_ping")!.execute
    guardTools(editor as never, { type: "pending" }, guard.assertOperational)
    expect(tools.get("openrouter_ping")!.execute).not.toBe(original)
    expect(tools.get(IMAGE_TOOL)!.options).toEqual({ namespace: "openrouter", codemode: true, pinned: true, permission: "openrouter_generate-image" })
    expect(isOwnedOpenRouterTool({ id: "openrouter_ping", options: { namespace: "openrouter" } }, { type: "disabled" })).toBe(false)
    expect(isOwnedOpenRouterTool({ id: "openrouter_x_other", options: { namespace: "openrouter_x" } }, PLUGIN)).toBe(false)
  })

  test("fails closed on a tool with no namespace: decorates it, guards it, and names it as a problem", async () => {
    let source: ServerSource = PLUGIN
    const guard = createGuard(() => source)
    guard.policyReport(undefined)
    const bare = (id: string): Tool => ({ id, name: id, description: id, input: {}, execute: async () => "ran" })
    const { tools, editor, calls } = registry([bare("openrouter_bare-tool"), bare("openrouter_\u202eevil")])
    const before = tools.get("openrouter_bare-tool")!.execute
    const pass = guardTools(editor as never, source, guard.assertOperational)
    expect(pass).toEqual({ failure: undefined, unnamespaced: ["openrouter_bare-tool", "openrouter_evil"], observed: TOOL_COUNT + 2 })
    const wrapped = tools.get("openrouter_bare-tool")!
    expect(wrapped.execute).not.toBe(before)
    expect(wrapped.options).toBeUndefined()
    expect(await wrapped.execute({}, {})).toBe("ran")
    source = CONFLICT
    await expect(wrapped.execute({}, {})).rejects.toThrow(/^POLICY_UNAVAILABLE: /)
    expect(calls).toEqual([])
    guard.transformReport(pass)
    expect(guard.health().problems).toEqual([
      "TOOL_NAMESPACE_MISSING: OpenCode listed openrouter_bare-tool, openrouter_evil with no tool namespace, so the plugin treats them as OpenRouter's and guards them. Next step: If a tool here is not OpenRouter's, rename the plugin or server that adds it; otherwise update OpenCode.",
    ])
    // A conflicting entry leaves even a bare tool alone, and another server's namespaced tools stay untouched.
    expect(isOwnedOpenRouterTool({ id: "openrouter_bare-tool", options: undefined }, CONFLICT)).toBe(false)
    expect(isOwnedOpenRouterTool({ id: "openrouter_x_other", options: { namespace: "openrouter_x" } }, PLUGIN)).toBe(false)
    guard.transformReport({ failure: undefined, unnamespaced: [], observed: 1 })
    expect(guard.health().problems).toEqual([])
  })

  test("records when a pass last found OpenRouter's tools, and keeps that time over a pass that found none", () => {
    const guard = healthy()
    expect(guard.lastObservedAt()).toBeUndefined()
    guard.transformReport({ failure: undefined, unnamespaced: [], observed: 0 })
    expect(guard.lastObservedAt()).toBeUndefined()
    const before = Date.now()
    guard.transformReport(guardTools(registry().editor as never, PLUGIN, guard.assertOperational))
    const seen = guard.lastObservedAt()!
    expect(Date.parse(seen)).toBeGreaterThanOrEqual(before - 1)
    guard.transformReport({ failure: undefined, unnamespaced: [], observed: 0 })
    expect(guard.lastObservedAt()).toBe(seen)
  })

  test("names at most 20 tools with no namespace", () => {
    const guard = healthy()
    const many = Array.from({ length: 25 }, (_, index): Tool => ({ id: `openrouter_t${index}`, name: "t", description: "t", input: {}, execute: async () => "ran" }))
    const { editor } = registry(many)
    expect(guardTools(editor as never, PLUGIN, guard.assertOperational).unnamespaced).toHaveLength(20)
  })

  test("makes the owned image tool direct: codemode false, pinned removed, permission and namespace kept", () => {
    const guard = healthy()
    for (const source of [PLUGIN, { type: "adopted", signIn: "oauth" } as ServerSource]) {
      const { tools, editor } = registry()
      guardTools(editor as never, source, guard.assertOperational)
      expect(tools.get(IMAGE_TOOL)!.options).toEqual({ namespace: "openrouter", permission: "openrouter_generate-image", codemode: false })
      expect(tools.get("openrouter_ping")!.options).toEqual({ namespace: "openrouter", codemode: true })
    }
  })

  test("a tool that cannot be decorated is removed and the pass reports it; a failing list is reported too", () => {
    const guard = healthy()
    const { tools, editor } = registry()
    const failing = { ...editor, update: (id: string, update: (draft: Tool) => void) => (id === "openrouter_ping" ? (() => { throw new Error("frozen draft") })() : editor.update(id, update)) }
    expect(guardTools(failing as never, PLUGIN, guard.assertOperational)).toEqual({ failure: "1 tool failed: frozen draft", unnamespaced: [], observed: TOOL_COUNT })
    expect(tools.has("openrouter_ping")).toBe(false)
    expect(tools.has("openrouter_send-message")).toBe(true)
    expect(guardTools({ list: () => { throw new Error("registry closed") } } as never, PLUGIN, guard.assertOperational)).toEqual({ failure: "registry closed", unnamespaced: [], observed: 0 })
  })

  test("the registered transform reads the latest source and reports each pass to the guard", async () => {
    let source: ServerSource = PLUGIN
    const guard = healthy()
    const tool = transforms<never>()
    await registerGuard({ transform: tool.transform } as never, guard, () => source)
    tool.run({ list: () => { throw new Error("registry closed") } } as never)
    expect(guard.operational()).toBe(false)
    const { tools, editor } = registry()
    tool.run(editor as never)
    expect(guard.operational()).toBe(true)
    expect(tools.get(IMAGE_TOOL)!.options?.codemode).toBe(false)
    source = CONFLICT
    const other = registry()
    tool.run(other.editor as never)
    expect(other.tools.get(IMAGE_TOOL)!.options?.codemode).toBe(true)
  })
})
