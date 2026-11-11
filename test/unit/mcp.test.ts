// The `openrouter` entry: registration, adoption, conflict, disabled, pending, duplicates and namespace collisions,
// and the strict URL ownership check. The fake editor throws if the plugin reads a server's headers.
import { describe, expect, test } from "bun:test"
import { ENDPOINT, SERVER_NAME } from "../../src/constants.js"
import {
  endpointMismatch,
  isOwned,
  namespaceOf,
  nativeToolId,
  PENDING,
  reconcileServer,
  registerServer,
  serverConfig,
  type ServerObservation,
} from "../../src/mcp.js"
import { TOOL_NAMES } from "../../src/openrouter-tools.js"
import { mcpEditor, transforms, type McpEditor, type ServerConfig } from "./fake.js"

const config = serverConfig({ endpoint: ENDPOINT })
const KEY = "sk-or-v1-0123456789abcdef0123456789abcdef"
const reconcile = (initial: Record<string, ServerConfig> = {}) => {
  const { editor, servers } = mcpEditor(initial)
  return { observation: reconcileServer(editor, config), servers }
}

describe("the server entry", () => {
  test("is the remote URL alone, with OAuth left to the host; no OAuth only for the tests' loopback seam", () => {
    expect(config).toEqual({ type: "remote", url: "https://mcp.openrouter.ai/mcp" })
    expect(serverConfig({ endpoint: "http://127.0.0.1:1/mcp", oauth: false })).toEqual({ type: "remote", url: "http://127.0.0.1:1/mcp", oauth: false })
  })

  test("is added under openrouter when the user has none, and other servers are untouched", () => {
    const { observation, servers } = reconcile({ github: { type: "remote", url: "https://example.com/mcp" } as ServerConfig })
    expect(servers.get(SERVER_NAME)).toEqual(config as ServerConfig)
    expect(servers.get("github")).toEqual({ type: "remote", url: "https://example.com/mcp" } as ServerConfig)
    expect(observation).toEqual({ source: { type: "plugin" }, duplicates: [], collisions: [], problems: [] })
    expect(isOwned(observation.source)).toBe(true)
  })

  test("adopts the user's exact entry unchanged, keeping its OAuth settings, timeout or own headers", () => {
    const tuned = { type: "remote", url: ENDPOINT, oauth: { callback_port: 19876 }, timeout: { execution: 60_000 } } as ServerConfig
    const adopted = reconcile({ openrouter: tuned })
    expect(adopted.servers.get(SERVER_NAME)).toEqual(tuned)
    expect(adopted.observation.source).toEqual({ type: "adopted", signIn: "oauth" })
    const keyed = { type: "remote", url: ENDPOINT, oauth: false, headers: { Authorization: `Bearer ${KEY}` } } as ServerConfig
    const own = reconcile({ openrouter: keyed })
    expect(own.servers.get(SERVER_NAME)).toEqual(keyed)
    expect(own.observation.source).toEqual({ type: "adopted", signIn: "user-managed" })
    expect(isOwned(own.observation.source)).toBe(true)
    expect(JSON.stringify(own.observation)).not.toContain(KEY)
  })

  test("keeps a user-disabled exact entry disabled, and does not own it", () => {
    const disabled = { type: "remote", url: ENDPOINT, disabled: true } as ServerConfig
    const { observation, servers } = reconcile({ openrouter: disabled })
    expect(servers.get(SERVER_NAME)).toEqual(disabled)
    expect(observation.source).toEqual({ type: "disabled" })
    expect(isOwned(observation.source)).toBe(false)
  })

  test("reports a local command, or another URL, as a conflict and changes nothing", () => {
    const local = { type: "local", command: ["openrouter-mcp"] } as ServerConfig
    const command = reconcile({ openrouter: local })
    expect(command.servers.get(SERVER_NAME)).toEqual(local)
    expect(command.observation.source).toEqual({ type: "conflict", safeDescription: "mcp.servers.openrouter is a local command, not https://mcp.openrouter.ai/mcp" })
    expect(command.observation.problems).toEqual([
      "SERVER_CONFLICT: Your OpenCode config's mcp.servers.openrouter is a local command, not https://mcp.openrouter.ai/mcp. The plugin leaves it untouched and adds no rules, guard or label to it. Next step: Set mcp.servers.openrouter.url to exactly https://mcp.openrouter.ai/mcp, or rename or remove that entry so the plugin can add its own.",
    ])
    const elsewhere = { type: "remote", url: `https://proxy.example.com/mcp?key=${KEY}` } as ServerConfig
    const other = reconcile({ openrouter: elsewhere })
    expect(other.servers.get(SERVER_NAME)).toEqual(elsewhere)
    expect(other.observation.source.type).toBe("conflict")
    expect(isOwned(other.observation.source)).toBe(false)
    expect(JSON.stringify(other.observation)).not.toContain(KEY)
  })

  test("a disabled entry at another URL is still a conflict, not the plugin's disabled server", () => {
    const { observation } = reconcile({ openrouter: { type: "remote", url: "https://example.com/mcp", disabled: true } as ServerConfig })
    expect(observation.source.type).toBe("conflict")
  })

  test("names another entry at OpenRouter's MCP host as a possible duplicate, without taking it over", () => {
    const mine = { type: "remote", url: `${ENDPOINT}/`, headers: { Authorization: `Bearer ${KEY}` } } as ServerConfig
    const { observation, servers } = reconcile({ "or-tools": mine })
    expect(servers.get("or-tools")).toEqual(mine)
    expect(servers.get(SERVER_NAME)).toEqual(config as ServerConfig)
    expect(observation.source).toEqual({ type: "plugin" })
    expect(observation.duplicates).toEqual(["or-tools"])
    expect(observation.problems).toHaveLength(1)
    expect(observation.problems[0]).toStartWith("SERVER_DUPLICATE: mcp.servers.or-tools also points at OpenRouter's MCP host")
    expect(JSON.stringify(observation)).not.toContain(KEY)
  })

  test("names another server whose tool ids would start with openrouter_ as a namespace collision", () => {
    const { observation } = reconcile({
      "openrouter_extra": { type: "remote", url: "https://example.com/mcp" } as ServerConfig,
      "openrouter.beta": { type: "local", command: ["x"] } as ServerConfig,
      openrouterx: { type: "remote", url: "https://example.com/x" } as ServerConfig,
    })
    expect(observation.collisions).toEqual(["openrouter.beta", "openrouter_extra"])
    expect(observation.problems.find((problem) => problem.startsWith("NAMESPACE_COLLISION"))).toContain("start with openrouter_")
  })

  test("never throws from the transform, and reports the failure as pending", () => {
    const { editor } = mcpEditor()
    const broken: McpEditor = { ...editor, get: () => { throw new Error(`broken editor Bearer ${KEY}`) } }
    let observation: ServerObservation | undefined
    expect(() => (observation = reconcileServer(broken, config))).not.toThrow()
    expect(observation!.source).toEqual({ type: "pending" })
    expect(observation!.problems).toEqual(["SERVER_NOT_REGISTERED: The openrouter MCP server entry could not be read or written (broken editor Bearer [redacted]). Next step: Restart OpenCode."])
  })

  test("is pending until the host runs the transform, and each replay replaces the observation whole", async () => {
    const { transform, run } = transforms<McpEditor>()
    const seen: ServerObservation[] = []
    await registerServer({ transform }, config, (observation) => seen.push(observation))
    expect(seen).toEqual([])
    expect(PENDING.source).toEqual({ type: "pending" })
    run(mcpEditor().editor)
    run(mcpEditor({ openrouter: { type: "remote", url: "https://example.com/mcp" } as ServerConfig }).editor)
    run(mcpEditor().editor)
    expect(seen.map((observation) => observation.source.type)).toEqual(["plugin", "conflict", "plugin"])
    expect(seen[2]!.problems).toEqual([])
  })
})

