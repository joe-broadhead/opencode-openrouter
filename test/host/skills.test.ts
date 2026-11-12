// The four packaged skills on a real host: the host lists them from the repository's skills/ folder, a skill of the same
// name that the user already has wins and is reported shadowed, and a missing skill file leaves the plugin and the
// server working. Each describe owns one host.
import "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { PLUGIN_ID } from "../../src/constants.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { cleanup, HOST_VERSION, serverRow, startHost, type Host } from "./harness.js"
import { ROOT } from "./isolate.js"

setDefaultTimeout(300_000)
afterAll(cleanup)

const SKILLS = fileURLToPath(new URL("../../skills/", import.meta.url))
const packaged = (name: string) => join(SKILLS, name, "SKILL.md")

/** The skills OpenCode lists for the host's location whose id belongs to this plugin or the test. */
const listed = async (host: Host) => (await host.client.skill.list({ location: host.location })).data.map((skill) => ({ id: skill.id as string, path: skill.path as string, description: skill.description as string | undefined }))

// The temp root is shared by the files of this stage and each file's cleanup removes it, so folders are made in
// beforeAll, never while a file is being collected.
/** A folder holding one skill for the host's config to scan: the user's own. */
function userSkills(name: string, description: string) {
  const directory = join(ROOT, "user-skills")
  mkdirSync(join(directory, name), { recursive: true })
  writeFileSync(join(directory, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nMy own instructions.\n`)
  return directory
}

describe(`the packaged skills on OpenCode ${HOST_VERSION}`, () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost()
  })
  afterAll(() => host?.close())

  test("OpenCode lists the four skills from their packaged paths, and the plugin reports them loaded", async () => {
    const skills = (await listed(host)).filter((skill) => SKILL_NAMES.includes(skill.id)).sort((a, b) => a.id.localeCompare(b.id))
    expect(skills.map((skill) => ({ id: skill.id, path: skill.path }))).toEqual(SKILL_NAMES.map((id) => ({ id, path: packaged(id) })).sort((a, b) => a.id.localeCompare(b.id)))
    for (const skill of skills) expect(skill.description?.length).toBeGreaterThan(40)
    expect(await host.state().skills()).toEqual(SKILL_NAMES.map((name) => ({ name, state: "loaded", path: packaged(name) })))
    expect(host.state().skillProblems).toEqual([])
  })
})

describe(`a skill of the same name that the user has, on OpenCode ${HOST_VERSION}`, () => {
  let host: Host
  let own = ""
  beforeAll(async () => {
    own = userSkills("openrouter", "The user's own OpenRouter skill, kept as it is.")
    host = await startHost({ config: () => ({ skills: [own] }) })
  })
  afterAll(() => host?.close())

  test("wins (the host lists it), and the plugin reports its own as shadowed with the user's path", async () => {
    const skills = await listed(host)
    const mine = join(own, "openrouter", "SKILL.md")
    expect(skills.filter((skill) => skill.id === "openrouter")).toEqual([{ id: "openrouter", path: mine, description: "The user's own OpenRouter skill, kept as it is." }])
    for (const name of SKILL_NAMES.filter((name) => name !== "openrouter")) expect(skills.find((skill) => skill.id === name)?.path).toBe(packaged(name))
    expect(await host.state().skills()).toEqual(
      SKILL_NAMES.map((name) => (name === "openrouter" ? { name, state: "shadowed", path: packaged(name), shadowedBy: mine } : { name, state: "loaded", path: packaged(name) })),
    )
    expect(host.state().skillProblems).toEqual([])
  })
})

describe(`a missing skill file, on OpenCode ${HOST_VERSION}`, () => {
  let host: Host
  beforeAll(async () => {
    const empty = join(ROOT, "no-skills")
    mkdirSync(empty, { recursive: true })
    host = await startHost({ skillsDir: empty })
  })
  afterAll(() => host?.close())

  test("registers no skill and records SKILLS_INVALID, while the plugin stays active and the server connects", async () => {
    const { data: plugins } = await host.client.plugin.list({ location: host.location })
    expect(plugins.find((plugin) => plugin.id === PLUGIN_ID)?.state).toEqual({ status: "active" })
    expect((await serverRow(host))?.status).toEqual({ status: "connected" })
    expect((await listed(host)).filter((skill) => SKILL_NAMES.includes(skill.id))).toEqual([])
    expect(await host.state().skills()).toEqual(SKILL_NAMES.map((name) => ({ name, state: "missing" })))
    expect(host.state().skillProblems).toEqual(SKILL_NAMES.map((name) => `SKILLS_INVALID: The "${name}" skill was not loaded: skills/${name}/SKILL.md is missing. Next step: Reinstall the plugin.`))
  })
})
