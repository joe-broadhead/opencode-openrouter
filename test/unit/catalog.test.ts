// The reviewed catalog: 17 documented tools, one classification each, derived lists that agree with it, and the
// documentation-derived fixture and its provenance, which never claim to be a live capture.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  BILLABLE_TOOLS,
  CHANGE_TOOLS,
  LIVE_VERIFIED_SCRIPT_METHODS,
  NATIVE_ONLY,
  READ_TOOLS,
  REVIEWED_TOOLS,
  reviewedTool,
  RPC_TOOLS,
  TOOL_NAMES,
} from "../../src/openrouter-tools.js"
import { canonicalJson, sha256 } from "./canonical.js"

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"))
const documented = fixture("documented-tools.json") as { evidence: string; source: string; tools: { name: string; purpose: string }[] }
const provenance = fixture("provenance.json") as {
  captures: { fixture: string; evidence: string; endpoint: string; digest: { algorithm: string; value: string }; schemas: string }[]
  live: unknown
}

describe("the reviewed catalog", () => {
  test("names exactly the 17 documented tools, once each", () => {
    expect(TOOL_NAMES).toHaveLength(17)
    expect(new Set(TOOL_NAMES).size).toBe(17)
    expect([...TOOL_NAMES].sort()).toEqual(documented.tools.map((tool) => tool.name).sort())
  })

  test("keeps upstream names: lower-case words joined by hyphens, never renamed with underscores", () => {
    for (const name of TOOL_NAMES) expect(name).toMatch(/^[a-z]+(?:-[a-z]+)*$/)
    expect(TOOL_NAMES).toContain("list-models")
    expect(TOOL_NAMES).not.toContain("search-models")
  })

  test("classifies the three non-reads as the design reviews them", () => {
    expect(CHANGE_TOOLS).toEqual(["send-message", "generate-image", "send-feedback"])
    expect(reviewedTool("send-message")).toEqual({ name: "send-message", effect: "write", billable: true, visibility: "execution", rpc: true, scriptOutput: "documented" })
    expect(reviewedTool("generate-image")).toEqual({ name: "generate-image", effect: "write", billable: true, visibility: "execution", rpc: false, rpcExclusion: "native-media-required" })
    expect(reviewedTool("send-feedback")).toEqual({ name: "send-feedback", effect: "send", billable: false, visibility: "execution", rpc: true, scriptOutput: "synthetic" })
    expect(BILLABLE_TOOLS).toEqual(["send-message", "generate-image"])
  })

  test("reads are never billable, and account and recipe reads are marked as such", () => {
    expect(READ_TOOLS).toHaveLength(14)
    for (const name of READ_TOOLS) expect(reviewedTool(name)).toMatchObject({ effect: "read", billable: false, rpc: true })
    expect(REVIEWED_TOOLS.filter((tool) => tool.visibility === "account-data").map((tool) => tool.name)).toEqual(["get-credits", "get-generation"])
    expect(REVIEWED_TOOLS.filter((tool) => tool.visibility === "recipe").map((tool) => tool.name)).toEqual(["install-ori-harness", "spawn-ori-eval"])
  })

  test("16 tools are script methods; generate-image alone is native-only, and only it carries an exclusion", () => {
    expect(RPC_TOOLS).toHaveLength(16)
    expect(NATIVE_ONLY).toEqual(["generate-image"])
    for (const tool of REVIEWED_TOOLS) expect(tool.rpcExclusion !== undefined).toBe(!tool.rpc)
  })

  test("every script method carries the evidence that its output fits the script result, and none claims a live capture", () => {
    for (const tool of REVIEWED_TOOLS) expect({ name: tool.name, labelled: tool.scriptOutput !== undefined }).toEqual({ name: tool.name, labelled: tool.rpc })
    // OpenRouter documents send-message's reply as text with a generation id; every other method is checked against the
    // loopback fake, until a signed-in capture confirms it (test/unit/live-catalog.test.ts decides which).
    for (const name of RPC_TOOLS) {
      const label = reviewedTool(name)!.scriptOutput
      expect({ name, label }).toEqual({ name, label: label === "live-observed" ? "live-observed" : name === "send-message" ? "documented" : "synthetic" })
    }
    expect(LIVE_VERIFIED_SCRIPT_METHODS).toEqual(RPC_TOOLS.filter((name) => reviewedTool(name)!.scriptOutput === "live-observed"))
  })

  test("billable tools are never reads", () => {
    for (const tool of REVIEWED_TOOLS) if (tool.billable) expect(tool.effect).not.toBe("read")
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
