// The status surfaces on the public @opencode/sdk host: the status RPC `openrouter.models` / `status` and
// `/openrouter-status` read the same model from local state, and neither sends anything to the loopback fake. Each
// describe owns one host: connected, needing a sign-in, with a failed policy, a conflicting entry and a disabled one.
import "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { PLUGIN_ID, SERVER_NAME, SUPPORTED_HOST, TESTED_HOSTS } from "../../src/constants.js"
import { TOOL_NAMES } from "../../src/openrouter-tools.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { StatusRpc } from "../../src/status.js"
import { NEW_TOOL } from "./fake-mcp.js"
import { cleanup, HOST_VERSION, serverRow, session, startHost, until, type Host } from "./harness.js"

setDefaultTimeout(300_000)
afterAll(cleanup)

type StatusOutput = Record<string, any>
const statusRpc = (host: Host) =>
  (host.client.rpc as unknown as (definition: typeof StatusRpc) => { status: (input: object, options: object) => Promise<StatusOutput> })(StatusRpc).status({}, { location: host.location })

/** Runs /openrouter-status in a fresh session and returns the text it posted. */
async function command(host: Host) {
  const sessionID = await session(host)
  await host.client.sessions.command({ sessionID, name: "openrouter-status", text: "" })
  return until("/openrouter-status posts its text", async () => {
    const inbox = await host.client.session.inbox.list({ sessionID })
    const posted = inbox.findLast((item) => item.type === "synthetic")
    return posted?.type === "synthetic" ? posted.payload.text : undefined
  })
}

const listedAll = (host: Host) =>
  until("OpenRouter's tools are listed", async () => (await host.probe().tool.list()).filter((tool) => tool.id.startsWith(`${SERVER_NAME}_`)).length === TOOL_NAMES.length + 1)

describe(`status of a connected server on OpenCode ${HOST_VERSION}`, () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost()
    await listedAll(host)
    await until("the policy is ready", async () => host.state().policy().installation === "ready")
  })
  afterAll(() => host?.close())

  test("the RPC reports the connection, the catalog, the script capability and the skills, and nothing to do", async () => {
    const before = host.fake.calls.length
    const status = await until("status sees the catalog", async () => {
      const output = await statusRpc(host)
      return output.catalog.state === "ready" && output.catalog.observed === TOOL_NAMES.length + 1 ? output : undefined
    })
    expect(status).toMatchObject({
      host: { version: HOST_VERSION, range: SUPPORTED_HOST, tested: TESTED_HOSTS.includes(HOST_VERSION) },
      state: "connected",
      access: "ask-changes",
      source: "plugin",
      catalog: { state: "ready", observed: 18, reviewedPresent: 17, unknownCount: 1, unknown: [NEW_TOOL], missingReviewed: [] },
      scripting: { reviewedMethodCount: 16, nativeOnly: ["generate-image"], liveVerifiedCount: 0 },
      policy: { installation: "ready" },
      skills: SKILL_NAMES.map((name) => ({ name, state: "loaded" })),
      unguardedAgents: [],
      problems: [],
      nextStep: "Nothing to do.",
    })
    // A real observation time, from the plugin's own tool transform.
    expect(Date.parse(status.catalog.lastObservedAt)).toBeGreaterThan(0)
    // Status reads local state only: nothing reached the server.
    expect(host.fake.calls.length).toBe(before)
  })

  test("/openrouter-status posts the same model as text, with no model turn and no call to the server", async () => {
    const before = host.fake.calls.length
    const text = await command(host)
    expect(text.split("\n")[0]).toBe("OpenRouter status")
    expect(text).toContain("- Connection: connected (registered by this plugin)\n")
    expect(text).toContain(`- Tools: 18 listed, 17 reviewed, 1 unknown: ${NEW_TOOL} (asked about, never a script method); last seen `)
    expect(text).toContain("- Scripts: 16 methods through openrouter.models.tools, output checked against a test server only")
    expect(text).toContain("- Skills: 4 of 4 loaded\n")
    expect(text).toContain("- Next step: Nothing to do.")
    expect(host.fake.calls.length).toBe(before)
  })
})

describe("status of a server that needs a sign-in", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true, fake: { challenge: true } })
    await until("the server needs a sign-in", async () => (await serverRow(host))?.status.status === "needs_auth")
  })
  afterAll(() => host?.close())

  test("is sign_in_required with the native sign-in as the next step, and never shows the host's auth text", async () => {
    const status = await statusRpc(host)
    expect(status).toMatchObject({ state: "sign_in_required", catalog: { state: "unavailable", observed: 0 } })
    expect(status.nextStep).toStartWith("Run /connect and choose OpenRouter tools")
    expect(status).not.toHaveProperty("error")
    const text = JSON.stringify(status) + (await command(host))
    for (const secret of ["oauth/authorize", "code_challenge", "client_id", host.fake.origin]) expect(text).not.toContain(secret)
    // No sign-in was started by reading status.
    expect(host.fake.registrations).toEqual([])
    expect(host.fake.calls).toEqual([])
  })
})

describe("status of a failed policy installation", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ policyFault: () => "register" })
  })
  afterAll(() => host?.close())

  test("is policy_unavailable with the POLICY_UNAVAILABLE problem and its one corrective step", async () => {
    const status = await statusRpc(host)
    expect(status).toMatchObject({ state: "policy_unavailable", policy: { installation: "failed" } })
    expect(status.problems.map((problem: { code: string }) => problem.code)).toEqual(["POLICY_UNAVAILABLE"])
    expect(status.nextStep).toBe("Restart OpenCode; if it fails again, run /plugins to see the error.")
    expect(await command(host)).toContain("- Connection: blocked: the plugin's policy is not in place")
    expect(host.fake.calls).toEqual([])
  })
})

describe("status of a conflicting and of a disabled user entry", () => {
  let conflict: Host
  let disabled: Host
  beforeAll(async () => {
    conflict = await startHost({ config: (url) => ({ mcp: { servers: { openrouter: { type: "remote", url: url.replace(/\/mcp$/, "/other"), oauth: false } } } }) })
    disabled = await startHost({ config: (url) => ({ mcp: { servers: { openrouter: { type: "remote", url, oauth: false, disabled: true } } } }) })
  })
  afterAll(async () => {
    await conflict?.close()
    await disabled?.close()
  })

  test("a conflict names the entry and is the next step, and its server's tools are not OpenRouter's catalog", async () => {
    const status = await until("status sees the conflict", async () => {
      const output = await statusRpc(conflict)
      return output.state === "conflict" ? output : undefined
    })
    expect(status).toMatchObject({ source: "conflict", catalog: { state: "unavailable", observed: 0 } })
    expect(status.problems.map((problem: { code: string }) => problem.code)).toContain("SERVER_CONFLICT")
    expect(status.nextStep).toStartWith("Set mcp.servers.openrouter.url to exactly ")
  })

  test("a disabled entry stays disabled and says how to enable it", async () => {
    const status = await statusRpc(disabled)
    expect(status).toMatchObject({ state: "disabled", source: "disabled" })
    expect(status.nextStep).toBe('Enable the openrouter server in /mcps, or remove "disabled": true from mcp.servers.openrouter in opencode.json.')
    expect(StatusRpc.id).toBe(PLUGIN_ID)
  })
})
