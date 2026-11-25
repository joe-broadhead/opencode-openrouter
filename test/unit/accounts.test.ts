import assert from "node:assert/strict"
import { test } from "node:test"
import { manifest } from "../../src/manifest.ts"
import { registerOpenRouterAccounts, type AccountsContext } from "../../src/accounts.ts"
import { MCP_URL } from "../../src/provider/mcp.ts"

/** A context with the two transforms, capturing the MCP servers a plugin registers. */
function context() {
  const servers = new Map<string, Record<string, unknown>>()
  const fake = {
    integration: {
      transform: async () => {
        throw new Error("the mcp mechanism must not touch the integration transform")
      },
    },
    mcp: {
      transform: async (callback: (editor: { set(name: string, config: Record<string, unknown>): void }) => void) => {
        callback({ set: (name, config) => void servers.set(name, config) })
        return { dispose: async () => undefined }
      },
    },
  } as unknown as AccountsContext
  return { fake, servers }
}

test("the mcp mechanism registers one server per alias, named and labelled for the account", async () => {
  const { fake, servers } = context()
  const registration = await registerOpenRouterAccounts(fake, manifest, { accounts: { work: {}, personal: {} } })
  assert.equal(registration.mechanism, "mcp")
  assert.deepEqual(registration.accounts.map((account) => account.name), ["openrouter-work", "openrouter-personal"])
  assert.deepEqual(servers.get("openrouter-work"), {
    type: "remote",
    url: MCP_URL,
    oauth: {},
    title: "OpenRouter (work)",
  })
  assert.deepEqual(servers.get("openrouter-personal"), {
    type: "remote",
    url: MCP_URL,
    oauth: {},
    title: "OpenRouter (personal)",
  })
  assert.deepEqual(registration.problems, [])
})

test("with no accounts option the plugin has one default server, named for the plugin", async () => {
  const { fake, servers } = context()
  const registration = await registerOpenRouterAccounts(fake, manifest, {})
  assert.deepEqual(registration.accounts.map((account) => account.name), ["openrouter"])
  assert.deepEqual(servers.get("openrouter"), { type: "remote", url: "https://mcp.openrouter.ai/mcp", oauth: {}, title: "OpenRouter" })
})

test("the server URL is the vendor's one hosted MCP endpoint", () => {
  assert.equal(MCP_URL, "https://mcp.openrouter.ai/mcp")
})

test("a bad alias is reported and registers no server", async () => {
  const { fake, servers } = context()
  const registration = await registerOpenRouterAccounts(fake, manifest, { accounts: { Work: {} } })
  assert.ok(registration.problems.length > 0)
  assert.equal(servers.size, 0)
})

test("a profile that carries a setting is refused: the alias is the whole account", async () => {
  const { fake, servers } = context()
  const registration = await registerOpenRouterAccounts(fake, manifest, { accounts: { work: { region: "eu" } } })
  assert.ok(registration.problems.length > 0)
  assert.equal(servers.size, 0)
})
