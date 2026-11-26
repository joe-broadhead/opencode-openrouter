import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { accountName, accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { checkManifest, manifestHash } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { methodEntries } from "@we-the-rebel-alliance/plugin-contract/register"
import { handlersFor } from "../../src/handlers/index.ts"
import { manifest, packageName, version } from "../../src/manifest.ts"
import { runtimeFor } from "../support/handlers.ts"

/** The 21 reads whose own call is free, plus the two recipes that ask first. */
const READS = [
  "get-endpoint-uptime-history",
  "get-model",
  "get-session-cost",
  "list-app-rankings",
  "list-benchmarks",
  "list-daily-model-rankings",
  "list-model-endpoints",
  "list-models",
  "list-providers",
  "list-task-classifications",
  "ping",
  "search-docs",
  "get-batch",
  "get-credits",
  "get-current-key",
  "get-generation",
  "get-preset",
  "get-video",
  "list-batches",
  "list-preset-versions",
  "list-presets",
]

/** The two tools that return a recipe. They ask under `ask-changes` even though they write nothing. */
const RECIPES = ["install-ori-harness", "spawn-ori-eval"]

/** The four tools that create media or text and bill the account. */
const WRITES = ["generate-image", "generate-speech", "generate-video", "transcribe-audio"]

/** The four tools that reach someone: three inference sends and feedback. */
const SENDS = ["send-batch", "send-decision", "send-message", "send-feedback"]

/** The seven tools that spend the account's credit. */
const BILLING = ["send-message", "send-batch", "send-decision", "transcribe-audio", "generate-image", "generate-speech", "generate-video"]

const MCP_ROWS = Object.keys(manifest.methods).filter((method) => method.startsWith("mcp:") && method !== "mcp:*")

test("the package and the manifest share one name, one version and a valid hash", () => {
  assert.equal(manifest.plugin.name, "openrouter")
  assert.equal(packageName, "@we-the-rebel-alliance/openrouter-plugin")
  assert.equal(version, "0.0.0")
  assert.equal(checkManifest(manifest).ok, true)
  assert.match(manifestHash(manifest), /^sha256:[0-9a-f]{64}$/)
})

test("the namespace line is one line inside the manifest schema's 300 characters", () => {
  // The standard and T0 allow 400; MANIFEST_SCHEMA caps plugin.summary at 300, so the stricter bound is the real one.
  assert.ok(!manifest.plugin.summary.includes("\n"))
  assert.ok(manifest.plugin.summary.length <= 300, `${manifest.plugin.summary.length} characters`)
  assert.ok(manifest.plugin.summary.length <= 400)
})

test("the identity names OpenRouter, its domain and its three icons", () => {
  assert.equal(manifest.plugin.title, "OpenRouter")
  assert.deepEqual(manifest.plugin.vendor, { id: "openrouter", name: "OpenRouter", domain: "openrouter.ai" })
  assert.deepEqual(
    manifest.plugin.icons.map((icon) => icon.src),
    ["assets/icon.svg", "assets/icon-128.png", "assets/icon-256.png"],
  )
  assert.deepEqual(manifest.plugin.host, { opencode: ">=2.4.1 <2.5.0", tested: ["2.4.1"] })
})

test("an account is an alias with an empty profile, held by the vendor's MCP server", () => {
  assert.deepEqual(manifest.accounts, {
    via: "mcp",
    profile: { $ref: "#/options/properties/accounts/additionalProperties" },
    owner: "mcp",
  })
  const properties = (manifest.options as { readonly properties: Record<string, unknown> }).properties
  assert.deepEqual(Object.keys(properties).sort(), ["access", "accounts", "allowUntestedHost"])
  assert.deepEqual(properties.accounts, {
    type: "object",
    description: "One empty profile per account alias; the alias is the setting.",
    additionalProperties: { type: "object", properties: {}, additionalProperties: false },
  })
  assert.deepEqual(properties.access, {
    type: "string",
    enum: ["all", "ask-changes", "read-only"],
    default: "all",
    description: "How much the plugin's methods may do.",
  })
  assert.deepEqual(properties.allowUntestedHost, { type: "boolean", default: false, description: "Start outside the tested OpenCode range." })
})

test("two aliases resolve to the two MCP servers OpenCode signs in to", () => {
  const plan = accountsOf(manifest, { accounts: { work: {}, personal: {} } })
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.deepEqual(plan.value.accounts.map((account) => account.alias), ["work", "personal"])
  assert.equal(accountName(manifest.plugin.name, "default"), "openrouter")
  assert.equal(accountName(manifest.plugin.name, "work"), "openrouter-work")
  assert.equal(accountName(manifest.plugin.name, "personal"), "openrouter-personal")
})

test("the methods table is status, probe, 31 reviewed MCP tools and the mcp:* default", () => {
  assert.equal(MCP_ROWS.length, 31)
  assert.equal(Object.keys(manifest.methods).length, 34)
  assert.deepEqual([...MCP_ROWS].map((method) => method.slice("mcp:".length)).sort(), [...READS, ...RECIPES, ...WRITES, ...SENDS].sort())
  assert.deepEqual(manifest.methods.status, { class: "read", accounts: "none" })
  assert.deepEqual(manifest.methods.probe, { class: "read", accounts: "optional" })
  assert.deepEqual(manifest.methods["mcp:*"], { class: "write", accounts: "optional", effect: "ask" })
})

test("every reviewed MCP row names its own tool and takes an account, and none is pinned or eval-hidden", () => {
  for (const tool of [...READS, ...RECIPES, ...WRITES, ...SENDS]) {
    const row = manifest.methods[`mcp:${tool}`]
    assert.ok(row !== undefined, tool)
    assert.deepEqual(row.operations, [tool], tool)
    assert.equal(row.accounts, "optional", tool)
    assert.equal(row.pinned, undefined, tool)
    assert.equal((row as unknown as Record<string, unknown>).agent, undefined, tool)
    assert.equal(row.plans, undefined, tool)
    assert.equal(row.commits, undefined, tool)
  }
})

test("every read is class read, every recipe asks first, and every non-read asks before it runs", () => {
  for (const tool of READS) assert.equal(manifest.methods[`mcp:${tool}`]?.class, "read", tool)
  for (const tool of RECIPES) {
    assert.equal(manifest.methods[`mcp:${tool}`]?.class, "read", tool)
    assert.equal(manifest.methods[`mcp:${tool}`]?.effect, "ask", tool)
  }
  for (const tool of WRITES) {
    assert.equal(manifest.methods[`mcp:${tool}`]?.class, "write", tool)
    assert.equal(manifest.methods[`mcp:${tool}`]?.effect, "ask", tool)
  }
  for (const tool of SENDS) {
    assert.equal(manifest.methods[`mcp:${tool}`]?.class, "send", tool)
    assert.equal(manifest.methods[`mcp:${tool}`]?.effect, "ask", tool)
  }
  assert.equal(manifest.methods["mcp:*"]?.effect, "ask")
})

test("no billing tool is class read: a call that spends is a change that asks before it runs", () => {
  for (const tool of BILLING) {
    const item = manifest.methods[`mcp:${tool}`]
    assert.ok(item !== undefined, tool)
    assert.notEqual(item.class, "read", tool)
    assert.equal(item.effect, "ask", tool)
  }
})

test("a tool OpenRouter adds later is class write, never a read that runs unreviewed", () => {
  assert.equal(manifest.methods["mcp:*"]?.class, "write")
})

test("the plugin has no sources, no actions and no bus events", () => {
  assert.deepEqual(manifest.sources, [])
  assert.deepEqual(manifest.actions, [])
  assert.deepEqual(manifest.events, {})
})

test("the manifest and the handler table declare the same methods, and no MCP row has a handler", () => {
  const handlers = handlersFor(runtimeFor())
  const entries = methodEntries(manifest, handlers)
  const declared = Object.keys(manifest.methods).filter((method) => !method.startsWith("mcp:"))
  assert.deepEqual(entries.map((entry) => entry.name).sort(), declared.sort())
  for (const method of Object.keys(manifest.methods)) {
    if (method.startsWith("mcp:")) assert.equal(handlers[method], undefined, method)
  }
})

test("the package has only the manifest's own keys and a dev-only dependency set", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as Record<string, unknown>
  assert.deepEqual(Object.keys(pkg).sort(), [
    "bugs",
    "capabilities",
    "description",
    "devDependencies",
    "engines",
    "exports",
    "files",
    "homepage",
    "keywords",
    "license",
    "name",
    "repository",
    "scripts",
    "type",
    "version",
  ])
  for (const key of ["dependencies", "peerDependencies", "optionalDependencies", "bundleDependencies"]) {
    assert.equal(pkg[key], undefined, key)
  }
  const scripts = pkg.scripts as Record<string, string>
  for (const lifecycle of ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack", "prepublishOnly"]) {
    assert.equal(scripts[lifecycle], undefined, lifecycle)
  }
})
