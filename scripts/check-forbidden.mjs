// Fails when a forbidden API, legacy surface, private host reference or machine-local path appears
// in src/, test/, scripts/ or dist/. The list is the "Forbidden in this repository" list in AGENTS.md. APIs that the
// public @opencode/plugin 2.2.3 types already reject fail the typecheck instead.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { extname, join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const self = fileURLToPath(import.meta.url)
const ROOTS = ["src", "test", "scripts", "dist"]
const MEMBER = String.raw`\s*(?:\?\.|\.)\s*`
const PERMISSION_HOOK = new RegExp(String.raw`\bpermission${MEMBER}hook\b`)

const RULES = [
  { id: "fork-marker", pattern: /dispatch[-_ ]?lease|catalog[-_ ]?ownership|text[-_ ]?only[-_ ]?respons/i, why: "dispatch-lease, ownership and text-only markers are fork-only" },
  { id: "tool-options-mcp", pattern: new RegExp(String.raw`\boptions${MEMBER}mcp\b|\boptions\s*:\s*\{\s*mcp\s*:|\boptions\b[^\n;,]{0,80}\)${MEMBER}mcp\b`), why: "tool options.mcp delegation is fork-only" },
  { id: "plugin-image", pattern: new RegExp(String.raw`\bPlugin${MEMBER}image\b|\bPROFILE_IMAGE\b|profile[-_]?image|profile\.png`, "i"), why: "Plugin.image and profile images were dropped" },
  { id: "imported-oauth", pattern: /\bimported[-_]?(?:gh[-_]?)?oauth\b|\bimportedOAuth\b/i, why: "imported OAuth grants are not allowed" },
  { id: "v1-plugin-api", pattern: /@opencode-ai\//, why: "@opencode-ai/* is the V1 plugin API" },
  { id: "v1-hook", pattern: /["'`](?:tool\.execute\.(?:before|after)|chat\.(?:message|params)|permission\.ask)["'`]/, why: "V1 plugin hooks are not allowed" },
  { id: "generate-text", pattern: new RegExp(String.raw`\bgenerate${MEMBER}text\b`), why: "ctx.generate.text is deprecated" },
  { id: "experimental-policies", pattern: new RegExp(String.raw`\bexperimental${MEMBER}policies\b`), why: "experimental.policies is deprecated" },
  { id: "opencode-ai-import", pattern: /["'`]@opencode\/ai(?:\/[^"'`]*)?["'`]/, why: "@opencode/ai breaks between patch releases; import only @opencode/plugin" },
  // Internal wording: shipped text states behaviour, never who decided it, and never a lane's name.
  { id: "internal-wording", pattern: /\bowner(?:'s)? (?:decision|ruling|sign-off|call)\b|\bthe lead(?:'s)? (?:decision|ruling|audit|report|review)\b|\bhey-jelly\s*#|\b(?:audit|review|reconcile) lane\s+[A-Z]\d\b|\blane\s+G\d\b/i, why: "no internal wording: state the behaviour, not who decided it, and name no lane" },
  // No permission hook at all yet. The family's tools RPC carries exactly one evaluate hook, which turns an ask on one of
  // its own script calls in flight into a deny; when that module is added, this rule gains its exception and count.
  { id: "permission-hook", pattern: PERMISSION_HOOK, why: "no escalating permission hook; default rules go through ctx.agent.transform" },
  // OpenCode derives an MCP integration's ID itself. The plugin reads it from ctx.mcp.list() and never recomputes it.
  { id: "integration-hash", pattern: /createHash\(\s*["'`]sha1|["'`]mcp_["'`]\s*\+/, why: "read the MCP integrationID from ctx.mcp.list(); never compute the host's hash", only: ["src", "dist"] },
  { id: "host-source", pattern: /packages\/(?:core|plugin|schema)\/src\b|opencode-[\w-]*-host\b|\bconsumer-host\b/, why: "never reference or import private host source or host checkouts" },
  { id: "absolute-path", pattern: /\/Users\/[^/\s"'`]+\/|\/home\/[^/\s"'`]+\/|\/(?:private\/)?var\/folders\/|(?<![\w.:/-])\/tmp\/|[A-Za-z]:\\\\?Users\\/, why: "machine-local home and temp paths do not belong in the repository; make temp folders with mkdtemp under os.tmpdir(), or use a relative path" },
]

const findings = []
for (const top of ROOTS) {
  const dir = join(root, top)
  if (!existsSync(dir)) continue
  for (const file of walk(dir)) {
    if (file === self) continue
    const path = relative(root, file).split(sep).join("/")
    if (top === "dist" && [".tsx", ".jsx"].includes(extname(file))) findings.push({ path, line: 0, id: "dist-jsx-source", why: "no .tsx or .jsx ships; the TUI is prebuilt" })
    const buffer = readFileSync(file)
    if (buffer.includes(0)) continue
    const lines = buffer.toString("utf8").split(/\r?\n/)
    for (const rule of RULES) {
      if (rule.only && !rule.only.includes(top)) continue
      lines.forEach((text, index) => {
        if (rule.pattern.test(text)) findings.push({ path, line: index + 1, id: rule.id, why: rule.why, text })
      })
    }
  }
}

for (const { path, line, id, why, text } of findings) {
  console.error(`${path}${line ? `:${line}` : ""}: [${id}] ${why}${text ? `\n    ${text.trim().slice(0, 160)}` : ""}`)
}
if (findings.length) {
  console.error(`\n${findings.length} forbidden reference(s) found. Remove them; see the forbidden list in AGENTS.md.`)
  process.exit(1)
}
console.log(`No forbidden references in ${ROOTS.filter((top) => existsSync(join(root, top))).join(", ")}.`)

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.isFile()) yield path
  }
}

// The family's working folders and the owner's private names never reach a public file. This reads every git-tracked
// file, so a note in a doc, a skill or a fixture is caught as well as code. AGENTS.md and this script name them on
// purpose and are skipped. Case does not matter.
{
  const { realpathSync, existsSync, readFileSync } = await import("node:fs")
  const { execFileSync } = await import("node:child_process")
  const { join, dirname } = await import("node:path")
  const { fileURLToPath } = await import("node:url")
  const WORDS = /opencode-release\/|prosus|toqan/i
  const self = realpathSync(fileURLToPath(import.meta.url))
  if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === self) {
    const repo = join(dirname(self), "..")
    let listed = []
    try {
      listed = execFileSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean)
    } catch {
      // Not a git checkout, such as a packed tarball: the scan above covers the shipped files.
    }
    const hits = []
    for (const path of listed) {
      if (path === "AGENTS.md" || path === "scripts/check-forbidden.mjs") continue
      const file = join(repo, path)
      if (!existsSync(file)) continue
      const buffer = readFileSync(file)
      if (buffer.includes(0)) continue
      buffer.toString("utf8").split(/\r?\n/).forEach((text, index) => {
        if (WORDS.test(text)) hits.push(`${path}:${index + 1}`)
      })
    }
    if (hits.length) {
      console.error(`forbidden-words: the family's working folders and the owner's private names must not appear in a public file:\n  ${hits.join("\n  ")}`)
      process.exitCode = 1
    }
  }
}
