// Pack, install and load the published shape. The tarball holds exactly the files whitelist and installs with
// lifecycle scripts disabled. Installed alone, it loads in each stock OpenCode release it is tested on, which provides
// @opencode/plugin, OpenTUI and Solid itself; next to those packages, both entry points also import under Bun.
// OPENCODE_BIN_2_2_3 to OPENCODE_BIN_2_2_6 name stock binaries; otherwise each release in TESTED_HOSTS is installed
// with npm, once per run. Every temp folder is a git repository under the system's temp folder, so OpenCode's upward
// search for `.opencode` folders stops there. PACK_TARBALL names a tarball that was already packed to test it instead.
// On each release a copy of the installed plugin is also pointed at a loopback fake of OpenRouter's MCP and sign-in
// server, to check that the sign-in OpenCode starts is its own.
import { afterAll, describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { arch, platform, tmpdir } from "node:os"
import { basename, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { DISPLAY_NAME, ENDPOINT, PLUGIN_ID, SERVER_NAME, TESTED_HOSTS } from "../../src/constants.js"
import { TUI_ID } from "../../src/tui.js"
import { startFakeMcp } from "../host/fake-mcp.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string
  version: string
  files: string[]
  exports: Record<string, string>
  devDependencies: Record<string, string>
}
// Outside the repository, so nothing resolves from the repository's own node_modules.
const work = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), "openrouter-pack-")))
// A repository root, where OpenCode's search for `.opencode` folders and project config stops.
run("git", ["init", "--quiet", work], root)
// Removing the installed packages and binaries can take longer than the default hook timeout.
afterAll(() => rmSync(work, { recursive: true, force: true }), { timeout: 120_000 })

/**
 * The host's ID for a remote MCP server's integration, derived from its name and URL. Only this test computes it, to
 * check the host's value; the plugin reads it from the host.
 */
const integrationID = (name: string, url: string) => `mcp_${createHash("sha1").update(`${name}\0${url}`).digest("hex").slice(0, 16)}`

