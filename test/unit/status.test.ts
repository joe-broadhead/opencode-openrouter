// The one status model: the state and next-step priority, the catalog counts, the scripting capability, the skills and
// agent coverage, redaction, the report text, the plain JSON Schema RPC contract, and the command's synthetic message.
// Built from local facts only: these tests hand it facts, and readStatus reads them from narrow fakes of the host lists.
import { describe, expect, test } from "bun:test"
import { CODES, PLUGIN_ID, SERVER_NAME, SUPPORTED_HOST } from "../../src/constants.js"
import { checkHost } from "../../src/host-version.js"
import type { ServerSource } from "../../src/mcp.js"
import { NATIVE_ONLY, RPC_TOOLS, TOOL_NAMES } from "../../src/openrouter-tools.js"
import { defaultRules } from "../../src/permissions.js"
import { SKILL_NAMES } from "../../src/skills.js"
import { buildStatus, formatStatus, LISTING_MS, readStatus, registerStatusCommand, registerStatusRpc, STATUS_COMMAND, StatusRpc, type StatusFacts, type StatusSource } from "../../src/status.js"
import { VERSION } from "../../src/version.js"

const PLUGIN: ServerSource = { type: "plugin" }
const loaded = SKILL_NAMES.map((name) => ({ name, state: "loaded" as const, path: `skills/${name}/SKILL.md` }))
const POLICY_FAILED =
  "POLICY_UNAVAILABLE: OpenRouter's default permission rules could not be applied (boom), so the plugin blocks its tools before anything is sent. Next step: Restart OpenCode; if it fails again, run /plugins to see the error."
const CONFLICT =
  "SERVER_CONFLICT: Your OpenCode config's mcp.servers.openrouter points at another host (example.com); the plugin uses https://mcp.openrouter.ai/mcp. The plugin leaves it untouched and adds no rules, guard or label to it. Next step: Set mcp.servers.openrouter.url to exactly https://mcp.openrouter.ai/mcp, or rename or remove that entry so the plugin can add its own."

const facts = (overrides: Partial<StatusFacts> = {}): StatusFacts => ({
  host: checkHost("2.2.3", false),
  access: "ask-changes",
  source: PLUGIN,
  server: { status: "connected" },
  tools: [...TOOL_NAMES],
  settling: false,
  lastObservedAt: "2026-11-12T10:00:00.000Z",
  policy: { installation: "ready", problems: [] },
  coverage: { unguarded: [], explicitlyAllowed: [] },
  skills: loaded,
  problems: [],
  ...overrides,
})

