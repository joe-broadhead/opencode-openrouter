# Repository rules

This repository builds `@joe-broadhead/opencode-openrouter`, an OpenCode plugin that registers OpenRouter's hosted MCP
server and names its sign-in "OpenRouter tools". It has no tool of its own: OpenCode owns the MCP connection, OAuth,
credentials, native tool execution and permission decisions. Read [docs/contract.md](docs/contract.md) before you
change code: it labels every host and service fact the code relies on. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the
checks.

## Where things go

`src/plugin.ts` lists the setup order as numbered steps. Built now: options and host check (1), the cleanup stack,
state and guard (3), the server entry and the guard's tool transform (4), the default rules (5), the Code Mode
namespace (6) and the `/connect` watcher (8). `src/permissions.ts` generates the rules from `src/openrouter-tools.ts`
and inserts them with `ctx.agent.transform`; `src/guard.ts` holds the health state and the in-place executor decorator.
The steps marked in brackets there are not built yet, and each has one place:

- **Status, TUI and scripts**: `src/status.ts` reads `PluginState` (`server()`, `owned()`, `policy()`,
  `unguardedAgents()`, `host`, `options`), never OpenRouter. The tools RPC calls `PluginState.assertOperational()` in its
  input shaper before every dispatch. `src/tui.ts` is the entry the TUI bundle builds. `src/host/tools-rpc.ts` is the family's shared adapter;
  its methods are `RPC_TOOLS`, and `NATIVE_ONLY` is reported separately.
- **Skills**: `skills/<name>/SKILL.md` and `src/skills.ts`, loaded at step 2 outside every transform. Add `"skills"` to
  `files` in `package.json` and to `FILES` in `scripts/check.mjs` with the first skill.

## Rules

- **Public API only.** Use only the public `@opencode/plugin` 2.2.3 API. `opencode.host` in `package.json` and
  `SUPPORTED_HOST` in `src/constants.ts` both say exactly `>=2.2.3 <2.3.0`, never `^2.2.3`. `TESTED_HOSTS` in
  `src/constants.ts` is the one list of tested releases (2.2.3, 2.2.4, 2.2.5 and 2.2.6): the host and pack stages and CI
  run on each. Inside the range an untested release, such as 2.2.99, still starts.
- **Greenfield.** No legacy, migration code, compatibility shim, dual path or deprecated alias, and nothing dead.
- **No peers, no runtime dependencies, no lifecycle scripts.** `@opencode/plugin`, `@opencode/sdk` and `@opencode/client`
  are devDependencies pinned to exactly `2.2.3`. Do not add another host version to the lockfile: the host stage installs
  the other tested SDKs into a temp folder.
- **Ship prebuilt, one file per entry.** `scripts/build.mjs` bundles `src/index.ts` and `src/tui.ts` with esbuild into the
  self-contained `dist/index.js` and `dist/tui.js`: no chunks, no relative imports, and only host-provided modules
  external. `tsc` only typechecks.
- **One endpoint string.** `ENDPOINT` in `src/constants.ts` is the only place OpenRouter's MCP URL is written in `src/`;
  the pack test points the built plugin at a fake by replacing its one occurrence in `dist/index.js`.
- **The server entry.** The plugin contributes `{ type: "remote", url }` and nothing else: no client ID, redirect URI,
  scope, protocol, timeout or header. Only the tests' seam sets `oauth: false`. It adopts a user's entry only when its URL
  is exactly `ENDPOINT`, keeps an exact entry with `disabled: true` disabled, and leaves anything else untouched as a
  conflict. Of a user's entry it reads only `type`, `url`, `disabled` and whether `oauth` is `false`, never `headers`.
- **Two OpenRouter identities.** The MCP server's integration is OpenCode's, keyed by an ID OpenCode derives; the plugin
  reads that ID from the server's row in `ctx.mcp.list()` and renames only an integration whose `metadata.source` is
  `"mcp"`. It never computes the ID, and never reads or changes the built-in model provider's `openrouter`
  integration or credential.
- **Setup undoes itself.** Every registration goes on the cleanup stack in `src/plugin.ts`. A failure part-way runs the
  stack and rethrows one sanitised `SETUP_FAILED` error; the plugin's own coded errors pass through unchanged. Cleanup
  never deletes a credential, and leaves no timer or subscription behind. The one exception is the default rules: their
  failure keeps setup going with the guard registered and blocked, because a rollback would leave an adopted server's
  tools on the base allow.
- **The guard fails closed.** Health starts blocked and opens only when the rules applied and the server is owned. Every
  OpenRouter tool's executor is decorated in place, the original captured inside each pass and called once; the check is
  live. Never add a permission hook, a second prompt or a retry to it.
- **Transforms are cheap, synchronous and never throw.** No file reads, network calls, awaited work or new timers in a
  transform callback. Record failures for status instead. A replay replaces what it observed, never appends.
- **`src/openrouter-tools.ts` is the one record of OpenRouter's tools**, with no imports. Everything else derives from it.
  Its names come from OpenRouter's documentation; `test/fixtures/documented-tools.json` is labelled `documented` and
  never stands in for a live capture. A signed-in capture goes in `test/fixtures/live-tools.json`, recorded in
  `test/fixtures/provenance.json` with its host version and protocol.
- **Errors** read `CODE: What happened. Next step: What to do.`, built by `pluginError`, `errorText` or `codeText`.
  `CODES` in `src/constants.ts` is the one table, and the README's `Errors` table is checked equal to it.
- **Redaction.** Host or network text is shown only through `src/redact.ts`: one line, at most 160 characters, no
  credentials, URL queries or userinfo, controls or bidi characters.
- **No paid or signed-in calls from a check.** Tests use the loopback fake with synthetic names, prompts, tokens and
  accounts. Never sign in to OpenRouter or call its API from a check.
- **TypeScript.** No enums, namespaces or parameter properties. `import type` for types, `.js` in relative imports.
- **Tests.** Unit tests use narrow fakes of the public context. Host tests use the public `@opencode/sdk` with
  `OpenCode.create({ app: { version } })`, a loopback fake and the temp root from `test/host/isolate.ts`. Every temp root
  of the host and pack tests is a git repository under the system's temp folder (`os.tmpdir()`), so OpenCode's upward
  search for `.opencode` folders stops there; each stock server has its own port.
- **Text.** Docs and model-facing text describe what the code does now: no process narrative, machine-local paths,
  secrets or personal data. Never claim an unpublished tag can be installed.
- **No personal email in anything we publish.** Every commit and tag is authored and committed as
  `joe-broadhead <91376460+joe-broadhead@users.noreply.github.com>`. Check `git config user.email` before committing.
- **One check command.** `npm run check` passes before every commit. Never skip, weaken or delete a test to get green.

## Forbidden in this repository

`scripts/check-forbidden.mjs` enforces this list in `src/`, `test/`, `scripts/` and `dist/`:

- internal wording: a decision attributed to the owner, the lead or a reviewer; a lane's name or identifier;
- dispatch-lease, catalog-ownership and text-only markers, and tool `options.mcp` delegation;
- `Plugin.image` and profile images; imported OAuth grants;
- the V1 plugin API: `@opencode-ai/*` packages and hooks such as `tool.execute.before`, `chat.message` or
  `permission.ask`; the deprecated `ctx.generate.text` and `experimental.policies`; importing `@opencode/ai`;
- any permission hook (the family's tools RPC brings its one allowed hook with it);
- computing the host's MCP integration hash in `src/` or `dist/`;
- references to private host source or host checkouts; machine-local home and temp paths;
- `.tsx` or `.jsx` files in `dist/`.
