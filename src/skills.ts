/**
 * The packaged skills: read once in `setup` and registered through `ctx.skill.transform`.
 *
 * The contract's `register` wires doors 1–3 and never touches skills, so this module is what makes the four
 * `skills/*\/SKILL.md` files load. A missing or malformed skill is a broken install: setup refuses it with the
 * contract's `UNAVAILABLE`, never a plugin-defined code.
 */
import { readFile, readdir } from "node:fs/promises"
import type { Dirent } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill, type Plugin } from "@opencode/plugin"
import { refusal, RegisterError } from "@we-the-rebel-alliance/plugin-contract/register"

/** `skills/` at the package root, next to `dist/` (and next to `src/` in the repository). */
export const SKILLS_DIR = fileURLToPath(new URL("../skills/", import.meta.url))

/** One packaged skill, parsed and ready to register. */
export interface PackagedSkill {
  readonly name: string
  readonly description: string
  readonly path: string
  readonly content: string
}

/** The contract refusal for a skill the install cannot use. */
function broken(name: string, problem: string): RegisterError {
  return new RegisterError(refusal("UNAVAILABLE", `the packaged skill ${name} ${problem}`, "Reinstall the plugin so its skills are present, then reload OpenCode."))
}

/** Parse `---` front matter with `name` and `description`; everything after it is the skill's content. */
export function parseSkill(name: string, path: string, text: string): PackagedSkill {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"))
  if (match === null) throw broken(name, "has no front matter")
  const [, front, body] = match
  if (front === undefined || body === undefined) throw broken(name, "has no front matter")
  const fields = new Map<string, string>()
  for (const line of front.split("\n")) {
    const colon = line.indexOf(":")
    if (colon <= 0) continue
    fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim().replace(/^(["'])(.*)\1$/, "$2").trim())
  }
  if (fields.get("name") !== name) throw broken(name, `does not name itself "${name}" in its front matter`)
  const description = fields.get("description")
  if (description === undefined || description === "") throw broken(name, "has no description")
  // A block scalar the simple front-matter reader cannot fold is an indicator alone (`>`, `|`, `>-`, `|+`), never the
  // skill's description. Registering it would make the skill invisible to agents.
  if (/^[>|][+-]?$/.test(description)) throw broken(name, `has an unparsed block-scalar description ("${description}")`)
  const content = body.trim()
  if (content === "") throw broken(name, "has no body")
  return { name, description, path, content }
}

/** Read every `skills/<name>/SKILL.md`, sorted by name. A directory without a readable skill refuses the install. */
export async function loadSkills(directory: string = SKILLS_DIR): Promise<readonly PackagedSkill[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    throw broken("skills", `cannot be read from ${directory}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  if (names.length === 0) throw broken("skills", `ships no skill directory in ${directory}`)

  const skills: PackagedSkill[] = []
  for (const name of names) {
    const path = join(directory, name, "SKILL.md")
    let text: string
    try {
      text = await readFile(path, "utf8")
    } catch (error) {
      const missing = (error as { code?: unknown }).code === "ENOENT"
      throw broken(name, missing ? "has no SKILL.md" : `cannot be read: ${error instanceof Error ? error.message : String(error)}`)
    }
    skills.push(parseSkill(name, path, text))
  }
  return skills
}

/** The editor `context.skill.transform` hands its callback. */
type SkillEditor = Parameters<Parameters<Plugin.Context["skill"]["transform"]>[0]>[0]

/**
 * The editor callback `setup` passes to `context.skill.transform`. It is exported separately so the direct
 * `context.skill.transform(...)` call stays visible in the built entry.
 */
export function addPackagedSkills(skills: readonly PackagedSkill[]) {
  return (editor: SkillEditor): void => {
    for (const info of skills) {
      editor.add({
        id: Skill.ID.make(info.name),
        name: Skill.Name.make(info.name),
        description: info.description,
        path: Skill.Info.fields.path.make(info.path),
        content: info.content,
      })
    }
  }
}
