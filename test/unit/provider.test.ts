import assert from "node:assert/strict"
import { test } from "node:test"
import { createMcpProvider, MCP_URL, serverConfig, serverLabel, serverName, signalOf, type McpServerEntry } from "../../src/provider/mcp.ts"
import { entry } from "../support/handlers.ts"

function providerFor(entries: readonly McpServerEntry[]) {
  return createMcpProvider({ list: async () => ({ data: entries }) })
}

test("connected is ready, and holds no reason", () => {
  assert.deepEqual(signalOf(entry("work")), { state: "ready" })
})

test("needs_auth is needs_sign_in, with a redacted reason", () => {
  const signal = signalOf(entry("work", "needs_auth", "sign in at https://mcp.openrouter.ai/auth?code=abc123"))
  assert.equal(signal.state, "needs_sign_in")
  assert.equal(signal.reason, "sign in at https://mcp.openrouter.ai/auth?code=…")
})

test("failed is error, with the server's reason redacted and cut to one line", () => {
  const signal = signalOf(entry("work", "failed", "the provider said Bearer abcdefghijklmnop"))
  assert.equal(signal.state, "error")
  assert.equal(signal.reason, "the provider said Bearer …")
  assert.ok((signal.reason ?? "").length <= 160)
})

test("a failure OpenCode gives no text for still says what happened", () => {
  assert.deepEqual(signalOf(entry("work", "failed")), { state: "error", reason: "OpenCode could not connect to the server" })
  assert.deepEqual(signalOf(entry("work", "needs_auth")), { state: "needs_sign_in", reason: "the server needs a sign-in" })
})

test("disabled and pending are errors with the contract's wording", () => {
  assert.deepEqual(signalOf(entry("work", "disabled")), { state: "error", reason: "the server is disabled" })
  assert.deepEqual(signalOf(entry("work", "pending")), { state: "error", reason: "the server is still connecting" })
})

test("an alias OpenCode does not list is an error, never a silent default", () => {
  assert.deepEqual(signalOf(undefined), { state: "error", reason: "OpenCode lists no such server" })
})

test("each alias reads its own server, so one account's failure never colours another", async () => {
  const entries = [entry("work", "failed", "timeout"), entry("personal")]
  const signals = await providerFor(entries).signals(["work", "personal"])
  assert.deepEqual(Object.keys(signals), ["work", "personal"])
  assert.equal(signals["work"]?.state, "error")
  assert.equal(signals["work"]?.reason, "timeout")
  assert.equal(signals["personal"]?.state, "ready")
})

test("an alias whose server is absent is an error beside the aliases that are ready", async () => {
  const signals = await providerFor([entry("work")]).signals(["work", "personal"])
  assert.equal(signals["work"]?.state, "ready")
  assert.deepEqual(signals["personal"], { state: "error", reason: "OpenCode lists no such server" })
})

test("the provider finds one server by name and answers nothing for an unlisted name", async () => {
  const provider = providerFor([entry("work"), entry("personal")])
  assert.equal((await provider.server("openrouter-work"))?.name, "openrouter-work")
  assert.equal(await provider.server("openrouter-elsewhere"), undefined)
  assert.equal((await provider.servers()).length, 2)
})

test("the server name and the probe label follow the contract's one naming rule", () => {
  assert.equal(serverName("default"), "openrouter")
  assert.equal(serverName("work"), "openrouter-work")
  assert.equal(serverLabel("default"), "OpenRouter")
  assert.equal(serverLabel("work"), "OpenRouter (work)")
})

test("every alias signs in to the one hosted MCP URL with its own OAuth, and the config carries no display field", () => {
  assert.deepEqual(serverConfig(), { type: "remote", url: MCP_URL, oauth: {} })
  assert.equal(MCP_URL, "https://mcp.openrouter.ai/mcp")
})
