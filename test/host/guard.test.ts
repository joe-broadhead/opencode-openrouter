// The default permission rules and the operational guard on the public @opencode/sdk host, against the loopback fake,
// counting the fake's actual `tools/call` requests: what asks, what is denied and what runs under each access; that a
// later user rule wins; that a failed policy installation (at setup, on a replay and after the plugin is loaded again)
// refuses every native call before anything is sent; that the guard is on every tool before any listing exposes it,
// at startup and after a late sign-in and a catalog rebuild; that replays add no second guard; and that text and an
// image block pass through it unchanged. Each describe owns one host.
import "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { SERVER_NAME } from "../../src/constants.js"
import { IMAGE_TOOL } from "../../src/guard.js"
import { nativeToolId } from "../../src/mcp.js"
import { BILLABLE_TOOLS, CHANGE_TOOLS, READ_TOOLS, TOOL_NAMES } from "../../src/openrouter-tools.js"
import { defaultRules } from "../../src/permissions.js"
import { createOpenRouterPlugin } from "../../src/plugin.js"
import { IMAGE_PNG, NEW_TOOL } from "./fake-mcp.js"
import { agentRules, attempt, cleanup, describeError, effect, HOST_VERSION, integration, serverRow, session, startHost, until, type Host, type Rule } from "./harness.js"

setDefaultTimeout(300_000)
afterAll(cleanup)

const BUILT_IN = ["build", "general", "explore", "compaction", "title", "summary", "plan"]
const FEEDBACK = CHANGE_TOOLS.filter((name) => !BILLABLE_TOOLS.includes(name))
const ALL_TOOLS = [...TOOL_NAMES, NEW_TOOL]
/** A declined prompt: the host's error, wrapped by the plugin's executor, with the decline the session loop looks for. */
const DECLINED = "Tool.Error:  [Permission.DeclinedError]"
const denied = (tool: string) => `Tool.Error: Permission denied: ${nativeToolId(tool)} [Permission.BlockedError]`
const POLICY = /^Tool\.Error: POLICY_UNAVAILABLE: .+ Next step: .+/

/** Every OpenRouter tool the host lists, once the server's catalog is in. */
const listed = (host: Host) =>
  until("OpenRouter's tools are listed", async () => {
    const tools = (await host.probe().tool.list()).filter((tool) => tool.id.startsWith(`${SERVER_NAME}_`))
    return tools.length === ALL_TOOLS.length && tools
  })

type Executor = (input: unknown, context: unknown) => Promise<unknown>

/**
 * A probe tool transform, registered in the probe plugin's setup, after the OpenRouter plugin's. On every pass it keeps
 * the executors of the OpenRouter tools as the registry holds them at that point: what any later transform, and the
 * listing the host builds once every transform has run, receives.
 */
function passRecorder() {
  const passes: Map<string, Executor>[] = []
  return {
    passes,
    setup: async (ctx: Plugin.Context) => {
      await ctx.tool.transform((editor) => {
        const seen = new Map<string, Executor>()
        for (const tool of editor.list()) if (tool.id.startsWith(`${SERVER_NAME}_`)) seen.set(tool.id, tool.execute as Executor)
        if (seen.size) passes.push(seen)
      })
    },
  }
}

/** Calls an executor with `context` and reports `ran` or the error. */
const call0 = (executor: Executor, context: object) =>
  executor({}, context).then(
    () => "ran",
    (error: unknown) => describeError(error),
  )

let direct = 0
/** Calls a captured executor directly, as the host would for a listed tool, in a real session. */
async function call(host: Host, executor: Executor, agent = "build") {
  const sessionID = await session(host, agent)
  return call0(executor, { sessionID, agent, messageID: "msg_guard_pass", id: `call_guard_pass_${++direct}`, signal: new AbortController().signal, progress: async () => {} })
}

const mcp = (host: Host) => host.client.mcp as unknown as Record<"connect" | "disconnect", (input: object) => Promise<unknown>>

