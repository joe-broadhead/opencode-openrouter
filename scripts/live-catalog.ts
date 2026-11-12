// The live catalog: what a signed-in capture of OpenRouter's MCP server records, and how it is reconciled with the
// reviewed catalog in src/openrouter-tools.ts. Pure functions only, no I/O: scripts/capture-live.ts uses them to build
// test/fixtures/live-tools.json, and test/unit/live-catalog.test.ts uses them to check that fixture.
//
// What a fixture may hold: tool names, each description's text with its digest and length (descriptions are public
// tool metadata), input and output schemas, annotations and titles, the negotiated protocol and server name, and for
// each free read the capture called, the shape of its result (types only, never values). Never a key, token, account
// id, balance, prompt or the text of a result. The capture of 2026-11-12 predates stored description text and holds
// digests only.
import { createHash } from "node:crypto"
import { CHANGE_TOOLS } from "../src/openrouter-tools.js"

/** The free reads the capture may call, in order: list-models first, so a model id is known for the two that take one. */
export const FREE_READS: readonly string[] = [
  "list-models",
  "get-model",
  "list-model-endpoints",
  "list-providers",
  "list-benchmarks",
  "list-daily-model-rankings",
  "list-app-rankings",
  "list-task-classifications",
  "search-docs",
  "ping",
  "get-credits",
]

/**
 * Reads whose result is the signed-in account's own data: the capture calls them only to see that they work, and
 * records whether they did, never their shape's keys beyond the top level, and never a value.
 */
export const ACCOUNT_READS: readonly string[] = ["get-credits"]

/**
 * Tools a capture never calls: every change in the catalog (billable inference, media, batches, decisions,
 * transcription, feedback) and the recipe whose follow-up runs an evaluation. The capture's real limit is FREE_READS,
 * an allowlist; this list is what the reconcile checks the fixture against.
 */
export const NEVER_CALLED: readonly string[] = [...CHANGE_TOOLS, "spawn-ori-eval"]

export type Schema = Record<string, unknown>

/** One raw tool from `tools/list`, as the server sent it. */
export interface RawTool {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly inputSchema?: Schema
  readonly outputSchema?: Schema
  readonly annotations?: Record<string, unknown>
}

/** A tool as the fixture records it: the description's digest and length, and its text (absent in older captures). */
export interface LiveTool {
  readonly name: string
  readonly title?: string
  readonly description: { readonly sha256: string; readonly length: number; readonly text?: string }
  readonly inputSchema: Schema | null
  readonly outputSchema: Schema | null
  readonly annotations: Record<string, unknown> | null
}

/** A raw `tools/call` result, as the server sent it. */
export interface RawResult {
  readonly content?: readonly { readonly type: string; readonly text?: string }[]
  readonly structuredContent?: unknown
  readonly isError?: boolean
}

/** What one free read returned, as types only. */
export interface LiveCall {
  readonly called: boolean
  /** Why it was not called, or why it failed: one short line. */
  readonly reason?: string
  /** The arguments sent: public values only (a model id, a search phrase, a small limit). */
  readonly arguments?: Record<string, unknown>
  readonly isError?: boolean
  /** The content block types, in order, such as ["text"] or ["text", "image"]. */
  readonly contentTypes?: readonly string[]
  /** The shape of the structured content, or null when there was none. */
  readonly structured?: Shape | null
  /** The text parts: their total length, and the shape of the text when it parses as JSON. */
  readonly text?: { readonly length: number; readonly json: Shape | null }
}

export interface LiveFixture {
  readonly evidence: "live-observed"
  readonly note: string
  readonly retrieved: string
  readonly endpoint: string
  readonly host: { readonly version: string; readonly via: string }
  readonly protocol: { readonly version: string | null; readonly server: { readonly name?: string; readonly version?: string } | null }
  /** How many `tools/list` pages the server sent. */
  readonly pages: number
  readonly tools: readonly LiveTool[]
  readonly calls: Readonly<Record<string, LiveCall>>
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

/** Canonical JSON: object keys sorted at every depth, arrays in order, no whitespace. Same as test/unit/canonical.ts. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

/** The digest provenance.json records for a live fixture: its tools, canonically serialised. */
export const toolsDigest = (tools: readonly LiveTool[]) => sha256(canonicalJson([...tools].sort((a, b) => (a.name < b.name ? -1 : 1))))

/** A value's shape: types and object keys, never a value. Arrays show their first element's shape. */
export type Shape = string | { readonly [key: string]: Shape } | readonly Shape[]

export function shapeOf(value: unknown, depth = 0, keys = true): Shape {
  if (value === null) return "null"
  if (Array.isArray(value)) return value.length === 0 ? [] : depth >= 6 ? ["…"] : [shapeOf(value[0], depth + 1, keys)]
  if (typeof value === "object") {
    if (depth >= 6) return "object"
    const out: Record<string, Shape> = {}
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))
    for (const [key, item] of entries.slice(0, 60)) out[keys ? key : "*"] = shapeOf(item, depth + 1, keys)
    return out
  }
  return typeof value
}

