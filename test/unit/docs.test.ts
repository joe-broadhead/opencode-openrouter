// The docs agree with the code: the README's error table is CODES, the install section claims no unpublished tag, the
// skills table is SKILL_NAMES, the scripting guide's table is the catalog, every GitHub URL is the new repository, and
// no doc carries a machine path or an address.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { CODES, ENDPOINT } from "../../src/constants.js"
import { actionEffectOf, NATIVE_ONLY, REVIEWED_TOOLS, RPC_TOOLS, SPEND_TOOLS } from "../../src/openrouter-tools.js"
import { SKILL_NAMES } from "../../src/skills.js"

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
const DOCS = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "CHANGELOG.md", "SECURITY.md", "docs/scripting.md"]
const REPOSITORY = "we-the-rebel-alliance/openrouter-plugin"

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

  test("names the new repository and package, and claims no unpublished release", () => {
    expect(readme).toContain("we-the-rebel-alliance/openrouter-plugin")
    expect(readme).toContain("There is no release yet")
    expect(readme).toContain("github:we-the-rebel-alliance/openrouter-plugin#v<version>")
    expect(readme).not.toContain("joe-broadhead")
    expect(readme).not.toContain("opencode-openrouter")
    expect(readme).toContain("## Install\n")
    expect(readme).toContain("## Known limits")
  })

  test("names the endpoint and the two OpenRouter connections", () => {
    expect(readme).toContain(ENDPOINT)
    expect(readme).toContain("**OpenRouter tools**")
    expect(readme).toContain("built-in model provider")
    expect(readme).toContain("passes the server's instructions to the model verbatim")
  })

  test("states the one spend classification and every spending tool", () => {
    for (const name of SPEND_TOOLS) expect(readme).toContain(`\`${name}\``)
    expect(readme).toContain("exactly one spend class")
    expect(readme).toContain("`send-feedback` sends feedback and spends nothing")
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

  test("gives each method the catalog's class, spend class and output evidence", () => {
    for (const name of RPC_TOOLS) {
      const tool = REVIEWED_TOOLS.find((item) => item.name === name)!
      const row = rows.find((cells) => cells[0] === `\`${name}\``)!
      const spend = tool.spend ? "spend" : tool.effect === "send" ? "notify" : "free"
      expect({ name, class: row[1], spend: row[2], evidence: row[4] } as Record<string, string | undefined>).toEqual({
        name,
        class: `\`${tool.effect}\``,
        spend,
        evidence: tool.scriptOutput,
      })
    }
  })

  test("names the native-only tools as not methods", () => {
    for (const name of NATIVE_ONLY) expect(scripting).toContain(`\`${name}\` is **not** a method`)
  })

  test("maps every change to the effect the contract will take, from the one column", () => {
    for (const tool of REVIEWED_TOOLS) {
      const effect = actionEffectOf(tool)
      if (tool.effect === "read") expect(effect).toBeUndefined()
      else expect(scripting).toContain(tool.spend ? "`spend` bills the account" : "`notify` sends feedback")
    }
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

  test("points every GitHub repository URL at the new repository, with file links under blob/master", () => {
    for (const path of DOCS) {
      const urls = read(path).match(/https?:\/\/github\.com\/[^\s)"'<>]+/g) ?? []
      for (const url of urls) {
        expect({ path, url }).toEqual({ path, url: expect.stringMatching(new RegExp(`^https://github\\.com/${REPOSITORY}(/|$)`)) })
      }
      const fileLinks = urls.filter((url) => /\/(?:blob|tree)\//.test(url))
      for (const url of fileLinks) expect({ path, url }).toEqual({ path, url: expect.stringContaining(`https://github.com/${REPOSITORY}/blob/master/`) })
    }
  })

  test("names a release tag only in the placeholder form, never an unpublished one", () => {
    for (const path of DOCS) {
      const specs = read(path).match(new RegExp(`${REPOSITORY}#v[^\\s"'\`)]*`, "g")) ?? []
      for (const spec of specs) expect({ path, spec }).toEqual({ path, spec: `${REPOSITORY}#v<version>` })
    }
  })
})
