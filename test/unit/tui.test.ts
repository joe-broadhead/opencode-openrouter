// The TUI status dialog against a narrow fake of the members it uses: the /openrouter command and palette entry, the
// status text from the server part's RPC, refreshes while open, stale answers, and cleanup.
import { describe, expect, test } from "bun:test"
import { checkHost } from "../../src/host-version.js"
import { TOOL_NAMES } from "../../src/openrouter-tools.js"
import { buildStatus, formatStatus, StatusRpc, type Status, type StatusFacts } from "../../src/status.js"
import tui, { REFRESH_COMMAND_ID, setupView, STATUS_COMMAND_ID, TUI_ID, viewMessage, type ViewContext } from "../../src/tui.js"

const status = (overrides: Partial<StatusFacts> = {}): Status =>
  buildStatus({
    host: checkHost("2.2.3", false),
    access: "ask-changes",
    source: { type: "plugin" },
    server: { status: "connected" },
    tools: [...TOOL_NAMES],
    settling: false,
    policy: { installation: "ready", problems: [] },
    coverage: { unguarded: [], explicitlyAllowed: [] },
    skills: [],
    problems: [],
    ...overrides,
  })
const SIGNED_OUT = () => status({ server: { status: "needs_auth" } })

/** Everything the view touches, recorded. */
function fake(options: { answer?: () => Promise<unknown> } = {}) {
  const handlers = new Map<string, ((event: unknown) => void)[]>()
  const alerts: { title: string; message: string; close: () => void }[] = []
  const sizes: unknown[] = []
  const layers: unknown[] = []
  const calls: unknown[] = []
  let cleared = 0
  let answer = options.answer ?? (async () => status())
  const context: ViewContext = {
    location: { directory: "project" } as ViewContext["location"],
    client: {
      rpc: ((definition: { id: string }) => ({
        status: (input: unknown, request: unknown) => (calls.push({ id: definition.id, input, request }), answer()),
      })) as unknown as ViewContext["client"]["rpc"],
    },
    data: {
      on: ((type: string, handler: (event: unknown) => void) => {
        handlers.set(type, [...(handlers.get(type) ?? []), handler])
        return () => handlers.set(type, handlers.get(type)!.filter((item) => item !== handler))
      }) as ViewContext["data"]["on"],
    },
    ui: {
      dialog: {
        alert: (alert) => new Promise((resolve) => void alerts.push({ ...alert, close: () => resolve() })),
        set: (value) => void sizes.push(value),
        clear: () => void cleared++,
      },
    },
    keymap: { layer: (factory) => void layers.push(factory()) },
  }
  const emit = (type: string, event: unknown = {}) => (handlers.get(type) ?? []).forEach((handler) => handler(event))
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { context, alerts, sizes, layers, calls, handlers, emit, settle, cleared: () => cleared, setAnswer: (next: () => Promise<unknown>) => void (answer = next) }
}

type Command = { run: () => Promise<void> | void; enabled?: () => boolean }
const command = (layers: unknown[]) => (layers[0] as { commands: Command[] }).commands[0]!
const refreshKey = (layers: unknown[]) => (layers[0] as { commands: Command[] }).commands[1]!

describe("the TUI entry", () => {
  test("is the status view with its stable id", () => {
    expect(tui.id).toBe(TUI_ID)
    expect(TUI_ID).toBe("openrouter.models.tui")
    expect(tui.setup).toBe(setupView as never)
  })

  test("adds one global palette entry and /openrouter, and an r key live only while the dialog is open", async () => {
    const view = fake()
    setupView(view.context)
    expect(view.layers).toEqual([
      {
        mode: "global",
        commands: [
          {
            id: STATUS_COMMAND_ID,
            title: "OpenRouter: Status",
            description: "Sign-in, rules, tools, scripts and the next step for OpenRouter tools",
            group: "OpenRouter",
            palette: true,
            slash: { name: "openrouter" },
            run: expect.any(Function),
          },
          { id: REFRESH_COMMAND_ID, title: "Refresh OpenRouter status", group: "OpenRouter", bind: "r", enabled: expect.any(Function), run: expect.any(Function) },
        ],
      },
    ])
    const key = refreshKey(view.layers)
    expect(key.enabled!()).toBe(false)
    await command(view.layers).run()
    expect(key.enabled!()).toBe(true)
    view.setAnswer(async () => SIGNED_OUT())
    key.run()
    await view.settle()
    expect(view.alerts).toHaveLength(2)
    expect(view.alerts[1]!.message).toContain("- Connection: sign-in required")
    view.alerts[1]!.close()
    await view.settle()
    expect(key.enabled!()).toBe(false)
  })
})

