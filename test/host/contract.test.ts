// Host contract facts the later guard and Code Mode work depends on, checked on the public API of each tested host
// rather than assumed: a plugin's tool transform sees the MCP server's native tools; an in-place execute decorator
// runs once per call and delegates to the host's executor exactly once, also after the catalog is rebuilt; and an
// options update can take a tool out of Code Mode. These use a probe plugin's own transforms, not the plugin's.
import "./isolate.js"
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { SERVER_NAME } from "../../src/constants.js"
import { cleanup, HOST_VERSION, serverRow, startHost, until, type Host } from "./harness.js"

setDefaultTimeout(300_000)
afterAll(cleanup)

let calls = 0
async function execute(host: Host, id: string) {
  const executor = await until(`${id} is listed`, async () => (await host.probe().tool.list()).find((item) => item.id === id))
  const session = await host.client.sessions.create({ agent: "build", location: host.location })
  const context = { sessionID: session.id, agent: "build", messageID: "msg_contract", id: `call_contract_${++calls}`, signal: new AbortController().signal, progress: async () => {} }
  return executor.execute({}, context as never)
}

describe(`the tool registry of OpenCode ${HOST_VERSION}`, () => {
  let host: Host
  beforeAll(async () => {
    host = await startHost()
    await until("the openrouter tools are listed", async () => (await host.probe().tool.list()).some((tool) => tool.id === "openrouter_ping"))
  })
  afterAll(() => host?.close())

  test("a plugin's tool transform lists the MCP tools under their native ids, in the server's namespace", async () => {
    let seen: { id: string; namespace?: string; codemode?: boolean }[] = []
    const registration = await host.probe().tool.transform((editor) => {
      seen = editor.list().filter((tool) => tool.id.startsWith(`${SERVER_NAME}_`)).map((tool) => ({ id: tool.id, namespace: tool.options?.namespace, codemode: tool.options?.codemode }))
    })
    try {
      await until("the transform has run", async () => seen.length > 0)
      expect(seen.find((tool) => tool.id === "openrouter_send-message")).toEqual({ id: "openrouter_send-message", namespace: SERVER_NAME, codemode: true })
    } finally {
      await registration.dispose()
    }
  })

  test("an in-place execute decorator runs once per call and delegates once, also after the catalog is rebuilt", async () => {
    let wrapped = 0
    const registration = await host.probe().tool.transform((editor) => {
      editor.update("openrouter_ping", (draft) => {
        const original = draft.execute
        draft.execute = async (input, context) => {
          wrapped++
          return original(input, context)
        }
      })
    })
    try {
      const before = host.fake.calls.length
      await execute(host, "openrouter_ping")
      expect(wrapped).toBe(1)
      expect(host.fake.calls.slice(before)).toEqual(["ping"])
      // Reconnecting rebuilds the server's tools; the transform replays on the new catalog without stacking.
      const mcp = host.client.mcp as unknown as Record<"connect" | "disconnect", (input: object) => Promise<unknown>>
      await mcp.disconnect({ server: SERVER_NAME, location: host.location })
      await until("the tools are gone", async () => !(await host.probe().tool.list()).some((tool) => tool.id === "openrouter_ping"))
      await mcp.connect({ server: SERVER_NAME, location: host.location })
      await until("the server is connected again", async () => (await serverRow(host))?.status.status === "connected")
      await execute(host, "openrouter_ping")
      expect(wrapped).toBe(2)
      expect(host.fake.calls.slice(before)).toEqual(["ping", "ping"])
    } finally {
      await registration.dispose()
    }
  })

  test("an options update can take one tool out of Code Mode, keeping its namespace", async () => {
    const registration = await host.probe().tool.transform((editor) => {
      editor.update("openrouter_generate-image", (draft) => {
        const { pinned: _pinned, ...options } = draft.options ?? {}
        draft.options = { ...options, codemode: false }
      })
    })
    try {
      const tool = await until("the update is listed", async () => {
        const found = (await host.probe().tool.list()).find((item) => item.id === "openrouter_generate-image")
        return found?.options?.codemode === false ? found : undefined
      })
      expect(tool.options).toEqual({ namespace: SERVER_NAME, codemode: false })
    } finally {
      await registration.dispose()
    }
  })
})
