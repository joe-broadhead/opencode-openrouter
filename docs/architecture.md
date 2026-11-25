# Architecture

## Layers

| Layer | Files | Does |
|---|---|---|
| Entry | `src/index.ts` | `Plugin.define({ id, setup })`, `assertHost`, the account wiring and one `register` call |
| Manifest | `src/manifest.ts` | reads `package.json` `capabilities` and checks it with the contract's validator |
| Accounts | `src/accounts.ts` | one OpenRouter MCP server per alias, through the contract's `accounts` module |
| Provider | `src/provider/mcp.ts` | the one MCP URL, the per-alias server config, and the live `ctx.mcp.list()` read |
| Handlers | `src/handlers/` | one handler per method the plugin owns: `status` and `probe` |

The entry is deliberately thin. `register` from the contract wires doors 1–3: one agent tool per non-MCP method in the
`openrouter` namespace, the same methods in Code Mode, one RPC registration under `openrouter`, the permission gate for
its own methods, and the access rules inserted into every agent. This repository never calls `ctx.tool`, `ctx.rpc` or
`ctx.permission` itself.

## The call path

1. OpenCode loads `dist/index.js` through the package's `./server` export and calls `setup(ctx)`.
2. `assertHost` refuses an OpenCode release outside `>=2.4.1 <2.5.0`, unless `allowUntestedHost` is set.
3. `src/accounts.ts` adds one MCP server per alias through `ctx.mcp.transform`, named `openrouter` or
   `openrouter-<alias>`, each with its own OAuth. The server config carries no display field: OpenCode's MCP config has
   none, so `probe` supplies the label.
4. `register` checks the handler table against `capabilities.methods`, resolves the accounts from the options, generates
   the access rules into every agent, and registers the plugin's own methods.
5. OpenRouter's 31 tools are not registered here at all. The manifest declares each as an `mcp:<tool>` row so the access
   rules cover it; OpenCode's MCP client owns the call, the schema and the result.
6. For `status`, the handler asks the call for the agents that no longer hold the generated rules and the provider for
   each alias's signal, then the contract's `statusAnswer` assembles the answer. For `probe`, the handler reads
   `ctx.mcp.list()`, finds the alias's server entry, and answers OpenCode's own connection identity for it.

## The provider

`src/provider/mcp.ts` is the only file that names the vendor URL. It holds:

- `MCP_URL`, the one endpoint, used by `src/accounts.ts` and nowhere else;
- `serverName` / `serverLabel` / `serverConfig`, the contract's one naming rule, the label `probe` answers and the
  per-alias server config;
- `signalOf`, the one mapping from OpenCode's MCP status to a contract signal, and `createMcpProvider`, the live read
  over `ctx.mcp.list()`.

There is no network client. The plugin never talks to OpenRouter: the vendor's MCP server owns every call, and the
plugin only reads OpenCode's local server list.

## OpenCode APIs

| API | Who calls it |
|---|---|
| `Plugin.define` | `src/index.ts` |
| `ctx.app.version` | `assertHost`, for the host gate, and `setup`, for `status` |
| `ctx.mcp.transform` | the contract's `accounts` module, called by `src/accounts.ts` |
| `ctx.mcp.list` | `src/provider/mcp.ts`, for `probe` and `status` |
| `ctx.agent.transform` and `ctx.agent.list` | `register` only, for the access rules and the unguarded agents `status` reads from the call |
| `ctx.tool.transform`, `ctx.rpc.register`, `ctx.permission.assert` | `register` only |

## State and caching

The plugin keeps no content cache, no credential and no cursor. `probe` and `status` read OpenCode's server list when
they are called, so a sign-in or a failure shows up without a reload. The vendor's MCP server keeps the tools and the
OAuth; OpenCode keeps the session.

## Build

`scripts/build.mjs` bundles `src/index.ts` into `dist/index.js` with esbuild. `@opencode/*` stays external, because
OpenCode provides it; the contract modules are bundled, so an install needs no build. `dist/` is generated and is not
committed.
