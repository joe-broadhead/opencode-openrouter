/**
 * The packaged skills must load in the real OpenCode 2.4.1 host.
 *
 * OpenCode discovers `<project>/skills/` by itself, so this test uses an empty temporary project directory and an
 * isolated `HOME`/`XDG_*`: a skill listed there can only come from the plugin's own `ctx.skill.transform` call. The
 * `@opencode/sdk` import is dynamic, after the environment is isolated.
 *
 * The expected front matter is parsed with the `yaml` package, so an invalid scalar (a `description: >` block, an
 * unquoted `: `, an empty value) fails here rather than registering a skill agents cannot read.
 */
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { OpenCode } from "@opencode/sdk"
import type { Plugin } from "@opencode/plugin"
import { parse as parseYaml } from "yaml"

const root = fileURLToPath(new URL("../..", import.meta.url))
const entry = join(root, "dist", "index.js")
const skillsDirectory = join(root, "skills")

/** One skill file's YAML front matter, checked against its directory. */
interface ExpectedSkill {
  readonly name: string
  readonly description: string
}

/** Parse every `skills/<name>/SKILL.md` front matter with YAML and check the name and description. */
function packagedSkills(): ExpectedSkill[] {
  return readdirSync(skillsDirectory, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => {
      const text = readFileSync(join(skillsDirectory, item.name, "SKILL.md"), "utf8")
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
      const parsed = parseYaml(front?.[1] ?? "") as { readonly name?: unknown; readonly description?: unknown }
      assert.equal(parsed.name, item.name, `${item.name}/SKILL.md must name itself in its front matter`)
      assert.equal(typeof parsed.description, "string", `${item.name}/SKILL.md must have a string description`)
      const description = parsed.description as string
      assert.ok(description.length > 0, `${item.name}/SKILL.md must have a non-empty description`)
      for (const marker of [">", "|", ">-", "|-", ">+", "|+"]) assert.notEqual(description.trim(), marker, `${item.name}/SKILL.md has the block marker ${marker}`)
      return { name: item.name, description }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** Poll with a bound; the SDK activates a plugin after the first prompt. */
async function until(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

test("the plugin registers all four packaged skills in the real 2.4.1 host", async () => {
  const expected = packagedSkills()
  assert.deepEqual(
    expected.map((skill) => skill.name),
    ["openrouter", "openrouter-evaluate", "openrouter-images", "openrouter-troubleshoot"],
  )

  const project = mkdtempSync(join(tmpdir(), "openrouter-skills-"))
  const environment = ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"] as const
  const saved = new Map(environment.map((key) => [key, process.env[key]]))
  process.env.HOME = project
  process.env.XDG_CONFIG_HOME = join(project, "c")
  process.env.XDG_CACHE_HOME = join(project, "k")
  process.env.XDG_DATA_HOME = join(project, "d")
  process.env.XDG_STATE_HOME = join(project, "s")

  let host: OpenCode.Interface | undefined
  try {
    const loaded = (await import(pathToFileURL(entry).href)) as { default?: Plugin.Plugin }
    const plugin = loaded.default
    assert.ok(plugin !== undefined, `${entry} exports no Plugin.define value`)
    const sdk = await import("@opencode/sdk")
    const created = await sdk.OpenCode.create({
      plugins: [plugin],
      config: { directory: project },
      app: { name: "opencode", version: "2.4.1" },
      log: { level: "error", emit: () => undefined },
    })
    host = created

    // A prompt is what makes the host acquire the location's plugin instance.
    const session = await created.sessions.create({ location: { directory: project }, agent: "build", permissions: [] })
    await created.sessions.prompt({ sessionID: session.id, text: "activate the skills test", delivery: "queue" }).catch(() => undefined)
    const active = await until(async () => {
      const list = await created.plugin.list({ location: { directory: project } })
      return list.data.some((item: { id: string }) => item.id === "openrouter")
    })
    assert.ok(active, "the plugin did not activate in the host within 30 seconds")

    const listed = await created.skill.list({ location: { directory: project } })
    type RegisteredSkill = { readonly id: unknown; readonly name?: unknown; readonly description?: unknown; readonly path?: unknown; readonly content?: unknown }
    const byId = new Map<string, RegisteredSkill>(
      (listed.data as readonly RegisteredSkill[]).map((item) => [String(item.id), item] as const),
    )
    for (const skill of expected) {
      const registered = byId.get(skill.name)
      assert.ok(registered !== undefined, `the host lists no skill ${skill.name}; it lists ${[...byId.keys()].join(", ")}`)
      assert.equal(String(registered.name), skill.name, `${skill.name} has the wrong name`)
      assert.equal(String(registered.path), join(skillsDirectory, skill.name, "SKILL.md"), `${skill.name} has the wrong path`)
      assert.ok(typeof registered.content === "string" && registered.content.trim().length > 0, `${skill.name} has no body`)
      assert.equal(registered.description, skill.description, `${skill.name} has the wrong description`)
    }
  } finally {
    if (host !== undefined) await host.close().catch(() => undefined)
    for (const key of environment) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(project, { recursive: true, force: true })
  }
})