describe("the status model", () => {
  test("a healthy connection: every family field, the catalog, the script capability, and nothing to do", () => {
    const status = buildStatus(facts())
    expect(status).toEqual({
      version: VERSION,
      host: { version: "2.2.3", range: SUPPORTED_HOST, tested: true },
      state: "connected",
      access: "ask-changes",
      source: "plugin",
      catalog: { state: "ready", observed: 17, reviewedPresent: 17, unknownCount: 0, unknown: [], missingReviewed: [], lastObservedAt: "2026-11-12T10:00:00.000Z" },
      scripting: { reviewedMethodCount: 16, nativeOnly: ["generate-image"], liveVerifiedCount: 0 },
      policy: { installation: "ready" },
      skills: SKILL_NAMES.map((name) => ({ name, state: "loaded" })),
      unguardedAgents: [],
      explicitlyAllowedAgents: [],
      problems: [],
      nextStep: "Nothing to do.",
    })
    expect(status.scripting.reviewedMethodCount).toBe(RPC_TOOLS.length)
    expect(status.scripting.nativeOnly).toEqual([...NATIVE_ONLY])
  })

  test("never invents a timestamp: no observation, no lastObservedAt", () => {
    const { lastObservedAt: _omit, ...rest } = facts()
    expect(buildStatus(rest).catalog).not.toHaveProperty("lastObservedAt")
  })

  test.each([
    [{ server: { status: "pending" as const } }, "connecting", "pending"],
    [{ server: { status: "needs_auth" as const } }, "sign_in_required", "unavailable"],
    [{ server: { status: "failed" as const, error: "connect ECONNREFUSED" } }, "failed", "unavailable"],
    [{ server: { status: "disabled" as const } }, "disabled", "unavailable"],
    [{ source: { type: "disabled" } as ServerSource, server: { status: "disabled" as const } }, "disabled", "unavailable"],
    [{ server: undefined }, "not_configured", "unavailable"],
    [{ source: { type: "pending" } as ServerSource, server: undefined, tools: [] }, "connecting", "pending"],
    [{ source: { type: "conflict", safeDescription: "x" } as ServerSource, problems: [CONFLICT] }, "conflict", "unavailable"],
    [{ policy: { installation: "failed" as const, problems: [POLICY_FAILED] } }, "policy_unavailable", "ready"],
  ])("maps %j to state %s with catalog %s", (overrides, state, catalog) => {
    const status = buildStatus(facts(overrides as Partial<StatusFacts>))
    expect({ state: status.state, catalog: status.catalog.state } as Record<string, string>).toEqual({ state, catalog })
  })

  test("a connected server that is still listing its tools is told apart from one that lists none", () => {
    const listing = buildStatus(facts({ tools: [], settling: true }))
    expect(listing.catalog).toMatchObject({ state: "pending", observed: 0 })
    expect(listing.nextStep).toBe("OpenRouter is still listing its tools. Run /openrouter-status again in a few seconds.")
    const empty = buildStatus(facts({ tools: [], settling: false }))
    expect(empty.catalog).toMatchObject({ state: "ready", observed: 0, missingReviewed: [] })
    expect(empty.nextStep).toBe("OpenRouter lists no tools for this sign-in. Sign in again from /connect → OpenRouter tools, then run /openrouter-status.")
  })

  test("counts unknown and missing tools, names at most 20 plain names, and never lists a conflicting server's tools", () => {
    const unknown = Array.from({ length: 23 }, (_, index) => `new-tool-${index}`)
    const status = buildStatus(facts({ tools: [...TOOL_NAMES.filter((name) => name !== "ping"), ...unknown, "Evil‮Name"] }))
    expect(status.catalog).toMatchObject({ observed: 16 + 24, reviewedPresent: 16, unknownCount: 24, missingReviewed: ["ping"] })
    expect(status.catalog.unknown).toEqual(unknown.slice(0, 20))
    expect(formatStatus(status)).toContain("- Tools: 40 listed, 16 reviewed, 24 unknown: new-tool-0,")
    expect(formatStatus(status)).toContain("and 4 more (asked about, never a script method); reviewed but not listed: ping; last seen 2026-11-12T10:00:00.000Z")
    const conflict = buildStatus(facts({ source: { type: "conflict", safeDescription: "x" }, problems: [CONFLICT] }))
    expect(conflict.catalog).toMatchObject({ state: "unavailable", observed: 0, unknown: [] })
  })

  test("the image tool is reported native-only and never counted as an unknown tool", () => {
    const status = buildStatus(facts())
    expect(status.scripting.nativeOnly).toEqual(["generate-image"])
    expect(status.catalog.unknown).not.toContain("generate-image")
    expect(status.catalog.unknownCount).toBe(0)
    expect(formatStatus(status)).toContain(
      "- Scripts: 16 methods through openrouter.models.tools, output checked against a test server only, not yet against OpenRouter's live server (0 of 16 checked live); generate-image only as a native tool, because the script result keeps text only",
    )
  })

  test("next-step priority: conflict, then a failed policy, then disabled, sign-in, connection, catalog, skills, agents", () => {
    const steps = (overrides: Partial<StatusFacts>) => buildStatus(facts(overrides)).nextStep
    const everything: Partial<StatusFacts> = {
      skills: [{ name: "openrouter", state: "missing" }, ...loaded.slice(1)],
      problems: ["SKILLS_INVALID: The \"openrouter\" skill was not loaded: skills/openrouter/SKILL.md is missing. Next step: Reinstall the plugin."],
      coverage: { unguarded: ["reviewer"], explicitlyAllowed: [] },
    }
    expect(steps({ ...everything, source: { type: "conflict", safeDescription: "x" }, problems: [CONFLICT], policy: { installation: "failed", problems: [POLICY_FAILED] } })).toBe(
      "Set mcp.servers.openrouter.url to exactly https://mcp.openrouter.ai/mcp, or rename or remove that entry so the plugin can add its own.",
    )
    expect(steps({ ...everything, policy: { installation: "failed", problems: [POLICY_FAILED] }, server: { status: "needs_auth" } })).toBe("Restart OpenCode; if it fails again, run /plugins to see the error.")
    expect(steps({ ...everything, server: { status: "disabled" } })).toBe('Enable the openrouter server in /mcps, or remove "disabled": true from mcp.servers.openrouter in opencode.json.')
    expect(steps({ ...everything, server: { status: "needs_auth" } })).toBe(
      "Run /connect and choose OpenRouter tools, or /mcps and choose openrouter (in a terminal, run opencode mcp auth openrouter from the project folder where the plugin is installed); never paste an OpenRouter key into the chat.",
    )
    expect(steps({ ...everything, server: { status: "pending" } })).toBe("OpenRouter tools are still connecting. Run /openrouter-status again in a few seconds.")
    expect(steps({ ...everything, tools: [], settling: true })).toBe("OpenRouter is still listing its tools. Run /openrouter-status again in a few seconds.")
    expect(steps(everything)).toBe("Reinstall the plugin.")
    expect(steps({ ...everything, skills: [{ name: "openrouter", state: "shadowed", path: "a", shadowedBy: "mine/SKILL.md" }, ...loaded.slice(1)], problems: [] })).toBe(
      'Rename or move the "openrouter" skill at mine/SKILL.md, which OpenCode loads instead of the plugin\'s skill of the same name.',
    )
    expect(steps({ coverage: { unguarded: ["reviewer"], explicitlyAllowed: [] } })).toBe(
      "Put the default rules shown by /openrouter-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your own rules for OpenRouter tools.",
    )
    // An explicit allow is the user's decision: shown, never a next step.
    expect(steps({ coverage: { unguarded: [], explicitlyAllowed: ["build"] } })).toBe("Nothing to do.")
  })

  test("a failed connection of the user's own oauth-free entry points at its headers, never reading them", () => {
    const status = buildStatus(facts({ source: { type: "adopted", signIn: "user-managed" }, server: { status: "failed", error: "401" } }))
    expect(status.nextStep).toBe("Check the credential in the headers of your own mcp.servers.openrouter, then restart OpenCode.")
  })

  test("a failure's reason is one redacted line; a sign-in's text is never shown", () => {
    const key = "sk-or-v1-0123456789abcdef0123456789abcdef"
    const failed = buildStatus(facts({ server: { status: "failed", error: `refused\nBearer ${key} https://u:p@mcp.openrouter.ai/mcp?token=abc` } }))
    expect(failed.error).toBe("refused Bearer [redacted] https://mcp.openrouter.ai/mcp")
    const signIn = buildStatus(facts({ server: { status: "needs_auth", error: "https://auth.example/authorize?code=1" } }))
    expect(signIn).not.toHaveProperty("error")
    expect(JSON.stringify(signIn)).not.toContain("authorize")
  })

  test("problems keep their codes, from the entry, the skills and the policy", () => {
    const status = buildStatus(facts({ problems: [CONFLICT], policy: { installation: "failed", problems: [POLICY_FAILED] } }))
    expect(status.problems.map((problem) => problem.code)).toEqual(["SERVER_CONFLICT", "POLICY_UNAVAILABLE"])
    for (const problem of status.problems) expect(Object.keys(CODES)).toContain(problem.code)
  })
})

