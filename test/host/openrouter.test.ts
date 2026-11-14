// The plugin on the public @opencode/sdk host, against the loopback fake: it loads and registers the server; native
// tool ids keep their hyphens and reach the server under the upstream name; the server needs a sign-in until one
// happens, and OpenCode's own OAuth starts it; the /connect entry is the MCP server's, named "OpenRouter tools", and is
// not the built-in OpenRouter model provider's; adoption, conflict and a disabled entry; and unload. Each describe owns
// one host.
import "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Plugin } from "@opencode/plugin"
import { DISPLAY_NAME, NAMESPACE_DESCRIPTION, PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { SIGN_IN_AGAIN } from "../../src/integration.js"
import { nativeToolId } from "../../src/mcp.js"
import { TOOL_NAMES } from "../../src/openrouter-tools.js"
import { NEW_TOOL } from "./fake-mcp.js"
import { cleanup, HOST_VERSION, integration, serverRow, startHost, until, type Host } from "./harness.js"

setDefaultTimeout(300_000)
afterAll(cleanup)

const KEY = "sk-or-v1-fakehosttest0123456789abcdef"
/** The built-in model provider's integration ID: OpenCode uses the provider's own ID. */
const PROVIDER_INTEGRATION = "openrouter"

const toolIds = (host: Host) =>
  until("OpenRouter's tools are registered", async () => {
    const ids = (await host.probe().tool.list()).map((tool) => tool.id).filter((id) => id.startsWith(`${SERVER_NAME}_`))
    return ids.length === TOOL_NAMES.length + 1 && ids.sort()
  })

let calls = 0
/** Runs a native tool through the host's own executor, as a model turn would, and returns how it ended. */
async function run(host: Host, id: string) {
  const executor = await until(`${id} is registered`, async () => (await host.probe().tool.list()).find((item) => item.id === id))
  const session = await host.client.sessions.create({ agent: "build", location: host.location })
  const context = { sessionID: session.id, agent: "build", messageID: "msg_host_test", id: `call_host_test_${++calls}`, signal: new AbortController().signal, progress: async () => {} }
  return executor.execute({}, context as never).then(
    (result: unknown) => ({ ok: true as const, result }),
    (error: unknown) => ({ ok: false as const, error: String(error) }),
  )
}

describe(`the plugin on OpenCode ${HOST_VERSION}`, () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost()
  })
  afterAll(() => host?.close())

  test("is active, registers openrouter as its own server, and the server connects", async () => {
    const { data: plugins } = await host.client.plugin.list({ location: host.location })
    expect(plugins.find((plugin) => plugin.id === PLUGIN_ID)?.state).toEqual({ status: "active" })
    expect((await serverRow(host))?.status).toEqual({ status: "connected" })
    expect(host.state().server()).toEqual({ source: { type: "plugin" }, duplicates: [], collisions: [], problems: [] })
    expect(host.state().owned()).toBe(true)
    expect(host.state().options).toEqual({ access: "all", allowUntestedHost: false })
    expect(host.state().host).toMatchObject({ version: HOST_VERSION, tested: true })
  })

  test("native tool ids keep the upstream hyphens, the unknown tool included", async () => {
    expect(await toolIds(host)).toEqual([...TOOL_NAMES, NEW_TOOL].map(nativeToolId).sort())
    expect(await toolIds(host)).toContain("openrouter_send-message")
    expect(await toolIds(host)).not.toContain("openrouter_send_message")
  })

  test("a native call reaches the server under the upstream name, hyphens included", async () => {
    const outcome = await run(host, "openrouter_list-models")
    expect(outcome.ok).toBe(true)
    expect(host.fake.calls).toEqual(["list-models"])
  })

  test("the Code Mode namespace carries the plugin's description", async () => {
    const tools = await host.probe().tool.list()
    const listed = tools.find((tool) => tool.id === "openrouter_ping")
    expect(listed?.options?.namespace).toBe(SERVER_NAME)
    expect(NAMESPACE_DESCRIPTION).toContain('tools["openrouter"]["list-models"]')
  })

  test("unloading the plugin runs its cleanup and removes the server", async () => {
    // Registering a plugin with the same ID replaces the old generation, which disposes everything it registered.
    await host.client.plugin(Plugin.define({ id: PLUGIN_ID, setup: () => {} }))
    await until("the cleanup has run", async () => host.cleanups.finished === 1)
    await until("the openrouter server is gone", async () => !(await serverRow(host)))
    expect(host.cleanups.started).toBe(1)
  })
})

