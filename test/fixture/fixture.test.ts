import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { accountsOf, resolveAccount } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { manifest, packageName } from "../../src/manifest.ts"
import { OPTIONS, run, runtimeFor } from "../support/handlers.ts"

interface Fixture {
  readonly plugin: string
  readonly namespace: string
  readonly accounts: {
    readonly real: boolean
    readonly aliases: readonly string[]
    readonly required: { readonly method: string; readonly code: string }
    readonly unknown: { readonly method: string; readonly account: string; readonly code: string }
  }
  readonly events: { readonly emitted: readonly string[]; readonly status?: unknown }
}

const fixture = JSON.parse(readFileSync(new URL("../../fixtures/conformance.json", import.meta.url), "utf8")) as Fixture

const plan = accountsOf(manifest, OPTIONS)
if (!plan.ok) throw new Error(plan.problems.join("; "))

test("the fixture was recorded for this package and the manifest's namespace line", () => {
  assert.equal(fixture.plugin, packageName)
  assert.equal(fixture.namespace, manifest.plugin.summary)
  assert.equal(fixture.accounts.real, true)
})

test("the recorded aliases are the two the options declare", () => {
  assert.deepEqual(fixture.accounts.aliases, plan.value.accounts.map((account) => account.alias))
})

test("the recorded ACCOUNT_REQUIRED and ACCOUNT_UNKNOWN cases are what the accounts module answers", () => {
  const required = resolveAccount(plan.value.accounts, {})
  assert.equal(required.ok, false)
  if (!required.ok) assert.equal(required.code, fixture.accounts.required.code)
  assert.equal(fixture.accounts.required.method, "probe")

  const unknown = resolveAccount(plan.value.accounts, { account: fixture.accounts.unknown.account })
  assert.equal(unknown.ok, false)
  if (!unknown.ok) assert.equal(unknown.code, fixture.accounts.unknown.code)
  assert.equal(fixture.accounts.unknown.method, "probe")
})

test("probe answers the recorded identity for both aliases", async () => {
  for (const alias of fixture.accounts.aliases) {
    const answer = (await run(runtimeFor(), "probe", {}, alias)) as { account: string; owner: { id: string; label: string; verified: boolean }; trust: string }
    assert.equal(answer.account, alias)
    assert.equal(answer.owner.id, `mcp:openrouter-${alias}`)
    assert.equal(answer.owner.label, `OpenRouter (${alias})`)
    assert.equal(answer.owner.verified, false)
    assert.equal(answer.trust, "untrusted")
  }
})

test("the fixture records exactly the bus events the manifest declares", () => {
  assert.deepEqual([...fixture.events.emitted].sort(), Object.keys(manifest.events).sort())
})

test("the recorded status is what the status handler answers today", async () => {
  assert.ok(fixture.events.status !== undefined, "fixtures/conformance.json records no status answer")
  assert.deepEqual(await run(runtimeFor(), "status", {}), fixture.events.status)
})
