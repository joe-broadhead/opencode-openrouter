// The tools RPC `openrouter.models.tools` on the public @opencode/sdk host, against the loopback fake, counting the
// fake's actual `tools/call` requests: a script gets the same decision as the native path (allow runs once, ask is
// refused with no prompt, deny is refused), the image route does not exist and dispatches nothing, and a failed policy
// installation, at setup and on a replay, refuses every method in the declared failure envelope with zero dispatch.
import "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { SERVER_NAME } from "../../src/constants.js"
import { TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { nativeToolId } from "../../src/mcp.js"
import { NATIVE_ONLY, RPC_TOOLS, TOOL_NAMES } from "../../src/openrouter-tools.js"
import { NEW_TOOL } from "./fake-mcp.js"
import { attempt, cleanup, HOST_VERSION, session, startHost, until, type Host, type Rule } from "./harness.js"

setDefaultTimeout(300_000)
afterAll(cleanup)

/** A tools RPC call by method name: the host's `{ output }` answer, or the error's type, code, next step and message. */
async function script(host: Host, method: string, input: object): Promise<Record<string, any>> {
  const call = (host.client.rpc as unknown as { call: (input: object) => Promise<unknown> }).call
  return call({ rpcID: TOOLS_RPC_ID, method, input, location: host.location }).then(
    (answer) => answer as Record<string, any>,
    (error: any) => ({ type: error?.type ?? error?._tag, code: error?.data?.code, next: error?.data?.next, message: String(error?.message) }),
  )
}

const listed = (host: Host) =>
  until("OpenRouter's tools are listed", async () => (await host.probe().tool.list()).filter((tool) => tool.id.startsWith(`${SERVER_NAME}_`)).length === TOOL_NAMES.length + 1)

const pending = async (host: Host, sessionID: string) => (await host.client.permission.list({ sessionID })).length

describe(`script permission parity on OpenCode ${HOST_VERSION}, access ask-changes`, () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost()
    await listed(host)
    await until("the policy is ready", async () => host.state().policy().installation === "ready")
  })
  afterAll(() => host?.close())

  test("describe lists the 27 reviewed methods by hyphenated name, each available, with the native action", async () => {
    const { output } = await script(host, "describe", {})
    expect(output.id).toBe(TOOLS_RPC_ID)
    expect(output.methods.map((method: { name: string }) => method.name)).toEqual([...RPC_TOOLS])
    for (const method of output.methods) expect({ name: method.name, action: method.action, available: method.available }).toEqual({ name: method.name, action: nativeToolId(method.name), available: true })
    // The shared field names every listed tool that is not a method: the native-only tools and the unreviewed one.
    expect(output.unclassified).toEqual([...NATIVE_ONLY, NEW_TOOL].sort())
  })

  test("a read runs once through the native executor, with no model turn, as it does natively", async () => {
    const sessionID = await session(host)
    const before = host.fake.calls.length
    expect(await script(host, "list-models", { sessionID, input: { query: "q" } })).toEqual({ output: { output: { tool: "list-models", arguments: { query: "q" } }, text: "synthetic list-models" } })
    expect(host.fake.calls.slice(before)).toEqual(["list-models"])
    expect(await attempt(host, sessionID, "build", "list-models")).toMatchObject({ asked: undefined, ok: true })
    expect(host.fake.calls.slice(before)).toEqual(["list-models", "list-models"])
  })

  test("billable inference and feedback ask natively; a script is refused at once, with no prompt left and nothing sent", async () => {
    const sessionID = await session(host)
    const before = host.fake.calls.length
    for (const method of ["send-message", "send-batch", "send-decision", "transcribe-audio", "send-feedback"]) {
      const result = await script(host, method, { sessionID, input: { query: "q" } })
      expect(result).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
      expect(result.message).toContain(`${nativeToolId(method)} would ask for this session's agent, and a script cannot answer`)
      expect(await pending(host, sessionID)).toBe(0)
      // The same decision on the native path: a prompt, declined here.
      expect(await attempt(host, sessionID, "build", method, "reject")).toMatchObject({ asked: nativeToolId(method), ok: false })
    }
    expect(host.fake.calls.length).toBe(before)
  })

  test("a session rule that allows send-message runs it exactly once; a session deny refuses a read before dispatch", async () => {
    const allowed = (await host.client.sessions.create({ agent: "build", permissions: [{ action: nativeToolId("send-message"), resource: "*", effect: "allow" } satisfies Rule], location: host.location })).id
    const before = host.fake.calls.length
    expect(await script(host, "send-message", { sessionID: allowed, input: { query: "q" } })).toMatchObject({ output: { text: "synthetic send-message" } })
    expect(host.fake.calls.slice(before)).toEqual(["send-message"])
    const denied = (await host.client.sessions.create({ agent: "build", permissions: [{ action: nativeToolId("ping"), resource: "*", effect: "deny" } satisfies Rule], location: host.location })).id
    expect(await script(host, "ping", { sessionID: denied, input: {} })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
    expect(await attempt(host, denied, "build", "ping")).toMatchObject({ ok: false })
    expect(host.fake.calls.slice(before)).toEqual(["send-message"])
  })

  test("no native-only tool has a route: each is refused by the host before the plugin runs, and nothing reaches the server", async () => {
    const sessionID = await session(host)
    const before = host.fake.calls.length
    for (const name of NATIVE_ONLY) {
      const result = await script(host, name, { sessionID, input: { query: "a red square" } })
      expect({ name, output: result.output, type: result.type }).toEqual({ name, output: undefined, type: "rpc.method_not_found" })
    }
    expect(await script(host, NEW_TOOL, { sessionID, input: {} })).toMatchObject({ type: "rpc.method_not_found" })
    expect(host.fake.calls.length).toBe(before)
  })
})

