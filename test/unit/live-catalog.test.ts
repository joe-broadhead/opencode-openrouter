// The live catalog: the pure helpers of scripts/live-catalog.ts on synthetic input, and, once a signed-in capture is
// committed as test/fixtures/live-tools.json, its reconcile with the reviewed catalog. Until then the reconcile checks
// that nothing claims live evidence.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import {
  ACCOUNT_READS,
  argumentsFor,
  assertNoSecrets,
  drift,
  FREE_READS,
  firstModelId,
  messagesOf,
  NEVER_CALLED,
  recordResult,
  recordTool,
  reconcile,
  refusal,
  scriptFit,
  shapeOf,
  toolsDigest,
  type LiveFixture,
  type LiveTool,
} from "../../scripts/live-catalog.js"
import { ENDPOINT } from "../../src/constants.js"
import { BILLABLE_TOOLS, CHANGE_TOOLS, LIVE_VERIFIED_SCRIPT_METHODS, READ_TOOLS, REVIEWED_TOOLS, RPC_TOOLS, TOOL_NAMES } from "../../src/openrouter-tools.js"
import { canonicalJson, sha256 } from "./canonical.js"

const FIXTURE = new URL("../fixtures/live-tools.json", import.meta.url)
const provenance = JSON.parse(readFileSync(new URL("../fixtures/provenance.json", import.meta.url), "utf8")) as {
  captures: { fixture: string; evidence: string; endpoint: string; host?: string | null; protocol?: string | null; digest: { value: string } }[]
  live: { fixture: string; retrieved: string } | null
}
const live = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as LiveFixture) : undefined

const tool = (name: string): LiveTool => recordTool({ name, description: `about ${name}`, inputSchema: { type: "object" } })
const fits = { called: true, isError: false, contentTypes: ["text"], structured: null, text: { length: 2, json: null } }

describe("the capture's limits", () => {
  test("calls only reads, never a billable, feedback or recipe-that-runs tool", () => {
    for (const name of FREE_READS) expect(READ_TOOLS).toContain(name)
    for (const name of [...BILLABLE_TOOLS, ...CHANGE_TOOLS, "spawn-ori-eval"]) {
      expect(FREE_READS).not.toContain(name)
      expect(NEVER_CALLED).toContain(name)
    }
    expect(ACCOUNT_READS).toEqual(["get-credits"])
  })

  test("refuses a tools/call outside the free reads, before it is sent, in a single or a batched request", () => {
    const call = (name: string) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } })
    for (const name of NEVER_CALLED) expect(refusal(JSON.stringify(call(name)))).toBe(`the capture never calls ${name}`)
    expect(refusal(JSON.stringify([call("ping"), call("send-message")]))).toBe("the capture never calls send-message")
    expect(refusal(JSON.stringify(call("ping")))).toBeUndefined()
    expect(refusal(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }))).toBeUndefined()
    expect(refusal(undefined)).toBeUndefined()
  })
})

describe("recording", () => {
  test("parses JSON and server-sent event bodies", () => {
    expect(messagesOf('{"id":1,"result":{}}', "application/json")).toEqual([{ id: 1, result: {} }])
    expect(messagesOf('event: message\ndata: {"id":1,"result":{"a":1}}\n\nevent: message\ndata: {"id":2}\n\n', "text/event-stream")).toEqual([{ id: 1, result: { a: 1 } }, { id: 2 }])
    expect(messagesOf("not json", "application/json")).toEqual([])
  })

  test("keeps a description only as a digest and a length", () => {
    expect(recordTool({ name: "ping", description: "Checks the server", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } })).toEqual({
      name: "ping",
      description: { sha256: sha256("Checks the server"), length: 17 },
      inputSchema: { type: "object" },
      outputSchema: null,
      annotations: { readOnlyHint: true },
    })
  })

  test("a result's shape holds types and keys, never a value; an account read keeps only its top level", () => {
    expect(shapeOf({ id: "openai/x", n: 3, tags: ["a"], nested: { ok: true } })).toEqual({ id: "string", n: "number", nested: { ok: "boolean" }, tags: ["string"] })
    const credits = recordResult("get-credits", { content: [{ type: "text", text: '{"data":{"total_credits":12.5,"total_usage":3.25}}' }], structuredContent: { data: { total_credits: 12.5 } } }, { ignored: 1 })
    expect(credits).toEqual({ called: true, isError: false, contentTypes: ["text"], structured: { data: "object" }, text: { length: 50, json: { data: "object" } } })
    expect(JSON.stringify(credits)).not.toMatch(/12\.5|3\.25|total_/)
    const models = recordResult("list-models", { content: [{ type: "text", text: '[{"id":"openai/x","pricing":{"prompt":"0.1"}}]' }] }, { limit: 3 })
    expect(models).toEqual({ called: true, arguments: { limit: 3 }, isError: false, contentTypes: ["text"], structured: null, text: { length: 46, json: [{ id: "string", pricing: { prompt: "string" } }] } })
  })

  test("refuses to write anything shaped like a credential", () => {
    for (const secret of ["sk-or-v1-0123456789abcdef", "Bearer abcdefghijkl", '"access_token":"x"', "eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl", "Authorization"]) {
      expect(() => assertNoSecrets(`{"x":"${secret}"}`)).toThrow(/nothing was written/)
    }
    expect(() => assertNoSecrets(JSON.stringify({ tools: [tool("ping")] }))).not.toThrow()
  })
})