describe("the report", () => {
  test("names each fact on its own row and the next step last", () => {
    const text = formatStatus(buildStatus(facts({ coverage: { unguarded: ["reviewer"], explicitlyAllowed: ["build"] } })))
    const rows = text.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).split(":")[0])
    expect(rows).toEqual(["Connection", "Access", "Default rules", "Tools", "Scripts", "Skills", "Agents without default rules", "Agents that allow OpenRouter changes with their own rule", "OpenCode", "Problems", "Next step"])
    expect(text.split("\n")[0]).toBe("OpenRouter status")
    expect(text).toContain("- Connection: connected (registered by this plugin)")
    expect(text).toContain("- Access: ask-changes: reads run without asking; send-message, generate-image, send-feedback and tools OpenRouter adds later ask first")
    expect(text).toContain("- Default rules: applied")
    expect(text).toContain("- Skills: 4 of 4 loaded")
    // The exact block for the listed agent, one rule a line.
    expect(text).toContain(`- Agents without default rules: reviewer\n  ${JSON.stringify(defaultRules("ask-changes")[0])},`)
    expect(text).toContain("- Agents that allow OpenRouter changes with their own rule: build")
    expect(text).toContain(`- OpenCode: 2.2.3 (tested; supported range ${SUPPORTED_HOST})`)
  })

  test("says read-only denies and all allows, and an untested host the user allowed", () => {
    expect(formatStatus(buildStatus(facts({ access: "read-only" })))).toContain("- Access: read-only: reads run without asking; send-message, generate-image, send-feedback and tools OpenRouter adds later are denied")
    expect(formatStatus(buildStatus(facts({ access: "all" })))).toContain("- Access: all: every OpenRouter tool is allowed, billable inference and feedback included")
    expect(formatStatus(buildStatus(facts({ host: checkHost("2.3.0", true) })))).toContain("- OpenCode: 2.3.0 (untested; supported range >=2.2.3 <2.3.0). It is outside the supported range;")
  })

  test("never holds a key, an auth URL, a balance or an expiry", () => {
    const text = formatStatus(buildStatus(facts()))
    for (const word of ["sk-or", "authorize", "balance", "credit", "expires"]) expect(text.toLowerCase()).not.toContain(word)
  })
})

