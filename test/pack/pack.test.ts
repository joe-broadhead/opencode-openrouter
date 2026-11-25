/**
 * The pack test: what `npm pack` ships, and that the shipped server entry loads as an OpenCode plugin.
 *
 * It installs the tarball into a throwaway project beside `@opencode/plugin` 2.4.1 and imports the package's `./server`
 * export, without running `setup`. `opencode plugin add <local path>` is not tested: OpenCode 2.4.1 refuses a local
 * path, so an install is always a tag or a registry specifier.
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../..", import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), "openrouter-pack-"))

after(() => rmSync(scratch, { recursive: true, force: true }))

interface PackedFile {
  readonly path: string
  readonly size: number
  readonly mode: number
}

interface Packed {
  readonly name: string
  readonly version: string
  readonly filename: string
  readonly files: readonly PackedFile[]
  readonly bundled: readonly string[]
}

let cache: Packed | undefined

/** Pack the repository once and return npm's report. */
function packed(): Packed {
  if (cache !== undefined) return cache
  const output = execFileSync("npm", ["pack", "--json", "--pack-destination", scratch], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  const reports = JSON.parse(output) as Packed[]
  assert.equal(reports.length, 1)
  const [report] = reports
  assert.ok(report !== undefined)
  cache = report
  return cache
}

test("the tarball ships the built entry, the skills, the assets and the licence, and no source or test", () => {
  const report = packed()
  assert.equal(report.name, "@we-the-rebel-alliance/openrouter-plugin")
  assert.equal(report.version, "0.0.0")
  const paths = report.files.map((file) => file.path)
  for (const path of [
    "package.json",
    "README.md",
    "LICENSE",
    "dist/index.js",
    "skills/openrouter/SKILL.md",
    "skills/openrouter-evaluate/SKILL.md",
    "skills/openrouter-images/SKILL.md",
    "skills/openrouter-troubleshoot/SKILL.md",
    "assets/icon.svg",
    "assets/icon-128.png",
    "assets/icon-256.png",
  ]) {
    assert.ok(paths.includes(path), `${path} is missing from the tarball`)
  }
  for (const path of paths) {
    assert.equal(path.startsWith("src/") || path.startsWith("test/") || path.startsWith("docs/") || path.startsWith("fixtures/") || path.startsWith("scripts/"), false, `${path} must not ship`)
  }
  assert.deepEqual(report.bundled, [])
})

test("every shipped file is readable and none is executable", () => {
  const report = packed()
  for (const file of report.files) {
    // npm records the checkout's umask on a non-executable file (600 on a hardened runner, 644 elsewhere); the mode
    // invariant that matters is that nothing ships executable and every file is owner-readable.
    assert.equal(file.mode & 0o111, 0, `${file.path} must not be executable (mode ${file.mode.toString(8)})`)
    assert.notEqual(file.mode & 0o400, 0, `${file.path} must be readable by its owner (mode ${file.mode.toString(8)})`)
    assert.ok(file.size > 0, `${file.path} is empty`)
  }
})

test("the built entry calls context.skill.transform directly, so the packaged skills load", () => {
  const entry = readFileSync(join(root, "dist", "index.js"), "utf8")
  assert.ok(entry.includes(".skill.transform"), "dist/index.js must call context.skill.transform; the packaged skills would not load")
})

test("the packed package has no runtime dependency and no lifecycle script", () => {
  const report = packed()
  assert.notEqual(report.filename, "")
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.peerDependencies, undefined)
  const scripts = pkg.scripts as Record<string, string>
  for (const lifecycle of ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack", "prepublishOnly"]) {
    assert.equal(scripts[lifecycle], undefined, lifecycle)
  }
})

test("the tarball installs beside @opencode/plugin 2.4.1 and its ./server entry is a Plugin.define value", () => {
  const report = packed()
  const project = join(scratch, "project")
  mkdirSync(project, { recursive: true })
  writeFileSync(
    join(project, "package.json"),
    `${JSON.stringify(
      {
        name: "openrouter-pack-check",
        private: true,
        type: "module",
        dependencies: {
          "@we-the-rebel-alliance/openrouter-plugin": `file:${join(scratch, report.filename)}`,
          "@opencode/plugin": "2.4.1",
        },
      },
      null,
      2,
    )}\n`,
  )
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: project,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 600_000,
  })

  const entry = join(project, "check-entry.mjs")
  writeFileSync(
    entry,
    [
      'import plugin from "@we-the-rebel-alliance/openrouter-plugin/server"',
      'console.log(JSON.stringify({ id: plugin.id, setup: typeof plugin.setup, keys: Object.keys(plugin).sort() }))',
      "",
    ].join("\n"),
  )
  const output = execFileSync(process.execPath, [entry], { cwd: project, encoding: "utf8", timeout: 60_000 })
  const value = JSON.parse(output) as { id: string; setup: string; keys: string[] }
  assert.equal(value.id, "openrouter")
  assert.equal(value.setup, "function")
  assert.deepEqual(value.keys, ["id", "setup"])

  const installed = JSON.parse(readFileSync(join(project, "node_modules", "@we-the-rebel-alliance", "openrouter-plugin", "package.json"), "utf8")) as Record<string, unknown>
  assert.equal(installed.dependencies, undefined)
  assert.equal(installed.capabilities === undefined, false)
})
