import assert from "node:assert/strict"
import { test } from "node:test"
import { RegisterError } from "@we-the-rebel-alliance/plugin-contract/register"
import { parseSkill } from "../../src/skills.ts"

/** A skill file with one front-matter description line. */
const skill = (description: string): string => `---\nname: openrouter-test\ndescription: ${description}\n---\n\n# Test skill\n`

/** The contract code a parse refuses with. */
function codeOf(action: () => unknown): string | undefined {
  try {
    action()
    return undefined
  } catch (error) {
    return error instanceof RegisterError ? error.refusal.code : undefined
  }
}

test("parseSkill reads a one-line description and the body", () => {
  const parsed = parseSkill("openrouter-test", "/tmp/openrouter-test/SKILL.md", skill("A one-line description."))
  assert.equal(parsed.name, "openrouter-test")
  assert.equal(parsed.description, "A one-line description.")
  assert.equal(parsed.content, "# Test skill")
})

test("parseSkill refuses an empty description", () => {
  assert.equal(codeOf(() => parseSkill("openrouter-test", "/tmp/SKILL.md", "---\nname: openrouter-test\ndescription:\n---\n\n# Body\n")), "UNAVAILABLE")
})

test("parseSkill refuses a lone folded-block indicator as the description", () => {
  assert.equal(codeOf(() => parseSkill("openrouter-test", "/tmp/SKILL.md", skill(">"))), "UNAVAILABLE")
})

test("parseSkill refuses a lone literal-block indicator as the description", () => {
  assert.equal(codeOf(() => parseSkill("openrouter-test", "/tmp/SKILL.md", skill("|"))), "UNAVAILABLE")
})

test("parseSkill refuses a block indicator with chomping", () => {
  for (const indicator of [">-", ">+", "|-", "|+"]) {
    assert.equal(codeOf(() => parseSkill("openrouter-test", "/tmp/SKILL.md", skill(indicator))), "UNAVAILABLE", indicator)
  }
})

test("the empty and block-scalar cases refuse with the contract's UNAVAILABLE", () => {
  assert.equal(codeOf(() => parseSkill("openrouter-test", "/tmp/SKILL.md", "---\nname: openrouter-test\ndescription:\n---\n\n# Body\n")), "UNAVAILABLE")
  assert.equal(codeOf(() => parseSkill("openrouter-test", "/tmp/SKILL.md", skill(">"))), "UNAVAILABLE")
  assert.equal(codeOf(() => parseSkill("openrouter-test", "/tmp/SKILL.md", skill("|"))), "UNAVAILABLE")
})

test("parseSkill strips matching single and double quotes", () => {
  assert.equal(parseSkill("openrouter-test", "/tmp/SKILL.md", skill('"A quoted: description."')).description, "A quoted: description.")
  assert.equal(parseSkill("openrouter-test", "/tmp/SKILL.md", skill("'A single-quoted description.'")).description, "A single-quoted description.")
})

test("parseSkill refuses a quoted block indicator", () => {
  assert.equal(codeOf(() => parseSkill("openrouter-test", "/tmp/SKILL.md", skill('">"'))), "UNAVAILABLE")
  assert.equal(codeOf(() => parseSkill("openrouter-test", "/tmp/SKILL.md", skill('"|"'))), "UNAVAILABLE")
})
