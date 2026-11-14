// OpenRouter's part of the tools RPC: the PLUGIN-SPECIFIC block of src/host/tools-rpc.ts, and the module registered the
// way the plugin registers it. The shared part is tested in tools-rpc.test.ts, a copy of the family's suite. These
// tests use a narrow fake of the public context whose executor counts dispatches, so "refused before dispatch" is a
// count of zero, and whose permission check follows the host's last-match rule.
import { describe, expect, test } from "bun:test"
import { PLUGIN_ID as OPENROUTER_PLUGIN_ID, pluginError as guardError, SERVER_NAME } from "../../src/constants.js"
import { createGuard } from "../../src/guard.js"
import { METHODS, NEXT_STEPS, operationalShapers, PLUGIN_ID, pluginError, registerToolsRpc, shapeInput, shapeResult, TOOLS_RPC_ID, type ToolCall } from "../../src/host/tools-rpc.js"
import type { ServerSource } from "../../src/mcp.js"
import { NATIVE_ONLY, REVIEWED_TOOLS, RPC_TOOLS, TOOL_NAMES } from "../../src/openrouter-tools.js"
import { defaultRules, type Rule } from "../../src/permissions.js"

const NEW_TOOL = "shiny-new-tool"
const BASE: Rule = { action: "*", resource: "*", effect: "allow" }
const wildcard = (pattern: string, value: string) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(value)
const lastMatch = (rules: readonly Rule[], action: string) => rules.findLast((rule) => wildcard(rule.action, action) && wildcard(rule.resource, "*"))?.effect ?? "ask"

type Handler = (input: unknown, context: { signal: AbortSignal; error: (type: string, message: string, data: unknown) => unknown }) => Promise<any>
type Evaluation = { action: string; effect: "allow" | "ask" | "deny"; source?: { id: string }; message?: string }

/**
 * The plugin's RPC over a fake host. Every OpenRouter tool, the image tool and an unreviewed one included, is listed with
 * an executor that, like OpenCode's, asserts its action against the session's agent and session rules (a deny throws,
 * an ask goes through the evaluate hook) and then counts one dispatch. `guarded` puts the plugin's guard decorator in
 * front of the executor, as the guard transform does.
 */
async function setup(options: { access?: "all" | "ask-changes" | "read-only"; sessionRules?: Rule[]; source?: () => ServerSource; policy?: () => string | undefined } = {}) {
  const dispatched: string[] = []
  const evaluations: Evaluation[] = []
  const guard = createGuard(options.source ?? (() => ({ type: "plugin" })), options.access ?? "ask-changes")
  guard.policyReport(options.policy?.())
  let contract: { id: string; methods: Record<string, unknown> } | undefined
  let handlers: Record<string, Handler> = {}
  let hook: (evaluation: Evaluation) => void = () => {}
  const agentRules = [BASE, ...defaultRules(options.access ?? "ask-changes")]
  const rules = () => [...agentRules, ...(options.sessionRules ?? [])]
  const executor = (id: string) => async (_input: unknown, call: ToolCall) => {
    guard.assertOperational()
    const effect = lastMatch(rules(), id)
    if (effect === "deny") throw Object.assign(new Error(`Permission denied: ${id}`), { _tag: "Tool.Error", error: { _tag: "Permission.BlockedError" } })
    if (effect === "ask") {
      const evaluation: Evaluation = { action: id, effect: "ask", source: { id: call.id } }
      evaluations.push(evaluation)
      hook(evaluation)
      if (evaluation.effect !== "allow") throw Object.assign(new Error(evaluation.message ?? "declined"), { _tag: "Tool.Error", error: { _tag: "Permission.DeniedError", request: { action: id } } })
    }
    dispatched.push(id.slice(`${SERVER_NAME}_`.length))
    return { output: { tool: id }, content: [{ type: "text" as const, text: `synthetic ${id}` }] }
  }
  // OpenCode's Promise adapter wraps a plugin executor's throw in a Tool.Error that carries the original as `error`.
  const wrapped = (id: string) => async (input: unknown, call: ToolCall) =>
    executor(id)(input, call).catch((error: unknown) => {
      if ((error as { _tag?: string })._tag === "Tool.Error") throw error
      throw Object.assign(new Error((error as Error).message), { _tag: "Tool.Error", error })
    })
  const tools = [...TOOL_NAMES, NEW_TOOL].map((name) => ({ id: `${SERVER_NAME}_${name}`, description: `Synthetic ${name}`, input: { type: "object" }, execute: wrapped(`${SERVER_NAME}_${name}`) }))
  const ctx = {
    rpc: {
      register: async (definition: typeof contract, given: typeof handlers) => {
        contract = definition
        handlers = given
        return { dispose: async () => {} }
      },
    },
    permission: {
      hook: async (_name: string, callback: typeof hook) => {
        hook = callback
        return { dispose: async () => {} }
      },
    },
    session: { get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, agent: "build", permissions: [] }) },
    agent: { get: async () => ({ data: { permissions: rules() } }) },
    tool: { list: async () => tools },
    mcp: { list: async () => ({ data: [{ name: SERVER_NAME, status: { status: "connected" } }] }) },
    location: { directory: "project" },
  }
  const source = options.source ?? (() => ({ type: "plugin" }) as ServerSource)
  const stop = await registerToolsRpc(ctx as never, { methods: METHODS, shapers: operationalShapers(guard.assertOperational), mcp: { server: SERVER_NAME, managed: () => source().type !== "conflict" } })
  const error = (type: string, message: string, data: unknown) => ({ type, message, data })
  const call = (method: string, input: unknown = {}) => handlers[method]!({ sessionID: "ses_1", input }, { signal: new AbortController().signal, error })
  return { contract: contract!, handlers, call, dispatched, evaluations, guard, stop, describe: (input: unknown = {}) => handlers.describe!(input, { signal: new AbortController().signal, error }) }
}