describe("a server that needs a sign-in", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true, fake: { challenge: true } })
  })
  afterAll(() => host?.close())

  test("reports sign-in required through the host's own MCP state", async () => {
    const row = await until("the server needs a sign-in", async () => {
      const found = await serverRow(host)
      return found?.status.status === "needs_auth" ? found : undefined
    })
    expect(row.status.status).toBe("needs_auth")
    expect(host.state().server().source).toEqual({ type: "plugin" })
  })

  test("its /connect entry is the MCP server's own, named OpenRouter tools, and not the model provider's", async () => {
    const row = (await serverRow(host))!
    const id = row.integrationID!
    expect(id).toMatch(/^mcp_[0-9a-f]{16}$/)
    expect(id).not.toBe(PROVIDER_INTEGRATION)
    const entry = await until("the entry is named OpenRouter tools", async () => {
      const found = await integration(host, id)
      return found?.name === DISPLAY_NAME ? found : undefined
    })
    expect(entry.metadata?.source).toBe("mcp")
    expect(entry.methods.map((method) => method.type)).toEqual(["oauth"])
    // The built-in model provider has its own integration, with key and environment methods; the plugin never renames it.
    const provider = await integration(host, PROVIDER_INTEGRATION)
    expect(provider).toMatchObject({ id: PROVIDER_INTEGRATION, name: "OpenRouter" })
    expect(provider!.methods.map((method) => method.type).sort()).toEqual(["env", "key"])
    expect(provider!.metadata?.source).toBeUndefined()
    const { data: all } = await host.client.integration.list({ location: host.location })
    expect((all as { id: string; name: string }[]).filter((item) => item.name === DISPLAY_NAME).map((item) => item.id)).toEqual([id])
  })

  test("OpenCode's own sign-in starts: dynamic registration and PKCE S256 against the server's sign-in server, no plugin pins", async () => {
    const id = (await serverRow(host))!.integrationID!
    const entry = (await integration(host, id))!
    const oauth = (host.client.integration as unknown as { oauth: Record<"connect" | "cancel", (input: object) => Promise<{ data: { attemptID: string; url: string } }>> }).oauth
    const { data: attempt } = await oauth.connect({ integrationID: id, methodID: entry.methods[0]!.id, location: host.location })
    try {
      const url = new URL(attempt.url)
      expect(`${url.origin}${url.pathname}`).toBe(`${host.fake.origin}/oauth/authorize`)
      expect(url.searchParams.get("code_challenge_method")).toBe("S256")
      expect(url.searchParams.get("client_id")).toBe("fake-client-1")
      expect(url.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
      expect(host.fake.registrations).toHaveLength(1)
      expect(host.fake.tokens).toHaveLength(0)
    } finally {
      await oauth.cancel({ integrationID: id, attemptID: attempt.attemptID, location: host.location }).catch(() => {})
    }
  })

  test("after a sign-in that stops working, the plugin marks the account and clears only its own mark", async () => {
    const id = (await serverRow(host))!.integrationID!
    const entry = (await integration(host, id))!
    const oauth = (host.client.integration as unknown as { oauth: Record<"connect", (input: object) => Promise<{ data: { url: string } }>> }).oauth
    const { data: attempt } = await oauth.connect({ integrationID: id, methodID: entry.methods[0]!.id, location: host.location })
    const redirect = await fetch(attempt.url, { redirect: "manual" })
    await fetch(redirect.headers.get("location")!)
    await until("the sign-in stores a token", async () => host.fake.tokens.length === 1)
    host.fake.challenge = false
    const mcp = host.client.mcp as unknown as Record<"connect" | "disconnect", (input: object) => Promise<unknown>>
    await mcp.connect({ server: SERVER_NAME, location: host.location }).catch(() => {})
    await until("the server connects with the token", async () => (await serverRow(host))?.status.status === "connected")
    expect(host.fake.authorizations).toContain("Bearer fake-access-1")
    // The token stops working: there is no refresh token, so the person must sign in again.
    host.fake.challenge = true
    await mcp.disconnect({ server: SERVER_NAME, location: host.location })
    await mcp.connect({ server: SERVER_NAME, location: host.location }).catch(() => {})
    await until("the server needs a sign-in again", async () => (await serverRow(host))?.status.status === "needs_auth")
    const marked = await until("/connect marks the account", async () => (await integration(host, id))?.connections?.find((item) => item.status?.message === SIGN_IN_AGAIN))
    expect(marked.status).toEqual({ status: "needs_auth", message: SIGN_IN_AGAIN })
    host.fake.challenge = false
    await mcp.connect({ server: SERVER_NAME, location: host.location })
    await until("the server connects again", async () => (await serverRow(host))?.status.status === "connected")
    expect(await until("/connect clears the mark", async () => ((await integration(host, id))?.connections?.some((item) => item.status?.message) ? undefined : true))).toBe(true)
  })

  test("unloading keeps the credential: the plugin registered again connects with the same token, with no new sign-in", async () => {
    await host.client.plugin(Plugin.define({ id: PLUGIN_ID, setup: () => {} }))
    await until("the openrouter server is gone", async () => !(await serverRow(host)))
    const before = host.fake.tokens.length
    const again = (await import("../../src/plugin.js")).createOpenRouterPlugin({ endpoint: host.fake.url })
    await host.client.plugin(again)
    await until("the server connects again", async () => (await serverRow(host))?.status.status === "connected")
    expect(host.fake.tokens.length).toBe(before)
    expect(host.fake.authorizations.at(-1)).toBe("Bearer fake-access-1")
  })
})

