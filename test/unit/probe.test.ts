import assert from "node:assert/strict"
import { test } from "node:test"
import { RegisterError } from "@we-the-rebel-alliance/plugin-contract/register"
import { EMPTY, PROBE_ANSWER } from "../../src/handlers/shared.ts"
import { entry, run, runtimeFor } from "../support/handlers.ts"

/** The contract code a handler refuses with, and its message. */
async function refusalOf(action: () => Promise<unknown>): Promise<{ readonly code: string; readonly message: string }> {
  try {
    await action()
  } catch (error) {
    assert.ok(error instanceof RegisterError, String(error))
    return { code: error.refusal.code, message: error.message }
  }
  throw new Error("expected a refusal")
}

test("probe answers OpenCode's own server identity for the account, and no provider content", async () => {
  const answer = await run(runtimeFor(), "probe", {}, "personal")
  assert.deepEqual(answer, {
    account: "personal",
    owner: { id: "mcp:openrouter-personal", label: "OpenRouter (personal)", verified: false },
    trust: "untrusted",
  })
})

test("probe is read from the live server list, so each alias gets its own entry", async () => {
  const work = await run(runtimeFor(), "probe", {}, "work")
  assert.deepEqual((work as { owner: unknown }).owner, { id: "mcp:openrouter-work", label: "OpenRouter (work)", verified: false })
})

test("probe still names the server while it needs a sign-in: identity is not sign-in state", async () => {
  const runtime = runtimeFor([entry("work", "needs_auth", "expired")])
  const answer = (await run(runtime, "probe", {}, "work")) as { owner: { id: string } }
  assert.equal(answer.owner.id, "mcp:openrouter-work")
})

test("probe refuses an alias whose server OpenCode does not list, with a next step", async () => {
  const refusal = await refusalOf(() => run(runtimeFor([entry("work")]), "probe", {}, "personal"))
  assert.equal(refusal.code, "UNAVAILABLE")
  assert.match(refusal.message, /^UNAVAILABLE: OpenCode lists no MCP server openrouter-personal/)
  assert.match(refusal.message, /Next step: /)
})

test("probe takes no input and answers a closed shape with no source", () => {
  assert.deepEqual(EMPTY, { type: "object", properties: {}, additionalProperties: false })
  assert.equal(PROBE_ANSWER["additionalProperties"], false)
  assert.deepEqual(Object.keys((PROBE_ANSWER["properties"] as Record<string, unknown>) ?? {}).sort(), ["account", "owner", "trust"])
  assert.deepEqual(PROBE_ANSWER["required"], ["account", "owner", "trust"])
  const owner = (PROBE_ANSWER["properties"] as Record<string, Record<string, unknown>>)["owner"]
  assert.ok(owner !== undefined)
  assert.deepEqual(Object.keys((owner["properties"] as Record<string, unknown>) ?? {}).sort(), ["id", "label", "verified"])
  assert.equal(owner["additionalProperties"], false)
})
