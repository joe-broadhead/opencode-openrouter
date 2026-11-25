/** The shapes the handlers share. */
import type { JsonSchema } from "@we-the-rebel-alliance/plugin-contract/manifest"

/** A method that takes no input. */
export const EMPTY: JsonSchema = { type: "object", properties: {}, additionalProperties: false }

/**
 * `probe`'s answer. It is not `PROBE_SCHEMA`: that shape names a `source`, and this plugin has none. The owner is
 * OpenCode's own MCP server entry, so `verified` is always false.
 */
export const PROBE_ANSWER: JsonSchema = {
  type: "object",
  properties: {
    account: { type: "string" },
    owner: {
      type: "object",
      properties: {
        id: { type: "string" },
        label: { type: "string" },
        verified: { type: "boolean" },
      },
      required: ["id", "label", "verified"],
      additionalProperties: false,
    },
    trust: { type: "string", enum: ["untrusted"] },
  },
  required: ["account", "owner", "trust"],
  additionalProperties: false,
}
