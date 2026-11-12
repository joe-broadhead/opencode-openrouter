// Captures OpenRouter's live MCP catalog, read-only, into test/fixtures/live-tools.json. Run by hand, never by
// `npm run check` or CI:
//
//   bun scripts/capture-live.ts --home <scratch folder>               sign in if needed, then capture and write
//   bun scripts/capture-live.ts --home <scratch folder> --until-login stop once OpenRouter's sign-in page is open
//   bun scripts/capture-live.ts --home <scratch folder> --check       capture again and report drift, write nothing
//   add --no-open to print the sign-in URL instead of opening it in the machine's desktop browser, and --keep-browser
//   to leave that browser open when the script ends
//
// It builds the plugin and runs it in an embedded OpenCode host whose home, config, database and project all live in
// the scratch folder, so no one's own OpenCode setup is read or changed. OpenCode does the sign-in: the script asks it
// for the sign-in URL of the `openrouter` server and opens that URL in the desktop browser, where the person signs in;
// OpenCode's own loopback callback receives the code and stores the credential in the scratch folder. The script never
// reads a request header, token or key.
//
// It watches the MCP server's HTTP responses in this process to record the raw `initialize` and `tools/list` pages
// (every page), and refuses, before it is sent, every `tools/call` except the free reads in FREE_READS: it never calls
// send-message, generate-image, send-feedback or spawn-ori-eval. It records each tool's name, a digest of its
// description, its schemas and annotations, and, for each free read it calls, the shape of the result (types only).
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Plugin as PluginApi } from "@opencode/plugin"
import { Plugin } from "@opencode/plugin"
import {
  argumentsFor,
  assertNoSecrets,
  drift,
  FREE_READS,
  firstModelId,
  messagesOf,
  recordResult,
  recordTool,
  refusal,
  requestsOf,
  toolsDigest,
  type LiveCall,
  type LiveFixture,
  type RawResult,
  type RawTool,
} from "./live-catalog.js"

export interface CaptureOptions {
  /** The MCP endpoint the plugin registers; the tap watches only this URL. */
  readonly endpoint: string
  /** The OpenRouter plugin to load, as OpenCode loads it. */
  readonly plugin: PluginApi.Plugin
  /** The scratch folder: config, database and project live here. */
  readonly home: string
  /** The folder of the @opencode/sdk package that hosts the run. */
  readonly sdk: string
  /** `wait` signs in when needed and captures; `until-login` stops once the sign-in page is open; `never` refuses. */
  readonly signIn: "wait" | "until-login" | "never"
  /** Opens the sign-in URL for the person who signs in. */
  readonly open?: (url: string) => void
  readonly log?: (line: string) => void
  readonly timeoutMs?: number
}

export interface CaptureResult {
  readonly fixture?: LiveFixture
  /** For `until-login`: the sign-in URL's origin and path, and the HTTP status its page answered. */
  readonly login?: { readonly page: string; readonly status: number }
}

type Pending = { method: string; tool?: string }

/**
 * Watches the MCP endpoint's responses in this process, and refuses a `tools/call` outside the free reads before it is
 * sent. Request headers are never read. Returns what it saw, and `restore`.
 */
function tap(endpoint: string) {
  const real = globalThis.fetch
  const listings: { pages: unknown[]; complete: boolean }[] = []
  const results = new Map<string, RawResult>()
  const refused: string[] = []
  let initialize: { protocolVersion?: string; serverInfo?: { name?: string; version?: string } } | undefined
  let seen = 0
  const reads: Promise<void>[] = []
  const wrapped = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    if (`${url.origin}${url.pathname}` !== endpoint || (init?.method ?? (input instanceof Request ? input.method : "GET")) !== "POST") return real(input, init)
    seen++
    const body = init?.body ?? undefined
    const why = refusal(body)
    if (why) {
      refused.push(why)
      throw new Error(`capture-live: ${why}`)
    }
    const requests = new Map<string | number, Pending>(requestsOf(body).flatMap((request) => (request.id === undefined ? [] : [[request.id, { method: request.method, ...(request.tool ? { tool: request.tool } : {}) }]])))
    const startsListing = requestsOf(body).some((request) => request.method === "tools/list" && !/"cursor"/.test(String(body)))
    if (startsListing) listings.push({ pages: [], complete: false })
    const response = await real(input, init)
    if (requests.size === 0) return response
    const copy = response.clone()
    reads.push(
      copy.text().then((text) => {
        for (const message of messagesOf(text, copy.headers.get("content-type"))) {
          const { id, result } = (message ?? {}) as { id?: string | number; result?: Record<string, unknown> }
          const request = id === undefined ? undefined : requests.get(id)
          if (!request || !result) continue
          if (request.method === "initialize") initialize = result as typeof initialize
          if (request.method === "tools/list") {
            const listing = listings.at(-1)
            if (!listing) continue
            listing.pages.push(result)
            if (!result["nextCursor"]) listing.complete = true
          }
          if (request.method === "tools/call" && request.tool) results.set(request.tool, result as RawResult)
        }
      }, () => undefined),
    )
    return response
  }) as typeof fetch
  globalThis.fetch = Object.assign(wrapped, { preconnect: real.preconnect })
  return {
    listings,
    results,
    refused,
    initialize: () => initialize,
    /** How many requests to the endpoint passed through the tap. */
    seen: () => seen,
    settled: () => Promise.all(reads.splice(0)),
    restore: () => void (globalThis.fetch = real),
  }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