describe("arguments for a free read", () => {
  test("a small limit where offered, the model id and a search phrase where required, and no guess otherwise", () => {
    expect(argumentsFor({ type: "object", properties: { limit: { type: "integer", maximum: 100 } } }, {})).toEqual({ arguments: { limit: 3 } })
    expect(argumentsFor({ type: "object", properties: { per_page: { type: "integer", minimum: 5 } } }, {})).toEqual({ arguments: { per_page: 5 } })
    expect(argumentsFor({ type: "object", properties: { model: { type: "string" } }, required: ["model"] }, { modelId: "openai/x" })).toEqual({ arguments: { model: "openai/x" } })
    expect(argumentsFor({ type: "object", properties: { model: { type: "string" } }, required: ["model"] }, {})).toEqual({ skip: 'needs a model id for "model", and list-models gave none' })
    expect(argumentsFor({ type: "object", properties: { query: { type: "string" } }, required: ["query"] }, {})).toEqual({ arguments: { query: "provider routing" } })
    expect(argumentsFor({ type: "object", properties: { period: { enum: ["day", "week"] } }, required: ["period"] }, {})).toEqual({ arguments: { period: "day" } })
    expect(argumentsFor({ type: "object", properties: { generation_id: { type: "string" } }, required: ["generation_id"] }, {})).toEqual({ skip: 'required parameter "generation_id" is not one the capture fills' })
    expect(argumentsFor(null, {})).toEqual({ arguments: {} })
  })

  test("finds a vendor/model id in structured content or JSON text", () => {
    expect(firstModelId({ structuredContent: { data: [{ id: "openai/gpt-x" }] } })).toBe("openai/gpt-x")
    expect(firstModelId({ content: [{ type: "text", text: '{"models":[{"slug":"anthropic/claude-x"}]}' }] })).toBe("anthropic/claude-x")
    expect(firstModelId({ content: [{ type: "text", text: 'Models: "id": "google/gemini-x" and more' }] })).toBe("google/gemini-x")
    expect(firstModelId({ content: [{ type: "text", text: "none here" }] })).toBeUndefined()
  })
})