/**
 * A raw result as the fixture records it. For an account read the shape keeps only the top level's keys with their
 * types, so nothing below can carry an id, and no value is ever kept.
 */
export function recordResult(name: string, result: RawResult, args: Record<string, unknown>): LiveCall {
  const account = ACCOUNT_READS.includes(name)
  const texts = (result.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "")
  const joined = texts.join("\n")
  let json: Shape | null = null
  try {
    json = joined.trim() === "" ? null : shapeOf(JSON.parse(joined))
  } catch {
    json = null
  }
  const flatten = (shape: Shape | null): Shape | null =>
    shape === null || typeof shape === "string" || Array.isArray(shape)
      ? shape === null ? null : typeof shape === "string" ? shape : ["…"]
      : Object.fromEntries(Object.entries(shape).map(([key, item]) => [key, typeof item === "string" ? item : Array.isArray(item) ? "array" : "object"]))
  const structured = result.structuredContent === undefined ? null : shapeOf(result.structuredContent)
  return {
    called: true,
    ...(account ? {} : { arguments: args }),
    isError: result.isError === true,
    contentTypes: (result.content ?? []).map((part) => part.type),
    structured: account ? flatten(structured) : structured,
    text: { length: joined.length, json: account ? flatten(json) : json },
  }
}

/** A raw tool as the fixture records it. */
export const recordTool = (tool: RawTool): LiveTool => ({
  name: tool.name,
  ...(tool.title ? { title: tool.title } : {}),
  description: { sha256: sha256(tool.description ?? ""), length: (tool.description ?? "").length, text: tool.description ?? "" },
  inputSchema: tool.inputSchema ?? null,
  outputSchema: tool.outputSchema ?? null,
  annotations: tool.annotations ?? null,
})

/**
 * The messages of one MCP HTTP response body: a JSON object or array, or server-sent events whose `data:` lines hold
 * JSON. Anything that does not parse is skipped.
 */
