// The /connect entry: renamed "OpenRouter tools" once the host has registered it and again after the host resets it,
// the account marked for a new sign-in while the server needs one, never the model provider's integration, and a stop
// that leaves no timer behind. Against a narrow fake of the members the watcher uses.
import { describe, expect, test } from "bun:test"
import { DISPLAY_NAME } from "../../src/constants.js"
import { SIGN_IN_AGAIN, watchIntegration, type IntegrationContext } from "../../src/integration.js"
import { timerProbe } from "./fake.js"

type Editor = Parameters<Parameters<IntegrationContext["integration"]["transform"]>[0]>[0]
type Connection = { type: "credential"; id: string; label: string; method: "oauth"; status?: { status: "needs_auth"; message: string } }

/** The MCP server's integration ID as OpenCode derives it; the fake only needs a stable value. */
const MCP_ID = "mcp_0123456789abcdef"

function fake(initial: { server?: string; integrationID?: string; source?: string; streamIgnoresAbort?: boolean } = {}) {
  const state = {
    server: initial.server ?? "connected",
    integrationID: "integrationID" in initial ? initial.integrationID : MCP_ID,
    source: initial.source ?? "mcp",
    /** The host's name for each integration before plugin transforms run. */
    hostName: "openrouter",
    connection: undefined as Connection | undefined,
  }
  const transforms: ((editor: Editor) => void)[] = []
  const reported: unknown[] = []
  const looked: string[] = []
  let push: (() => void) | undefined
  let next: { type: string; data: Record<string, unknown> } = { type: "integration.updated", data: {} }
  const name = () => {
    let current = state.hostName
    const editor = {
      get: (id: string) => (id === state.integrationID ? { id, name: current } : undefined),
      update: (id: string, update: (integration: { id: string; name: string }) => void) => {
        const integration = { id, name: current }
        update(integration)
        current = integration.name
      },
    } as unknown as Editor
    for (const transform of transforms) transform(editor)
    return current
  }
  const ctx = {
    mcp: { list: async () => ({ data: [{ name: "openrouter", status: { status: state.server }, ...(state.integrationID ? { integrationID: state.integrationID } : {}) }] }) },
    integration: {
      transform: async (callback: (editor: Editor) => void) => {
        transforms.push(callback)
        return { dispose: async () => void transforms.splice(transforms.indexOf(callback), 1) }
      },
      // The host projects each credential with the status the plugin set on it; `active` returns the credential alone.
      get: async ({ integrationID }: { integrationID: string }) => {
        looked.push(integrationID)
        return {
          data: {
            id: state.integrationID,
            name: name(),
            metadata: { source: state.source },
            connections: state.connection
              ? [{ type: "credential", id: state.connection.id, label: state.connection.label, method: state.connection.method, ...(state.connection.status ? { status: state.connection.status } : {}) }]
              : [],
          },
        }
      },
      connection: {
        active: async () => state.connection,
        status: async (input: { status: Connection["status"] }) => {
          reported.push(input.status)
          if (state.connection) state.connection = { ...state.connection, ...(input.status ? { status: input.status } : { status: undefined }) }
        },
      },
    },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          for (;;) {
            if (signal.aborted && !initial.streamIgnoresAbort) return
            await new Promise<void>((resolve) => {
              push = resolve
              if (!initial.streamIgnoresAbort) signal.addEventListener("abort", () => resolve(), { once: true })
            })
            if (signal.aborted && !initial.streamIgnoresAbort) return
            yield next
          }
        },
      }),
    },
  } as unknown as IntegrationContext
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
  /** Delivers one event, `integration.updated` unless another is given. */
  const emit = (event: { type: string; data: Record<string, unknown> } = { type: "integration.updated", data: {} }) => {
    next = event
    push?.()
  }
  return { ctx, state, transforms, reported, looked, name, emit, settle }
}

