import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { readonly name: string; readonly version: string }

/** The package a metafile input belongs to, scoped-aware, or undefined outside node_modules. */
function packageOf(input: string): string | undefined {
  const marker = "node_modules/"
  const at = input.lastIndexOf(marker)
  if (at < 0) return undefined
  const parts = input.slice(at + marker.length).split("/")
  const first = parts[0]
  if (first === undefined || first === "") return undefined
  return first.startsWith("@") ? `${first}/${parts[1] ?? ""}` : first
}

test("NOTICE names every inlined package with its heading and verbatim licence", async () => {
  const outdir = mkdtempSync(join(tmpdir(), "openrouter-notice-"))
  try {
    const result = await build({
      entryPoints: [{ in: join(root, "src", "index.ts"), out: "index" }],
      outdir,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node24",
      external: ["@opencode/*"],
      legalComments: "none",
      logLevel: "silent",
      metafile: true,
      banner: { js: `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n// ${pkg.name} ${pkg.version}. Built by scripts/build.mjs; do not edit.` },
    })
    const inputs = Object.keys(result.metafile?.inputs ?? {})
    const names = new Set(inputs.map(packageOf).filter((name): name is string => name !== undefined))
    // zod is inlined inside the contract's dist, so esbuild reports no zod input file: detect its code in the bundle.
    const bundle = readFileSync(join(outdir, "index.js"), "utf8")
    if (bundle.includes("$ZodType") || bundle.includes("ZodError")) names.add("zod")
    const sorted = [...names].sort()
    assert.deepEqual(sorted, ["@we-the-rebel-alliance/plugin-contract", "yaml", "zod"], "the inlined package set changed without a NOTICE review")

    const notice = readFileSync(join(root, "NOTICE"), "utf8")
    for (const name of sorted) {
      const directory = join(root, "node_modules", ...name.split("/"))
      const installed = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { readonly version: string; readonly license: string }
      const licence = readFileSync(join(directory, "LICENSE"), "utf8")
      assert.ok(notice.includes(`## ${name} ${installed.version} (${installed.license})`), `NOTICE has no heading for ${name} ${installed.version}`)
      assert.ok(notice.includes(licence), `NOTICE does not carry the verbatim ${name} licence`)
    }
  } finally {
    rmSync(outdir, { recursive: true, force: true })
  }
})