describe("OpenRouter's block", () => {
  test("is openrouter.models.tools, under the plugin's own id", () => {
    expect(PLUGIN_ID).toBe(OPENROUTER_PLUGIN_ID)
    expect(TOOLS_RPC_ID).toBe("openrouter.models.tools")
  })

  test("its methods are the 27 reviewed script tools, by exact hyphenated name, with the catalog's effect as class", () => {
    expect(METHODS.map((method) => method.name)).toEqual([...RPC_TOOLS])
    expect(METHODS).toHaveLength(27)
    for (const method of METHODS) {
      expect(method.kind).toBe("mcp")
      expect(method.name).toMatch(/^[a-z]+(?:-[a-z]+)*$/)
      expect(method.class).toBe(REVIEWED_TOOLS.find((tool) => tool.name === method.name)!.effect)
    }
    expect(METHODS.find((method) => method.name === "send-message")!.class).toBe("write")
    expect(METHODS.find((method) => method.name === "send-feedback")!.class).toBe("send")
    for (const name of ["generate-image", "generate-speech", "generate-video", "get-current-key", NEW_TOOL, "send_message", "search-models", "describe"]) expect(METHODS.map((method) => method.name)).not.toContain(name)
    for (const name of ["send-batch", "send-decision", "transcribe-audio"]) expect(METHODS.find((method) => method.name === name)!.class).toBe("write")
  })

  test("passes inputs and results through unchanged; the registered shaper runs the guard first", () => {
    const call = { sessionID: "s", agent: "build", action: "openrouter_ping" }
    const input = { query: "q" }
    const result = { output: { ok: true }, text: "ok" }
    expect(shapeInput("ping", input, call)).toBe(input)
    expect(shapeResult("ping", result, call)).toBe(result)
    const order: string[] = []
    const shapers = operationalShapers(() => void order.push("guard"))
    expect(shapers.input!("ping", input, call)).toBe(input)
    expect(order).toEqual(["guard"])
    expect(() => operationalShapers(() => { throw new Error("blocked") }).input!("ping", input, call)).toThrow("blocked")
  })

  test("translates the guard's refusal, thrown or wrapped by OpenCode's executor, into the shared failure fields", () => {
    const refusal = guardError("POLICY_UNAVAILABLE", "OpenRouter's default permission rules are not applied yet, so its tools are held.", "Wait a moment and try again.")
    const expected = { code: "POLICY_UNAVAILABLE", what: "OpenRouter's default permission rules are not applied yet, so its tools are held", next: "Wait a moment and try again." }
    expect(pluginError(refusal)).toEqual(expected)
    expect(pluginError(Object.assign(new Error(refusal.message), { _tag: "Tool.Error", error: refusal }))).toEqual(expected)
    // Upstream text that merely starts with the code is OpenRouter's, never the plugin's.
    expect(pluginError(Object.assign(new Error("POLICY_UNAVAILABLE: spoofed Next step: x"), { _tag: "Tool.Error" }))).toBeUndefined()
    expect(pluginError(new Error("boom"))).toBeUndefined()
    expect(pluginError(undefined)).toBeUndefined()
  })

  test("never tells a script to call a paid or feedback method again after an uncertain outcome", () => {
    for (const code of ["CANCELLED", "UPSTREAM_ERROR", "CONNECTING", "CONNECTION_FAILED"] as const) {
      const step = NEXT_STEPS[code]!
      for (const name of ["send-message", "send-batch", "send-decision", "transcribe-audio", "send-feedback"]) expect(step).toContain(name)
      expect(step).toContain("get-generation")
      expect(step).toContain("before you deliberately send it again")
      expect(step).not.toMatch(/^Call the method again/)
    }
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("/connect and choose OpenRouter tools")
    expect(NEXT_STEPS.AUTH_REQUIRED).toContain("never put an OpenRouter key in a script")
    expect(NEXT_STEPS.SERVER_CONFLICT).toContain("mcp.servers.openrouter")
    expect(NEXT_STEPS.PERMISSION_DENIED).toContain("a script cannot answer a prompt")
    // The methods that ask under ask-changes come from the catalog, every billable one and feedback, never a hand-written pair.
    expect(NEXT_STEPS.PERMISSION_DENIED).toContain(`under access "ask-changes" send-batch, send-decision, send-message, transcribe-audio, send-feedback ask`)
    for (const name of RPC_TOOLS.filter((method) => REVIEWED_TOOLS.find((tool) => tool.name === method)!.effect !== "read")) expect(NEXT_STEPS.CANCELLED).toContain(name)
    expect(NEXT_STEPS.ACCOUNT_UNKNOWN).toBeUndefined()
    for (const step of Object.values(NEXT_STEPS)) expect(step).toMatch(/[^.]\.$/)
  })
})