async function until<T>(what: string, check: () => Promise<T | undefined | false>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`capture-live: timed out waiting until ${what}`)
    await sleep(500)
  }
}

/** The one-line reason of an error, without anything shaped like a credential. */
const reasonOf = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0]!.replace(/\b(bearer|basic|token)\s+\S+/gi, "$1 [redacted]").slice(0, 160)

/**
 * Runs one capture. Call it in a fresh process, before anything has loaded OpenCode: the tap replaces
 * `globalThis.fetch`, which OpenCode 2.2.6 reads once per process.
 */
export async function capture(options: CaptureOptions): Promise<CaptureResult> {
  const log = options.log ?? (() => {})
  const timeoutMs = options.timeoutMs ?? 20 * 60_000
  const project = join(options.home, "project")
  mkdirSync(project, { recursive: true })
  if (!existsSync(join(options.home, ".git"))) spawnSync("git", ["init", "--quiet", options.home])
  const watch = tap(options.endpoint)
  let probe: PluginApi.Context | undefined
  const probePlugin = Plugin.define({ id: "openrouter.capture.probe", setup: (ctx) => void (probe = ctx) })
  const sdkVersion = (JSON.parse(readFileSync(join(options.sdk, "package.json"), "utf8")) as { version: string }).version
  const { OpenCode } = (await import(pathToFileURL(join(options.sdk, "dist", "index.js")).href)) as typeof import("@opencode/sdk")
  const providers = { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } }
  const client = await OpenCode.create({
    plugins: [options.plugin, probePlugin],
    app: { version: sdkVersion },
    config: { content: JSON.stringify({ providers }), directory: join(options.home, "config"), project: false, claude: false },
    database: { path: join(options.home, "opencode.db") },
    models: { fetch: false },
    fs: { filewatcher: false },
    log: { level: "error" },
  })
  const location = { directory: project }
  type Row = { name: string; integrationID?: string; status: { status: string } }
  const row = async () => ((await client.mcp.list({ location })).data as Row[]).find((server) => server.name === "openrouter")
  try {
    const first = await until("the openrouter server has left pending", async () => {
      const found = await row()
      return found && found.status.status !== "pending" ? found : undefined
    }, 120_000)
    // OpenCode 2.2.6 resolves `globalThis.fetch` once per process, on first use: a host that used fetch before the tap
    // was installed would bypass it, and the capture would see nothing. Fail now rather than record nothing.
    if (watch.seen() === 0) throw new Error("capture-live: no MCP request passed through the capture's tap; run it in a fresh process, before anything loads OpenCode")
    if (first.status.status === "needs_auth") {
      if (options.signIn === "never") throw new Error("capture-live: the openrouter server needs a sign-in")
      const integrationID = first.integrationID
      if (!integrationID) throw new Error("capture-live: OpenCode lists no sign-in for the openrouter server")
      const { data: integration } = await client.integration.get({ integrationID, location })
      const method = (integration as { methods: { id: string; type: string }[] }).methods.find((item) => item.type === "oauth")
      if (!method) throw new Error("capture-live: the openrouter sign-in has no OAuth method")
      const oauth = (client.integration as unknown as { oauth: Record<"connect" | "cancel", (input: object) => Promise<{ data: { attemptID: string; url: string } }>> }).oauth
      const { data: attempt } = await oauth.connect({ integrationID, methodID: method.id, location })
      const page = new URL(attempt.url)
      log(`sign-in page: ${page.origin}${page.pathname}`)
      options.open?.(attempt.url)
      if (options.signIn === "until-login") {
        const answered = await fetch(attempt.url, { redirect: "manual" })
        await answered.body?.cancel()
        await oauth.cancel({ integrationID, attemptID: attempt.attemptID, location }).catch(() => undefined)
        return { login: { page: `${page.origin}${page.pathname}`, status: answered.status } }
      }
      log("waiting for the sign-in to finish in the browser")
      try {
        await until("the sign-in finishes and the server connects", async () => (await row())?.status.status === "connected", timeoutMs)
      } catch (error) {
        await oauth.cancel({ integrationID, attemptID: attempt.attemptID, location }).catch(() => undefined)
        throw error
      }
    } else if (first.status.status !== "connected") {
      throw new Error(`capture-live: the openrouter server is ${first.status.status}`)
    }
    if (options.signIn === "until-login") return {}
    log("connected; reading the catalog")
    const listed = await until(
      "OpenCode lists OpenRouter's tools",
      async () => {
        const tools = (await probe!.tool.list()).filter((tool) => tool.options?.namespace === "openrouter")
        await watch.settled()
        return tools.length > 0 && watch.listings.some((listing) => listing.complete) ? tools : undefined
      },
      120_000,
    )
    const listing = watch.listings.findLast((item) => item.complete)!
    const raw = listing.pages.flatMap((page) => ((page as { tools?: RawTool[] }).tools ?? []))
    if (raw.length !== listed.length) throw new Error(`capture-live: the server listed ${raw.length} tools, OpenCode ${listed.length}`)

    const sessionID = (await client.sessions.create({ agent: "build", location })).id
    const calls: Record<string, LiveCall> = {}
    let modelId: string | undefined
    let index = 0
    for (const name of FREE_READS) {
      const tool = raw.find((item) => item.name === name)
      if (!tool) {
        calls[name] = { called: false, reason: "not listed by the server" }
        continue
      }
      const planned = argumentsFor(tool.inputSchema ?? null, modelId ? { modelId } : {})
      if ("skip" in planned) {
        calls[name] = { called: false, reason: planned.skip }
        log(`${name}: not called (${planned.skip})`)
        continue
      }
      const executor = (await probe!.tool.list()).find((item) => item.id === `openrouter_${name}`)
      if (!executor) {
        calls[name] = { called: false, reason: "OpenCode does not list it" }
        continue
      }
      const context = { sessionID, agent: "build", messageID: "msg_capture", id: `call_capture_${++index}`, signal: new AbortController().signal, progress: async () => {} }
      let failure: string | undefined
      await executor.execute(planned.arguments as never, context as never).catch((error: unknown) => (failure = reasonOf(error)))
      await watch.settled()
      const result = watch.results.get(name)
      if (result) {
        calls[name] = recordResult(name, result, planned.arguments)
        if (name === "list-models") modelId = firstModelId(result)
      } else {
        calls[name] = { called: true, reason: failure ?? "no result reached the capture" }
      }
      log(`${name}: ${result ? (result.isError ? "error result" : "ok") : `failed (${calls[name]!.reason})`}`)
    }
    if (watch.refused.length) throw new Error(`capture-live: refused ${watch.refused.join("; ")}`)
    const init = watch.initialize()
    const fixture: LiveFixture = {
      evidence: "live-observed",
      note: "Captured from OpenRouter's MCP server with a signed-in account by scripts/capture-live.ts. Descriptions are recorded as digests; results as types only. No key, token, account id, balance or result text is recorded. No billable or feedback tool was called.",
      retrieved: new Date().toISOString().slice(0, 10),
      endpoint: options.endpoint,
      host: { version: sdkVersion, via: "embedded @opencode/sdk" },
      protocol: { version: init?.protocolVersion ?? null, server: init?.serverInfo ? { name: init.serverInfo.name, version: init.serverInfo.version } : null },
      pages: listing.pages.length,
      tools: raw.map(recordTool).sort((a, b) => (a.name < b.name ? -1 : 1)),
      calls,
    }
    assertNoSecrets(JSON.stringify(fixture))
    return { fixture }
  } finally {
    await client.close().catch(() => undefined)
    watch.restore()
  }
}