describe("the status dialog", () => {
  test("shows the status RPC's answer: the /openrouter-status report without its heading, in a large dialog", async () => {
    const answer = status({ access: "read-only", coverage: { unguarded: ["reviewer"], explicitlyAllowed: [] } })
    const view = fake({ answer: async () => answer })
    setupView(view.context)
    await command(view.layers).run()
    expect(view.calls.at(-1)).toEqual({ id: StatusRpc.id, input: {}, request: { location: { directory: "project" } } })
    expect(view.alerts).toHaveLength(1)
    expect(view.alerts[0]!.title).toBe("OpenRouter status")
    expect(view.alerts[0]!.message).toBe(`${formatStatus(answer).split("\n").slice(1).join("\n")}\n\nr refresh · esc close`)
    expect(view.alerts[0]!.message).toContain("- Next step: Put the default rules shown by /openrouter-status first")
    expect(view.sizes.at(-1)).toEqual({ size: "large" })
  })

  test.each([
    [{ type: "rpc.unavailable", message: "x" }, "STATUS_UNAVAILABLE: The OpenRouter plugin is not running on this OpenCode server. Next step: Run /plugins to see why it did not start."],
    [{ type: "rpc.method_not_found", message: "x" }, "STATUS_UNAVAILABLE: The OpenRouter plugin is not running on this OpenCode server. Next step: Run /plugins to see why it did not start."],
    [
      { type: "unavailable", message: "STATUS_UNAVAILABLE: Could not read OpenRouter's status (agents unavailable).", data: { nextStep: "Restart OpenCode, then run /openrouter-status again." } },
      "STATUS_UNAVAILABLE: Could not read OpenRouter's status (agents unavailable). Next step: Restart OpenCode, then run /openrouter-status again.",
    ],
    [new Error("socket closed Bearer sk-or-v1-0123456789abcdef0123456789abcdef"), "STATUS_UNAVAILABLE: Could not read OpenRouter's status (socket closed Bearer [redacted]). Next step: Restart OpenCode, then run /openrouter again."],
    ["timeout", "STATUS_UNAVAILABLE: Could not read OpenRouter's status (timeout). Next step: Restart OpenCode, then run /openrouter again."],
  ])("a failed status request (%j) shows a coded error with a next step", async (error, message) => {
    const view = fake({ answer: () => Promise.reject(error) })
    setupView(view.context)
    await command(view.layers).run()
    expect(view.alerts[0]!.message).toBe(`${message}\n\nr refresh · esc close`)
  })

  test.each(["mcp.status.changed", "server.connected", "agent.updated", "integration.updated", "credential.updated", "credential.switched"])("an open dialog redraws on %s", async (type) => {
    const view = fake()
    setupView(view.context)
    await command(view.layers).run()
    view.setAnswer(async () => SIGNED_OUT())
    view.emit(type, { data: { server: "openrouter" } })
    await view.settle()
    expect(view.alerts).toHaveLength(2)
    expect(view.alerts[1]!.message).toContain("- Connection: sign-in required")
  })

  test("listens to events only while the dialog is open", async () => {
    const view = fake()
    setupView(view.context)
    const listening = () => [...view.handlers.values()].flat().length
    expect(listening()).toBe(0)
    await command(view.layers).run()
    expect(listening()).toBe(6)
    await command(view.layers).run()
    expect(listening()).toBe(6)
    view.alerts.at(-1)!.close()
    await view.settle()
    expect(listening()).toBe(0)
  })

  test("a closed dialog is never reopened, and another server's change is ignored", async () => {
    const view = fake()
    setupView(view.context)
    view.emit("mcp.status.changed", { data: { server: "openrouter" } })
    await view.settle()
    expect(view.alerts).toHaveLength(0)
    await command(view.layers).run()
    view.emit("mcp.status.changed", { data: { server: "github" } })
    await view.settle()
    expect(view.alerts).toHaveLength(1)
    view.alerts[0]!.close()
    await view.settle()
    view.emit("agent.updated")
    await view.settle()
    expect(view.alerts).toHaveLength(1)
  })

  test("a refresh whose answer arrives after the dialog closed does not reopen it", async () => {
    let release: (value: Status) => void = () => {}
    const view = fake()
    setupView(view.context)
    await command(view.layers).run()
    view.setAnswer(() => new Promise((resolve) => (release = resolve)))
    refreshKey(view.layers).run()
    view.alerts[0]!.close()
    await view.settle()
    release(SIGNED_OUT())
    await view.settle()
    expect(view.alerts).toHaveLength(1)
  })

  test("a slow answer never replaces a newer one", async () => {
    let release: (value: Status) => void = () => {}
    const view = fake({ answer: () => new Promise((resolve) => (release = resolve)) })
    setupView(view.context)
    const first = command(view.layers).run()
    const releaseFirst = release
    view.setAnswer(async () => SIGNED_OUT())
    await command(view.layers).run()
    releaseFirst(status())
    await first
    expect(view.alerts.map((alert) => alert.message.includes("- Connection: sign-in required"))).toEqual([true])
  })

  test("cleanup stops listening, closes an open dialog, and an answer that arrives after it opens nothing", async () => {
    const view = fake()
    const cleanup = setupView(view.context)
    await command(view.layers).run()
    cleanup()
    expect([...view.handlers.values()].flat()).toHaveLength(0)
    expect(view.cleared()).toBe(1)
    const closed = fake()
    setupView(closed.context)()
    expect(closed.cleared()).toBe(0)
    let release: (value: Status) => void = () => {}
    const late = fake({ answer: () => new Promise((resolve) => (release = resolve)) })
    const stop = setupView(late.context)
    const opening = command(late.layers).run()
    stop()
    release(status())
    await opening
    expect(late.alerts).toHaveLength(0)
  })

  test("the view message keeps the keys line", () => {
    expect(viewMessage({ status: status() }).endsWith("\n\nr refresh · esc close")).toBe(true)
  })
})
