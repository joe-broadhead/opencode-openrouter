// The default rules: generated from the catalog for each access, inserted after the first base allow only, detected as
// a whole contiguous block (a partial block is not installed), idempotent on replay, with later rules still winning,
// strict agents left alone, and unguarded agents told apart from an explicit user allow.
import { describe, expect, test } from "bun:test"
import { nativeToolId } from "../../src/mcp.js"
import { BILLABLE_TOOLS, CHANGE_TOOLS, READ_TOOLS, REVIEWED_TOOLS } from "../../src/openrouter-tools.js"
import { ACCESS, type Access } from "../../src/options.js"
import type { ServerSource } from "../../src/mcp.js"
import { applyDefaultRules, BASE_ALLOW, BASELINE_ACTION, defaultRules, hasDefaultRules, insertRules, lastMatch, registerDefaultRules, rulesApply, agentCoverage, type Rule } from "../../src/permissions.js"
import { transforms } from "./fake.js"

const rule = (action: string, effect: Rule["effect"]): Rule => ({ action, resource: "*", effect })
const UNKNOWN = nativeToolId("tool-added-later")
const FEEDBACK = CHANGE_TOOLS.filter((name) => !BILLABLE_TOOLS.includes(name))

/** The host's last-match result for one action under `rules`, with no match asking. */
const decide = (rules: readonly Rule[], action: string) => lastMatch(rules, action)?.effect ?? "ask"

