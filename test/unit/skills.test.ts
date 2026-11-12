// The skill loader: frontmatter parsing (LF and CRLF), the problems a bad or missing file becomes, registration that
// keeps a user's skill of the same name, and the shadowing status read from the host's list.
import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import { loadSkills, observeSkills, parseSkill, registerSkills, SKILL_NAMES, SKILLS_DIR, type SkillStatus } from "../../src/skills.js"
import { transforms } from "./fake.js"

type SkillEditor = Parameters<Parameters<Plugin.Context["skill"]["transform"]>[0]>[0]

const root = mkdtempSync(join(tmpdir(), "openrouter-skills-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function skills(files: Record<string, string>) {
  const directory = mkdtempSync(join(root, "skills-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(directory, name))
    writeFileSync(join(directory, name, "SKILL.md"), text)
  }
  return directory
}

const ok = (name: string) => `---\nname: ${name}\ndescription: ${name} skill\n---\nBody\n`
const everySkill = () => skills(Object.fromEntries(SKILL_NAMES.map((name) => [name, ok(name)])))

describe("skill loading", () => {
  test("the four skills, read from skills/ at the package root", () => {
    expect([...SKILL_NAMES]).toEqual(["openrouter", "openrouter-evaluate", "openrouter-images", "openrouter-troubleshoot"])
    expect(SKILLS_DIR.replaceAll("\\", "/").endsWith("/skills/")).toBe(true)
  })

  test("parses LF and CRLF frontmatter into a skill with the body kept apart and the real path", () => {
    for (const newline of ["\n", "\r\n"]) {
      const text = ["---", "name: openrouter", 'description: "Use OpenRouter: find models."', "---", "", "# OpenRouter", "Body."].join(newline)
      expect(parseSkill("openrouter", "/pkg/skills/openrouter/SKILL.md", text)).toEqual({
        id: "openrouter",
        name: "openrouter",
        description: "Use OpenRouter: find models.",
        path: "/pkg/skills/openrouter/SKILL.md",
        content: "# OpenRouter\nBody.",
      } as never)
    }
  })

  test.each([
    ["no frontmatter", "# OpenRouter", "skills/openrouter/SKILL.md has no frontmatter"],
    ["an unclosed frontmatter", "---\nname: openrouter\ndescription: d\n# OpenRouter", "skills/openrouter/SKILL.md has no frontmatter"],
    ["the wrong name", "---\nname: other\ndescription: d\n---\nBody", 'skills/openrouter/SKILL.md must be named "openrouter" in its frontmatter'],
    ["no name", "---\ndescription: d\n---\nBody", 'skills/openrouter/SKILL.md must be named "openrouter" in its frontmatter'],
    ["no description", "---\nname: openrouter\n---\nBody", "skills/openrouter/SKILL.md has no description"],
    ["an empty description", "---\nname: openrouter\ndescription:\n---\nBody", "skills/openrouter/SKILL.md has no description"],
    ["no body", "---\nname: openrouter\ndescription: d\n---\n\n", "skills/openrouter/SKILL.md has no body"],
  ])("rejects a skill with %s", (_, text, message) => {
    expect(() => parseSkill("openrouter", "/x", text)).toThrow(`SKILLS_INVALID: The "openrouter" skill was not loaded: ${message}. Next step: Reinstall the plugin.`)
  })

  test("a frontmatter line without a colon is ignored", () => {
    expect(parseSkill("openrouter", "/x", "---\nname: openrouter\nstray line\ndescription: d\n---\nBody").description).toBe("d")
  })

  test("loads every skill and reports each as loaded with its path", async () => {
    const directory = everySkill()
    const loaded = await loadSkills(directory)
    expect(loaded.skills.map((skill): string => skill.id)).toEqual([...SKILL_NAMES])
    expect(loaded.problems).toEqual([])
    expect(loaded.status).toEqual(SKILL_NAMES.map((name) => ({ name, state: "loaded", path: join(directory, name, "SKILL.md") })))
  })

  test("the packaged skills load from the repository", async () => {
    const loaded = await loadSkills()
    expect(loaded.problems).toEqual([])
    expect(loaded.skills.map((skill): string => skill.id)).toEqual([...SKILL_NAMES])
  })

  test("a broken skill is an invalid problem and a missing one a missing problem, not a failure", async () => {
    const broken = skills({ openrouter: "---\nname: openrouter\n---\n", "openrouter-evaluate": ok("openrouter-evaluate") })
    const loaded = await loadSkills(broken)
    expect(loaded.skills.map((skill): string => skill.id)).toEqual(["openrouter-evaluate"])
    expect(loaded.status.map(({ name, state }) => [name, state])).toEqual([
      ["openrouter", "invalid"],
      ["openrouter-evaluate", "loaded"],
      ["openrouter-images", "missing"],
      ["openrouter-troubleshoot", "missing"],
    ])
    expect(loaded.problems).toEqual([
      'SKILLS_INVALID: The "openrouter" skill was not loaded: skills/openrouter/SKILL.md has no description. Next step: Reinstall the plugin.',
      'SKILLS_INVALID: The "openrouter-images" skill was not loaded: skills/openrouter-images/SKILL.md is missing. Next step: Reinstall the plugin.',
      'SKILLS_INVALID: The "openrouter-troubleshoot" skill was not loaded: skills/openrouter-troubleshoot/SKILL.md is missing. Next step: Reinstall the plugin.',
    ])
  })

  test("a skill folder that is missing altogether loads nothing and does not throw", async () => {
    const loaded = await loadSkills(join(root, "nowhere"))
    expect(loaded.skills).toEqual([])
    expect(loaded.status.map((entry) => entry.state)).toEqual(["missing", "missing", "missing", "missing"])
  })

  test("an unreadable skill file is invalid and reported as unreadable, not missing", async () => {
    const directory = skills({ "openrouter-evaluate": ok("openrouter-evaluate") })
    mkdirSync(join(directory, "openrouter", "SKILL.md"), { recursive: true })
    const loaded = await loadSkills(directory)
    expect(loaded.status[0]).toEqual({ name: "openrouter", state: "invalid" })
    expect(loaded.problems[0]).toBe('SKILLS_INVALID: The "openrouter" skill was not loaded: skills/openrouter/SKILL.md cannot be read (EISDIR). Next step: Reinstall the plugin.')
  })
})

describe("registering skills", () => {
  const parsed = (name: string, path: string) => parseSkill(name, path, ok(name))

  /** A skill editor over a map, as the host's is: `add` replaces whatever has the id. */
  function editor(initial: Record<string, string> = {}) {
    const present = new Map(Object.entries(initial).map(([id, path]) => [id, { id, name: id, path, content: "theirs" }]))
    const api = {
      list: () => [...present.values()],
      get: (id: string) => present.get(id),
      add: (skill: { id: string }) => void present.set(skill.id, skill as never),
    } as unknown as SkillEditor
    return { api, present }
  }

  test("adds every loaded skill through ctx.skill.transform, and the cleanup removes the transform", async () => {
    const fake = transforms<SkillEditor>()
    const stop = await registerSkills({ transform: fake.transform }, [parsed("openrouter", "/pkg/a"), parsed("openrouter-images", "/pkg/b")])
    const { api, present } = editor()
    fake.run(api)
    expect([...present.values()].map((skill) => [skill.id, skill.path])).toEqual([["openrouter", "/pkg/a"], ["openrouter-images", "/pkg/b"]])
    await stop.dispose()
    expect(fake.callbacks).toHaveLength(0)
  })

  test("keeps a user's skill of the same name, and a replay never stacks or replaces it", async () => {
    const fake = transforms<SkillEditor>()
    await registerSkills({ transform: fake.transform }, [parsed("openrouter", "/pkg/a"), parsed("openrouter-images", "/pkg/b")])
    const { api, present } = editor({ openrouter: "/projects/acme/skills/openrouter/SKILL.md" })
    fake.run(api)
    fake.run(api)
    expect(present.get("openrouter")?.path).toBe("/projects/acme/skills/openrouter/SKILL.md")
    expect(present.get("openrouter")?.content).toBe("theirs")
    expect(present.get("openrouter-images")?.path).toBe("/pkg/b")
    expect(present.size).toBe(2)
  })
})

describe("shadowing", () => {
  const loaded: readonly SkillStatus[] = [
    { name: "openrouter", state: "loaded", path: "/pkg/skills/openrouter/SKILL.md" },
    { name: "openrouter-images", state: "loaded", path: "/pkg/skills/openrouter-images/SKILL.md" },
    { name: "openrouter-evaluate", state: "missing" },
  ]
  const list = (data: { id: string; path: string }[]) => ({ list: async () => ({ data }) }) as unknown as Pick<Plugin.Context["skill"], "list">

  test("a skill OpenCode lists from another path is shadowed, with that path", async () => {
    const status = await observeSkills(
      list([
        { id: "openrouter", path: "/projects/acme/.opencode/skills/openrouter/SKILL.md" },
        { id: "openrouter-images", path: "/pkg/skills/openrouter-images/SKILL.md" },
        { id: "openrouter-evaluate", path: "/elsewhere/SKILL.md" },
      ]),
      loaded,
    )
    expect(status).toEqual([
      { name: "openrouter", state: "shadowed", path: "/pkg/skills/openrouter/SKILL.md", shadowedBy: "/projects/acme/.opencode/skills/openrouter/SKILL.md" },
      { name: "openrouter-images", state: "loaded", path: "/pkg/skills/openrouter-images/SKILL.md" },
      // A skill that did not load is not "shadowed": it stays missing.
      { name: "openrouter-evaluate", state: "missing" },
    ])
  })

  test("a skill the host does not list stays loaded, and a failed list changes nothing", async () => {
    expect(await observeSkills(list([]), loaded)).toEqual(loaded)
    const failing = { list: async () => Promise.reject(new Error("host busy")) } as unknown as Pick<Plugin.Context["skill"], "list">
    expect(await observeSkills(failing, loaded)).toEqual(loaded)
  })
})
