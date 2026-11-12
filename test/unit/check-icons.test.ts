// scripts/check-icons.mjs, contract revision 2: the family rules are unchanged without `opencode.vendor.mark`, and
// with it a vendor's own mark replaces the family tile. Each case checks a copy of this package in a scratch folder.
import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const script = join(repo, "scripts", "check-icons.mjs")
const scratch = mkdtempSync(join(tmpdir(), "openrouter-icons-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const manifest = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"))
const MARK = readFileSync(join(repo, "assets", "icon.svg"), "utf8")
const README = "# OpenRouter for OpenCode\n\nUnofficial; not affiliated with OpenRouter. OpenRouter is a trademark of OpenRouter, Inc.\n"
const TILE = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#2B3340"/><path d="M13 16H35" stroke="#FFFFFF" fill="none"/></svg>'

type Options = { svg?: string; readme?: string | null; mark?: unknown; name?: string }
let count = 0

/** Writes a package with this repo's manifest and PNGs, then runs the checker on it. */
function check(options: Options = {}) {
  const dir = join(scratch, `case-${count++}`)
  mkdirSync(join(dir, "assets"), { recursive: true })
  cpSync(join(repo, "assets", "icon-128.png"), join(dir, "assets", "icon-128.png"))
  cpSync(join(repo, "assets", "icon-256.png"), join(dir, "assets", "icon-256.png"))
  writeFileSync(join(dir, "assets", "icon.svg"), options.svg ?? MARK)
  const next = structuredClone(manifest)
  if (options.name) next.name = options.name
  if ("mark" in options) {
    if (options.mark === undefined) delete next.opencode.vendor.mark
    else next.opencode.vendor.mark = options.mark
  }
  writeFileSync(join(dir, "package.json"), JSON.stringify(next))
  if (options.readme !== null) writeFileSync(join(dir, "README.md"), options.readme ?? README)
  const run = spawnSync("node", [script, dir], { encoding: "utf8" })
  return { ok: run.status === 0, out: `${run.stdout}${run.stderr}` }
}

describe("check-icons, contract revision 2", () => {
  test("this package passes: OpenRouter's own mark, flagged, with its notice", () => {
    expect(manifest.opencode.vendor.mark).toBe(true)
    const result = check()
    expect(result.out).toContain("revision 2")
    expect(result.ok).toBe(true)
  })

  test("without the flag, the family rules are unchanged: the vendor's mark is refused", () => {
    const result = check({ mark: undefined })
    expect(result.ok).toBe(false)
    expect(result.out).toContain("the tile's rx")
  })

  test("without the flag, a family tile still passes and needs no trademark line", () => {
    expect(check({ mark: undefined, svg: TILE, readme: "# x\n" }).ok).toBe(true)
  })

  test("the flag must be true or absent", () => {
    for (const mark of ["yes", false, 1]) {
      const result = check({ mark })
      expect(result.ok).toBe(false)
      expect(result.out).toContain("opencode.vendor.mark")
    }
  })

  test("a package of our own cannot claim a vendor's mark", () => {
    const result = check({ name: "@joe-broadhead/opencode-utilities" })
    expect(result.ok).toBe(false)
    expect(result.out).toContain("is our own product")
  })

  test("the README must say it is not affiliated with the vendor", () => {
    const result = check({ readme: "# OpenRouter\n\nOpenRouter is a trademark of OpenRouter, Inc.\n" })
    expect(result.ok).toBe(false)
    expect(result.out).toContain('"not affiliated with OpenRouter"')
  })

  test("the README must carry a trademark line", () => {
    const result = check({ readme: "# OpenRouter\n\nUnofficial; not affiliated with OpenRouter.\n" })
    expect(result.ok).toBe(false)
    expect(result.out).toContain("trademark line")
  })

  test("a missing README is refused", () => {
    const result = check({ readme: null })
    expect(result.ok).toBe(false)
    expect(result.out).toContain("README.md: missing")
  })

  test("the root must be a square viewBox starting at 0 0", () => {
    const wide = MARK.replace('viewBox="0 0 48 48"', 'viewBox="0 0 48 40"')
    expect(check({ svg: wide }).out).toContain("is not square")
    const moved = MARK.replace('viewBox="0 0 48 48"', 'viewBox="5 0 48 48"')
    expect(check({ svg: moved }).out).toContain("must start at 0 0")
    expect(check({ svg: MARK.replace(' viewBox="0 0 48 48"', "") }).out).toContain("has no viewBox")
  })

  test("path numbers are bounded by four times the viewBox width", () => {
    const within = MARK.replace('d="', 'd="M0 0H191 ')
    expect(check({ svg: within }).ok).toBe(true)
    const beyond = MARK.replace('d="', 'd="M0 0H193 ')
    const result = check({ svg: beyond })
    expect(result.ok).toBe(false)
    expect(result.out).toContain("far outside the 48x48 canvas")
  })

  test("the sanitizer still decides what is a clean icon", () => {
    const result = check({ svg: MARK.replace("<path", "<style>p{}</style><path") })
    expect(result.ok).toBe(false)
    expect(result.out).toContain("cleanPluginIcon")
  })

  test("the sanitizer block is unchanged from revision 1", () => {
    const text = readFileSync(script, "utf8")
    expect(text).toContain("// Shared block SHA-256: 34f125900257d27f159ffb514a6ddfff9627b4547d0743572be8433598fe22a1")
    const print = spawnSync("node", [script, "--print"], { encoding: "utf8" })
    expect(print.stdout).toContain("shared block  sha256 34f125900257d27f159ffb514a6ddfff9627b4547d0743572be8433598fe22a1")
  })
})