const MAX_FILES = 30
const MAX_PACKED_BYTES = 100 * 1024
// The two self-contained entry bundles, and nothing else, in dist/.
const DIST = ["dist/index.js", "dist/tui.js"]
// Modules the host serves to plugins at runtime. Everything else must be inlined in the bundle.
const SERVER_HOST_MODULES = [/^node:/, /^@opencode\/plugin(?:\/|$)/]
const TUI_HOST_MODULES = [/^node:/, /^@opencode\/plugin(?:\/|$)/, /^@opentui\//, /^solid-js(?:\/|$)/]
// The host packages OpenCode 2.2.3 ships; the versions come from devDependencies.
const HOST_PACKAGES = ["@opencode/plugin", "@opentui/core", "@opentui/solid", "solid-js"]
// Anything a stock host tries on the network goes to a closed port, except loopback.
const OFFLINE = {
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  http_proxy: "http://127.0.0.1:9",
  https_proxy: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_AUTOUPDATE: "true",
  OPENCODE_DISABLE_FREE_MODELS: "true",
}

type Packed = { filename: string; size: number; entryCount: number; files: { path: string }[] }

let packed: Packed | undefined
function pack(): Packed {
  if (packed) return packed
  const given = process.env.PACK_TARBALL
  if (given) {
    const tarball = resolve(given)
    copyFileSync(tarball, join(work, basename(tarball)))
    const files = run("tar", ["-tzf", tarball], root).trim().split("\n").filter((path) => !path.endsWith("/")).map((path) => ({ path: path.replace(/^package\//, "") }))
    packed = { filename: basename(tarball), size: statSync(tarball).size, entryCount: files.length, files }
    return packed
  }
  // Build first, explicitly: the package has no prepare or prepack hook, and a stale dist/ must never be packed.
  run("node", [join(root, "scripts", "check.mjs"), "build"], root)
  const result = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], root)
  packed = (JSON.parse(result) as Packed[])[0]!
  return packed
}

/** An empty project with its own package.json, so npm never walks up to another one. */
function project(name: string): string {
  const dir = join(work, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `openrouter-pack-${name}`, private: true, type: "module" }))
  return dir
}

const installs = new Map<string, string>()
/** The tarball installed with scripts disabled, alone or next to the host packages. */
function install(withHostPackages: boolean): string {
  const name = withHostPackages ? "with-host-packages" : "alone"
  const existing = installs.get(name)
  if (existing) return existing
  const dir = project(name)
  const hosts = withHostPackages ? HOST_PACKAGES.map((item) => `${item}@${pkg.devDependencies[item]}`) : []
  run("npm", ["install", join(work, pack().filename), ...hosts, "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], dir)
  installs.set(name, dir)
  return dir
}

const installedPackage = (withHostPackages: boolean) => join(install(withHostPackages), "node_modules", ...pkg.name.split("/"))

/** A home, OpenCode's test home, XDG folders and a temp folder, all inside `base`. */
function isolated(base: string) {
  const home = join(base, "home")
  const env = {
    HOME: home,
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    TMPDIR: join(base, "tmp"),
  }
  for (const dir of Object.values(env)) mkdirSync(dir, { recursive: true })
  return env
}

describe("package tarball", () => {
  test("lists exactly the files whitelist, under the size and file limits", () => {
    const { files, entryCount, size } = pack()
    const paths = files.map((file) => file.path).sort()
    const expected = ["package.json", ...pkg.files.flatMap((entry) => whitelisted(entry))].sort()
    expect(paths).toEqual(expected)
    expect(entryCount).toBeLessThan(MAX_FILES)
    expect(size).toBeLessThanOrEqual(MAX_PACKED_BYTES)
    expect(paths.filter((path) => path.includes("node_modules/") || /\.(?:tsx|jsx)$/.test(path))).toEqual([])
    for (const target of Object.values(pkg.exports)) expect(paths).toContain(target.replace(/^\.\//, ""))
    expect(paths.filter((path) => path.endsWith(".d.ts"))).toEqual([])
  }, 120_000)

  test("installs with scripts disabled and loads both entry points under Bun, next to the host packages", () => {
    const consumer = install(true)
    const probe = join(consumer, "probe.mjs")
    writeFileSync(probe, [
      "const out = {}",
      `for (const [part, specifier] of [["server", ${JSON.stringify(pkg.name)}], ["tui", ${JSON.stringify(`${pkg.name}/tui`)}]]) {`,
      "  const plugin = (await import(specifier)).default",
      "  out[part] = { id: plugin?.id, setup: typeof plugin?.setup }",
      "}",
      "console.log(JSON.stringify(out))",
    ].join("\n"))
    const output = run(process.execPath, [probe], consumer, { PATH: process.env.PATH, ...isolated(join(work, "bun-probe")) })
    expect(JSON.parse(output.trim().split("\n").at(-1)!)).toEqual({
      server: { id: PLUGIN_ID, setup: "function" },
      tui: { id: TUI_ID, setup: "function" },
    })
  }, 300_000)

  // OpenCode reloads a plugin in place and reuses the module records it holds for unchanged paths, so an entry that
  // imported a sibling module could get an older cached copy of it. Each entry must stand alone.
  test("dist holds only the two entry bundles, and they import no sibling module", () => {
    const dist = join(installedPackage(true), "dist")
    expect(tree(relative(root, dist), dist).sort()).toEqual(["index.js", "tui.js"])
    for (const file of ["index.js", "tui.js"]) expect(relativeImports(readFileSync(join(dist, file), "utf8"))).toEqual([])
  }, 300_000)

  test("dist imports only modules the host provides, and names the endpoint exactly once", () => {
    const dist = join(installedPackage(true), "dist")
    expect(foreign(join(dist, "index.js"), SERVER_HOST_MODULES)).toEqual([])
    expect(foreign(join(dist, "tui.js"), TUI_HOST_MODULES)).toEqual([])
    expect(readFileSync(join(dist, "index.js"), "utf8").split(JSON.stringify(ENDPOINT)).length - 1).toBe(1)
  }, 300_000)
})

describe.each(TESTED_HOSTS)("installed alone, in stock OpenCode %s", (version) => {
  test("is active, registers openrouter at the endpoint, and names only its own /connect entry OpenRouter tools", async () => {
    const installed = installedPackage(false)
    const host = await serve(version, installed)
    try {
      const plugin = await host.until("the plugin finishes loading", async () => {
        const { data } = await host.api<{ data: { id: string; state: { status: string } }[] }>("GET", "/api/plugin")
        const found = data.find((item) => item.id === PLUGIN_ID)
        return found && found.state.status !== "loading" ? found : undefined
      })
      expect(plugin.state).toEqual({ status: "active" })

      const server = await host.until("the openrouter server is registered", async () => {
        const { data } = await host.api<{ data: { name: string; integrationID?: string }[] }>("GET", "/api/mcp")
        return data.find((item) => item.name === SERVER_NAME)
      })
      // The ID OpenCode keys the sign-in by: the same name and URL as a sign-in made before the plugin was installed.
      expect(server.integrationID).toBe(integrationID(SERVER_NAME, ENDPOINT))
      type Listed = { id: string; name: string; metadata?: { source?: string } }
      const listed = await host.until("/connect lists the server as OpenRouter tools", async () => {
        const { data } = await host.api<{ data: Listed[] }>("GET", "/api/integration")
        const found = data.find((item) => item.id === server.integrationID)
        return found?.name === DISPLAY_NAME ? found : undefined
      })
      expect(listed.metadata?.source).toBe("mcp")
      // The built-in model provider's integration is a different entry, and keeps its own name.
      const { data: all } = await host.api<{ data: Listed[] }>("GET", "/api/integration")
      expect(all.find((item) => item.id === "openrouter")).toMatchObject({ id: "openrouter", name: "OpenRouter" })
      expect(all.filter((item) => item.name === DISPLAY_NAME).map((item) => item.id)).toEqual([server.integrationID!])
    } catch (error) {
      throw new Error(`${(error as Error).message}\n--- opencode ${version} log ---\n${host.log().slice(-3000)}`)
    } finally {
      await host.close()
    }
  }, 600_000)

  test("pointed at a fake that needs a sign-in, reports needs_auth and OpenCode starts its own sign-in", async () => {
    const fake = await startFakeMcp({ challenge: true })
    const installed = pointedAt(fake.url, version)
    const host = await serve(version, installed, { name: `pointed-${version}` })
    try {
      const id = integrationID(SERVER_NAME, fake.url)
      const server = await host.until("the server needs a sign-in", async () => {
        const { data } = await host.api<{ data: { name: string; integrationID?: string; status: { status: string } }[] }>("GET", "/api/mcp")
        const found = data.find((item) => item.name === SERVER_NAME)
        return found?.status.status === "needs_auth" ? found : undefined
      })
      expect(server.integrationID).toBe(id)
      const integration = await host.until("the entry is named OpenRouter tools", async () => {
        const { data } = await host.api<{ data: { name: string; methods: { id: string }[] } }>("GET", `/api/integration/${id}`)
        return data.name === DISPLAY_NAME ? data : undefined
      })
      const started = await host.api<Record<string, any>>("POST", `/api/integration/${id}/connect/oauth`, { methodID: integration.methods[0]!.id })
      const attempt = (started.data ?? started) as { attemptID: string; url: string }
      try {
        const url = new URL(attempt.url)
        expect(`${url.origin}${url.pathname}`).toBe(`${fake.origin}/oauth/authorize`)
        expect(url.searchParams.get("code_challenge_method")).toBe("S256")
        expect(url.searchParams.get("client_id")).toBe("fake-client-1")
        expect(fake.registrations).toHaveLength(1)
        expect(fake.tokens).toHaveLength(0)
        expect(fake.calls).toEqual([])
      } finally {
        await host.request("DELETE", `/api/integration/${id}/connect/oauth/${attempt.attemptID}`)
      }
    } catch (error) {
      throw new Error(`${(error as Error).message}\n--- opencode ${version} log ---\n${host.log().slice(-3000)}`)
    } finally {
      await host.close()
      await fake.close()
    }
  }, 600_000)
})

/** A copy of the installed package whose endpoint points at `url`. */
function pointedAt(url: string, name: string) {
  const copy = join(work, "pointed", name)
  cpSync(installedPackage(false), copy, { recursive: true })
  const entry = join(copy, "dist", "index.js")
  const text = readFileSync(entry, "utf8")
  const quoted = JSON.stringify(ENDPOINT)
  expect(text.split(quoted).length - 1).toBe(1)
  writeFileSync(entry, text.replace(quoted, JSON.stringify(url)))
  return copy
}

/**
 * OPENCODE_BIN_<version>, or the unmodified npm release with its platform binary, installed with scripts disabled.
 * Installed once per version: several tests serve the same release.
 */
const ran = new Set<string>()
const binaries = new Map<string, string>()
function stockBinary(version: string): string {
  ran.add(version)
  const given = process.env[`OPENCODE_BIN_${version.replaceAll(".", "_")}`]
  if (given) return given
  const cached = binaries.get(version)
  if (cached) return cached
  const binary = `@opencode/cli-${platform()}-${arch()}`
  const dir = project(`opencode-${version}`)
  // Only this platform's binary: each one is a few hundred megabytes.
  run("npm", ["install", `@opencode/cli@${version}`, `${binary}@${version}`, "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], dir)
  const path = join(dir, "node_modules", binary, "bin", "opencode")
  binaries.set(version, path)
  return path
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const { port } = server.address() as { port: number }
  await new Promise((done) => server.close(done))
  return port
}

/**
 * `opencode serve` on its own port and password, in an environment that holds only its temp root and is offline, with
 * a project that loads the installed package.
 */
async function serve(version: string, installed: string, options: { readonly name?: string } = {}) {
  const binary = stockBinary(version)
  const base = join(work, options.name ?? `stock-${version}`)
  const directory = join(base, "project")
  // Keep the built-in local providers from probing their default ports.
  const providers = { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } }
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "opencode.json"), JSON.stringify({ plugins: [installed], providers }))
  const password = randomUUID()
  const env = { ...isolated(base), ...OFFLINE, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", OPENCODE_PASSWORD: password }

  expect(run(binary, ["--version"], directory, env).trim()).toBe(`opencode v${version}`)
  // OpenCode resolves every global path from this environment; none may leave the temp root.
  const paths = run(binary, ["debug", "paths"], directory, env).trim().split("\n").map((line) => line.trim().split(/\s+/))
  expect(paths.length).toBeGreaterThan(5)
  expect(paths.filter(([, path]) => !path?.startsWith(base + sep))).toEqual([])

  const port = await freePort()
  let log = ""
  const server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] })
  server.stdout.on("data", (chunk) => void (log += chunk))
  server.stderr.on("data", (chunk) => void (log += chunk))
  const exited = new Promise((done) => server.once("exit", done))

  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  /** The response's status and parsed body, whatever the status. */
  const request = async (method: string, path: string, body?: unknown) => {
    const url = new URL(path, `http://127.0.0.1:${port}`)
    url.searchParams.set("location[directory]", directory)
    const response = await fetch(url, { method, headers: { authorization, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // Not JSON: keep the text.
    }
    return { status: response.status, ok: response.ok, text, body: parsed }
  }
  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await request(method, path, body)
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${response.text.slice(0, 500)}`)
    return response.body as T
  }
  /** Polls until `read` returns a value. The server answers before plugins finish loading, more slowly when busy. */
  const until = async <T>(what: string, read: () => Promise<T | false | undefined>, ms = 180_000): Promise<T> => {
    for (const deadline = Date.now() + ms; ; await Bun.sleep(500)) {
      const value = await read().catch((error: unknown) => (Date.now() > deadline ? Promise.reject(error) : undefined))
      if (value) return value
      if (server.exitCode !== null) throw new Error(`opencode ${version} exited before ${what}`)
      if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`)
    }
  }
  const close = async () => {
    if (server.exitCode !== null || server.signalCode !== null) return
    server.kill("SIGTERM")
    const timer = setTimeout(() => server.kill("SIGKILL"), 10_000)
    await exited
    clearTimeout(timer)
  }
  return { api, request, until, close, directory, log: () => log }
}

// The files a `files` entry should put in the tarball. dist/ must hold exactly the two bundles, so stale or foreign
// build output fails the comparison, and so does a missing whitelisted file.
function whitelisted(entry: string): string[] {
  if (entry === "dist") return DIST
  const path = join(root, entry)
  if (!existsSync(path)) return [`${entry} (missing)`]
  return statSync(path).isDirectory() ? tree(entry) : [entry]
}

/** Every file under `dir`, as paths relative to `base` (the repository root by default). */
function tree(dir: string, base = root): string[] {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile() && item.name !== ".DS_Store")
    .map((item) => relative(base, join(item.parentPath, item.name)).split(sep).join("/"))
}

