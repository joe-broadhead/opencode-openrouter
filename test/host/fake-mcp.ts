// A loopback stand-in for OpenRouter's hosted MCP server and its sign-in server. Everything it serves is synthetic:
// the tool names are the 17 documented ones (src/openrouter-tools.ts) plus one the plugin has never seen, each with a
// minimal invented schema, because no signed-in tool list has been captured. Its answers, tokens and clients are
// invented too.
//
// It answers JSON-RPC POSTs with plain JSON and records every tool call; `generate-image` answers with a text block and a
// synthetic PNG image block, the shape OpenRouter documents. While `challenge` is set, every MCP request
// gets 401 with a bearer challenge that points at its protected-resource metadata, and the same server plays the
// sign-in server in the shape OpenRouter's public metadata describes: authorization code with PKCE S256 and dynamic
// client registration, and no refresh-token grant.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { TOOL_NAMES } from "../../src/openrouter-tools.js"

/** A tool the plugin has never reviewed. */
export const NEW_TOOL = "shiny-new-tool"
/** A synthetic 1x1 PNG, which the fake returns as `generate-image`'s image content block. */
export const IMAGE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const schema = { type: "object", properties: { query: { type: "string" } } }
const TOOLS = [...TOOL_NAMES, NEW_TOOL].map((name) => ({ name, description: `Synthetic ${name}`, inputSchema: schema }))

export interface FakeMcpOptions {
  /** Start with every MCP request challenged, as before any sign-in. */
  readonly challenge?: boolean
  /** Split `tools/list` into pages of this many tools, linked by `nextCursor`. */
  readonly pageSize?: number
  /** Stop challenging once a token has been issued, as a real server accepts the token it signed. */
  readonly acceptAfterToken?: boolean
}

export interface FakeMcp {
  readonly url: string
  readonly origin: string
  /** While true, every MCP request gets 401 with a bearer challenge. The sign-in server keeps answering. */
  challenge: boolean
  /** Upstream tool names called, in order. */
  readonly calls: string[]
  /** While true, the answer to every `tools/call` waits until `release()`, so a test can abort a call in flight. */
  hold: boolean
  /** Sends every held answer. */
  release(): void
  /** The `notifications/cancelled` the client sent, by request id. */
  readonly cancelled: unknown[]
  /** Tool calls whose HTTP request the client closed before the held answer was sent. */
  readonly abandoned: string[]
  /** The `authorization` header of every MCP request. */
  readonly authorizations: (string | undefined)[]
  /** The `x-openrouter-test` header of every MCP request, to tell whose server config the host used. */
  readonly markers: (string | undefined)[]
  /** Every dynamic client registration request body. */
  readonly registrations: Record<string, unknown>[]
  /** Every authorization endpoint request's query. */
  readonly authorizeRequests: Record<string, string>[]
  /** Every token request's form. */
  readonly tokens: Record<string, string>[]
  close(): Promise<void>
}

type Message = { jsonrpc: "2.0"; id?: number | string; method: string; params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> } }