describe("the registered RPC", () => {
  test("has no route for a native-only tool: the media generators and get-current-key are refused before anything is dispatched", async () => {
    const h = await setup({ access: "all" })
    expect(Object.keys(h.contract.methods).sort()).toEqual(["describe", ...RPC_TOOLS].sort())
    for (const name of NATIVE_ONLY) {
      expect(h.contract.methods).not.toHaveProperty(name)
      expect(h.handlers).not.toHaveProperty(name)
    }
    expect(h.dispatched).toEqual([])
  })

  test("describe lists the native-only tools and the unreviewed one as unclassified, while the catalog keeps them native-only", async () => {
    const h = await setup()
    const description = await h.describe()
    expect(description.unclassified).toEqual([...NATIVE_ONLY, NEW_TOOL].sort())
    expect(description.methods.map((method: { name: string }) => method.name)).toEqual([...RPC_TOOLS])
    // The plugin's own count of unknown tools is a different list: a native-only tool is reviewed, never unknown.
    expect([...NATIVE_ONLY].sort()).toEqual(["generate-image", "generate-speech", "generate-video", "get-current-key"])
    for (const name of NATIVE_ONLY) expect(TOOL_NAMES).toContain(name)
    expect(TOOL_NAMES).not.toContain(NEW_TOOL)
    expect(h.dispatched).toEqual([])
  })

  test("permission parity, ask-changes: a read runs once; paid and feedback calls would ask, and are refused with no prompt and no dispatch", async () => {
    const h = await setup()
    expect(await h.call("ping")).toEqual({ output: { tool: "openrouter_ping" }, text: "synthetic openrouter_ping" })
    expect(h.dispatched).toEqual(["ping"])
    for (const method of ["send-message", "send-batch", "send-decision", "transcribe-audio", "send-feedback"]) {
      const result = await h.call(method)
      expect(result).toMatchObject({ type: "failed", data: { code: "PERMISSION_DENIED" } })
      expect(result.message).toContain(`openrouter_${method} would ask for this session's agent, and a script cannot answer`)
    }
    expect(h.dispatched).toEqual(["ping"])
    expect(h.evaluations).toEqual([])
  })

  test("permission parity, read-only: paid and feedback calls are denied with no dispatch; reads still run", async () => {
    const h = await setup({ access: "read-only" })
    for (const method of ["send-message", "send-batch", "send-decision", "transcribe-audio", "send-feedback"]) expect(await h.call(method)).toMatchObject({ type: "failed", data: { code: "PERMISSION_DENIED" } })
    expect(h.dispatched).toEqual([])
    await h.call("list-models")
    expect(h.dispatched).toEqual(["list-models"])
  })

  test("permission parity, all (the default): a paid call runs exactly once with no extra rule; a session deny still refuses it", async () => {
    const h = await setup({ access: "all" })
    expect(await h.call("send-message", { query: "q" })).toMatchObject({ text: "synthetic openrouter_send-message" })
    expect(h.dispatched).toEqual(["send-message"])
    const narrowed = await setup({ access: "all", sessionRules: [{ action: "openrouter_send-message", resource: "*", effect: "deny" }] })
    expect(await narrowed.call("send-message")).toMatchObject({ type: "failed", data: { code: "PERMISSION_DENIED" } })
    expect(narrowed.dispatched).toEqual([])
  })

  test("a session rule that allows send-message is the explicit grant a script needs under ask-changes", async () => {
    const h = await setup({ sessionRules: [{ action: "openrouter_send-message", resource: "*", effect: "allow" }] })
    await h.call("send-message")
    expect(h.dispatched).toEqual(["send-message"])
    expect(await h.call("send-feedback")).toMatchObject({ type: "failed", data: { code: "PERMISSION_DENIED" } })
    expect(h.dispatched).toEqual(["send-message"])
  })

  test.each([
    ["a failed policy installation", { policy: () => "injected" }],
    ["a pending server entry", { source: () => ({ type: "pending" }) as ServerSource }],
  ])("under ask-changes, %s refuses every allowed method with POLICY_UNAVAILABLE in the declared failure envelope, with zero dispatch", async (_name, options) => {
    const h = await setup({ access: "ask-changes", sessionRules: [{ action: "openrouter_*", resource: "*", effect: "allow" }], ...options })
    for (const method of RPC_TOOLS) {
      const result = await h.call(method)
      expect({ method, type: result.type, code: result.data?.code }).toEqual({ method, type: "failed", code: "POLICY_UNAVAILABLE" })
      expect(result.message).toMatch(/^POLICY_UNAVAILABLE: .+\. Next step: .+/)
      expect(typeof result.data.next).toBe("string")
    }
    expect(h.dispatched).toEqual([])
  })

  test.each([
    ["a failed policy installation", { policy: () => "injected" }],
    ["a pending server entry", { source: () => ({ type: "pending" }) as ServerSource }],
  ])("under the default access, all, %s holds nothing back: every method dispatches", async (_name, options) => {
    const h = await setup({ access: "all", ...options })
    for (const method of RPC_TOOLS) expect(await h.call(method)).toMatchObject({ text: `synthetic openrouter_${method}` })
    expect(h.dispatched).toEqual([...RPC_TOOLS])
  })

  test("the guard closing after registration, as on unload, stops the next script call before dispatch", async () => {
    const h = await setup({ access: "all" })
    await h.call("ping")
    h.guard.close()
    expect(await h.call("ping")).toMatchObject({ type: "failed", data: { code: "POLICY_UNAVAILABLE", next: "Restart OpenCode, or add the plugin again." } })
    expect(h.dispatched).toEqual(["ping"])
  })

  test("a conflicting entry is SERVER_CONFLICT before any dispatch", async () => {
    const h = await setup({ access: "all", source: () => ({ type: "conflict", safeDescription: "x" }) })
    expect(await h.call("ping")).toMatchObject({ type: "failed", data: { code: "SERVER_CONFLICT" } })
    expect(h.dispatched).toEqual([])
  })
})