/** Every module specifier in a file: static imports and re-exports, dynamic `import()` and `require()`. */
const specifiers = (source: string) =>
  [...source.matchAll(/(?:^|[\s;}])(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?["']([^"']+)["']|\b(?:import|require)\s*\(\s*["'`]?([^"'`)]*)["'`]?\s*\)/g)].map((match) => (match[1] ?? match[2])!)

/** Relative imports, and every dynamic `import()` or `require()` call: a self-contained bundle has none. */
const relativeImports = (source: string) => [
  ...specifiers(source).filter((specifier) => specifier.startsWith(".")),
  ...[...source.matchAll(/(?<![\w$.])(?:import|require)\s*\(/g)].map((match) => match[0]),
]

/** The bare specifiers of one bundle that the allowed list does not cover. */
const foreign = (file: string, allowed: RegExp[]) =>
  [...new Set(specifiers(readFileSync(file, "utf8")).filter((specifier) => !allowed.some((pattern) => pattern.test(specifier))))].sort()

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = { ...process.env, npm_config_update_notifier: "false" }): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}

// A release that did not run is a failure, never a silent skip: every tested release must have loaded a stock binary,
// so a suite that quietly tested only one of them cannot pass.
describe("the tested releases", () => {
  test("every release in TESTED_HOSTS ran the stock binary in this run", () => {
    expect([...ran].sort()).toEqual([...TESTED_HOSTS].sort())
  })
})
