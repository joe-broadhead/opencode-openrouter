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
| `get-credits` works with the MCP key (the REST credits endpoint needs a management key). | assumed | To verify with `scripts/capture-live.ts`, which calls it and records only whether it answered and its top-level shape. |
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
| Setting `options.codemode = false` (with `pinned` removed) on `openrouter_generate-image` keeps its namespace and is listed. | synthetic | `test/host/contract.test.ts`; the plugin's own guard transform in `test/host/guard.test.ts` |
| A tool with `codemode: false` is offered to the model as a direct tool; the rest go through Code Mode. A tool whose action's last matching rule is a deny on every resource is left out of the model's tools. | source-verified | `core` 2.2.3 `usage-limits-qbh9qxse.js:217-222`; 2.2.6 `persistent-pty-fre27jqt.js:201-206` (`src/tool/registry.ts`, `snapshot`) |
| Each registry rebuild runs every transform, in registration order, on a fresh state and publishes that state only after the last one: no listing or snapshot ever holds a tool before every transform has run on it. | source-verified | `core` 2.2.3 and 2.2.6 `usage-limits-40y6dtc2.js` / `persistent-pty-40y6dtc2.js:84-117` (`src/state.ts`, `create`) |
| A transform that throws disables its plugin's whole registration group, so the plugin's transforms catch every failure. | source-verified | Same function, `:107` in both |
| The host's MCP tools are already in the editor when the plugin's tool transform runs, at startup, after a late sign-in and after a disconnect and reconnect: a probe transform registered after the plugin's receives only guarded executors in every pass. | synthetic | `test/host/guard.test.ts`, 2.2.3 to 2.2.6 |
| A plugin executor that throws reaches the host as a `Tool.Error` with the thrown message; a Promise-wrapped host executor that dies with `Permission.DeclinedError` reaches the caller as a `Tool.Error` wrapping it, which the session loop still recognises as a decline. | source-verified + synthetic | `plugin/dist/promise/adapter.js` 2.2.3 `:470`, `:478` / 2.2.6 `:489`, `:497`; session loop 2.2.3 `usage-limits-y5an59n2.js:265`, 2.2.6 `persistent-pty-tz26yf19.js:283`; `test/host/guard.test.ts` |
| Aborting a native call's signal reaches the host's own executor through the plugin's guard, which ends the call at once with an interruption error. The host then sends the server one `notifications/cancelled` and keeps the HTTP request open until the server answers; nothing retries. A paid call aborted after dispatch may still have run. | synthetic | `test/host/guard.test.ts` ("cancellation through the guard"), 2.2.3 to 2.2.6 |
| `ctx.agent.transform` sees each agent's built-in rules (the base allow and the agent's own defaults), not the user's `permissions` or the agent's configured `permissions`: the host merges those after every transform, appended after the transformed rules. So they follow the plugin's block and win over it: a user deny on a read the block allows, and an agent allow on a tool the block asks for. `ctx.agent.list()` returns the merged rules, which `agentCoverage` reads. `ctx.agent.reload()` replays the transform. | synthetic | `test/host/guard.test.ts` ("the user's and the agent's configured rules"), 2.2.3 to 2.2.6 |
| `ctx.agent.transform` with `list`, `get`, `default`, `update`, `remove`. | source-verified | `plugin/dist/promise/agent.d.ts:5-15` |
| `ctx.skill.transform` with `list`, `get`, `add`, `update`, `remove`. | source-verified | `plugin/dist/promise/skill.d.ts:5-15` |
| `ctx.command.transform` with `add({ name, description?, execute })`. | source-verified | `plugin/dist/promise/command.d.ts:11-22` |
| `ctx.integration.transform` with `get`, `update(id, (integration) => …)` on `{ id, name }`; `ctx.integration.connection.active` and `.status`. | source-verified | `plugin/dist/promise/integration.d.ts:70-94` |
| `ctx.event.subscribe({ types, signal })` returns an async iterable; the four types the watcher uses exist. | source-verified | `plugin/dist/promise/event.d.ts:5`; the literal types typecheck against `@opencode/client` 2.2.3 |
| `Rpc.define(definition)` and `ctx.rpc.register(definition, handlers)`. | source-verified | `schema/dist/rpc.d.ts:49`; `plugin/dist/promise/rpc.d.ts:21` |
| Removing a plugin generation disposes everything it registered, and the plugin's cleanup runs. | synthetic | "unloading" host test |
| There is no public `ctx.mcp.callTool()`. | source-verified | `plugin/dist/promise/mcp.d.ts:12-15` exposes only `list`, `transform`, `reload` |
| `ctx.tool.list()` hands a plugin each tool's executor after every transform, so the tools RPC dispatches through the guarded native executor, which asserts `openrouter_<name>` for the call's session and agent. A throw from a plugin executor reaches the caller as a `Tool.Error` that keeps the thrown error as `error`. | source-verified | `plugin/dist/promise/adapter.js` 2.2.3 `:346` (`list`), `:470` (`toolError`) |
| The tools RPC resolves the session's agent and session rules before dispatch; an `allow` runs once, an `ask` is refused with no prompt left, a `deny` is refused, and a failed policy refuses every method as `POLICY_UNAVAILABLE` in the declared `failed` envelope, with no `tools/call` reaching the server. | synthetic | `test/host/scripts.test.ts`, 2.2.3 to 2.2.6 |
| A route the RPC contract does not declare, such as `generate-image`, is answered `rpc.method_not_found` by the host before any plugin code runs. | synthetic | `test/host/scripts.test.ts` |
| The shared tools RPC's result keeps an MCP result's structured content and its text parts, and drops every other content block (images included). | source-verified | `normalise` in `src/host/tools-rpc.ts`, the family's shared part |
| Each script method's useful result fits that result. | synthetic (`send-message`: documented) | The loopback fake answers text and structured content; OpenRouter documents `send-message`'s reply as text with a generation id. Per-method labels are the `scriptOutput` column of `src/openrouter-tools.ts` and the table in [scripting.md](scripting.md). To confirm with a signed-in capture. |
| Status reads only `ctx.mcp.list()`, `ctx.tool.list()`, `ctx.agent.list()`, `ctx.skill.list()` and the plugin's own state, and sends no `tools/call`. | synthetic | `test/host/status.test.ts`; stock `opencode serve` in `test/pack/pack.test.ts` |
| `ctx.command.transform` registers `/openrouter-status`, and `ctx.session.synthetic({ resume: false })` posts its text with no model turn. | source-verified + synthetic | `plugin/dist/promise/command.d.ts:11-22`; `test/host/status.test.ts` |
| The installed `dist/tui.js` sets up its dialog against a TUI context: a global palette entry and `/openrouter`, an `r` key enabled only while the dialog is open, event listeners only while it is open, and a cleanup that clears an open dialog. | synthetic | `test/pack/pack.test.ts`, with the host packages installed next to the tarball |
| Each stock TUI resolves a plugin's `ui.dialog.alert` promise on every path that closes it (replace, clear, Escape, Ctrl+C), so the dialog's `r` key and listeners stop when it closes. | source-verified | The stock binary of 2.2.3 to 2.2.6, matched by `test/pack/pack.test.ts` |

