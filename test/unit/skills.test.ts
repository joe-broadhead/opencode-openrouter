import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { Plugin } from "@opencode/plugin"
import { fileURLToPath } from "node:url"
import { readSkills, registerSkills } from "../../src/skills.ts"

const root = fileURLToPath(new URL("../..", import.meta.url))

/** A temporary `skills/` directory holding one file per entry. */
function fixture(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), "plugin-skills-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(directory, name), { recursive: true })
    writeFileSync(join(directory, name, "SKILL.md"), text)
  }
  return directory
}

test("the packaged skills are checked with their names, descriptions and bodies", () => {
  const skills = readSkills()
  assert.deepEqual(skills.map((skill) => skill.id), ["openrouter", "openrouter-evaluate", "openrouter-images", "openrouter-troubleshoot"])
  const skill = skills.find((candidate) => candidate.id === "openrouter")
  assert.ok(skill !== undefined)
  assert.equal(skill.name, "openrouter")
  assert.match(skill.description, /^Find and compare OpenRouter models/)
  assert.match(skill.description, /openrouter-evaluate, openrouter-images or openrouter-troubleshoot/)
  assert.match(skill.content, /^# OpenRouter research and integration\n/)
  assert.equal(skill.content.includes("---"), false)
  assert.equal(skill.path, join(root, "skills", "openrouter", "SKILL.md"))
})

test("YAML block scalars are folded, literal or stripped as YAML specifies", () => {
  const cases: readonly [string, string, string][] = [
    ["folded", ">", "first line second line\n"],
    ["literal", "|", "first line\nsecond line\n"],
    ["folded-strip", ">-", "first line second line"],
    ["literal-strip", "|-", "first line\nsecond line"],
  ]
  for (const [name, marker, expected] of cases) {
    const directory = fixture({ [name]: `---\nname: ${name}\ndescription: ${marker}\n  first line\n  second line\n---\n\n# Body\n` })
    try {
      assert.equal(readSkills(directory)[0]?.description, expected, name)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
  const empty = fixture({ empty: "---\nname: empty\ndescription: >\n---\n\n# Body\n" })
  try {
    assert.throws(() => readSkills(empty), /has no frontmatter description/)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
  const marker = fixture({ marker: "---\nname: marker\ndescription: '>'\n---\n\n# Body\n" })
  try {
    assert.throws(() => readSkills(marker), /only a block marker/)
  } finally {
    rmSync(marker, { recursive: true, force: true })
  }
  const broken = fixture({ broken: "---\nname: broken\ndescription: [unclosed\n---\n\n# Body\n" })
  try {
    assert.throws(() => readSkills(broken), /has frontmatter that is not valid YAML/)
  } finally {
    rmSync(broken, { recursive: true, force: true })
  }
})

test("a skill file must have the frontmatter shape the plugin registers", () => {
  const cases: readonly [string, Readonly<Record<string, string>>, RegExp][] = [
    ["no frontmatter", { broken: "# Broken\n" }, /SCHEMA_VIOLATION: skills\/broken\/SKILL.md has no frontmatter\. Next step: /],
    ["no name", { broken: "---\ndescription: A description.\n---\n\n# Body\n" }, /has no frontmatter name/],
    ["another name", { broken: "---\nname: other\ndescription: A description.\n---\n\n# Body\n" }, /names "other", not its directory "broken"/],
    ["no description", { broken: "---\nname: broken\n---\n\n# Body\n" }, /has no frontmatter description/],
    ["empty content", { broken: "---\nname: broken\ndescription: A description.\n---\n\n" }, /has no content below its frontmatter/],
  ]
  for (const [name, files, expected] of cases) {
    const directory = fixture(files)
    try {
      assert.throws(() => readSkills(directory), expected, name)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
  const missing = mkdtempSync(join(tmpdir(), "plugin-skills-"))
  try {
    mkdirSync(join(missing, "empty"), { recursive: true })
    assert.throws(() => readSkills(missing), /skills\/empty\/SKILL.md is missing/)
  } finally {
    rmSync(missing, { recursive: true, force: true })
  }
  const none = mkdtempSync(join(tmpdir(), "plugin-skills-"))
  try {
    assert.throws(() => readSkills(none), /skills\/ holds no <name>\/SKILL\.md/)
  } finally {
    rmSync(none, { recursive: true, force: true })
  }
})

test("registerSkills adds every checked skill and returns a disposer", async () => {
  const added: { id: string; name: string; description?: string; path: string; content: string }[] = []
  let disposed = false
  const context = {
    skill: {
      async transform(callback: (editor: { add: (skill: (typeof added)[number]) => void }) => void) {
        callback({ add: (skill) => added.push(skill) })
        return {
          async dispose() {
            disposed = true
          },
        }
      },
    },
  } as unknown as Plugin.Context
  const registration = await registerSkills(context)
  assert.equal(added.length, 4)
  const skill = added.find((candidate) => candidate.id === "openrouter")
  assert.ok(skill !== undefined)
  assert.equal(skill.name, "openrouter")
  assert.match(skill.description ?? "", /^Find and compare OpenRouter models/)
  assert.equal(skill.path, join(root, "skills", "openrouter", "SKILL.md"))
  assert.match(skill.content, /^# OpenRouter research and integration\n/)
  await registration.dispose()
  assert.equal(disposed, true)
})