export function messagesOf(body: string, contentType: string | null): unknown[] {
  const parse = (text: string) => {
    try {
      const value = JSON.parse(text) as unknown
      return Array.isArray(value) ? value : [value]
    } catch {
      return []
    }
  }
  if (contentType?.includes("text/event-stream")) {
    return body
      .split(/\r?\n\r?\n/)
      .map((event) => event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n"))
      .filter((data) => data.trim() !== "")
      .flatMap(parse)
  }
  return parse(body)
}

/** A JSON-RPC request body's messages, with their method, id and tool name; anything else is skipped. A body that is
 * not a string, or not JSON, yields nothing: `refusal` refuses such a request. */
export function requestsOf(body: unknown): { readonly method: string; readonly id?: string | number; readonly tool?: string }[] {
  if (typeof body !== "string") return []
  return messagesOf(body, "application/json").flatMap((message) => {
    if (typeof message !== "object" || message === null) return []
    const { method, id, params } = message as { method?: unknown; id?: unknown; params?: { name?: unknown } }
    if (typeof method !== "string") return []
    return [{ method, ...(typeof id === "string" || typeof id === "number" ? { id } : {}), ...(typeof params?.name === "string" ? { tool: params.name } : {}) }]
  })
}

/**
 * Why a request to the MCP server must not be sent: a body the capture cannot read (not a string, such as a stream or a
 * byte array, or not JSON-RPC), or a `tools/call` of any tool outside the free reads. What it cannot read, it refuses.
 */
export function refusal(body: unknown): string | undefined {
  const requests = requestsOf(body)
  if (requests.length === 0) return "the capture cannot read this request's body, so it never sends it"
  for (const request of requests) {
    if (request.method !== "tools/call") continue
    if (!request.tool || !FREE_READS.includes(request.tool)) return `the capture never calls ${request.tool ?? "an unnamed tool"}`
  }
  return undefined
}

const properties = (schema: Schema | null | undefined) => (schema?.["properties"] ?? {}) as Record<string, Schema>
const required = (schema: Schema | null | undefined) => ((schema?.["required"] ?? []) as unknown[]).filter((name): name is string => typeof name === "string")

const SEARCH = "provider routing"
const LIMIT_NAMES = /^(limit|max|max_?results|top|n|count|per_?page|page_?size|size)$/i
const MODEL_NAMES = /^(model|model_?id|id|slug|permaslug|model_?slug)$/i
const QUERY_NAMES = /^(q|query|search|text|question|term|keywords?)$/i

/**
 * The arguments for one free read, from its live input schema: a small limit where the schema offers one, the model id
 * for a required model parameter, a fixed search phrase for a required query. Undefined, with the reason, when a
 * required parameter is none of these, so the capture never guesses.
 */
export function argumentsFor(schema: Schema | null, context: { readonly modelId?: string }): { readonly arguments: Record<string, unknown> } | { readonly skip: string } {
  const props = properties(schema)
  const args: Record<string, unknown> = {}
  for (const [name, prop] of Object.entries(props)) {
    const numeric = prop["type"] === "integer" || prop["type"] === "number"
    if (numeric && LIMIT_NAMES.test(name)) {
      const minimum = typeof prop["minimum"] === "number" ? (prop["minimum"] as number) : 1
      args[name] = Math.max(minimum, Math.min(3, typeof prop["maximum"] === "number" ? (prop["maximum"] as number) : 3))
    }
  }
  for (const name of required(schema)) {
    if (name in args) continue
    const prop = props[name] ?? {}
    const enumeration = prop["enum"]
    if (Array.isArray(enumeration) && enumeration.length > 0) {
      args[name] = enumeration[0]
      continue
    }
    if (prop["type"] === "string" && MODEL_NAMES.test(name)) {
      if (!context.modelId) return { skip: `needs a model id for "${name}", and list-models gave none` }
      args[name] = context.modelId
      continue
    }
    if (prop["type"] === "string" && QUERY_NAMES.test(name)) {
      args[name] = SEARCH
      continue
    }
    return { skip: `required parameter "${name}" is not one the capture fills` }
  }
  return { arguments: args }
}

/** The first model id in a list-models result: an `id` or `slug` string that looks like `vendor/model`. */
export function firstModelId(result: RawResult): string | undefined {
  const texts = (result.content ?? []).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n")
  const sources: unknown[] = [result.structuredContent]
  try {
    sources.push(JSON.parse(texts))
  } catch {
    const match = /"(?:id|slug)"\s*:\s*"([\w.-]+\/[\w.:-]+)"/.exec(texts)
    if (match) return match[1]
  }
  const seen = new Set<unknown>()
  const walk = (value: unknown): string | undefined => {
    if (value === null || typeof value !== "object" || seen.has(value)) return undefined
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item)
        if (found) return found
      }
      return undefined
    }
    for (const key of ["id", "slug", "canonical_slug"]) {
      const candidate = (value as Record<string, unknown>)[key]
      if (typeof candidate === "string" && /^[\w.-]+\/[\w.:-]+$/.test(candidate)) return candidate
    }
    for (const item of Object.values(value as Record<string, unknown>)) {
      const found = walk(item)
      if (found) return found
    }
    return undefined
  }
  for (const source of sources) {
    const found = walk(source)
    if (found) return found
  }
  return undefined
}

/**
 * Whether a call's useful result survives the tools RPC, which keeps structured content and the text parts and drops
 * every other content block: `fits` when it returned text or structured content and nothing else; `drops` when it
 * returned another block type; `unknown` when it was not called or failed.
 */
export function scriptFit(call: LiveCall | undefined): "fits" | "drops" | "unknown" {
  if (!call?.called || call.isError || call.reason) return "unknown"
  const types = call.contentTypes ?? []
  if (types.some((type) => type !== "text")) return "drops"
  return types.length > 0 || call.structured !== null ? "fits" : "unknown"
}

/** Credential values no fixture may contain, anywhere. */
const SECRET_VALUE = /\bsk-or-[\w-]{8,}|\bBearer\s+[\w.~+/=-]{8,}|\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/
/** Credential fields, which may appear only inside a tool's public description (one may say "an Authorization header"). */
const SECRET_FIELD = /"(?:access|refresh)_token"|\bAuthorization\b/i

/**
 * Throws when a fixture holds anything shaped like a credential: a key, a bearer token or a JWT anywhere, and a credential
 * field name anywhere outside the tools' description text. Pass the fixture itself, or its serialised text.
 */