describe("watchIntegration", () => {
  test("names the server's /connect entry OpenRouter tools once the host has registered it", async () => {
    const view = fake({ integrationID: undefined })
    const stop = watchIntegration(view.ctx, () => true)
    await view.settle()
    expect(view.transforms).toHaveLength(0)
    view.state.integrationID = MCP_ID
    view.emit()
    await view.settle()
    expect(view.name()).toBe(DISPLAY_NAME)
    expect(view.transforms).toHaveLength(1)
    await stop()
    expect(view.transforms).toHaveLength(0)
  })

  test("reports each status change of the openrouter server, and no other server's", async () => {
    const view = fake()
    let changes = 0
    const stop = watchIntegration(view.ctx, () => true, () => void changes++)
    await view.settle()
    view.emit({ type: "mcp.status.changed", data: { server: "openrouter" } })
    await view.settle()
    view.emit({ type: "mcp.status.changed", data: { server: "github" } })
    await view.settle()
    view.emit()
    await view.settle()
    expect(changes).toBe(1)
    await stop()
  })

  test("reads the integration ID from the server's row, and never looks up the model provider's", async () => {
    const view = fake()
    const stop = watchIntegration(view.ctx, () => true)
    await view.settle()
    await stop()
    expect(new Set(view.looked)).toEqual(new Set([MCP_ID]))
    expect(view.looked).not.toContain("openrouter")
  })

  test("leaves an integration that is not an MCP server's alone", async () => {
    const view = fake({ integrationID: "openrouter", source: "provider" })
    const stop = watchIntegration(view.ctx, () => true)
    await view.settle()
    expect(view.transforms).toHaveLength(0)
    expect(view.name()).toBe("openrouter")
    await stop()
  })

  test("registers the rename again when the host's name comes back, and drops the old one", async () => {
    const view = fake()
    const stop = watchIntegration(view.ctx, () => true)
    await view.settle()
    expect(view.name()).toBe(DISPLAY_NAME)
    // An MCP reload registers the host's transform again, after the plugin's: the name is reset.
    view.transforms.push((editor) => editor.update(MCP_ID, (integration) => void (integration.name = "openrouter")))
    view.emit()
    await view.settle()
    expect(view.name()).toBe(DISPLAY_NAME)
    expect(view.transforms).toHaveLength(2)
    await stop()
  })

  test("leaves a server that is not the plugin's alone", async () => {
    const view = fake()
    const stop = watchIntegration(view.ctx, () => false)
    await view.settle()
    expect(view.transforms).toHaveLength(0)
    expect(view.looked).toEqual([])
    await stop()
  })

  test("marks the account for a new sign-in while the server needs one, and clears only its own mark", async () => {
    const view = fake({ server: "needs_auth" })
    view.state.connection = { type: "credential", id: "c1", label: "Example account", method: "oauth" }
    const stop = watchIntegration(view.ctx, () => true)
    await view.settle()
    expect(view.reported).toEqual([{ status: "needs_auth", message: SIGN_IN_AGAIN }])
    view.state.server = "connected"
    view.emit()
    await view.settle()
    expect(view.reported).toEqual([{ status: "needs_auth", message: SIGN_IN_AGAIN }, undefined])
    view.state.connection = { ...view.state.connection!, status: { status: "needs_auth", message: "Another plugin's problem." } }
    view.emit()
    await view.settle()
    expect(view.reported).toHaveLength(2)
    await stop()
  })

  test("without a credential, marks nothing: the host's own needs_auth state stands", async () => {
    const view = fake({ server: "needs_auth" })
    const stop = watchIntegration(view.ctx, () => true)
    await view.settle()
    expect(view.reported).toEqual([])
    expect(view.name()).toBe(DISPLAY_NAME)
    await stop()
  })

  test("stops with no timer left, and does not wait forever for a stream that ignores the abort", async () => {
    const timers = timerProbe()
    try {
      const view = fake({ streamIgnoresAbort: true })
      const stop = watchIntegration(view.ctx, () => true)
      await view.settle()
      expect(timers.pending()).toBeGreaterThan(0)
      const started = Date.now()
      await stop()
      expect(Date.now() - started).toBeLessThan(3_000)
      expect(timers.pending()).toBe(0)
    } finally {
      timers.stop()
    }
  })

  test("a stop during startup polling leaves no timer and no rename", async () => {
    const timers = timerProbe()
    try {
      const view = fake()
      const stop = watchIntegration(view.ctx, () => true)
      await stop()
      expect(timers.pending()).toBe(0)
      expect(view.transforms).toHaveLength(0)
    } finally {
      timers.stop()
    }
  })
})
