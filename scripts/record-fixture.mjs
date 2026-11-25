// Rewrites fixtures/conformance.json from the plugin's own two-alias runtime.
//
//   npm run fixtures
//
// There is no signed-in OpenRouter account on the recording machine, so this is a synthetic recording: the plugin's real
// manifest and account wiring, two aliases, and OpenCode's own MCP list faked at its documented boundary. It never claims
// a live OpenRouter capture.
//
// `accounts.cursors` stays empty. This plugin has no cursor-bearing read (no sources), so there is no honest cross-account
// cursor case to record; the conformance kit reports that as `accounts.cursors`, and the plugin does not fake one.
import { mkdirSync, writeFileSync } from "node:fs"
import { accountsOf, resolveAccount } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { manifest, packageName } from "../src/manifest.ts"
import { run, runtimeFor, OPTIONS } from "../test/support/handlers.ts"

const plan = accountsOf(manifest, OPTIONS)
if (!plan.ok) throw new Error(plan.problems.join("; "))
const aliases = plan.value.accounts.map((account) => account.alias)

const required = resolveAccount(plan.value.accounts, {})
if (required.ok || required.code !== "ACCOUNT_REQUIRED") throw new Error("two aliases and no account must answer ACCOUNT_REQUIRED")
const unknown = resolveAccount(plan.value.accounts, { account: "nobodyhere" })
if (unknown.ok || unknown.code !== "ACCOUNT_UNKNOWN") throw new Error("an alias the plugin does not serve must answer ACCOUNT_UNKNOWN")

// Drive probe and status through the real handler table, so a recording cannot describe an answer the plugin does not
// give.
const probes = {}
for (const alias of aliases) probes[alias] = await run(runtimeFor(), "probe", {}, alias)
const status = await run(runtimeFor(), "status", {})
if (status.state !== "ready") throw new Error(`the synthetic runtime must record a ready status, not ${status.state}`)

const fixture = {
  $comment:
    "Recorded from the plugin's own two-alias runtime: the provider answers are synthetic (no live OpenRouter account was " +
    "available on the recording machine). accounts.real: true makes T1 run the two-account cases against the real 2.4.1 " +
    "host (plugin-contract docs/conformance.md), not a live provider recording. The 31 OpenRouter MCP tools are declared " +
    "as mcp:<tool> rows and have no handler. accounts.cursors is empty because this tools-only plugin has no " +
    "cursor-bearing read, so there is no honest cross-account cursor case to record.",
  plugin: packageName,
  namespace: manifest.plugin.summary,
  accounts: {
    real: true,
    aliases,
    required: { method: "probe", code: "ACCOUNT_REQUIRED" },
    unknown: { method: "probe", account: "nobodyhere", code: "ACCOUNT_UNKNOWN" },
    cursors: [],
  },
  events: {
    emitted: [],
    status,
  },
}

mkdirSync("fixtures", { recursive: true })
writeFileSync("fixtures/conformance.json", `${JSON.stringify(fixture, null, 2)}\n`)
console.log(
  `recorded fixtures/conformance.json for ${packageName}: probe answers for ${aliases
    .map((alias) => `${alias} (${probes[alias].owner.id})`)
    .join(", ")}, status ${status.state}`,
)