describe("script permission parity, access read-only", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ options: { access: "read-only" } })
    await listed(host)
    await until("the policy is ready", async () => host.state().policy().installation === "ready")
  })
  afterAll(() => host?.close())

  test("billable inference and feedback are denied on both paths with zero dispatch; a read still runs", async () => {
    const sessionID = await session(host)
    for (const method of ["send-message", "send-feedback"]) {
      expect(await script(host, method, { sessionID, input: {} })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
      expect(await attempt(host, sessionID, "build", method, "always")).toMatchObject({ asked: undefined, ok: false })
    }
    expect(host.fake.calls).toEqual([])
    expect(await script(host, "ping", { sessionID, input: {} })).toMatchObject({ output: { text: "synthetic ping" } })
    expect(host.fake.calls).toEqual(["ping"])
  })
})

// Under ask-changes the guard holds calls while the rules are not in place. The build agent's own allow makes every
// method allowed, so only the guard refuses them.
describe("a failed policy installation on the script path, under ask-changes", () => {
  let fault: "register" | "apply" | undefined = "register"
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: () => ({ agents: { build: { permissions: [{ action: "openrouter_*", resource: "*", effect: "allow" }] } } }), policyFault: () => fault })
    await listed(host)
  })
  afterAll(() => host?.close())

  test("at setup, every method fails with POLICY_UNAVAILABLE, data.code and data.next, and nothing is sent", async () => {
    expect(host.state().policy().installation).toBe("failed")
    const sessionID = await session(host)
    for (const method of RPC_TOOLS) {
      const result = await script(host, method, { sessionID, input: {} })
      expect({ method, type: result.type, code: result.code }).toEqual({ method, type: "failed", code: "POLICY_UNAVAILABLE" })
      expect(result.next).toBe("Restart OpenCode; if it fails again, run /plugins to see the error.")
      expect(result.message).toMatch(/^POLICY_UNAVAILABLE: OpenRouter's default permission rules could not be applied .+\. Next step: Restart OpenCode/)
    }
    expect(host.fake.calls).toEqual([])
  })
})

describe("a policy failure on a replay, on the script path, under ask-changes", () => {
  let fault: "apply" | undefined
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: () => ({ agents: { build: { permissions: [{ action: "openrouter_*", resource: "*", effect: "allow" }] } } }), policyFault: () => fault })
    await listed(host)
    await until("the policy is ready", async () => host.state().policy().installation === "ready")
  })
  afterAll(() => host?.close())

  test("blocks every method with zero dispatch, and a good replay restores them", async () => {
    const sessionID = await session(host)
    expect(await script(host, "ping", { sessionID, input: {} })).toMatchObject({ output: { text: "synthetic ping" } })
    const before = host.fake.calls.length
    fault = "apply"
    await host.probe().agent.reload()
    await until("the replay failed", async () => host.state().policy().installation === "failed")
    for (const method of ["ping", "send-message", "send-feedback"]) expect(await script(host, method, { sessionID, input: {} })).toMatchObject({ type: "failed", code: "POLICY_UNAVAILABLE" })
    expect(host.fake.calls.length).toBe(before)
    fault = undefined
    await host.probe().agent.reload()
    await until("the replay succeeded", async () => host.state().policy().installation === "ready")
    expect(await script(host, "ping", { sessionID, input: {} })).toMatchObject({ output: { text: "synthetic ping" } })
    expect(host.fake.calls.slice(before)).toEqual(["ping"])
  })
})

describe("a failed policy installation on the script path, under the default access, all", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ options: {}, policyFault: () => "register" })
    await listed(host)
  })
  afterAll(() => host?.close())

  test("holds nothing back: every method runs once, paid calls included, with no rule of the plugin's", async () => {
    expect(host.state().options.access).toBe("all")
    expect(host.state().policy()).toEqual({ installation: "failed", problems: [] })
    const sessionID = await session(host)
    for (const method of RPC_TOOLS) expect({ method, result: await script(host, method, { sessionID, input: {} }) }).toMatchObject({ method, result: { output: { text: `synthetic ${method}` } } })
    expect(host.fake.calls).toEqual([...RPC_TOOLS])
  })
})
