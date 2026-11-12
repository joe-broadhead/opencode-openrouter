// Fails when this plugin's copy of the tools RPC differs from the one every plugin carries.
//   node scripts/check-copies.mjs          check the copy this plugin has
//   node scripts/check-copies.mjs --print  print the copy's hash, after a change made in every plugin at once
// The copy keeps its own file, because each bundle stands alone. Only the part outside the PLUGIN-SPECIFIC markers is
// shared, and the hash below names that part's one version.
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"

const BEGIN = "// >>> PLUGIN-SPECIFIC >>>"
const END = "// <<< PLUGIN-SPECIFIC <<<"

const COPY = { path: "src/host/tools-rpc.ts", sha256: "15d82caa53aaae7ad9efb88dddb97056d3895c4dbf49b8efbb85b743871b2a6d" }

function sharedPart(text, path) {
  const begin = text.indexOf(BEGIN)
  const end = text.indexOf(END)
  if (begin === -1 || end === -1 || end < begin) throw new Error(`${path}: the PLUGIN-SPECIFIC markers are missing or out of order`)
  return text.slice(0, begin) + text.slice(end + END.length)
}

if (!existsSync(COPY.path)) {
  console.error(`MISSING: ${COPY.path}`)
  process.exit(1)
}
const hash = createHash("sha256").update(sharedPart(readFileSync(COPY.path, "utf8").replaceAll("\r\n", "\n"), COPY.path)).digest("hex")
if (process.argv.includes("--print")) {
  console.log(`${COPY.path}: ${hash}`)
} else if (hash === COPY.sha256) {
  console.log(`same: ${COPY.path}`)
} else {
  console.error(`DRIFT: ${COPY.path} differs from the copy every plugin carries. Change it in every plugin at once, then update its hash here.`)
  process.exit(1)
}
