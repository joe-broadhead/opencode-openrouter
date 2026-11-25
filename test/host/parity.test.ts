/**
 * The remaining capability surface on the real OpenCode 2.4.1 host.
 *
 * The contract's `createHost` loads the built entry in the embedded host with two aliases. A status reason is read from
 * OpenCode's own server list, so "OpenCode lists no such server" would mean the per-alias entry was never registered;
 * the live server answers `Unauthorized` here because this VM has no OAuth.
 */
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { createHost } from "@we-the-rebel-alliance/plugin-contract/kit"

const root = fileURLToPath(new URL("../..", import.meta.url))


interface StatusAnswer {
  readonly state: string
  readonly accounts: readonly { readonly alias: string; readonly state: string; readonly reason?: string }[]
  readonly nextStep: string | null
}

interface ProbeAnswer {
  readonly account: string
  readonly owner: { readonly id: string; readonly label: string; readonly verified: boolean }
  readonly trust: string
}

test("status, probe and both per-alias server entries answer on the real 2.4.1 host", async () => {
  const project = mkdtempSync(join(tmpdir(), "openrouter-parity-"))
  const environment = ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"] as const
  const saved = new Map(environment.map((key) => [key, process.env[key]]))
  process.env.HOME = project
  process.env.XDG_CONFIG_HOME = join(project, "c")
  process.env.XDG_CACHE_HOME = join(project, "k")
  process.env.XDG_DATA_HOME = join(project, "d")
  process.env.XDG_STATE_HOME = join(project, "s")

  const host = await createHost({
    directory: root,
    version: "2.4.1",
    pluginId: "openrouter",
    options: { accounts: { work: {}, personal: {} } },
    timeoutMs: 30_000,
  })
  try {
    assert.equal(host.refusal, undefined)
    assert.equal(host.failure, undefined)
    assert.deepEqual(
      host.tools.map((tool) => tool.permission).sort(),
      ["openrouter.probe", "openrouter.status"],
    )

    const status = await host.call("status", {})
    assert.equal(status.ok, true)
    if (!status.ok) return
    const answer = status.output as StatusAnswer
    assert.equal(answer.accounts.length, 2)
    assert.deepEqual(answer.accounts.map((account) => account.alias), ["work", "personal"])
    for (const account of answer.accounts) {
      assert.ok(["ready", "needs_sign_in", "error"].includes(account.state), `${account.alias}: ${account.state}`)
      assert.notEqual(account.reason, "OpenCode lists no such server", `${account.alias} has no registered MCP server`)
    }

    const probe = await host.call("probe", { account: "work" })
    assert.equal(probe.ok, true)
    if (!probe.ok) return
    assert.deepEqual(probe.output as ProbeAnswer, {
      account: "work",
      owner: { id: "mcp:openrouter-work", label: "OpenRouter (work)", verified: false },
      trust: "untrusted",
    })
  } finally {
    await host.close()
    for (const key of environment) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(project, { recursive: true, force: true })
  }
})
