# Contract matrix

Every claim the implementation relies on, with the evidence behind it. Re-check a row when the host range, the tested
releases or OpenRouter's documentation changes, and move a row to **live-observed** only with a signed-in capture.

| Label | Meaning |
| --- | --- |
| **documented** | Stated in OpenRouter's or OpenCode's public documentation. Not observed by running anything. |
| **source-verified** | Read in the pinned packages: the `.d.ts` types of `@opencode/plugin` and `@opencode/schema` 2.2.3 (the locked dev pins) and 2.2.6 (installed outside the lockfile), and where noted the bundled host runtime of `@opencode/core` at the same versions. Paths are relative to `node_modules/@opencode/`. Line numbers are for 2.2.3, then 2.2.6. |
| **synthetic** | Observed by this repository's tests on a real host (embedded `@opencode/sdk` or stock `opencode serve`, 2.2.3 to 2.2.6) against the loopback fake in `test/host/fake-mcp.ts`. Proves host behaviour; proves nothing about OpenRouter's server. |
| **live-observed** | Observed against OpenRouter's real server with a signed-in account. **No row has this label yet.** |
| **assumed** | Design policy or an expectation nothing above confirms yet. |

The `@opencode/core` bundle splits into hashed chunk files; the citations below name the chunk and the source module it
inlines (`src/tool/mcp.ts` and so on) so a reader can find the same code in another release.

## OpenRouter's service

