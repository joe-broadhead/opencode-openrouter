// Canonical JSON for fixture digests: object keys sorted at every depth, arrays kept in order, no whitespace. The
// digest detects drift between a fixture and its provenance record; it is not a security signature.
import { createHash } from "node:crypto"

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
    return `{${entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")