/** A plugin state and host lists, as readStatus reads them; counts each list call. */
function sources(overrides: { tools?: { id: string; options?: { namespace?: string } }[]; changedAt?: number } = {}) {
  const calls: string[] = []
  const state: StatusSource = {
    host: checkHost("2.2.3", false),
    options: { access: "ask-changes" },
    server: () => ({ source: PLUGIN, problems: [] }),
    policy: () => ({ installation: "ready", problems: [] }),
    agentCoverage: async () => (calls.push("agents"), { unguarded: [], explicitlyAllowed: [] }),
    skills: async () => (calls.push("skills"), loaded),
    skillProblems: [],
    lastObservedAt: () => undefined,
    serverChangedAt: () => overrides.changedAt ?? 0,
  }
  const tools = overrides.tools ?? [...TOOL_NAMES.map((name) => ({ id: `openrouter_${name}`, options: { namespace: SERVER_NAME } })), { id: "openrouter_x_other", options: { namespace: "openrouter_x" } }, { id: "github_issue", options: { namespace: "github" } }]
  const ctx = {
    mcp: { list: async () => (calls.push("mcp"), { data: [{ name: "github", status: { status: "failed", error: "x" } }, { name: SERVER_NAME, status: { status: "connected" } }] }) },
    tool: { list: async () => (calls.push("tools"), tools) },
  }
  return { ctx: ctx as unknown as Parameters<typeof readStatus>[0], state, calls }
}

