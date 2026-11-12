// The docs agree with the code: the README's error table is CODES, the README never claims a release exists, the
// contract matrix names every reviewed tool and claims nothing live, and no doc carries a machine path or an address.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { CODES, ENDPOINT } from "../../src/constants.js"
import { NATIVE_ONLY, REVIEWED_TOOLS, RPC_TOOLS, TOOL_NAMES } from "../../src/openrouter-tools.js"
import { SKILL_NAMES } from "../../src/skills.js"

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
const DOCS = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "CHANGELOG.md", "docs/contract.md", "docs/scripting.md"]

/** The rows of the markdown table under a `## heading`, as cells. */
function table(markdown: string, heading: string) {
  const section = markdown.split(/^## /m).find((part) => part.startsWith(`${heading}\n`)) ?? ""
  return section
    .split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
    .slice(1)
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
}

describe("the README", () => {
  const readme = read("README.md")

  test("its Errors table is exactly CODES, in order", () => {
    expect(table(readme, "Errors")).toEqual(Object.entries(CODES).map(([code, { when }]) => [`\`${code}\``, when]))
  })

  test("says no release exists yet, and names v0.0.0 only as planned", () => {
    expect(readme).toContain("**Not yet released.**")
    expect(readme).toContain("## Installation (planned for v0.0.0)")
    expect(readme).toContain("## Known limits")
  })

  test("names the endpoint and the two OpenRouter connections", () => {
    expect(readme).toContain(ENDPOINT)
    expect(readme).toContain("**OpenRouter tools**")
    expect(readme).toContain("built-in model provider")
  })
})

describe("the README's skills section", () => {
  const readme = read("README.md")

  test("lists exactly the four packaged skills, and says a user's skill of the same name is kept", () => {
    expect(table(readme, "Skills").map((cells) => cells[0])).toEqual(SKILL_NAMES.map((name) => `\`${name}\``))
    expect(readme).toContain("If you already have a skill with one of these names, yours is kept")
  })
})

describe("the scripting guide", () => {
  const scripting = read("docs/scripting.md")
  const rows = table(`## Methods\n${scripting.split("## The methods\n")[1]!.split("\n## ")[0]}`, "Methods")

  test("lists exactly the script methods, in catalog order, then describe", () => {
    expect(rows.map((cells) => cells[0])).toEqual([...RPC_TOOLS, "describe"].map((name) => `\`${name}\``))
  })

  test("gives each method the catalog's class and output evidence, and claims nothing live", () => {
    for (const name of RPC_TOOLS) {
      const tool = REVIEWED_TOOLS.find((item) => item.name === name)!
      const row = rows.find((cells) => cells[0] === `\`${name}\``)!
      expect({ name, class: row[1], evidence: row[3] } as Record<string, string | undefined>).toEqual({ name, class: `\`${tool.effect}\``, evidence: tool.scriptOutput })
    }
    expect(scripting).not.toMatch(/\|\s*live-observed\s*\|/)
  })

  test("names the native-only tools as not methods", () => {
    for (const name of NATIVE_ONLY) expect(scripting).toContain(`\`${name}\` is **not** a method`)
  })
})

describe("the contract matrix", () => {
  const contract = read("docs/contract.md")

  test("names every reviewed tool", () => {
    for (const name of TOOL_NAMES) expect(contract).toContain(`\`${name}\``)
  })

  test("labels no row live-observed until a signed-in capture exists", () => {
    const labels = contract.split("\n").filter((line) => line.startsWith("|")).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    expect(labels.filter((cells) => cells.length >= 3 && /live-observed/.test(cells[1] ?? ""))).toEqual([])
    expect(contract).toContain("**No row has this label yet.**")
  })
})

describe("every doc", () => {
  test("carries no machine-local path and no address other than the GitHub noreply one", () => {
    for (const path of DOCS) {
      const text = read(path)
      expect({ path, paths: text.match(/\/(?:home|Users)\/[\w.-]+\//g) ?? [] }).toEqual({ path, paths: [] })
      const emails = (text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}\b/g) ?? []).filter((email) => !email.endsWith("@users.noreply.github.com"))
      expect({ path, emails }).toEqual({ path, emails: [] })
    }
  })
})