describe(`the default access, ask-changes, on OpenCode ${HOST_VERSION}`, () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost()
    await listed(host)
    await until("the policy is ready", async () => host.state().policy().installation === "ready")
  })
  afterAll(() => host?.close())

  test("the block sits right after the base allow in every built-in agent, once, and the plugin is operational", async () => {
    const rules = await agentRules(host)
    for (const id of BUILT_IN) {
      const permissions = rules.get(id)!
      const base = permissions.findIndex((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")
      expect({ id, base }).toEqual({ id, base: 0 })
      expect(permissions.slice(base + 1, base + 1 + defaultRules("ask-changes").length)).toEqual(defaultRules("ask-changes"))
      expect(permissions.filter((rule) => rule.action === `${SERVER_NAME}_*`)).toHaveLength(1)
    }
    expect(host.state().policy()).toEqual({ installation: "ready", problems: [] })
    expect(await host.state().unguardedAgents()).toEqual([])
    expect(() => host.state().assertOperational()).not.toThrow()
  })

  test("reads run without a prompt and reach the server once each", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    for (const tool of READ_TOOLS) expect({ tool, result: await attempt(host, build, "build", tool) }).toMatchObject({ tool, result: { asked: undefined, ok: true } })
    expect(host.fake.calls.slice(before)).toEqual([...READ_TOOLS])
  })

  test("billable inference, feedback and an unreviewed tool ask, and a declined prompt sends nothing", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    for (const tool of [...BILLABLE_TOOLS, ...FEEDBACK, NEW_TOOL]) {
      expect({ tool, result: await attempt(host, build, "build", tool) }).toEqual({ tool, result: { asked: nativeToolId(tool), ok: false, error: DECLINED } })
    }
    expect(host.fake.calls.length).toBe(before)
  })

  test("an approved prompt runs the call exactly once", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    expect(await attempt(host, build, "build", "send-message", "once")).toMatchObject({ asked: nativeToolId("send-message"), ok: true })
    expect(host.fake.calls.slice(before)).toEqual(["send-message"])
  })

  test("generate-image is a direct tool, outside Code Mode, and its text and image block pass through the guard unchanged", async () => {
    const image = (await listed(host)).find((tool) => tool.id === IMAGE_TOOL)!
    expect(image.options).toEqual({ namespace: SERVER_NAME, codemode: false })
    // Every other OpenRouter tool stays in Code Mode.
    expect((await listed(host)).filter((tool) => tool.options?.codemode === false).map((tool) => tool.id)).toEqual([IMAGE_TOOL])
    const build = await session(host)
    const before = host.fake.calls.length
    const outcome = await attempt(host, build, "build", "generate-image", "once")
    expect(outcome).toMatchObject({ asked: IMAGE_TOOL, ok: true })
    expect(host.fake.calls.slice(before)).toEqual(["generate-image"])
    expect((outcome as { result: unknown }).result).toEqual({
      output: "synthetic generate-image",
      content: [
        { type: "text", text: "synthetic generate-image" },
        { type: "file", uri: `data:image/png;base64,${IMAGE_PNG}`, mime: "image/png" },
      ],
    })
  })

  test("repeated rebuilds keep one block per agent, one guard per tool and one dispatch per call", async () => {
    for (let index = 0; index < 3; index++) {
      await host.probe().tool.reload()
      await host.probe().agent.reload()
    }
    const rules = await agentRules(host)
    for (const id of BUILT_IN) expect({ id, count: rules.get(id)!.filter((rule) => rule.action === `${SERVER_NAME}_*`).length }).toEqual({ id, count: 1 })
    const build = await session(host)
    const [checks, before] = [host.checks.count, host.fake.calls.length]
    expect(await attempt(host, build, "build", "ping")).toMatchObject({ asked: undefined, ok: true })
    expect(host.checks.count - checks).toBe(1)
    expect(host.fake.calls.slice(before)).toEqual(["ping"])
  })
})

