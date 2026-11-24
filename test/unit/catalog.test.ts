// The reviewed catalog: the 31 tools of the live capture, one classification each, derived lists that agree with it,
// and the documentation-derived fixture and its provenance, which is never relabelled as live.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  ACTION_EFFECTS,
  actionEffectOf,
  CHANGE_TOOLS,
  LIVE_VERIFIED_SCRIPT_METHODS,
  MCP_DOCS,
  NATIVE_ONLY,
  NOTIFY_TOOLS,
  READ_TOOLS,
  REVIEWED_TOOLS,
  reviewedTool,
  RPC_TOOLS,
  SPEND_TOOLS,
  TOOL_NAMES,
} from "../../src/openrouter-tools.js"
import { NAMESPACE_DESCRIPTION } from "../../src/constants.js"
import { canonicalJson, sha256 } from "./canonical.js"

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"))
const documented = fixture("documented-tools.json") as { evidence: string; source: string; tools: { name: string; purpose: string }[] }
const live = fixture("live-tools.json") as { tools: { name: string; annotations: Record<string, unknown> | null }[] }
const provenance = fixture("provenance.json") as {
  captures: { fixture: string; evidence: string; endpoint: string; digest: { algorithm: string; value: string }; schemas: string }[]
  live: unknown
}

describe("the reviewed catalog", () => {
  test("names exactly the 31 tools the live server lists, once each, and every documented tool among them", () => {
    expect(TOOL_NAMES).toHaveLength(31)
    expect(new Set(TOOL_NAMES).size).toBe(31)
    expect([...TOOL_NAMES].sort()).toEqual(live.tools.map((tool) => tool.name).sort())
    for (const { name } of documented.tools) expect(TOOL_NAMES).toContain(name)
  })

  test("keeps upstream names: lower-case words joined by hyphens, never renamed with underscores", () => {
    for (const name of TOOL_NAMES) expect(name).toMatch(/^[a-z]+(?:-[a-z]+)*$/)
    expect(TOOL_NAMES).toContain("list-models")
    expect(TOOL_NAMES).not.toContain("search-models")
  })

  test("everything that can spend or act outside the machine is a change: spending inference and media, batches, decisions, transcription, feedback", () => {
    expect([...CHANGE_TOOLS].sort()).toEqual(["generate-image", "generate-speech", "generate-video", "send-batch", "send-decision", "send-feedback", "send-message", "transcribe-audio"])
    expect([...SPEND_TOOLS].sort()).toEqual(["generate-image", "generate-speech", "generate-video", "send-batch", "send-decision", "send-message", "transcribe-audio"])
    for (const name of ["send-batch", "send-decision", "send-message", "transcribe-audio"]) expect(reviewedTool(name)).toMatchObject({ effect: "write", spend: true, visibility: "execution", rpc: true })
    expect(reviewedTool("send-feedback")).toMatchObject({ name: "send-feedback", effect: "send", spend: false, visibility: "execution", rpc: true, scriptOutput: "synthetic" })
    // Every tool the server marks as not read-only is a change here.
    for (const tool of live.tools) if (tool.annotations?.["readOnlyHint"] === false) expect({ name: tool.name, change: CHANGE_TOOLS.includes(tool.name) }).toEqual({ name: tool.name, change: true })
  })

  test("the media generators are native only, like generate-image; get-current-key is native only, so a script never sees key metadata", () => {
    for (const name of ["generate-image", "generate-speech", "generate-video"]) {
      expect(reviewedTool(name)).toMatchObject({ name, effect: "write", spend: true, visibility: "execution", rpc: false, rpcExclusion: "native-media-required" })
    }
    expect(reviewedTool("get-current-key")).toMatchObject({ name: "get-current-key", effect: "read", spend: false, visibility: "account-data", rpc: false, rpcExclusion: "key-metadata" })
    expect([...NATIVE_ONLY].sort()).toEqual(["generate-image", "generate-speech", "generate-video", "get-current-key"])
    for (const tool of REVIEWED_TOOLS) expect(tool.rpcExclusion !== undefined).toBe(!tool.rpc)
  })

  test("reads never spend, and the account's own data and the recipes are marked as such", () => {
    expect(READ_TOOLS).toHaveLength(23)
    for (const name of READ_TOOLS) expect(reviewedTool(name)).toMatchObject({ effect: "read", spend: false })
    expect(REVIEWED_TOOLS.filter((tool) => tool.visibility === "account-data").map((tool) => tool.name)).toEqual([
      "get-batch", "get-credits", "get-current-key", "get-generation", "get-preset", "get-video", "list-batches", "list-preset-versions", "list-presets",
    ])
    expect(REVIEWED_TOOLS.filter((tool) => tool.visibility === "recipe").map((tool) => tool.name)).toEqual(["install-ori-harness", "spawn-ori-eval"])
  })

  test("27 tools are script methods: 22 reads, four spending executions with text or structured results, and feedback", () => {
    expect(RPC_TOOLS).toHaveLength(27)
    expect(RPC_TOOLS.filter((name) => reviewedTool(name)!.effect === "read")).toHaveLength(22)
    expect(RPC_TOOLS.filter((name) => reviewedTool(name)!.spend).sort()).toEqual(["send-batch", "send-decision", "send-message", "transcribe-audio"])
  })

  test("every script method carries the evidence that its output fits the script result", () => {
    for (const tool of REVIEWED_TOOLS) expect({ name: tool.name, labelled: tool.scriptOutput !== undefined }).toEqual({ name: tool.name, labelled: tool.rpc })
    // live-observed: the free reads the capture called; documented: a live output schema, or OpenRouter's documentation
    // for send-message; synthetic: only the loopback fake. test/unit/live-catalog.test.ts checks each against the capture.
    const byLabel = (label: string) => RPC_TOOLS.filter((name) => reviewedTool(name)!.scriptOutput === label)
    expect(byLabel("live-observed")).toEqual(["list-app-rankings", "list-benchmarks", "list-daily-model-rankings", "list-models", "list-providers", "list-task-classifications", "ping", "search-docs", "get-credits"])
    expect(byLabel("documented")).toEqual(["get-batch", "get-generation", "get-video", "list-batches", "send-batch", "send-decision", "send-message", "transcribe-audio"])
    expect(byLabel("synthetic")).toEqual([
      "get-endpoint-uptime-history", "get-model", "get-session-cost", "list-model-endpoints", "get-preset", "list-preset-versions", "list-presets", "install-ori-harness", "spawn-ori-eval", "send-feedback",
    ])
    expect(LIVE_VERIFIED_SCRIPT_METHODS).toEqual(byLabel("live-observed"))
  })

  test("every effect judgement rests on the live annotations, and every spend judgement names its evidence honestly", () => {
    for (const tool of REVIEWED_TOOLS) {
      expect({ name: tool.name, effect: tool.effectEvidence }).toEqual({ name: tool.name, effect: "live-observed" })
      // A spend judgement is never live-observed: the capture called no spending tool and stored descriptions only as digests.
      expect(["documented", "assumed"]).toContain(tool.spendEvidence.level)
      if (tool.spendEvidence.level === "documented") expect(tool.spendEvidence.source).toMatch(/^https:\/\/openrouter\.ai\/docs\//)
      else expect(tool.spendEvidence.source.length).toBeGreaterThan(40)
    }
    // The 17 tools on the MCP page cite it; the rest cite another OpenRouter page or say why nothing confirms them.
    for (const { name } of documented.tools) expect({ name, source: reviewedTool(name)!.spendEvidence.source }).toEqual({ name, source: MCP_DOCS })
    const assumed = REVIEWED_TOOLS.filter((tool) => tool.spendEvidence.level === "assumed").map((tool) => tool.name)
    expect(assumed).toEqual(["get-endpoint-uptime-history", "get-session-cost", "get-batch", "get-current-key", "get-preset", "get-video", "list-batches", "list-preset-versions", "list-presets", "transcribe-audio"])
    // A spending tool resting on an assumption still spends: when in doubt, it asks.
    expect(reviewedTool("transcribe-audio")).toMatchObject({ spend: true, spendEvidence: { level: "assumed" } })
  })

  test("the Code Mode namespace text names the spend class without listing every spending tool", () => {
    expect(NAMESPACE_DESCRIPTION).toContain("send-*, transcribe-audio and generate-* bill the account")
    expect(NAMESPACE_DESCRIPTION.length).toBeLessThanOrEqual(400)
    expect(NAMESPACE_DESCRIPTION).not.toContain("direct tool")
  })

  test("spending tools are never reads", () => {
    for (const tool of REVIEWED_TOOLS) if (tool.spend) expect(tool.effect).not.toBe("read")
  })

  test("the contract effect is derived once: spend for a spending call, notify for feedback, and no action for a read", () => {
    for (const tool of REVIEWED_TOOLS) {
      const effect = actionEffectOf(tool)
      if (tool.effect === "read") expect({ name: tool.name, effect }).toEqual({ name: tool.name, effect: undefined })
      else expect({ name: tool.name, effect }).toEqual({ name: tool.name, effect: tool.spend ? "spend" : "notify" })
    }
    expect(NOTIFY_TOOLS).toEqual(["send-feedback"])
    expect(ACTION_EFFECTS).toEqual(CHANGE_TOOLS.map((name) => ({ name, effect: SPEND_TOOLS.includes(name) ? "spend" : "notify" })))
    expect(ACTION_EFFECTS).toHaveLength(8)
  })

  test("an unknown tool has no review", () => {
    expect(reviewedTool("shiny-new-tool")).toBeUndefined()
  })
})

describe("the documentation-derived fixture", () => {
  test("is labelled documented, never live, and records no schema", () => {
    expect(documented.evidence).toBe("documented")
    expect(documented.source).toBe("https://openrouter.ai/docs/guides/overview/mcp-server")
    for (const tool of documented.tools) expect(Object.keys(tool).sort()).toEqual(["name", "purpose"])
  })

  test("its provenance matches its digest and names the endpoint; a live capture is a separate entry", () => {
    const [capture] = provenance.captures
    expect(capture).toMatchObject({ fixture: "documented-tools.json", evidence: "documented", endpoint: "https://mcp.openrouter.ai/mcp", schemas: "not published" })
    expect(capture!.digest.algorithm).toBe("sha256")
    expect(capture!.digest.value).toBe(sha256(canonicalJson(documented.tools.map((tool) => tool.name).sort())))
    expect(provenance.captures.slice(1).map((item) => [item.fixture, item.evidence])).toEqual(provenance.live ? [["live-tools.json", "live-observed"]] : [])
  })
})

describe("canonical serialisation", () => {
  test("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}')
    expect(sha256(canonicalJson({ a: 1, b: 2 }))).toBe(sha256(canonicalJson({ b: 2, a: 1 })))
  })
})