## MCP identity and naming

| Claim | Label | Evidence |
| --- | --- | --- |
| An MCP image content block reaches the caller as `{ type: "file", uri: "data:<mime>;base64,<data>", mime }`, after the text block, unchanged by the plugin's guard. | source-verified + synthetic | `toContent`, 2.2.3 `usage-limits-6er5y2fs.js:139-145`, 2.2.6 `persistent-pty-psrqx85q.js:146-151`; `test/host/guard.test.ts` with the fake's synthetic PNG |
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
| The host's MCP client sends each request through `globalThis.fetch`, looked up at call time, so `scripts/capture-live.ts`, running the host in its own process, can read the raw `initialize`, `tools/list` and `tools/call` responses and refuse a `tools/call` before it is sent, without reading a header or credential. | source-verified + synthetic | `core/dist/mcp/oauth.js` 2.2.3 `:134-136` (`send` through `noTimeoutFetch`), `util/dist/no-timeout-fetch.js`; `test/host/capture.test.ts` |

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
- **A declined prompt changes shape through the guard.** Without a decorator the host's executor dies with
  `Permission.DeclinedError`; through the plugin's Promise decorator it fails with a `Tool.Error` whose `error` is that
  `DeclinedError`. The session loop of every tested host checks both shapes (see the row above), so a decline still ends
  the turn as a decline. A host that dropped the second check would turn a declined prompt into a tool error; it would
  still send nothing.
- **A failed rules registration does not fail setup.** The design's rollback would remove the guard together with the
  plugin's server, and leave the tools of a user's adopted entry on the base allow. Setup keeps the guard registered and
  blocked instead, and records the failure. Recovery needs the plugin loaded again.

## Plugin policy (assumed, by design)

| Claim | Label |
| --- | --- |
| Effect, billing, visibility and script eligibility of each tool (`src/openrouter-tools.ts`). | assumed (reviewed policy, DESIGN §3 and §9) |
| `ask-changes` is the default access. | assumed (DESIGN §1) |
| The guard decorates an `openrouter_` tool in the server's namespace, and one with no namespace at all, reported as `TOOL_NAMESPACE_MISSING`: every tested host sets the namespace (synthetic row above), and a host that stopped would fail closed. | assumed (DESIGN §10) |
| The block goes into the agents while the entry is the plugin's own, adopted, or not checked yet (`pending`, the fail-safe), and never for a conflicting or disabled entry. When the source changes the plugin asks the host to rebuild the tools and agents (`ctx.tool.reload`, `ctx.agent.reload`), and the replay that finds a conflict leaves the block out. That a conflicting entry ends with no rule in any agent is synthetic (`test/host/guard.test.ts`). | assumed (DESIGN §8, §17) |
| The access matrix: reads allowed; billable inference, image generation, feedback and unreviewed tools deny / ask / allow under `read-only` / `ask-changes` / `all`. That the host then denies, asks and allows as the block says, and sends nothing on a deny or a declined prompt, is synthetic (`test/host/guard.test.ts`). | assumed (DESIGN §10) |
| Exact-string URL ownership: anything but the canonical URL is a fixable conflict. | assumed (DESIGN §8; trailing slash pending live evidence) |
| The integration watcher's startup polling (250 ms for 10 s) and resubscribe delay (5 s). | assumed (ported from the family's Notion connector) |