describe("the user's own exact openrouter entry, with a key in its headers", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({
      config: (url) => ({ mcp: { servers: { openrouter: { type: "remote", url, oauth: false, headers: { Authorization: `Bearer ${KEY}`, "x-openrouter-test": "user" } } } } }),
    })
  })
  afterAll(() => host?.close())

  test("is adopted unchanged: the host uses the user's headers, and the plugin never copies them", async () => {
    expect((await serverRow(host))?.status).toEqual({ status: "connected" })
    expect(host.state().server().source).toEqual({ type: "adopted", signIn: "user-managed" })
    expect(host.fake.markers.filter(Boolean)).not.toEqual([])
    expect(host.fake.markers.every((marker) => marker === "user")).toBe(true)
    expect(JSON.stringify(host.state().server())).not.toContain(KEY)
  })
})

describe("a user openrouter entry that points elsewhere", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ oauth: true, config: (url) => ({ mcp: { servers: { openrouter: { type: "remote", url: url.replace(/\/mcp$/, "/other") } } } }) })
  })
  afterAll(() => host?.close())

  test("is left in place as a conflict: its /connect entry keeps the host's name and gets no plugin namespace", async () => {
    expect(host.state().server().source.type).toBe("conflict")
    expect(host.state().owned()).toBe(false)
    expect(host.state().server().problems[0]).toStartWith("SERVER_CONFLICT: Your OpenCode config's mcp.servers.openrouter uses another path")
    const row = await until("the conflicting server has a row", async () => {
      const found = await serverRow(host)
      return found?.integrationID ? found : undefined
    })
    await Bun.sleep(1_000)
    expect((await integration(host, row.integrationID!))?.name).toBe(SERVER_NAME)
  })
})

describe("a user-disabled exact openrouter entry", () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost({ config: (url) => ({ mcp: { servers: { openrouter: { type: "remote", url, oauth: false, disabled: true } } } }) })
  })
  afterAll(() => host?.close())

  test("stays disabled, and the plugin does not own it", async () => {
    expect((await serverRow(host))?.status).toEqual({ status: "disabled" })
    expect(host.state().server().source).toEqual({ type: "disabled" })
    expect(host.state().owned()).toBe(false)
    expect(host.fake.calls).toEqual([])
  })
})
