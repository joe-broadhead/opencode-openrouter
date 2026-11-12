// The shipped skills: exactly the four, loadable, named after their folders, plain files, listed in the Jelly
// declaration and the package whitelist, and never naming a tool the reviewed catalog does not have.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { BILLABLE_TOOLS, TOOL_NAMES } from "../../src/openrouter-tools.js"
import { parseSkill, SKILL_NAMES, SKILLS_DIR } from "../../src/skills.js"

const read = (name: string) => readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8")
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { files: string[]; jelly: { skills: string[] } }
// Code spans that are hyphenated words but not tools.
const NOT_TOOLS = new Set(["ask-changes"])
const MAX_LINES = 80

/**
 * Every tool name a skill mentions, in the three forms it teaches: the native id `openrouter_list-models`, the Code Mode
 * member `tools.openrouter["list-models"]`, and the bare hyphenated name in a code span or prose, such as `list-models`.
 */
function mentioned(text: string) {
  const native = [...text.matchAll(/\bopenrouter_([a-z][a-z0-9-]*)/g)].map((match) => match[1]!)
  const members = [...text.matchAll(/\btools\.openrouter\[["']([^"']+)["']\]/g)].map((match) => match[1]!)
  const spans = [...text.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g)].map((match) => match[1]!).filter((span) => !NOT_TOOLS.has(span))
  // A verb-led hyphenated word in prose is a tool name too, so one that is mistyped or invented cannot hide unquoted.
  const prose = [...text.matchAll(/\b((?:list|get|send|search|spawn|install|generate|transcribe)-[a-z0-9-]*[a-z0-9])\b/g)].map((match) => match[1]!)
  return { native, members, spans, prose }
}

describe("the shipped skills", () => {
  test("are exactly the four, each a single SKILL.md, and exactly the Jelly declaration's list", () => {
    expect(readdirSync(SKILLS_DIR).sort()).toEqual([...SKILL_NAMES].sort())
    for (const name of SKILL_NAMES) expect(readdirSync(join(SKILLS_DIR, name))).toEqual(["SKILL.md"])
    expect(pkg.jelly.skills).toEqual([...SKILL_NAMES])
    expect(pkg.files).toContain("skills")
  })

  test.each([...SKILL_NAMES])("%s is a plain, non-executable LF file that loads under its own name", (name) => {
    const path = join(SKILLS_DIR, name, "SKILL.md")
    expect(statSync(path).mode & 0o111).toBe(0)
    expect(read(name)).not.toContain("\r")
    expect(read(name).endsWith("\n")).toBe(true)
    const skill = parseSkill(name, path, read(name))
    expect(skill.name as string).toBe(name)
    expect(skill.description?.length).toBeGreaterThan(40)
    expect(skill.content.length).toBeGreaterThan(500)
    // A YAML reader would split a description at either of these.
    expect(skill.description).not.toMatch(/: | #/)
    // Short enough to load whole: the family's length rule, and the limit a host truncates a description at.
    expect(read(name).split("\n").length).toBeLessThan(MAX_LINES)
    expect(skill.description!.length).toBeLessThanOrEqual(1024)
  })

  test("carry the descriptions that route a request to each skill", () => {
    const description = (name: string) => parseSkill(name, "/x", read(name)).description
    expect(description("openrouter")).toStartWith("Use live OpenRouter information to find and shortlist models")
    expect(description("openrouter-evaluate")).toStartWith("Run a bounded, authorized comparison or prompt test using OpenRouter models")
    expect(description("openrouter-images")).toStartWith("Generate requested images through OpenRouter's connected MCP service")
    expect(description("openrouter-troubleshoot")).toStartWith("Diagnose OpenRouter MCP connection, authentication, discovery, credit, generation, routing, or tool failures")
  })

  test.each([...SKILL_NAMES])("%s names only tools in the reviewed catalog, in every form it uses", (name) => {
    const { native, members, spans, prose } = mentioned(read(name))
    const unknown = [...new Set([...native, ...members, ...spans, ...prose])].filter((tool) => !TOOL_NAMES.includes(tool))
    expect(unknown).toEqual([])
    // Each skill names at least one tool, so the check above is never vacuous.
    expect(new Set([...native, ...members, ...spans, ...prose]).size).toBeGreaterThan(0)
  })

  test("the mention finder reads the hyphenated, native and Code Mode forms, and flags a tool that is not there", () => {
    const text = 'Use `list-models`, then openrouter_get-model or tools.openrouter["list-model-endpoints"]; never `list-everything` or openrouter_make-coffee, and `ask-changes` is a policy. Call get-widget in prose.'
    const found = mentioned(text)
    expect(found.native).toEqual(["get-model", "make-coffee"])
    expect(found.members).toEqual(["list-model-endpoints"])
    expect(found.spans).toEqual(["list-models", "list-everything"])
    expect(found.prose).toContain("get-widget")
    expect([...new Set([...found.native, ...found.members, ...found.spans, ...found.prose])].filter((tool) => !TOOL_NAMES.includes(tool)).sort()).toEqual(["get-widget", "list-everything", "make-coffee"])
  })

  test("together the skills name every tool in the catalog, by its exact name", () => {
    const all = new Set(SKILL_NAMES.flatMap((name) => Object.values(mentioned(read(name))).flat()).filter((tool) => TOOL_NAMES.includes(tool)))
    for (const tool of TOOL_NAMES) expect({ tool, used: all.has(tool) }).toEqual({ tool, used: true })
  })

  test("the research skill calls no billable tool, and routes paid and media requests to the other skills", () => {
    const research = read("openrouter")
    for (const tool of BILLABLE_TOOLS) expect(research).toContain(`\`${tool}\``)
    expect(research).toContain("Route paid tests to the evaluate skill and media requests to the images skill")
    expect(research).toContain("not the user's own spend")
  })

  test("every billable tool is used only on an explicit request, called once, and checked before any repeat", () => {
    const evaluate = read("openrouter-evaluate")
    expect(evaluate).toContain("use those two only when the user explicitly asks")
    expect(evaluate).toContain("Use `send-batch` only when the user explicitly asks for an offline batch")
    expect(evaluate).toContain("Never resubmit a batch after a timeout or an unclear answer")
    expect(evaluate).toContain("after a timeout or ambiguous failure, look the call up this way before deciding whether to repeat it")
    const images = read("openrouter-images")
    expect(images).toContain("only on the user's explicit request, one agreed call, the native tool only (never a script), no automatic retry")
    expect(images).toContain("Never call `generate-video` again to check on a job")
    expect(images).toContain("check `get-generation` or `get-video` before deciding with the user whether to repeat the call")
    const troubleshoot = read("openrouter-troubleshoot")
    expect(troubleshoot).toContain("use `get-current-key` first")
    expect(troubleshoot).toContain("check `get-generation`, `get-batch`, or `get-video` for what actually ran")
    for (const tool of BILLABLE_TOOLS) expect(troubleshoot).toContain(`\`${tool}\``)
  })

  test("name no script surface for the image tool, and keep it out of Code Mode", () => {
    const images = read("openrouter-images")
    expect(images).toContain("`openrouter_generate-image`")
    expect(images).not.toContain('tools.openrouter["generate-image"]')
  })

  test("carry no machine-local path or address", () => {
    for (const name of SKILL_NAMES) {
      const text = read(name)
      expect({ name, paths: text.match(/\/(?:home|Users)\/[\w.-]+\//g) ?? [] }).toEqual({ name, paths: [] })
      expect({ name, emails: text.match(/[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/g) ?? [] }).toEqual({ name, emails: [] })
    }
  })
})