export async function startFakeMcp(options: FakeMcpOptions = {}): Promise<FakeMcp> {
  const calls: string[] = []
  const authorizations: (string | undefined)[] = []
  const markers: (string | undefined)[] = []
  const registrations: Record<string, unknown>[] = []
  const authorizeRequests: Record<string, string>[] = []
  const tokens: Record<string, string>[] = []
  let codes = 0
  const held: (() => void)[] = []
  const cancelled: unknown[] = []
  const abandoned: string[] = []
  const fake = { challenge: options.challenge ?? false, hold: false } as FakeMcp

  const answer = (message: Message) => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result })
    switch (message.method) {
      case "initialize":
        return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-openrouter", version: "0.0.0" } })
      case "tools/list": {
        if (!options.pageSize) return reply({ tools: TOOLS })
        const start = Number((message.params as { cursor?: string } | undefined)?.cursor ?? 0)
        const end = start + options.pageSize
        return reply({ tools: TOOLS.slice(start, end), ...(end < TOOLS.length ? { nextCursor: String(end) } : {}) })
      }
      case "tools/call": {
        const name = message.params?.name ?? ""
        calls.push(name)
        if (name === "generate-image") return reply({ content: [{ type: "text", text: `synthetic ${name}` }, { type: "image", data: IMAGE_PNG, mimeType: "image/png" }] })
        return reply({ content: [{ type: "text", text: `synthetic ${name}` }], structuredContent: { tool: name, arguments: message.params?.arguments ?? {} } })
      }
      case "ping":
        return reply({})
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }
    }
  }

  const json = (response: ServerResponse, status: number, body: unknown) => void response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body))

  const signIn = async (request: IncomingMessage, response: ServerResponse, route: string) => {
    if (route.startsWith("/.well-known/oauth-protected-resource")) {
      return json(response, 200, { resource: fake.url, authorization_servers: [fake.origin], bearer_methods_supported: ["header"] })
    }
    if (["/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"].includes(route)) {
      return json(response, 200, {
        issuer: fake.origin,
        authorization_endpoint: `${fake.origin}/oauth/authorize`,
        token_endpoint: `${fake.origin}/oauth/token`,
        registration_endpoint: `${fake.origin}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      })
    }
    if (route === "/oauth/register" && request.method === "POST") {
      const body = JSON.parse(await read(request)) as Record<string, unknown>
      registrations.push(body)
      return json(response, 201, { ...body, client_id: `fake-client-${registrations.length}`, token_endpoint_auth_method: "none" })
    }
    // Like a signed-in browser: the authorization endpoint sends the loopback callback a code.
    if (route === "/oauth/authorize") {
      const query = Object.fromEntries(new URL(request.url ?? "/", "http://127.0.0.1").searchParams)
      authorizeRequests.push(query)
      const target = new URL(query.redirect_uri ?? `${fake.origin}/nowhere`)
      target.searchParams.set("code", `fake-code-${++codes}`)
      if (query.state) target.searchParams.set("state", query.state)
      return void response.writeHead(302, { location: target.toString() }).end()
    }
    // A token without a refresh token: once it stops working, the person signs in again.
    if (route === "/oauth/token" && request.method === "POST") {
      const form = Object.fromEntries(new URLSearchParams(await read(request)))
      tokens.push(form)
      if (options.acceptAfterToken) fake.challenge = false
      return json(response, 200, { access_token: `fake-access-${tokens.length}`, token_type: "Bearer", expires_in: 3600 })
    }
    return json(response, 404, { error: "not_found" })
  }

  const server = createServer(async (request, response) => {
    const route = new URL(request.url ?? "/", "http://127.0.0.1").pathname
    if (route.startsWith("/.well-known/") || route.startsWith("/oauth")) return signIn(request, response, route)
    authorizations.push(header(request, "authorization"))
    markers.push(header(request, "x-openrouter-test"))
    if (fake.challenge) {
      const metadata = `${fake.origin}/.well-known/oauth-protected-resource/mcp`
      return void response.writeHead(401, { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${metadata}"` }).end(JSON.stringify({ error: "invalid_token" }))
    }
    if (request.method !== "POST") return void response.writeHead(405, { allow: "POST" }).end()
    const body = JSON.parse(await read(request)) as Message | Message[]
    const messages = Array.isArray(body) ? body : [body]
    for (const message of messages) if (message.method === "notifications/cancelled") cancelled.push((message.params as { requestId?: unknown } | undefined)?.requestId)
    const replies = messages.filter((message) => message.id !== undefined).map(answer)
    const call = messages.find((message) => message.method === "tools/call")
    if (fake.hold && call) {
      const closed = () => void (response.writableEnded || abandoned.push(call.params?.name ?? ""))
      response.once("close", closed)
      await new Promise<void>((done) => held.push(done))
      response.off("close", closed)
    }
    if (response.destroyed) return
    if (!replies.length) return void response.writeHead(202).end()
    json(response, 200, Array.isArray(body) ? replies : replies[0])
  })
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const { port } = server.address() as AddressInfo
  Object.assign(fake, {
    url: `http://127.0.0.1:${port}/mcp`,
    origin: `http://127.0.0.1:${port}`,
    calls,
    cancelled,
    abandoned,
    release: () => held.splice(0).forEach((done) => done()),
    authorizations,
    markers,
    registrations,
    authorizeRequests,
    tokens,
    close: () => new Promise<void>((done) => (held.splice(0).forEach((release) => release()), server.closeAllConnections(), server.close(() => done()))),
  })
  return fake
}

const header = (request: IncomingMessage, name: string) => [request.headers[name]].flat()[0]

async function read(request: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}
