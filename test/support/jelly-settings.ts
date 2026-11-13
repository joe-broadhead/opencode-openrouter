/**
 * Jelly's rules for a declared setting, restated without zod so a test can check `jelly.contributes.settings` the way
 * Jelly reads it: `PluginSettingSchema` (a strict object, with its refinements) and `settingValueIssue`, the check the
 * host runs on every value a person saves, from Jelly's plugin contracts (Jelly app#1301). A Jelly from before that
 * change refuses a setting that declares `enum`, `choices`, `min`, `max`, `step` or `integer`.
 *
 * Each function returns the problems it finds, as sentences, so a test asserts `toEqual([])`.
 */

export type SettingChoice = { value: string; label?: string; description?: string }
export type DeclaredSetting = {
  key: string
  label: string
  type: "string" | "boolean" | "number" | "secret"
  description: string
  enum?: string[]
  choices?: SettingChoice[]
  min?: number
  max?: number
  step?: number
  integer?: boolean
  visibleWhen?: { setting: string; equals: string | boolean | number }
  default?: string | boolean | number
}

/** Jelly's own words for the three `access` values, the same in every plugin of the family. */
export const ACCESS_CHOICES: readonly SettingChoice[] = [
  { value: "all", label: "Allowed", description: "Every tool runs without asking, reads and changes alike." },
  { value: "ask-changes", label: "Ask before changes", description: "Reads run without asking. Each change asks you first." },
  { value: "read-only", label: "Read only", description: "Reads run. Changes never run." },
]

const SETTING_KEYS = ["key", "label", "type", "description", "enum", "choices", "min", "max", "step", "integer", "visibleWhen", "default"]
const CHOICE_KEYS = ["value", "label", "description"]
const ID = /^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/
const MAX_VALUE_LENGTH = 8192
const MAX_SETTINGS = 32

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
const text = (value: unknown, min: number, max: number) => typeof value === "string" && value.length >= min && value.length <= max
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value)
const settingValue = (value: unknown) => (typeof value === "string" ? value.length <= MAX_VALUE_LENGTH : typeof value === "boolean" || typeof value === "number")

/** The closed set a string setting declares, as choices; undefined for a free value. */
export function settingChoices(setting: Pick<DeclaredSetting, "enum" | "choices">): readonly SettingChoice[] | undefined {
  return setting.choices ?? setting.enum?.map((value) => ({ value }))
}

/** Why Jelly's host refuses a saved value for this setting, or null when it takes it. The type is checked apart. */
export function settingValueIssue(setting: Pick<DeclaredSetting, "enum" | "choices" | "min" | "max" | "step" | "integer">, value: string | number | boolean): string | null {
  const closed = settingChoices(setting)
  if (closed !== undefined && typeof value === "string" && !closed.some((choice) => choice.value === value)) return "not one of the declared values"
  if (typeof value !== "number") return null
  if (setting.integer === true && !Number.isInteger(value)) return "not a whole number"
  if (setting.min !== undefined && value < setting.min) return "below the minimum"
  if (setting.max !== undefined && value > setting.max) return "above the maximum"
  if (setting.step !== undefined) {
    const steps = (value - (setting.min ?? 0)) / setting.step
    if (Math.abs(steps - Math.round(steps)) > 1e-9) return "not on a step"
  }
  return null
}

/** What Jelly's `PluginSettingSchema` refuses in one declared setting. */
export function settingProblems(raw: unknown): string[] {
  if (!isObject(raw)) return ["a setting must be an object"]
  const at = typeof raw.key === "string" ? `setting ${raw.key}` : "a setting"
  const problems: string[] = []
  const say = (problem: string) => problems.push(`${at}: ${problem}`)
  for (const key of Object.keys(raw)) if (!SETTING_KEYS.includes(key)) say(`Jelly refuses the unknown field ${key}`)
  if (typeof raw.key !== "string" || !ID.test(raw.key)) say("key must be an identifier")
  if (!text(raw.label, 1, 200)) say("label must be 1 to 200 characters")
  if (!["string", "boolean", "number", "secret"].includes(raw.type as string)) say("type must be string, boolean, number or secret")
  if (!text(raw.description, 0, 1000)) say("description must be at most 1000 characters")
  if (raw.enum !== undefined && !(Array.isArray(raw.enum) && raw.enum.length >= 2 && raw.enum.length <= 64 && raw.enum.every((value) => text(value, 1, 200))))
    say("enum must be 2 to 64 values of 1 to 200 characters")
  if (raw.choices !== undefined) {
    const valid =
      Array.isArray(raw.choices) &&
      raw.choices.length >= 2 &&
      raw.choices.length <= 64 &&
      raw.choices.every(
        (choice) =>
          isObject(choice) &&
          Object.keys(choice).every((key) => CHOICE_KEYS.includes(key)) &&
          text(choice.value, 1, 200) &&
          (choice.label === undefined || text(choice.label, 1, 200)) &&
          (choice.description === undefined || text(choice.description, 0, 300)),
      )
    if (!valid) say("choices must be 2 to 64 entries of value, label and description only, within their lengths")
  }
  for (const key of ["min", "max", "step"]) if (raw[key] !== undefined && !finite(raw[key])) say(`${key} must be a finite number`)
  if (raw.step !== undefined && !((raw.step as number) > 0)) say("step must be positive")
  if (raw.integer !== undefined && typeof raw.integer !== "boolean") say("integer must be true or false")
  if (raw.visibleWhen !== undefined) {
    const when = raw.visibleWhen
    if (!isObject(when) || Object.keys(when).some((key) => key !== "setting" && key !== "equals") || typeof when.setting !== "string" || !ID.test(when.setting) || !settingValue(when.equals))
      say("visibleWhen must name a setting and a value")
  }
  if (raw.default !== undefined && !settingValue(raw.default)) say("default must be a string, boolean or number")
  if (problems.length > 0) return problems

  const setting = raw as DeclaredSetting
  if (setting.default !== undefined && (setting.type === "secret" || typeof setting.default !== setting.type))
    say("a default must match the setting type; secrets never declare a default")
  const closed = settingChoices(setting)
  if (setting.enum !== undefined && setting.choices !== undefined) say("declare a closed set as enum or as choices, not both")
  if (closed !== undefined) {
    if (setting.type !== "string") say("only a string setting has a closed set")
    if (new Set(closed.map((choice) => choice.value)).size !== closed.length) say("the values of a closed set must be unique")
    if (typeof setting.default === "string" && !closed.some((choice) => choice.value === setting.default)) say("a default must be one of the closed set's values")
  }
  const bounded = setting.min !== undefined || setting.max !== undefined || setting.step !== undefined || setting.integer !== undefined
  if (bounded && setting.type !== "number") say("only a number setting has min, max, step or integer")
  if (setting.min !== undefined && setting.max !== undefined && setting.min > setting.max) say("min may not be above max")
  if (typeof setting.default === "number" && settingValueIssue(setting, setting.default) !== null) say("a default must satisfy the setting's own bounds")
  return problems
}

/** What Jelly refuses in `contributes.settings`: each setting's problems, more than 32 settings, or a key used twice. */
export function settingsProblems(settings: unknown): string[] {
  if (!Array.isArray(settings)) return ["contributes.settings must be an array"]
  const problems = settings.flatMap(settingProblems)
  if (settings.length > MAX_SETTINGS) problems.push(`Jelly takes at most ${MAX_SETTINGS} settings`)
  const keys = settings.map((setting) => (isObject(setting) ? setting.key : undefined))
  if (new Set(keys).size !== keys.length) problems.push("two settings share a key")
  return problems
}
