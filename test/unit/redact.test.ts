// Text from the host or the network, as a diagnostic shows it: one line, no credentials, URL queries or userinfo,
// no controls or bidi characters, and at most 160 characters.
import { describe, expect, test } from "bun:test"
import { cut, oneLine, reasonOf, shortReason } from "../../src/redact.js"

const SECRETS = [
  "sk-or-v1-0123456789abcdef0123456789abcdef",
  "eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl",
  "x".repeat(48),
]

describe("shortReason", () => {
  test("redacts OpenRouter keys, bearer values, JWTs, key=value secrets and long key-like runs", () => {
    for (const secret of SECRETS) expect(shortReason(`failed with ${secret} today`)).not.toContain(secret)
    expect(shortReason("Authorization: Bearer abcdefgh12345678")).toBe("Authorization: Bearer [redacted]")
    expect(shortReason("api_key=hunter2hunter2 and more")).toBe("api_key=[redacted] and more")
  })

  test("drops a URL's userinfo, query and fragment, and keeps its host and path", () => {
    expect(shortReason("GET https://user:pass@mcp.openrouter.ai/mcp?code=abc#state failed")).toBe("GET https://mcp.openrouter.ai/mcp failed")
  })

  test("is one line without controls or bidi characters", () => {
    expect(shortReason("first\nsecond\r\nthird\u001b[31m red")).toBe("first second third [31m red")
    expect(shortReason("name‮gnp.exe")).toBe("namegnp.exe")
    expect(oneLine("  a \t b  ")).toBe("a b")
  })

  test("is at most 160 characters, cut between whole characters", () => {
    const reason = shortReason("word ".repeat(100))!
    expect(Array.from(reason).length).toBeLessThanOrEqual(160)
    expect(reason.endsWith("…")).toBe(true)
    expect(cut("😀😀😀", 2)).toBe("😀…")
  })

  test("falls back when nothing is left", () => {
    expect(shortReason("  \n ")).toBeUndefined()
    expect(reasonOf(new Error(" . "))).toBe("no reason given")
    expect(reasonOf("plain text")).toBe("plain text")
  })
})