describe("access read-only", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ options: { access: "read-only" } })
    await listed(host)
    await until("the policy is ready", async () => host.state().policy().installation === "ready")
  })
  afterAll(() => host?.close())

  test("denies a tool OpenRouter added later, billable inference and feedback, and sends nothing", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    for (const tool of [NEW_TOOL, ...CHANGE_TOOLS]) {
      expect({ tool, effect: await effect(host, "build", nativeToolId(tool)) }).toEqual({ tool, effect: "deny" })
      expect({ tool, result: await attempt(host, build, "build", tool, "always") }).toEqual({ tool, result: { asked: undefined, ok: false, error: denied(tool) } })
    }
    expect(host.fake.calls.length).toBe(before)
  })

  test("still runs a read once", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    expect(await attempt(host, build, "build", "list-models")).toMatchObject({ asked: undefined, ok: true })
    expect(host.fake.calls.slice(before)).toEqual(["list-models"])
  })
})

describe("the user's later rules", () => {
  const userRules: Rule[] = [{ action: nativeToolId("list-models"), resource: "*", effect: "deny" }]
  const agentAllow: Rule = { action: nativeToolId("send-message"), resource: "*", effect: "allow" }
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: () => ({ permissions: userRules, agents: { build: { permissions: [agentAllow] } } }) })
    await listed(host)
    await until("the policy is ready", async () => host.state().policy().installation === "ready")
  })
  afterAll(() => host?.close())

  test("a user deny on a read wins over the block, and sends nothing", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    expect(await attempt(host, build, "build", "list-models")).toEqual({ asked: undefined, ok: false, error: denied("list-models") })
    expect(host.fake.calls.length).toBe(before)
  })

  test("an agent's own allow on billable inference wins too: an intentional decision, and not an unguarded agent", async () => {
    const build = await session(host)
    const before = host.fake.calls.length
    expect(await attempt(host, build, "build", "send-message")).toMatchObject({ asked: undefined, ok: true })
    expect(host.fake.calls.slice(before)).toEqual(["send-message"])
    // The other billable tool still asks.
    expect(await attempt(host, build, "build", "generate-image")).toMatchObject({ asked: IMAGE_TOOL, ok: false })
    expect(await host.state().unguardedAgents()).toEqual([])
  })
})

describe("a permission-registration failure at setup", () => {
  const recorder = passRecorder()
  let host: Host
  let first: Promise<{ emptyListings: number; outcomes: Record<string, string> }> | undefined
  beforeAll(async () => {
    host = await startHost({
      policyFault: () => "register",
      early: true,
      probeSetup: async (ctx) => {
        await recorder.setup(ctx)
        // From the probe's setup on, watch the listing, and call every OpenRouter tool of the first listing that holds
        // any. The guard refuses before the host looks at the session, so the calls need no real one.
        first = (async () => {
          for (let emptyListings = 0; ; emptyListings++) {
            const tools = (await ctx.tool.list()).filter((item) => item.id.startsWith(`${SERVER_NAME}_`))
            if (tools.length) {
              const outcomes: Record<string, string> = {}
              for (const tool of tools) {
                const context = { sessionID: "ses_watch", agent: "build", messageID: "msg_watch", id: `call_watch_${tool.id}`, signal: new AbortController().signal, progress: async () => {} }
                outcomes[tool.id] = await call0(tool.execute as Executor, context)
              }
              return { emptyListings, outcomes }
            }
            await Bun.sleep(2)
          }
        })()
      },
    })
    await listed(host)
  })
  afterAll(() => host?.close())

  test("leaves the plugin active and blocked, with the problem for status", async () => {
    const { data: plugins } = await host.client.plugin.list({ location: host.location })
    expect(plugins.find((plugin) => plugin.id === "openrouter.models")?.state).toEqual({ status: "active" })
    const policy = host.state().policy()
    expect(policy.installation).toBe("failed")
    expect(policy.problems).toEqual([
      "POLICY_UNAVAILABLE: OpenRouter's default permission rules could not be applied (injected registration failure), so the plugin blocks its tools before anything is sent. Next step: Restart OpenCode; if it fails again, run /plugins to see the error.",
    ])
    expect(() => host.state().assertOperational()).toThrow(/^POLICY_UNAVAILABLE: /)
  })

  test("the first listing that holds OpenRouter's tools, watched from before the server connected, refuses them all before anything is sent", async () => {
    const seen = await first!
    expect(seen.emptyListings).toBeGreaterThan(0)
    expect(Object.keys(seen.outcomes).length).toBeGreaterThan(0)
    for (const [id, outcome] of Object.entries(seen.outcomes)) expect({ id, outcome }).toEqual({ id, outcome: expect.stringMatching(POLICY) })
    expect(host.fake.calls).toEqual([])
  })

  test("every native call, reads included, fails with POLICY_UNAVAILABLE before any prompt and sends nothing", async () => {
    const build = await session(host)
    for (const tool of ALL_TOOLS) {
      const result = await attempt(host, build, "build", tool, "once")
      expect({ tool, asked: result.asked, ok: result.ok }).toEqual({ tool, asked: undefined, ok: false })
      expect((result as { error: string }).error).toMatch(POLICY)
    }
    expect(host.fake.calls).toEqual([])
  })

  test("every registry pass that held OpenRouter's tools handed on guarded executors", async () => {
    expect(recorder.passes.length).toBeGreaterThan(0)
    for (const pass of recorder.passes) {
      for (const [id, executor] of pass) expect({ id, outcome: await call(host, executor) }).toEqual({ id, outcome: expect.stringMatching(POLICY) })
    }
    expect(host.fake.calls).toEqual([])
  })
})

