import { pluginError } from "./constants.js"

/** How much the default rules restrict OpenRouter's tools: allow all, ask before a change, or deny every change. */
export const ACCESS = ["all", "ask-changes", "read-only"] as const
export type Access = (typeof ACCESS)[number]
/** The family default: every tool is allowed, billable inference and feedback included. People narrow it with `access`. */
export const DEFAULT_ACCESS: Access = "all"

export interface Options {
  /** Run on an OpenCode version outside the supported range, with a warning in status. */
  readonly allowUntestedHost: boolean
  readonly access: Access
}

const EXAMPLE = `"plugins": [{ "package": "github:joe-broadhead/opencode-openrouter#v0.0.2", "options": { "access": "ask-changes" } }]`
const ACCEPTED = {
  access: `${ACCESS.map((value) => `"${value}"`).join(", ")}, with "${DEFAULT_ACCESS}" the default`,
  allowUntestedHost: "true or false (the default)",
} as const

const invalid = (problem: string) =>
  pluginError("OPTIONS_INVALID", `${problem}.`, `Fix the plugin options in opencode.json, for example ${EXAMPLE}.`)

/** Validates the plugin options from opencode.json. Every option is optional; an unknown one is refused. */
export function parseOptions(raw: unknown): Options {
  if (raw === undefined || raw === null) return { allowUntestedHost: false, access: DEFAULT_ACCESS }
  if (typeof raw !== "object" || Array.isArray(raw)) throw invalid(`The plugin options must be an object, found ${describe(raw)}`)
  const input = raw as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(ACCEPTED, key)) {
      throw invalid(`Unknown option ${JSON.stringify(key)}. Accepted options: ${Object.keys(ACCEPTED).map((name) => `"${name}"`).join(", ")}`)
    }
  }
  const { allowUntestedHost = false, access = DEFAULT_ACCESS } = input
  if (typeof allowUntestedHost !== "boolean") {
    throw invalid(`The option "allowUntestedHost" must be ${ACCEPTED.allowUntestedHost}, found ${describe(allowUntestedHost)}`)
  }
  if (!ACCESS.includes(access as Access)) {
    throw invalid(`The option "access" must be ${ACCEPTED.access}, found ${describe(access)}`)
  }
  return { allowUntestedHost, access: access as Access }
}

const describe = (value: unknown) =>
  value === null
    ? "null"
    : Array.isArray(value)
      ? "an array"
      : typeof value === "string"
        ? JSON.stringify(value.slice(0, 40))
        : typeof value === "object"
          ? "an object"
          : String(value)
