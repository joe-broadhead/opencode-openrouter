// The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly's agents have no base allow
// rule, so this plugin's own rules never reach them: Jelly writes each declared "ask" or "deny" as that tool's default.
// Every entry derives from the one catalog and the default rules, so these tests keep them in step.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { DISPLAY_NAME, SERVER_NAME } from "../../src/constants.js"
import { nativeToolId } from "../../src/mcp.js"
import { BILLABLE_TOOLS, READ_TOOLS, REVIEWED_TOOLS } from "../../src/openrouter-tools.js"
import { ACCESS, DEFAULT_ACCESS, parseOptions } from "../../src/options.js"
import { BASE_ALLOW, defaultRules, lastMatch } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { ACCESS_CHOICES, type DeclaredSetting, settingChoices, settingsProblems, settingValueIssue } from "../support/jelly-settings.js"

type Tool = { name: string; permission: string; effect: "allow" | "ask" | "deny"; readOnly: boolean }
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  jelly: { title: string; summary: string; icon: string; tools: Tool[]; skills: string[]; rpc: unknown[]; views: unknown[]; signIns: Record<string, string>[]; contributes: unknown }
}
const { jelly } = pkg

describe("the jelly declaration", () => {
  test("declares all 31 reviewed tools once, in catalog order, and no tool the catalog has not reviewed", () => {
    expect(jelly.tools.map((tool) => tool.permission)).toEqual(REVIEWED_TOOLS.map((tool) => nativeToolId(tool.name)))
    expect(jelly.tools).toHaveLength(31)
  })

  test("each tool's name is its Code Mode path with the hyphens intact, and its permission the host's action", () => {
    for (const tool of jelly.tools) {
      expect(tool.name).toStartWith(`${SERVER_NAME}.`)
      expect(tool.name.replace(".", "_")).toBe(tool.permission)
      expect(Object.keys(tool).sort()).toEqual(["effect", "name", "permission", "readOnly"])
    }
    expect(jelly.tools.map((tool) => tool.name)).toContain("openrouter.send-message")
  })

  test("each declared effect is what the default rules decide under the default access; reads are read-only, billable tools are not", () => {
    const rules = [BASE_ALLOW, ...defaultRules(DEFAULT_ACCESS)]
    for (const tool of jelly.tools) expect([tool.permission, tool.effect]).toEqual([tool.permission, lastMatch(rules, tool.permission)!.effect])
    for (const name of READ_TOOLS) expect(jelly.tools.find((tool) => tool.permission === nativeToolId(name))).toMatchObject({ effect: "allow", readOnly: true })
    for (const name of BILLABLE_TOOLS) expect(jelly.tools.find((tool) => tool.permission === nativeToolId(name))).toMatchObject({ effect: "ask", readOnly: false })
    expect(jelly.tools.find((tool) => tool.permission === nativeToolId("send-feedback"))).toMatchObject({ effect: "ask", readOnly: false })
  })

  test("uses only the keys Jelly reads: its contracts strip any other, and refuse an unknown key inside an entry", () => {
    expect(Object.keys(jelly).sort()).toEqual(["contributes", "icon", "rpc", "signIns", "skills", "summary", "title", "tools", "views"])
  })

  test("names the four skills, the one sign-in by server, and no views, Jelly RPC, feeds or widgets", () => {
    expect(jelly.title).toBe("OpenRouter")
    expect(jelly.icon).toBe("assets/icon.svg")
    expect(jelly.skills).toEqual([...SKILL_NAMES])
    expect([...jelly.skills].sort()).toEqual(readdirSync(new URL("../../skills", import.meta.url)).sort())
    // The sign-in resolves the MCP server's own integration, never the built-in model provider's, and its label never
    // says MCP.
    expect(jelly.signIns).toEqual([{ id: SERVER_NAME, label: DISPLAY_NAME, server: SERVER_NAME }])
    expect(jelly.signIns[0]!.label).not.toMatch(/\bMCP\b/i)
    // The plugin's own status and tools RPCs are host RPCs; Jelly's rpc list is a different surface and stays empty.
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({
      homeFeeds: [],
      homeWidgets: [],
      workKinds: [],
      settings: [
        {
          key: "access",
          label: "Access",
          type: "string",
          choices: ACCESS_CHOICES,
          default: "ask-changes",
          description: "all, ask-changes or read-only. Generates default rules for agents with a base allow rule.",
        },
      ],
    })
  })

  test("the settings pass Jelly's setting contract, and access offers Jelly's three choices with the plugin's default", () => {
    const { settings } = jelly.contributes as { settings: DeclaredSetting[] }
    expect(settingsProblems(settings)).toEqual([])
    const access = settings.find((setting) => setting.key === "access")!
    expect(access.choices).toEqual([...ACCESS_CHOICES])
    expect(access.default).toBe(DEFAULT_ACCESS)
  })

  test("every declared choice is a value the options parser takes, and the parser refuses a value outside the set", () => {
    const { settings } = jelly.contributes as { settings: DeclaredSetting[] }
    const access = settings.find((setting) => setting.key === "access")!
    const values = settingChoices(access)!.map((choice) => choice.value)
    expect(values).toEqual([...ACCESS])
    for (const value of values) {
      expect(settingValueIssue(access, value)).toBeNull()
      expect(parseOptions({ access: value }).access as string).toBe(value)
    }
    for (const outside of ["write", "read", "none", ""]) {
      expect(settingValueIssue(access, outside)).not.toBeNull()
      expect(() => parseOptions({ access: outside })).toThrow("OPTIONS_INVALID")
    }
  })

  test("declares no billing, budget or media field: no key at any depth names one", () => {
    const keys = (value: unknown): string[] =>
      Array.isArray(value) ? value.flatMap(keys) : value !== null && typeof value === "object" ? Object.entries(value).flatMap(([key, item]) => [key, ...keys(item)]) : []
    expect(keys(jelly).filter((key) => /billing|budget|price|cost|media|spend/i.test(key))).toEqual([])
  })

  test("the summary is one line of 1 to 120 characters", () => {
    expect(jelly.summary.trim().length).toBeGreaterThan(0)
    expect(jelly.summary.length).toBeLessThanOrEqual(120)
    expect(jelly.summary).not.toContain("\n")
  })
})