describe("endpoint ownership", () => {
  const mismatch = (url: string) => endpointMismatch(url, ENDPOINT)

  test("accepts exactly the canonical URL", () => {
    expect(mismatch(ENDPOINT)).toBeUndefined()
  })

  test.each([
    ["userinfo", `https://user:${KEY}@mcp.openrouter.ai/mcp`, "has user credentials in the URL"],
    ["username only", "https://someone@mcp.openrouter.ai/mcp", "has user credentials in the URL"],
    ["query", `https://mcp.openrouter.ai/mcp?key=${KEY}`, "has a query string"],
    ["empty query", "https://mcp.openrouter.ai/mcp?", "is not written in the canonical form"],
    ["fragment", "https://mcp.openrouter.ai/mcp#frag", "has a fragment"],
    ["plain http", "http://mcp.openrouter.ai/mcp", "uses http: instead of https:"],
    ["lookalike suffix", "https://mcp.openrouter.ai.evil.example/mcp", "points at another host (mcp.openrouter.ai.evil.example)"],
    ["lookalike prefix", "https://evilmcp.openrouter.ai/mcp", "points at another host (evilmcp.openrouter.ai)"],
    ["sibling host", "https://openrouter.ai/mcp", "points at another host (openrouter.ai)"],
    ["homoglyph", "https://mcp.openrоuter.ai/mcp", "points at another host (mcp.xn--openruter-42h.ai)"],
    ["other port", "https://mcp.openrouter.ai:8443/mcp", "uses port 8443 instead of the default"],
    ["explicit default port", "https://mcp.openrouter.ai:443/mcp", "is not written in the canonical form"],
    ["upper-case host", "https://MCP.openrouter.ai/mcp", "is not written in the canonical form"],
    ["trailing slash", "https://mcp.openrouter.ai/mcp/", "ends with a trailing slash"],
    ["other path", "https://mcp.openrouter.ai/v2/mcp", "uses another path"],
    ["root path", "https://mcp.openrouter.ai/", "uses another path"],
    ["no path", "https://mcp.openrouter.ai", "uses another path"],
    ["invalid", "not a url", "is not a valid URL"],
  ])("refuses %s", (_, url, reason) => {
    expect(mismatch(url)).toBe(reason)
    const { observation } = reconcile({ openrouter: { type: "remote", url } as ServerConfig })
    expect(observation.source.type).toBe("conflict")
    expect(JSON.stringify(observation)).not.toContain(KEY)
  })

  test("compares the seam's own loopback endpoint the same way", () => {
    const loopback = "http://127.0.0.1:4100/mcp"
    expect(endpointMismatch(loopback, loopback)).toBeUndefined()
    expect(endpointMismatch("http://127.0.0.1:4101/mcp", loopback)).toBe("uses port 4101 instead of 4100")
  })
})

describe("tool identity", () => {
  test("keeps hyphens in native ids, as the host's normalisation does", () => {
    expect(namespaceOf(SERVER_NAME)).toBe("openrouter")
    expect(nativeToolId("send-message")).toBe("openrouter_send-message")
    expect(TOOL_NAMES.map(nativeToolId).every((id) => /^openrouter_[a-z]+(?:-[a-z]+)*$/.test(id))).toBe(true)
    expect(namespaceOf("open.router beta")).toBe("open_router_beta")
  })
})
