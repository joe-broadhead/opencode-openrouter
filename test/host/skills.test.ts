/**
 * The packaged skills must load in the real OpenCode 2.4.1 host.
 *
 * OpenCode discovers `<project>/skills/` by itself, so this test uses an empty temporary project directory and an
 * isolated `HOME`/`XDG_*`: a skill listed there can only come from the plugin's own `ctx.skill.transform` call. The
 * `@opencode/sdk` import is dynamic, after the environment is isolated.
 */
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { OpenCode } from "@opencode/sdk"
import type { Plugin } from "@opencode/plugin"

const root = fileURLToPath(new URL("../..", import.meta.url))
const entry = join(root, "dist", "index.js")
const skillsDirectory = join(root, "skills")

/** The front-matter name of each packaged skill, asserted equal to its directory. */
function packagedSkillNames(): string[] {
  return readdirSync(skillsDirectory, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => {
      const text = readFileSync(join(skillsDirectory, item.name, "SKILL.md"), "utf8")
      const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
      const name = /^name:\s*(.+)$/m.exec(front?.[1] ?? "")?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2")
      assert.equal(name, item.name, `${item.name}/SKILL.md must name itself in its front matter`)
      return name
    })
    .sort()
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
  const expected = packagedSkillNames()
  assert.deepEqual(expected, ["openrouter", "openrouter-evaluate", "openrouter-images", "openrouter-troubleshoot"])

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
    const ids = listed.data.map((item: { id: unknown }) => String(item.id)).sort()
    for (const name of expected) assert.ok(ids.includes(name), `the host lists no skill ${name}; it lists ${ids.join(", ")}`)
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
