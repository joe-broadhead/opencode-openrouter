import { describe, expect, test } from "bun:test"
import { ACCESS, DEFAULT_ACCESS, parseOptions } from "../../src/options.js"

describe("parseOptions", () => {
  test("defaults to the family's all, and refuses an untested host", () => {
    expect(DEFAULT_ACCESS).toBe("all")
    expect(parseOptions(undefined)).toEqual({ access: "all", allowUntestedHost: false })
    expect(parseOptions(null)).toEqual({ access: "all", allowUntestedHost: false })
    expect(parseOptions({})).toEqual({ access: "all", allowUntestedHost: false })
  })

  test("accepts every access value and the host override", () => {
    for (const access of ACCESS) expect(parseOptions({ access }).access).toBe(access)
    expect(parseOptions({ allowUntestedHost: true })).toEqual({ access: "all", allowUntestedHost: true })
  })

  test("refuses an unknown option and names the accepted ones", () => {
    expect(() => parseOptions({ readOnly: true })).toThrow(
      'OPTIONS_INVALID: Unknown option "readOnly". Accepted options: "access", "allowUntestedHost". Next step: Fix the plugin options in opencode.json',
    )
  })

  test("refuses wrong types and values with what it accepts", () => {
    expect(() => parseOptions({ access: "write" })).toThrow('The option "access" must be "all", "ask-changes", "read-only", with "all" the default, found "write"')
    expect(() => parseOptions({ access: 1 })).toThrow('The option "access" must be')
    expect(() => parseOptions({ allowUntestedHost: "yes" })).toThrow('The option "allowUntestedHost" must be true or false (the default), found "yes"')
    expect(() => parseOptions([])).toThrow("The plugin options must be an object, found an array")
    expect(() => parseOptions("all")).toThrow('The plugin options must be an object, found "all"')
  })

  test("never echoes a long value back whole", () => {
    const long = `sk-or-v1-${"a".repeat(64)}`
    let message = ""
    try {
      parseOptions({ access: long })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain("OPTIONS_INVALID")
    expect(message).not.toContain(long)
  })

  test("errors carry their code and next step", () => {
    try {
      parseOptions({ nope: 1 })
      throw new Error("expected a refusal")
    } catch (error) {
      expect(error).toMatchObject({ code: "OPTIONS_INVALID" })
      expect((error as { nextStep: string }).nextStep).toContain("opencode.json")
    }
  })
})