export function assertNoSecrets(fixture: unknown) {
  const whole = typeof fixture === "string" ? fixture : JSON.stringify(fixture)
  const value = SECRET_VALUE.exec(whole)
  if (value) throw new Error(`the capture would record something shaped like a credential (${value[0].slice(0, 12)}…); nothing was written`)
  // Text that is not JSON is scanned as it is; otherwise every description's text is left out of the field scan.
  let parsed: unknown = fixture
  if (typeof fixture === "string") {
    try {
      parsed = JSON.parse(fixture)
    } catch {
      parsed = undefined
    }
  }
  const withoutDescriptions = parsed === undefined ? whole : JSON.stringify(parsed, (key, item) => (key === "text" && typeof item === "string" ? "" : item))
  const field = SECRET_FIELD.exec(withoutDescriptions)
  if (field) throw new Error(`the capture would record something shaped like a credential (${field[0].slice(0, 12)}…); nothing was written`)
}

/** A reviewed tool, as the reconcile reads it. */
export interface Reviewed {
  readonly name: string
  readonly effect: string
  readonly rpc: boolean
  readonly scriptOutput?: string
}

/**
 * Every disagreement between a live fixture and the reviewed catalog: an unknown or a missing tool, a script method
 * whose recorded result is dropped by the RPC, a method labelled live-observed that the capture did not confirm, and a
 * method the capture confirmed that is not labelled live-observed, a tool the server marks as not read-only that the
 * catalog treats as a read, and a method labelled documented with neither a live output schema nor OpenRouter's
 * documentation (`documentedByDocs`) behind it. Empty when they agree.
 */
export function reconcile(fixture: Pick<LiveFixture, "tools" | "calls">, reviewed: readonly Reviewed[], documentedByDocs: readonly string[] = ["send-message"]): string[] {
  const problems: string[] = []
  const live = new Set(fixture.tools.map((tool) => tool.name))
  const known = new Set(reviewed.map((tool) => tool.name))
  for (const name of [...live].sort()) if (!known.has(name)) problems.push(`unknown tool: ${name} is live but not in the reviewed catalog`)
  for (const name of [...known].sort()) if (!live.has(name)) problems.push(`missing tool: ${name} is reviewed but the live server does not list it`)
  for (const tool of reviewed) {
    const fit = scriptFit(fixture.calls[tool.name])
    if (tool.rpc && fit === "drops") problems.push(`script method ${tool.name} returns content the tools RPC drops; make it native-only`)
    if (tool.rpc && fit === "fits" && tool.scriptOutput !== "live-observed") problems.push(`script method ${tool.name} is confirmed by the capture; label its output live-observed`)
    if (tool.scriptOutput === "live-observed" && fit !== "fits") problems.push(`script method ${tool.name} is labelled live-observed, but the capture did not confirm it`)
    if (NEVER_CALLED.includes(tool.name) && fixture.calls[tool.name]?.called) problems.push(`${tool.name} must never be called by a capture`)
    const liveTool = fixture.tools.find((item) => item.name === tool.name)
    // MCP's defaults: a tool without `readOnlyHint: true` is not read-only, and `destructiveHint: true` is never a read.
    if (liveTool && tool.effect === "read") {
      if (liveTool.annotations?.["destructiveHint"] === true) problems.push(`${tool.name} is marked destructive by the server, but the catalog treats it as a read`)
      else if (liveTool.annotations?.["readOnlyHint"] !== true) problems.push(`${tool.name} is not marked read-only by the server, but the catalog treats it as a read`)
    }
    if (tool.rpc && tool.scriptOutput === "documented" && liveTool && !liveTool.outputSchema && !documentedByDocs.includes(tool.name)) {
      problems.push(`script method ${tool.name} is labelled documented, but the server declares no output schema for it`)
    }
  }
  return problems
}

/** What changed between two captures, by kind: tools added and removed, and input, output and annotation changes. */
export function drift(before: readonly LiveTool[], after: readonly LiveTool[]) {
  const map = (tools: readonly LiveTool[]) => new Map(tools.map((tool) => [tool.name, tool]))
  const a = map(before)
  const b = map(after)
  const same = (x: unknown, y: unknown) => canonicalJson(x) === canonicalJson(y)
  const common = [...a.keys()].filter((name) => b.has(name)).sort()
  return {
    added: [...b.keys()].filter((name) => !a.has(name)).sort(),
    removed: [...a.keys()].filter((name) => !b.has(name)).sort(),
    input: common.filter((name) => !same(a.get(name)!.inputSchema, b.get(name)!.inputSchema)),
    output: common.filter((name) => !same(a.get(name)!.outputSchema, b.get(name)!.outputSchema)),
    annotations: common.filter((name) => !same(a.get(name)!.annotations, b.get(name)!.annotations)),
    descriptions: common.filter((name) => a.get(name)!.description.sha256 !== b.get(name)!.description.sha256),
  }
}
