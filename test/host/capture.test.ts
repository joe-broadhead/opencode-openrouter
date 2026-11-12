// scripts/capture-live.ts against the loopback fake, on the public @opencode/sdk host: it records every tools/list page,
// calls only the free reads, never a billable or feedback tool, writes no credential, stops at the sign-in page when
// asked, and completes a sign-in through OpenCode's own OAuth before it captures. Each capture runs in a fresh process
// (test/host/capture-child.ts), as the script does, because OpenCode 2.2.6 reads `globalThis.fetch` once per process.
// Synthetic: it proves the tool, not OpenRouter's server.
import { ROOT, HOST_SDK_DIR } from "./isolate.js"
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { cpSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { CaptureResult } from "../../scripts/capture-live.js"
import { writeFixture } from "../../scripts/capture-live.js"
import { FREE_READS, NEVER_CALLED, scriptFit, toolsDigest } from "../../scripts/live-catalog.js"
import { TOOL_NAMES } from "../../src/openrouter-tools.js"
import { NEW_TOOL, startFakeMcp, type FakeMcp } from "./fake-mcp.js"
import { cleanup } from "./harness.js"

setDefaultTimeout(300_000)
afterAll(cleanup)

const SDK = HOST_SDK_DIR ? join(HOST_SDK_DIR, "node_modules", "@opencode", "sdk") : fileURLToPath(new URL("../../node_modules/@opencode/sdk", import.meta.url))
const CHILD = fileURLToPath(new URL("./capture-child.ts", import.meta.url))
let homes = 0

type Outcome = { result?: CaptureResult; opened?: string[]; fetchRestored?: boolean; error?: string }

/** One capture in a fresh process against `fake`. */
async function run(fake: FakeMcp, options: { oauth?: boolean; signIn: "wait" | "until-login" | "never"; browser?: "none" | "follow"; urlFile?: string }): Promise<Outcome> {
  const input = { endpoint: fake.url, oauth: options.oauth ?? false, home: join(ROOT, `capture-${++homes}`), sdk: SDK, signIn: options.signIn, browser: options.browser ?? "none", ...(options.urlFile ? { urlFile: options.urlFile } : {}) }
  const child = Bun.spawn([process.execPath, CHILD], { env: { ...process.env, CAPTURE_CHILD: JSON.stringify(input) }, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const line = stdout.trim().split("\n").at(-1)
  if (!line?.startsWith("{")) throw new Error(`the capture child printed no result:\n${stdout.slice(-2000)}\n${stderr.slice(-2000)}`)
  return JSON.parse(line) as Outcome
}

describe("the live capture tool, against the fake", () => {
  test("records every tools/list page and calls only the free reads, with types and no values", async () => {
    const fake = await startFakeMcp({ pageSize: 5 })
    try {
      const outcome = await run(fake, { signIn: "never" })
      expect(outcome.error).toBeUndefined()
      expect(outcome.fetchRestored).toBe(true)
      const fixture = outcome.result!.fixture!
      expect(fixture.pages).toBe(Math.ceil((TOOL_NAMES.length + 1) / 5))
      expect(fixture.tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES, NEW_TOOL].sort())
      for (const tool of fixture.tools) {
        expect(tool.inputSchema).toEqual({ type: "object", properties: { query: { type: "string" } } })
        expect(tool.description.length).toBe(`Synthetic ${tool.name}`.length)
        // Descriptions are public tool metadata: stored in full, so a judgement read from one can be checked later.
        expect(tool.description.text).toBe(`Synthetic ${tool.name}`)
      }
      expect(fixture.protocol.server).toEqual({ name: "fake-openrouter", version: "0.0.0" })
      expect(typeof fixture.protocol.version).toBe("string")
      // Exactly the free reads reached the server, in order, and none of the paid, feedback or recipe tools.
      expect(fake.calls).toEqual([...FREE_READS])
      for (const name of NEVER_CALLED) expect(fake.calls).not.toContain(name)
      for (const name of FREE_READS) expect({ name, fit: scriptFit(fixture.calls[name]) }).toEqual({ name, fit: "fits" })
      expect(fixture.calls["list-models"]).toMatchObject({ called: true, isError: false, contentTypes: ["text"], structured: { arguments: {}, tool: "string" }, text: { length: "synthetic list-models".length, json: null } })
      // An account read keeps only the top level of its shape, and never its arguments.
      expect(fixture.calls["get-credits"]).toEqual({ called: true, isError: false, contentTypes: ["text"], structured: { arguments: "object", tool: "string" }, text: { length: "synthetic get-credits".length, json: null } })
      expect(JSON.stringify(fixture)).not.toContain("synthetic get-credits")

      // The fixture and its provenance entry, written into a copy of the fixtures folder.
      const root = join(ROOT, "capture-root")
      mkdirSync(join(root, "test"), { recursive: true })
      cpSync(fileURLToPath(new URL("../fixtures", import.meta.url)), join(root, "test", "fixtures"), { recursive: true })
      writeFixture(root, fixture)
      expect(JSON.parse(readFileSync(join(root, "test", "fixtures", "live-tools.json"), "utf8"))).toEqual(fixture)
      const provenance = JSON.parse(readFileSync(join(root, "test", "fixtures", "provenance.json"), "utf8"))
      expect(provenance.live).toEqual({ fixture: "live-tools.json", retrieved: fixture.retrieved })
      expect(provenance.captures.map((item: { fixture: string }) => item.fixture)).toEqual(["documented-tools.json", "live-tools.json"])
      expect(provenance.captures[1]).toMatchObject({ evidence: "live-observed", endpoint: fake.url, digest: { algorithm: "sha256", value: toolsDigest(fixture.tools) } })
    } finally {
      await fake.close()
    }
  })

  test("stopping at the sign-in page: OpenCode's own sign-in is opened, then cancelled; no token, no tool call", async () => {
    const fake = await startFakeMcp({ challenge: true })
    try {
      const urlFile = join(ROOT, "signin-url.txt")
      const outcome = await run(fake, { oauth: true, signIn: "until-login", urlFile })
      expect(outcome.error).toBeUndefined()
      expect(outcome.result!.login!.page).toBe(`${fake.origin}/oauth/authorize`)
      expect(outcome.opened).toHaveLength(1)
      // With --url-file, the full URL is in a file only its owner can read.
      expect(readFileSync(urlFile, "utf8")).toBe(`${outcome.opened![0]}\n`)
      expect(statSync(urlFile).mode & 0o777).toBe(0o600)
      expect(new URL(outcome.opened![0]!).searchParams.get("code_challenge_method")).toBe("S256")
      expect(fake.tokens).toEqual([])
      expect(fake.calls).toEqual([])
    } finally {
      await fake.close()
    }
  })

  test("signs in through OpenCode's OAuth when the person completes the page, then captures", async () => {
    const fake = await startFakeMcp({ challenge: true, acceptAfterToken: true })
    try {
      const outcome = await run(fake, { oauth: true, signIn: "wait", browser: "follow" })
      expect(outcome.error).toBeUndefined()
      expect(fake.tokens).toHaveLength(1)
      expect(outcome.result!.fixture!.tools).toHaveLength(TOOL_NAMES.length + 1)
      expect(fake.calls).toEqual([...FREE_READS])
      // The fixture holds no part of the token exchange.
      expect(JSON.stringify(outcome.result)).not.toMatch(/fake-code|access_token|refresh_token/)
    } finally {
      await fake.close()
    }
  })

  test("a server that needs a sign-in, with sign-in refused, fails with a reason and calls nothing", async () => {
    const fake = await startFakeMcp({ challenge: true })
    try {
      const outcome = await run(fake, { oauth: true, signIn: "never" })
      expect(outcome.error).toBe("capture-live: the openrouter server needs a sign-in")
      expect(fake.calls).toEqual([])
    } finally {
      await fake.close()
    }
  })
})
