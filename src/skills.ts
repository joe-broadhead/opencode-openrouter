// The packaged skills: read and validated once in setup, outside every transform, then registered with
// `ctx.skill.transform`. A missing or malformed skill file never stops the plugin: the server and the rules still work,
// so the loss is recorded for status. A skill the user already has under the same name is kept, never replaced.
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill, type Plugin } from "@opencode/plugin"
import { errorText, pluginError } from "./constants.js"
import { reasonOf } from "./redact.js"

/** `skills/` at the package root, next to `dist/` (and next to `src/` in the repository). */
export const SKILLS_DIR = fileURLToPath(new URL("../skills/", import.meta.url))

/** The skills the plugin ships, in the order the Jelly declaration lists them. */
export const SKILL_NAMES: readonly string[] = ["openrouter", "openrouter-evaluate", "openrouter-images", "openrouter-troubleshoot"]

/** What became of one packaged skill. `shadowed` means a skill with the same name, at `shadowedBy`, is the one in use. */
export type SkillState = "loaded" | "missing" | "invalid" | "shadowed"

export interface SkillStatus {
  readonly name: string
  readonly state: SkillState
  /** The packaged file, when it was read. */
  readonly path?: string
  /** The path of the user's skill that is used instead, for `shadowed`. */
  readonly shadowedBy?: string
}

const notLoaded = (name: string, problem: string) => `The "${name}" skill was not loaded: skills/${name}/SKILL.md ${problem}.`
const REINSTALL = "Reinstall the plugin."

/**
 * Parses `---` frontmatter with `name` and `description`; the body after it is the skill's content. CRLF is read as LF.
 * Throws a `SKILLS_INVALID` error when the file is not a skill named `name`.
 */
export function parseSkill(name: string, path: string, text: string): Skill.Info {
  const fail = (problem: string) => pluginError("SKILLS_INVALID", notLoaded(name, problem), REINSTALL)
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"))
  if (!match) throw fail("has no frontmatter")
  const fields = new Map<string, string>()
  for (const line of match[1]!.split("\n")) {
    const colon = line.indexOf(":")
    if (colon > 0) fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim().replace(/^(["'])(.*)\1$/, "$2"))
  }
  if (fields.get("name") !== name) throw fail(`must be named "${name}" in its frontmatter`)
  const description = fields.get("description")
  if (!description) throw fail("has no description")
  const content = match[2]!.trim()
  if (!content) throw fail("has no body")
  return { id: Skill.ID.make(name), name: Skill.Name.make(name), description, path: Skill.Info.fields.path.make(path), content }
}

export interface LoadedSkills {
  /** The skills that parsed, ready to register. */
  readonly skills: readonly Skill.Info[]
  /** One `SKILLS_INVALID` line per skill that is missing or invalid, for status. */
  readonly problems: readonly string[]
  /** The state of every packaged skill, `loaded`, `missing` or `invalid` at this point. */
  readonly status: readonly SkillStatus[]
}

/** Reads every packaged skill from `directory`. Never throws: a problem becomes a line in `problems`. */
export async function loadSkills(directory = SKILLS_DIR): Promise<LoadedSkills> {
  const skills: Skill.Info[] = []
  const problems: string[] = []
  const status: SkillStatus[] = []
  for (const name of SKILL_NAMES) {
    const path = join(directory, name, "SKILL.md")
    try {
      skills.push(parseSkill(name, path, await readFile(path, "utf8")))
      status.push({ name, state: "loaded", path })
    } catch (error) {
      const code = (error as { code?: unknown }).code
      const missing = code === "ENOENT"
      problems.push(
        code === "SKILLS_INVALID"
          ? (error as Error).message
          : errorText("SKILLS_INVALID", notLoaded(name, missing ? "is missing" : `cannot be read (${typeof code === "string" ? code : reasonOf(error)})`), REINSTALL),
      )
      status.push({ name, state: missing ? "missing" : "invalid" })
    }
  }
  return { skills, problems, status }
}

/**
 * Registers the loaded skills. A skill already present under the same name at another path is the user's, and is left
 * as it is. The callback is synchronous and never throws. The host adds a user's skills after the plugin's transforms
 * run, so the transform often cannot see them: {@link observeSkills} is what finds a shadowed skill.
 */
export function registerSkills(skill: Pick<Plugin.Context["skill"], "transform">, skills: readonly Skill.Info[]) {
  return skill.transform((editor) => {
    for (const info of skills) {
      const existing = editor.get(info.id)
      if (!existing || existing.path === info.path) editor.add(info)
    }
  })
}

/**
 * The state of each packaged skill as OpenCode lists them now: a loaded skill that OpenCode lists from another file, such
 * as one the user wrote under the same name, is `shadowed`, with that file's path. A failed list is advice lost, not an
 * error: the loaded states are returned unchanged.
 */
export async function observeSkills(skill: Pick<Plugin.Context["skill"], "list">, status: readonly SkillStatus[]): Promise<readonly SkillStatus[]> {
  const listed = await skill.list().then(
    (result) => result.data,
    () => undefined,
  )
  if (!listed) return status
  return status.map((entry) => {
    const other = entry.state === "loaded" ? listed.find((item) => item.id === entry.name) : undefined
    return other && other.path !== entry.path ? { name: entry.name, state: "shadowed" as const, ...(entry.path ? { path: entry.path } : {}), shadowedBy: other.path } : entry
  })
}