describe("the reconcile", () => {
  const reviewed = REVIEWED_TOOLS.map(({ name, rpc, scriptOutput }) => ({ name, rpc, ...(scriptOutput ? { scriptOutput } : {}) }))
  const allTools = TOOL_NAMES.map(tool)

  test("whether a recorded result survives the tools RPC", () => {
    expect(scriptFit(fits)).toBe("fits")
    expect(scriptFit({ ...fits, contentTypes: [], structured: { a: "string" } })).toBe("fits")
    expect(scriptFit({ ...fits, contentTypes: ["text", "image"] })).toBe("drops")
    expect(scriptFit({ ...fits, isError: true })).toBe("unknown")
    expect(scriptFit({ called: false, reason: "x" })).toBe("unknown")
    expect(scriptFit(undefined)).toBe("unknown")
  })

  test("fails on an unknown or a missing tool", () => {
    expect(reconcile({ tools: [...allTools.filter((item) => item.name !== "ping"), tool("new-tool")], calls: {} }, reviewed)).toEqual([
      "unknown tool: new-tool is live but not in the reviewed catalog",
      "missing tool: ping is reviewed but the live server does not list it",
    ])
  })

  test("a confirmed method must be labelled live-observed, a dropped one must leave the script methods, and an unconfirmed label fails", () => {
    expect(reconcile({ tools: allTools, calls: { ping: fits } }, reviewed)).toEqual(["script method ping is confirmed by the capture; label its output live-observed"])
    const relabelled = reviewed.map((item) => (item.name === "ping" ? { ...item, scriptOutput: "live-observed" } : item))
    expect(reconcile({ tools: allTools, calls: { ping: fits } }, relabelled)).toEqual([])
    expect(reconcile({ tools: allTools, calls: {} }, relabelled)).toEqual(["script method ping is labelled live-observed, but the capture did not confirm it"])
    expect(reconcile({ tools: allTools, calls: { "list-models": { ...fits, contentTypes: ["text", "resource"] } } }, reviewed)).toEqual([
      "script method list-models returns content the tools RPC drops; make it native-only",
    ])
    expect(reconcile({ tools: allTools, calls: { "send-message": fits } }, reviewed)).toContain("send-message must never be called by a capture")
  })

  test("reports schema drift between two captures by kind", () => {
    const before = [tool("a"), tool("b"), { ...tool("c"), annotations: { readOnlyHint: true } }]
    const after = [{ ...tool("a"), inputSchema: { type: "object", properties: { x: {} } } }, { ...tool("c"), outputSchema: { type: "object" }, description: { sha256: "x", length: 1 } }, tool("d")]
    expect(drift(before, after)).toEqual({ added: ["d"], removed: ["b"], input: ["a"], output: ["c"], annotations: ["c"], descriptions: ["c"] })
    expect(Object.values(drift(before, before)).flat()).toEqual([])
  })

  test("the provenance digest is the same canonical JSON the documented fixture uses", () => {
    expect(toolsDigest([tool("b"), tool("a")])).toBe(sha256(canonicalJson([tool("a"), tool("b")])))
  })
})

describe("the committed live capture", () => {
  if (!live) {
    test("does not exist yet, so nothing claims live evidence", () => {
      expect(provenance.live).toBeNull()
      expect(provenance.captures.every((item) => item.evidence !== "live-observed")).toBe(true)
      expect(LIVE_VERIFIED_SCRIPT_METHODS).toEqual([])
      for (const item of REVIEWED_TOOLS) expect(item.scriptOutput).not.toBe("live-observed")
    })
    return
  }

  test("is labelled live-observed, names the endpoint, the host and the protocol, and holds no credential", () => {
    expect(live.evidence).toBe("live-observed")
    expect(live.endpoint).toBe(ENDPOINT)
    expect(live.host.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(live.protocol.version).toBeTruthy()
    expect(() => assertNoSecrets(JSON.stringify(live))).not.toThrow()
    for (const item of live.tools) expect(Object.keys(item.description).sort()).toEqual(["length", "sha256"])
  })

  test("its provenance entry matches its digest, so an edited schema fails here", () => {
    const entry = provenance.captures.find((item) => item.fixture === "live-tools.json")!
    expect(entry).toMatchObject({ evidence: "live-observed", endpoint: ENDPOINT, host: live.host.version, protocol: live.protocol.version })
    expect(entry.digest.value).toBe(toolsDigest(live.tools))
    expect(provenance.live).toEqual({ fixture: "live-tools.json", retrieved: live.retrieved })
  })

  test("agrees with the reviewed catalog: no unknown or missing tool, and every script label matches the capture", () => {
    const reviewed = REVIEWED_TOOLS.map(({ name, rpc, scriptOutput }) => ({ name, rpc, ...(scriptOutput ? { scriptOutput } : {}) }))
    expect(reconcile(live, reviewed)).toEqual([])
    for (const name of NEVER_CALLED) expect(live.calls[name]?.called ?? false).toBe(false)
    expect(LIVE_VERIFIED_SCRIPT_METHODS).toEqual(RPC_TOOLS.filter((name) => scriptFit(live.calls[name]) === "fits"))
  })
})