describe("readStatus", () => {
  test("reads OpenCode's lists and the plugin's state once each, and counts only the openrouter namespace's tools", async () => {
    const { ctx, state, calls } = sources()
    const status = await readStatus(ctx, state)
    expect(status.catalog).toMatchObject({ state: "ready", observed: 17, unknownCount: 0 })
    expect(status).not.toHaveProperty("error")
    expect(calls.sort()).toEqual(["agents", "mcp", "skills", "tools"])
  })

  test("no tools moments after a status change is still listing; long after, it is an empty catalog", async () => {
    const recent = sources({ tools: [], changedAt: Date.now() })
    expect((await readStatus(recent.ctx, recent.state)).catalog.state).toBe("pending")
    const old = sources({ tools: [], changedAt: Date.now() - LISTING_MS - 1 })
    expect((await readStatus(old.ctx, old.state)).catalog.state).toBe("ready")
  })
})

describe("the status RPC", () => {
  test("is openrouter.models / status, a plain JSON Schema contract whose output every built status satisfies", () => {
    expect(StatusRpc.id).toBe(PLUGIN_ID)
    expect(Object.keys(StatusRpc.methods)).toEqual(["status"])
    const schema = StatusRpc.methods.status.output
    for (const status of [buildStatus(facts()), buildStatus(facts({ server: { status: "failed", error: "x" } })), buildStatus(facts({ policy: { installation: "failed", problems: [POLICY_FAILED] } }))]) {
      for (const key of schema.required) expect(status).toHaveProperty(key)
      for (const key of Object.keys(status)) expect(Object.keys(schema.properties)).toContain(key)
      expect(schema.properties.state.enum).toContain(status.state)
    }
    expect(JSON.parse(JSON.stringify(StatusRpc))).toEqual(StatusRpc)
  })

  test("answers the status, or the declared error unavailable with a coded message and a next step", async () => {
    let handler: ((input: unknown, context: { error: (type: string, message: string, data: unknown) => unknown }) => Promise<unknown>) | undefined
    const rpc = { register: async (_definition: unknown, handlers: { status: typeof handler }) => ((handler = handlers.status), { dispose: async () => {} }) }
    let fail = false
    await registerStatusRpc(rpc as never, async () => {
      if (fail) throw new Error("agents unavailable Bearer sk-or-v1-0123456789abcdef0123456789abcdef")
      return buildStatus(facts())
    })
    const error = (type: string, message: string, data: unknown) => ({ type, message, data })
    expect(await handler!({}, { error })).toMatchObject({ state: "connected" })
    fail = true
    expect(await handler!({}, { error })).toEqual({
      type: "unavailable",
      message: "STATUS_UNAVAILABLE: Could not read OpenRouter's status (agents unavailable Bearer [redacted]).",
      data: { nextStep: "Restart OpenCode, then run /openrouter-status again." },
    })
  })
})

describe("/openrouter-status", () => {
  test("posts the report as a synthetic message with no model turn, or the coded failure", async () => {
    let added: { name: string; execute: (input: { sessionID: string }) => Promise<void> } | undefined
    const posted: unknown[] = []
    const ctx = {
      command: { transform: async (callback: (editor: { add: (command: typeof added) => void }) => void) => (callback({ add: (command) => void (added = command) }), { dispose: async () => {} }) },
      session: { synthetic: async (input: unknown) => void posted.push(input) },
    }
    let fail = false
    await registerStatusCommand(ctx as never, async () => {
      if (fail) throw new Error("closed")
      return buildStatus(facts())
    })
    expect(added!.name).toBe(STATUS_COMMAND)
    expect(STATUS_COMMAND).toBe("openrouter-status")
    await added!.execute({ sessionID: "ses_1" })
    expect(posted).toEqual([{ sessionID: "ses_1", text: formatStatus(buildStatus(facts())), description: "OpenRouter status", resume: false }])
    fail = true
    await added!.execute({ sessionID: "ses_1" })
    expect(posted.at(-1)).toMatchObject({ text: "STATUS_UNAVAILABLE: Could not read OpenRouter's status (closed). Next step: Restart OpenCode, then run /openrouter-status again.", resume: false })
  })
})