describe("a permission failure on a replay and after the plugin is loaded again", () => {
  let fault: "register" | "apply" | undefined
  let host: Host
  beforeAll(async () => {
    host = await startHost({ policyFault: () => fault })
    await listed(host)
    await until("the policy is ready", async () => host.state().policy().installation === "ready")
  })
  afterAll(() => host?.close())

  test("a failed replay blocks every call with zero dispatch, and a good replay restores them", async () => {
    const build = await session(host)
    expect(await attempt(host, build, "build", "ping")).toMatchObject({ ok: true })
    const before = host.fake.calls.length
    fault = "apply"
    await host.probe().agent.reload()
    await until("the replay failed", async () => host.state().policy().installation === "failed")
    for (const tool of ["ping", "send-message", NEW_TOOL]) {
      const result = await attempt(host, build, "build", tool, "once")
      expect({ tool, asked: result.asked, ok: result.ok }).toEqual({ tool, asked: undefined, ok: false })
      expect((result as { error: string }).error).toMatch(POLICY)
    }
    expect(host.fake.calls.length).toBe(before)
    fault = undefined
    await host.probe().agent.reload()
    await until("the replay succeeded", async () => host.state().policy().installation === "ready")
    expect(await attempt(host, build, "build", "ping")).toMatchObject({ asked: undefined, ok: true })
    expect(host.fake.calls.slice(before)).toEqual(["ping"])
  })

  test("the plugin loaded again with a failing registration blocks with zero dispatch, then recovers on a good replay", async () => {
    fault = "register"
    const generations = host.cleanups.finished
    await host.client.plugin(createOpenRouterPlugin(host.seam))
    await until("the plugin is loaded again", async () => host.state().policy().installation === "failed")
    expect(host.cleanups.finished).toBe(generations + 1)
    await listed(host)
    const build = await session(host)
    const before = host.fake.calls.length
    for (const tool of ["ping", "generate-image"]) {
      const result = await attempt(host, build, "build", tool, "once")
      expect({ tool, asked: result.asked, ok: result.ok }).toEqual({ tool, asked: undefined, ok: false })
      expect((result as { error: string }).error).toMatch(POLICY)
    }
    expect(host.fake.calls.length).toBe(before)
    // The registration itself failed, so a replay has no rules to apply: only loading the plugin again recovers.
    fault = undefined
    await host.client.plugin(createOpenRouterPlugin(host.seam))
    await until("the policy is ready again", async () => host.state().policy().installation === "ready")
    expect(await attempt(host, build, "build", "ping")).toMatchObject({ asked: undefined, ok: true })
    expect(host.fake.calls.slice(before)).toEqual(["ping"])
  })
})

