import assert from "node:assert/strict"
import { test } from "node:test"
import { STATUS_SCHEMA, statusAnswer } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { handlersFor } from "../../src/handlers/index.ts"
import { entry, run, runtimeFor } from "../support/handlers.ts"
import { manifest } from "../../src/manifest.ts"

interface Answer {
  readonly name: string
  readonly version: string
  readonly host: { readonly version: string; readonly range: string; readonly tested: readonly string[] }
  readonly state: string
  readonly accounts: readonly { readonly alias: string; readonly state: string; readonly reason?: string }[]
  readonly unguardedAgents: readonly string[]
  readonly nextStep: string | null
}

const status = async (runtime = runtimeFor(), options = {}): Promise<Answer> => (await run(runtime, "status", {}, "work", options)) as Answer

test("status names the plugin, its host and both aliases, all ready", async () => {
  const answer = await status()
  assert.equal(answer.name, "openrouter")
  assert.equal(answer.version, "0.0.0")
  assert.deepEqual(answer.host, { version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] })
  assert.equal(answer.state, "ready")
  assert.deepEqual(
    answer.accounts.map((account) => [account.alias, account.state]),
    [
      ["work", "ready"],
      ["personal", "ready"],
    ],
  )
  assert.deepEqual(answer.unguardedAgents, [])
  assert.equal(answer.nextStep, null)
})

test("status is the answer the contract's builder makes from the same inputs", async () => {
  const answer = await status()
  const built = statusAnswer({
    manifest,
    version: "0.0.0",
    hostVersion: "2.4.1",
    accounts: [
      { alias: "work", state: "ready" },
      { alias: "personal", state: "ready" },
    ],
    problems: [],
    unguardedAgents: { ok: true, agents: [] },
  })
  assert.deepEqual(answer, built)
})

test("one alias needing a sign-in makes the plugin needs_sign_in, with the contract's next step", async () => {
  const answer = await status(runtimeFor([entry("work"), entry("personal", "needs_auth", "expired at https://mcp.openrouter.ai/auth?code=abc123")]))
  assert.equal(answer.state, "needs_sign_in")
  assert.equal(answer.accounts[1]?.state, "needs_sign_in")
  assert.equal(answer.accounts[1]?.reason, "expired at https://mcp.openrouter.ai/auth?code=…")
  assert.equal(answer.nextStep, "Sign in to the account that needs it, then read status again.")
})

test("a failed alias is an error in its own entry, and the plugin itself stays ready", async () => {
  const answer = await status(runtimeFor([entry("work", "failed", "the provider said Bearer abcdefghijklmnop"), entry("personal")]))
  // The contract's builder reserves the plugin-level error for its own problems; an account's failure is its entry.
  assert.equal(answer.state, "ready")
  assert.equal(answer.accounts[0]?.state, "error")
  assert.equal(answer.accounts[0]?.reason, "the provider said Bearer …")
  assert.equal(answer.nextStep, null)
})

test("an account registration problem is an error before any account state", async () => {
  const answer = await status(runtimeFor(undefined, { accountProblems: ["the openrouter-work server could not be added"] }))
  assert.equal(answer.state, "error")
  assert.equal(answer.nextStep, "the openrouter-work server could not be added")
})

test("an agent that no longer holds the generated rules is named, never patched", async () => {
  const answer = await status(runtimeFor(), { unguardedAgents: async () => ({ ok: true, agents: ["build"] }) })
  assert.deepEqual(answer.unguardedAgents, ["build"])
  assert.equal(answer.state, "ready")
})

test("an unreadable agent list is unknown, never zero: status says error with a redacted next step", async () => {
  const answer = await status(runtimeFor(), {
    unguardedAgents: async () => ({ ok: false, error: "agent list failed at https://opencode.local/api/agent?code=abcd1234" }),
  })
  assert.equal(answer.state, "error")
  assert.equal(answer.nextStep, "agent list failed at https://opencode.local/api/agent?code=…")
  assert.deepEqual(answer.unguardedAgents, [])
})

test("an unreadable MCP server list marks every alias error, not a silent ready", async () => {
  const base = runtimeFor()
  const runtime = {
    ...base,
    provider: {
      ...base.provider,
      signals: async () => {
        throw new Error("mcp list failed")
      },
    },
  }
  const answer = await status(runtime)
  assert.equal(answer.state, "error")
  assert.equal(answer.accounts.every((account) => account.state === "error"), true)
  assert.equal(answer.accounts[0]?.reason, "mcp list failed")
  assert.equal(answer.nextStep, "mcp list failed")
})

test("status answers the contract's status schema, not a copied shape", () => {
  const handler = handlersFor(runtimeFor()).status
  assert.ok(handler !== undefined)
  assert.deepEqual(handler.output, STATUS_SCHEMA)
})