| Claim | Label | Evidence |
| --- | --- | --- |
| The endpoint is `https://mcp.openrouter.ai/mcp`, a remote server reached over HTTP. | documented | [MCP page](https://openrouter.ai/docs/guides/overview/mcp-server), read 2026-11-11 |
| The catalog has exactly 17 tools: `send-message`, `generate-image`, `list-models`, `get-model`, `list-model-endpoints`, `list-providers`, `list-daily-model-rankings`, `list-app-rankings`, `get-credits`, `get-generation`, `list-benchmarks`, `list-task-classifications`, `search-docs`, `send-feedback`, `spawn-ori-eval`, `install-ori-harness`, `ping`. | documented | Same page, "What you can do" table; recorded in `test/fixtures/documented-tools.json` |
| `send-message` and `generate-image` are billable inference; `send-feedback` writes feedback on one of the account's own generations; the rest are read-only lookups. | documented | Same page |
| `generate-image` returns the image inline as an image content block. | documented | Same page |
| `send-message` replies include the generation id, which `get-generation` accepts. | documented | Same page, tip under "More things you can do" |
| Sign-in: an unauthenticated request gets 401 pointing at OpenRouter's authorization server; the client registers dynamically; PKCE. | documented | Same page, "How it works" |
| The sign-in mints a dedicated key, `$10` default spend cap editable on the consent page, at most seven days' lifetime, shortened by an account's key-lifetime policy; a client-requested expiry is ignored. | documented | Same page |
| The authorization server advertises authorization code, PKCE S256, dynamic client registration, and no refresh-token grant. | assumed | From the design's reading of the public metadata; not re-fetched here. The fake mirrors this shape (synthetic). |
| Input schemas, output schemas, annotations, pagination of `tools/list`, rate limits and error shapes. | **unknown** | Not published. No signed-in capture exists; `test/fixtures/provenance.json` has `"live": null`. |
| `get-credits` works with the MCP key (the REST credits endpoint needs a management key). | assumed | To verify in the live spike. |
| A trailing-slash URL behaves the same as the canonical one. | **unknown** | Not tested live, so the plugin treats it as a fixable mismatch. |
| OpenRouter's own OpenCode snippet uses `mcp.openrouter` with `enabled: true`. | documented | Same page, OpenCode tab. That is the older config shape: the 2.2.x schema has `mcp.servers.<name>` and `disabled`, not `enabled` (`schema/dist/config/mcp.d.ts:17`; `schema/dist/mcp.d.ts:39` / `:40`). The plugin uses the V2 API, not the snippet. |

## Host APIs the design maps (DESIGN §7)

| API | Label | Evidence (2.2.3 / 2.2.6) |
| --- | --- | --- |
| `Plugin.define({ id, setup })`; setup may return a cleanup. | source-verified | `plugin/dist/promise/plugin.d.ts:63` / `:65`, `Cleanup` at `:58` / `:60` |
| `ctx.mcp.transform` with an editor of `list`, `get`, `set`, `update`, `remove`; `ctx.mcp.list()`. | source-verified | `plugin/dist/promise/mcp.d.ts:5-15`, identical in both |
| The user's config is applied before a plugin's MCP transform, so `editor.get("openrouter")` returns the user's entry. | synthetic | Adoption, conflict and disabled host tests in `test/host/openrouter.test.ts` |
| `ctx.tool.transform` with an editor of `list`, `get`, `namespace`, `add`, `update`, `remove`; `update` ignores a missing id. | source-verified | `plugin/dist/promise/tool.d.ts:12-28`, identical in both |
| A tool's `execute(input, context)` returns a Promise of the result; the context carries `signal` and `progress`. | source-verified | `plugin/dist/promise/tool.d.ts:9-15` |
| `ctx.tool.list()` returns the tools after every transform. | source-verified | `plugin/dist/promise/tool.d.ts:57-60` |
| A plugin's tool transform sees the MCP server's native tools in `editor.list()`, with `options` `{ namespace: "openrouter", codemode: true }`. | synthetic | `test/host/contract.test.ts`, 2.2.3 to 2.2.6 |
| The in-place decorator shape (`const original = draft.execute; draft.execute = async (input, call) => original(input, call)`) runs once per call and dispatches upstream once; after a disconnect and reconnect rebuilds the catalog, the transform replays on the new tools without stacking. | synthetic | `test/host/contract.test.ts` |
| Tool `options` is `{ namespace?, permission? }` and either `{ codemode?: true, pinned?: boolean }` or `{ codemode: boolean, pinned?: never }`, so `codemode: false` needs `pinned` removed. | source-verified | `schema/dist/tool.d.ts:21-31`, identical in both |
| Setting `options.codemode = false` (with `pinned` removed) on `openrouter_generate-image` keeps its namespace and is listed. | synthetic | `test/host/contract.test.ts` |
| `ctx.agent.transform` with `list`, `get`, `default`, `update`, `remove`. | source-verified | `plugin/dist/promise/agent.d.ts:5-15` |
| `ctx.skill.transform` with `list`, `get`, `add`, `update`, `remove`. | source-verified | `plugin/dist/promise/skill.d.ts:5-15` |
| `ctx.command.transform` with `add({ name, description?, execute })`. | source-verified | `plugin/dist/promise/command.d.ts:11-22` |
| `ctx.integration.transform` with `get`, `update(id, (integration) => …)` on `{ id, name }`; `ctx.integration.connection.active` and `.status`. | source-verified | `plugin/dist/promise/integration.d.ts:70-94` |
| `ctx.event.subscribe({ types, signal })` returns an async iterable; the four types the watcher uses exist. | source-verified | `plugin/dist/promise/event.d.ts:5`; the literal types typecheck against `@opencode/client` 2.2.3 |
| `Rpc.define(definition)` and `ctx.rpc.register(definition, handlers)`. | source-verified | `schema/dist/rpc.d.ts:49`; `plugin/dist/promise/rpc.d.ts:21` |
| Removing a plugin generation disposes everything it registered, and the plugin's cleanup runs. | synthetic | "unloading" host test |
| There is no public `ctx.mcp.callTool()`. | source-verified | `plugin/dist/promise/mcp.d.ts:12-15` exposes only `list`, `transform`, `reload` |

## MCP identity and naming

| Claim | Label | Evidence |
| --- | --- | --- |
| Native MCP tool ids are `<server>_<tool>` with every character outside `[A-Za-z0-9_-]` replaced by `_`, so hyphens survive: `openrouter_send-message`. The permission action is the same string. | source-verified | `core` 2.2.3 `dist/chunks/usage-limits-6er5y2fs.js:49-50` (`src/tool/mcp.ts`), action at `:74`; 2.2.6 `dist/chunks/persistent-pty-psrqx85q.js:54-55` with `normalizedName2` / `effectiveName2` in `persistent-pty-z0h12gs8.js:212-213`, action at `:79` |
| …and observed so on every tested host, with a native call reaching the server as `list-models`. | synthetic | `test/host/openrouter.test.ts` |
| Each native MCP tool's executor asserts the permission action, then calls the server: a decorator around it keeps the assertion. | source-verified | 2.2.3 `usage-limits-6er5y2fs.js:73-86`; 2.2.6 `persistent-pty-psrqx85q.js:78-85` |
| A remote server's integration exists only when `oauth` is not `false`. Its ID is `mcp_` + the first 16 hex of SHA-1 of `name + "\0" + url`, its name is the server name, and its `metadata.source` is `"mcp"`. | source-verified | 2.2.3 `usage-limits-xcp7yafh.js:131-145`; 2.2.6 `persistent-pty-8yst3fhc.js:158-171` |
| `ctx.mcp.list()` rows carry `integrationID` (optional). The plugin reads it there and never computes it. | source-verified | `schema/dist/mcp.d.ts:80` / `:82`; `scripts/check-forbidden.mjs` refuses the hash in `src/` |
| The integration ID of the stock `openrouter` server is `mcp_` + the hash of the endpoint; `/connect` lists it as "OpenRouter tools" after the plugin's rename. | synthetic | `test/pack/pack.test.ts`, stock `opencode serve` 2.2.3 to 2.2.6 |
| The built-in model provider's integration ID is the provider's own ID, `openrouter`; it is named "OpenRouter", has `key` and `env` methods, no `metadata.source`, and is never renamed. | source-verified + synthetic | 2.2.3 `usage-limits-rp2cm5ts.js:66`, 2.2.6 `persistent-pty-02w7mmza.js:66`; host and pack tests |
| A server that needs a sign-in reports `needs_auth` in `ctx.mcp.list()`, and OpenCode's own OAuth starts with dynamic registration and S256 against the server's authorization server. | synthetic | Host and pack tests |
| Unloading keeps the credential: the plugin registered again connects with the same token, with no new sign-in. | synthetic | Host test |
| `opencode plugin add`, `opencode reload` and `opencode mcp auth <server>` exist. | source-verified | Stock 2.2.3 CLI `--help` |

## Where the pinned host does not match the design

- **No `/connect` entry without OAuth.** The host makes an MCP integration only for a remote server whose `oauth` is not
  `false`. A user's adopted entry with `oauth: false` and their own `Authorization` header has no integration, so there is
  nothing to label "OpenRouter tools" and nothing to mark for a new sign-in; Jelly's sign-in entry for `server:
  "openrouter"` would find none. The watcher does nothing in that case.
- **No "host removal" state.** A plugin's MCP transform sees only the merged config. The 2.2.x schema has `disabled`
  and no removal marker, so "the user removed the plugin's server" is indistinguishable from "no entry": the plugin adds
  its entry again. The only way to keep it off is `"disabled": true` on an exact entry, which the plugin preserves.
- **`pool` is newer than the baseline.** 2.2.6 adds an MCP `pool` option (`schema/dist/mcp.d.ts:21`, `:44`) that 2.2.3
  does not have. The plugin never sets it.
- **2.2.6 adds `ctx.experimental.artifact`** (`plugin/dist/promise/plugin.d.ts:39`). Unused.
- **Ordering of guard and first exposure is not yet proven.** The contract test shows a transform registered after the
  tools exist applies to them and replays after a rebuild. That the guard decorates every tool before any model sees it,
  at startup and on late sign-in, is for the guard work to prove on each host.
- **Native media.** The host converts MCP content through its own output path (`toContent` in the same `src/tool/mcp.ts`
  chunk). That an image block survives a decorator and reaches the user is not yet observed.

## Plugin policy (assumed, by design)

| Claim | Label |
| --- | --- |
| Effect, billing, visibility and script eligibility of each tool (`src/openrouter-tools.ts`). | assumed (reviewed policy, DESIGN §3 and §9) |
| `ask-changes` is the default access. | assumed (DESIGN §1) |
| Exact-string URL ownership: anything but the canonical URL is a fixable conflict. | assumed (DESIGN §8; trailing slash pending live evidence) |
| The integration watcher's startup polling (250 ms for 10 s) and resubscribe delay (5 s). | assumed (ported from the family's Notion connector) |
