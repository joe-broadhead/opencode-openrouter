// The Jelly declaration against the committed live capture, with no catalog in between: every tool OpenRouter's server
// listed is declared, every declared tool was listed, and each declared `readOnly` is the server's own `readOnlyHint`.
// Jelly enforces the declaration without loading the plugin, so a served tool that is not declared, or a write declared
// read-only, would escape its read-only-helper fence. The family's shared drift check (a kit script) will replace this
// test; until then it reads the same two files the same way.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { SERVER_NAME } from "../../src/constants.js"

type Declared = { name: string; permission: string; effect: string; readOnly: boolean }
type Captured = { name: string; annotations?: { readOnlyHint?: boolean } }

const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T
const declared = read<{ jelly: { tools: Declared[] } }>("../../package.json").jelly.tools
const capture = read<{ evidence: string; retrieved: string; tools: Captured[] }>("../fixtures/live-tools.json")

/** Tools the plugin keeps declared although the capture did not list them, each with its reason. None today. */
const GATED: Readonly<Record<string, string>> = {}
/** Tools declared stricter than the server's hint (a write the server calls read-only), each with its reason. None today. */
const STRICTER: Readonly<Record<string, string>> = {}

const upstream = (tool: Declared) => tool.name.slice(`${SERVER_NAME}.`.length)

describe("the declaration against the committed capture", () => {
  test("the capture is a signed-in live capture", () => {
    expect(capture.evidence).toBe("live-observed")
    expect(capture.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test("every served tool is declared", () => {
    const names = new Set(declared.map(upstream))
    expect(capture.tools.map((tool) => tool.name).filter((name) => !names.has(name))).toEqual([])
  })

  test("every declared tool was served, unless a gating note says why it is kept", () => {
    const served = new Set(capture.tools.map((tool) => tool.name))
    expect(declared.map(upstream).filter((name) => !served.has(name) && !GATED[name])).toEqual([])
  })

  test("each declared readOnly is the server's readOnlyHint, unless declared stricter with a reason", () => {
    const hint = new Map(capture.tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint]))
    const mismatched = declared
      .filter((tool) => hint.has(upstream(tool)))
      .filter((tool) => hint.get(upstream(tool)) !== tool.readOnly && !(STRICTER[upstream(tool)] && tool.readOnly === false))
      .map((tool) => `${upstream(tool)}: declared ${tool.readOnly}, served ${hint.get(upstream(tool))}`)
    expect(mismatched).toEqual([])
    // Every hint is present, so no readOnly rests on the catalog alone.
    expect(capture.tools.filter((tool) => typeof tool.annotations?.readOnlyHint !== "boolean").map((tool) => tool.name)).toEqual([])
  })

  test("every declared tool is allowed at the default access, writes and paid calls included", () => {
    expect(declared.filter((tool) => tool.effect !== "allow").map((tool) => tool.name)).toEqual([])
  })
})