describe("the generated block", () => {
  test("is the broad openrouter_* baseline first, then one exact rule per reviewed tool, in catalog order", () => {
    for (const access of ACCESS) {
      const block = defaultRules(access)
      expect(block[0]).toEqual(rule("openrouter_*", access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny"))
      expect(block.slice(1).map((item) => item.action)).toEqual(REVIEWED_TOOLS.map((tool) => nativeToolId(tool.name)))
      expect(block.every((item) => item.resource === "*")).toBe(true)
      expect(BASELINE_ACTION).toBe("openrouter_*")
    }
  })

  test("follows the access matrix: reads allowed everywhere; billable tools, media, feedback and unknown tools deny, ask or allow", () => {
    const expected: Record<Access, Rule["effect"]> = { "read-only": "deny", "ask-changes": "ask", all: "allow" }
    for (const access of ACCESS) {
      const rules = [BASE_ALLOW, ...defaultRules(access)]
      for (const name of READ_TOOLS) expect({ access, name, effect: decide(rules, nativeToolId(name)) }).toEqual({ access, name, effect: "allow" })
      for (const name of [...BILLABLE_TOOLS, ...FEEDBACK]) expect({ access, name, effect: decide(rules, nativeToolId(name)) }).toEqual({ access, name, effect: expected[access] })
      expect({ access, effect: decide(rules, UNKNOWN) }).toEqual({ access, effect: expected[access] })
      // Another server's tools are not matched.
      expect(decide(rules, "github_create_issue")).toBe("allow")
    }
    // The live server's spenders: speech, video, batches, decisions and transcription ask under ask-changes, like send-message.
    expect([...BILLABLE_TOOLS].sort()).toEqual(["generate-image", "generate-speech", "generate-video", "send-batch", "send-decision", "send-message", "transcribe-audio"])
    expect(FEEDBACK).toEqual(["send-feedback"])
    const askChanges = [BASE_ALLOW, ...defaultRules("ask-changes")]
    for (const name of ["generate-speech", "generate-video", "send-batch", "send-decision", "transcribe-audio"]) expect({ name, effect: decide(askChanges, nativeToolId(name)) }).toEqual({ name, effect: "ask" })
  })
})

describe("insertion", () => {
  test("goes right after the first base allow, before every later rule, and later rules still win", () => {
    const later = rule(nativeToolId("send-message"), "allow")
    const deny = rule(nativeToolId("list-models"), "deny")
    const permissions: Rule[] = [rule("edit", "ask"), BASE_ALLOW, rule("bash", "ask"), later, deny, BASE_ALLOW]
    expect(insertRules(permissions, "ask-changes")).toBe(true)
    expect(permissions).toEqual([rule("edit", "ask"), BASE_ALLOW, ...defaultRules("ask-changes"), rule("bash", "ask"), later, deny, BASE_ALLOW])
    expect(decide(permissions.slice(0, -1), nativeToolId("send-message"))).toBe("allow")
    expect(decide(permissions.slice(0, -1), nativeToolId("list-models"))).toBe("deny")
  })

  test("is idempotent on replay: the whole block is found and not inserted again", () => {
    const permissions: Rule[] = [BASE_ALLOW, rule("bash", "ask")]
    insertRules(permissions, "read-only")
    const once = structuredClone(permissions)
    expect(insertRules(permissions, "read-only")).toBe(false)
    expect(permissions).toEqual(once)
    expect(permissions.filter((item) => item.action === "openrouter_*")).toHaveLength(1)
  })

  test("finds the block after another plugin's block at the same place", () => {
    const other = [rule("notion_*", "allow"), rule("notion_notion-search", "allow")]
    const permissions: Rule[] = [BASE_ALLOW, ...other, ...defaultRules("all"), rule("bash", "ask")]
    expect(hasDefaultRules(permissions, "all")).toBe(true)
    expect(insertRules(permissions, "all")).toBe(false)
  })

  test("leaves a strict agent without a base allow unchanged", () => {
    const strict: Rule[] = [rule("*", "deny"), rule("read", "allow"), rule("openrouter_*", "allow")]
    const before = structuredClone(strict)
    for (const access of ACCESS) {
      expect(insertRules(strict, access)).toBe(false)
      expect(hasDefaultRules(strict, access)).toBe(false)
    }
    expect(strict).toEqual(before)
    // A `* * allow` written with another resource or effect is not a base allow.
    const near: Rule[] = [{ action: "*", resource: "src/*", effect: "allow" }, rule("*", "ask")]
    expect(insertRules(near, "ask-changes")).toBe(false)
  })
})

describe("block detection", () => {
  test("a partial block is not installed: missing tail, missing middle, or a changed effect", () => {
    const block = defaultRules("ask-changes")
    const cases: Rule[][] = [
      block.slice(0, -1),
      block.slice(1),
      [...block.slice(0, 5), ...block.slice(6)],
      block.map((item, index) => (index === 3 ? { ...item, effect: "deny" as const } : item)),
    ]
    for (const partial of cases) {
      const permissions = [BASE_ALLOW, ...partial, rule("bash", "ask")]
      expect(hasDefaultRules(permissions, "ask-changes")).toBe(false)
      // Insertion then adds the whole block, which is detected.
      expect(insertRules(permissions, "ask-changes")).toBe(true)
      expect(hasDefaultRules(permissions, "ask-changes")).toBe(true)
    }
  })

  test("a block split by another rule, before the base allow, or for another access is not installed", () => {
    const block = defaultRules("read-only")
    expect(hasDefaultRules([BASE_ALLOW, ...block.slice(0, 4), rule("bash", "ask"), ...block.slice(4)], "read-only")).toBe(false)
    expect(hasDefaultRules([...block, BASE_ALLOW], "read-only")).toBe(false)
    expect(hasDefaultRules([BASE_ALLOW, ...defaultRules("all")], "read-only")).toBe(false)
    expect(hasDefaultRules([BASE_ALLOW, ...block], "read-only")).toBe(true)
  })
})

describe("one transform pass", () => {
  type Agent = { id: string; permissions: Rule[] }
  const editor = (agents: Agent[]) => ({ list: () => agents, update: (id: string, update: (agent: Agent) => void) => update(agents.find((agent) => agent.id === id)!) })

  test("inserts into every agent with a base allow, leaves strict agents alone, and reports success", () => {
    const agents: Agent[] = [
      { id: "build", permissions: [BASE_ALLOW] },
      { id: "strict", permissions: [rule("*", "deny")] },
    ]
    expect(applyDefaultRules(editor(agents) as never, "ask-changes")).toBeUndefined()
    expect(agents[0]!.permissions).toEqual([BASE_ALLOW, ...defaultRules("ask-changes")])
    expect(agents[1]!.permissions).toEqual([rule("*", "deny")])
  })

  test("reports a failure, redacted and on one line, instead of throwing", () => {
    const failing = { list: () => [{ id: "build" }], update: () => { throw new Error("agent store closed\nBearer sk-or-v1-0123456789abcdef0123456789") } }
    expect(applyDefaultRules(failing as never, "ask-changes")).toBe("agent store closed Bearer [redacted]")
  })

  test("reports a pass where another transform's edit leaves the block incomplete", () => {
    const agents: Agent[] = [{ id: "build", permissions: [BASE_ALLOW] }]
    const sabotaged = { list: () => agents, update: (_id: string, update: (agent: Agent) => void) => {
      const agent = agents[0]!
      const permissions = new Proxy(agent.permissions, {
        get(target, key, receiver) {
          if (key === "splice") return (start: number, _count: number, ...items: Rule[]) => target.splice(start, 0, ...items.slice(1))
          return Reflect.get(target, key, receiver)
        },
      })
      update({ ...agent, permissions })
    } }
    expect(applyDefaultRules(sabotaged as never, "all")).toBe("the block is missing from 1 agent after insertion")
  })

  test("the registered transform reports each pass, and the fault fails a pass without touching any agent", async () => {
    const agent = transforms<never>()
    const reports: (string | undefined)[] = []
    let fault = false
    await registerDefaultRules({ transform: agent.transform } as never, "read-only", () => ({ type: "plugin" }), (failure) => reports.push(failure), () => fault)
    const agents: Agent[] = [{ id: "build", permissions: [BASE_ALLOW] }]
    agent.run(editor(agents) as never)
    fault = true
    agent.run(editor([{ id: "plan", permissions: [BASE_ALLOW] }]) as never)
    expect(reports).toEqual([undefined, "injected failure"])
    expect(agents[0]!.permissions).toEqual([BASE_ALLOW, ...defaultRules("read-only")])
  })
})

describe("the server entry the rules are for", () => {
  type Agent = { id: string; permissions: Rule[] }
  const editor = (agents: Agent[]) => ({ list: () => agents, update: (id: string, update: (agent: Agent) => void) => update(agents.find((agent) => agent.id === id)!) })

  test("the block goes in for the plugin's own, an adopted and a pending entry, and never for a conflict or a disabled one", async () => {
    const sources: ServerSource[] = [{ type: "plugin" }, { type: "adopted", signIn: "oauth" }, { type: "pending" }, { type: "conflict", safeDescription: "x" }, { type: "disabled" }]
    expect(sources.map(rulesApply)).toEqual([true, true, true, false, false])
    let source: ServerSource = { type: "pending" }
    const agent = transforms<never>()
    const reports: (string | undefined)[] = []
    await registerDefaultRules({ transform: agent.transform } as never, "ask-changes", () => source, (failure) => reports.push(failure))
    const pending: Agent[] = [{ id: "build", permissions: [BASE_ALLOW] }]
    agent.run(editor(pending) as never)
    expect(pending[0]!.permissions).toEqual([BASE_ALLOW, ...defaultRules("ask-changes")])
    // The replay that finds the conflict starts from the configured rules again and adds nothing.
    source = { type: "conflict", safeDescription: "ends with a trailing slash" }
    const conflict: Agent[] = [{ id: "build", permissions: [BASE_ALLOW] }]
    agent.run(editor(conflict) as never)
    expect(conflict[0]!.permissions).toEqual([BASE_ALLOW])
    expect(reports).toEqual([undefined, undefined])
  })
})

describe("agent coverage", () => {
  const agent = (id: string, permissions: Rule[]) => ({ id, permissions })

  test("names an agent whose OpenRouter changes fall through to a broad allow, and gives nothing under all", () => {
    const agents = [
      agent("build", [BASE_ALLOW, ...defaultRules("ask-changes")]),
      agent("custom", [BASE_ALLOW, rule("bash", "ask")]),
      agent("strict", [rule("*", "deny")]),
    ]
    expect(agentCoverage(agents, "ask-changes")).toEqual({ unguarded: ["custom"], explicitlyAllowed: [] })
    expect(agentCoverage(agents, "read-only")).toEqual({ unguarded: ["custom"], explicitlyAllowed: [] })
    expect(agentCoverage(agents, "all")).toEqual({ unguarded: [], explicitlyAllowed: [] })
  })

  test("a later broad allow after the block is unguarded, even though the whole block is present", () => {
    const later = agent("build", [BASE_ALLOW, ...defaultRules("ask-changes"), rule("bash", "ask"), BASE_ALLOW])
    expect(hasDefaultRules(later.permissions, "ask-changes")).toBe(true)
    expect(agentCoverage([later], "ask-changes")).toEqual({ unguarded: ["build"], explicitlyAllowed: [] })
    // A later broad ask or deny is not.
    expect(agentCoverage([agent("ask", [BASE_ALLOW, ...defaultRules("read-only"), rule("*", "ask")])], "read-only").unguarded).toEqual([])
  })

  test("an explicit OpenRouter allow is reported apart, as an intentional decision", () => {
    const explicit = agent("reviewer", [BASE_ALLOW, ...defaultRules("ask-changes"), rule("openrouter_*", "allow")])
    const one = agent("tester", [BASE_ALLOW, ...defaultRules("read-only"), rule(nativeToolId("send-message"), "allow")])
    const partial = agent("partial", [BASE_ALLOW, rule(nativeToolId("send-message"), "deny")])
    const both = agent("both", [BASE_ALLOW, rule(nativeToolId("send-feedback"), "allow")])
    expect(agentCoverage([explicit, one, partial, both], "read-only")).toEqual({ unguarded: ["partial", "both"], explicitlyAllowed: ["reviewer", "tester", "both"] })
  })
})