/** Writes the fixture and its provenance entry, replacing an earlier live capture. */
export function writeFixture(root: string, fixture: LiveFixture) {
  const text = `${JSON.stringify(fixture, null, 2)}\n`
  assertNoSecrets(text)
  writeFileSync(join(root, "test", "fixtures", "live-tools.json"), text)
  const path = join(root, "test", "fixtures", "provenance.json")
  const provenance = JSON.parse(readFileSync(path, "utf8")) as { captures: Record<string, unknown>[]; live: unknown; note: string }
  const entry = {
    fixture: "live-tools.json",
    evidence: "live-observed",
    retrieved: fixture.retrieved,
    endpoint: fixture.endpoint,
    source: "scripts/capture-live.ts, signed in",
    host: fixture.host.version,
    protocol: fixture.protocol.version,
    digest: { algorithm: "sha256", of: "canonical JSON of the recorded tools, sorted by name", value: toolsDigest(fixture.tools) },
    schemas: "recorded",
  }
  provenance.captures = [...provenance.captures.filter((item) => item["fixture"] !== "live-tools.json"), entry]
  provenance.live = { fixture: "live-tools.json", retrieved: fixture.retrieved }
  writeFileSync(path, `${JSON.stringify(provenance, null, 2)}\n`)
}

async function main(argv: readonly string[]) {
  const flag = (name: string) => argv.includes(name)
  const value = (name: string) => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const given = value("--home")
  if (!given) {
    console.error("usage: bun scripts/capture-live.ts --home <scratch folder> [--until-login | --check] [--no-open] [--keep-browser] [--timeout <minutes>]")
    process.exit(2)
  }
  const root = fileURLToPath(new URL("..", import.meta.url))
  const home = resolve(given)
  mkdirSync(home, { recursive: true })
  // The desktop browser keeps the caller's environment; OpenCode gets only the scratch folder's.
  const caller = { ...process.env }
  const KEEP = ["PATH", "LANG", "TZ", "TERM"]
  for (const key of Object.keys(process.env)) if (!KEEP.includes(key) && !key.startsWith("BUN_")) delete process.env[key]
  const userHome = join(home, "home")
  Object.assign(process.env, {
    HOME: userHome,
    OPENCODE_TEST_HOME: userHome,
    XDG_CONFIG_HOME: join(userHome, ".config"),
    XDG_DATA_HOME: join(userHome, ".local", "share"),
    XDG_CACHE_HOME: join(userHome, ".cache"),
    XDG_STATE_HOME: join(userHome, ".local", "state"),
    TMPDIR: join(home, "tmp"),
  })
  for (const dir of [userHome, join(home, "tmp")]) mkdirSync(dir, { recursive: true })

  const build = spawnSync("node", [join(root, "scripts", "build.mjs")], { cwd: root, stdio: "inherit", env: caller })
  if (build.status !== 0) process.exit(build.status ?? 1)
  const { ENDPOINT } = await import(pathToFileURL(join(root, "src", "constants.ts")).href)
  const plugin = (await import(pathToFileURL(join(root, "dist", "index.js")).href)).default as PluginApi.Plugin
  // A browser session of its own, with its profile in the scratch folder, on the machine's desktop, where the person
  // watches and signs in. The machine's default browser profile is never used.
  const browser = ["--session", "openrouter-signin", "--profile", join(home, "browser")]
  const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`
  const open = flag("--no-open")
    ? undefined
    : (url: string) => {
        const launched = spawnSync("boxd-desktop-launch", [["agent-browser", ...browser, "open", url].map(quote).join(" ")], { env: caller, stdio: "ignore" })
        if (launched.status !== 0) console.log(`Open this URL in a browser on this machine:\n${url}`)
        else console.log("Opened the sign-in page in the machine's desktop browser (boxd console: Open, then Desktop).")
      }
  const closeBrowser = () => {
    if (open && !flag("--keep-browser")) spawnSync("agent-browser", [...browser, "close"], { env: caller, stdio: "ignore", timeout: 30_000 })
  }
  const minutes = Number(value("--timeout") ?? 20)
  const result = await capture({
    endpoint: ENDPOINT,
    plugin,
    home,
    sdk: join(root, "node_modules", "@opencode", "sdk"),
    signIn: flag("--until-login") ? "until-login" : flag("--check") ? "never" : "wait",
    ...(open ? { open } : {}),
    log: (line) => console.log(line),
    timeoutMs: minutes * 60_000,
  }).finally(closeBrowser)
  if (result.login) {
    console.log(`Stopped before signing in: ${result.login.page} answered ${result.login.status}.`)
    return
  }
  const fixture = result.fixture!
  if (flag("--check")) {
    const committed = join(root, "test", "fixtures", "live-tools.json")
    if (!existsSync(committed)) throw new Error("capture-live: there is no committed live-tools.json to compare with")
    const changes = drift((JSON.parse(readFileSync(committed, "utf8")) as LiveFixture).tools, fixture.tools)
    console.log(JSON.stringify(changes, null, 2))
    process.exitCode = Object.values(changes).some((list) => list.length) ? 1 : 0
    return
  }
  writeFixture(root, fixture)
  const confirmed = Object.entries(fixture.calls).filter(([, call]) => call.called && !call.reason && !call.isError).map(([name]) => name)
  console.log(`Wrote test/fixtures/live-tools.json: ${fixture.tools.length} tools in ${fixture.pages} page(s); free reads that answered: ${confirmed.join(", ") || "none"}.`)
}

if (import.meta.main) {
  await main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