describe("a late sign-in and a catalog rebuild", () => {
  const recorder = passRecorder()
  let fault: "apply" | undefined
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true, fake: { challenge: true }, probeSetup: recorder.setup, policyFault: () => fault })
    await until("the server needs a sign-in", async () => (await serverRow(host))?.status.status === "needs_auth")
  })
  afterAll(() => host?.close())

  test("before the sign-in no OpenRouter tool is listed", async () => {
    expect((await host.probe().tool.list()).filter((tool) => tool.id.startsWith(`${SERVER_NAME}_`))).toEqual([])
    expect(recorder.passes).toEqual([])
  })

  test("every tool the sign-in brings in is guarded from the first pass that holds it", async () => {
    const id = (await serverRow(host))!.integrationID!
    const entry = (await integration(host, id))!
    const oauth = (host.client.integration as unknown as { oauth: Record<"connect", (input: object) => Promise<{ data: { url: string } }>> }).oauth
    const { data: started } = await oauth.connect({ integrationID: id, methodID: entry.methods[0]!.id, location: host.location })
    const redirect = await fetch(started.url, { redirect: "manual" })
    await fetch(redirect.headers.get("location")!)
    await until("the sign-in stores a token", async () => host.fake.tokens.length === 1)
    host.fake.challenge = false
    await mcp(host).connect({ server: SERVER_NAME, location: host.location }).catch(() => {})
    await until("the server connects", async () => (await serverRow(host))?.status.status === "connected")
    await listed(host)
    expect(recorder.passes.length).toBeGreaterThan(0)

    // Block the plugin through a failed replay; every executor any pass handed on must now refuse before dispatch.
    fault = "apply"
    await host.probe().agent.reload()
    await until("the replay failed", async () => host.state().policy().installation === "failed")
    const before = host.fake.calls.length
    for (const pass of recorder.passes) {
      for (const [tool, executor] of pass) expect({ tool, outcome: await call(host, executor) }).toEqual({ tool, outcome: expect.stringMatching(POLICY) })
    }
    expect(host.fake.calls.length).toBe(before)
    fault = undefined
    await host.probe().agent.reload()
    await until("the replay succeeded", async () => host.state().policy().installation === "ready")
  })

  test("a disconnect and reconnect rebuilds the catalog guarded, with one guard and one dispatch per call", async () => {
    const seen = recorder.passes.length
    await mcp(host).disconnect({ server: SERVER_NAME, location: host.location })
    await until("the tools are gone", async () => !(await host.probe().tool.list()).some((tool) => tool.id.startsWith(`${SERVER_NAME}_`)))
    await mcp(host).connect({ server: SERVER_NAME, location: host.location })
    await until("the server is connected again", async () => (await serverRow(host))?.status.status === "connected")
    await listed(host)
    const rebuilt = recorder.passes.slice(seen)
    expect(rebuilt.length).toBeGreaterThan(0)

    const build = await session(host)
    const [checks, before] = [host.checks.count, host.fake.calls.length]
    expect(await attempt(host, build, "build", "ping")).toMatchObject({ asked: undefined, ok: true })
    expect(host.checks.count - checks).toBe(1)
    expect(host.fake.calls.slice(before)).toEqual(["ping"])

    fault = "apply"
    await host.probe().agent.reload()
    await until("the replay failed", async () => host.state().policy().installation === "failed")
    for (const pass of rebuilt) {
      for (const [tool, executor] of pass) expect({ tool, outcome: await call(host, executor) }).toEqual({ tool, outcome: expect.stringMatching(POLICY) })
    }
    expect(host.fake.calls.length).toBe(before + 1)
    fault = undefined
    await host.probe().agent.reload()
  })
})
