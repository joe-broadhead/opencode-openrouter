# Repository rules

This repository builds `@joe-broadhead/opencode-openrouter`, an OpenCode plugin that registers OpenRouter's hosted MCP
server and names its sign-in "OpenRouter tools". It has no tool of its own: OpenCode owns the MCP connection, OAuth,
credentials, native tool execution and permission decisions. Read [docs/contract.md](docs/contract.md) before you
change code: it labels every host and service fact the code relies on. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the
checks.

## Where things go

`src/plugin.ts` lists the setup order as numbered steps: options and host check (1), the skills (2 and 7), the cleanup
stack, state and guard (3), the server entry and the guard's tool transform (4), the default rules (5), the Code Mode
namespace (6), the status command, the status RPC and the tools RPC (7), and the `/connect` watcher (8).
`src/permissions.ts` generates the rules from `src/openrouter-tools.ts` and inserts them with `ctx.agent.transform`;
`src/guard.ts` holds the health state and the in-place executor decorator.

- **Status and TUI**: `src/status.ts` builds the one status model for `/openrouter-status`, the `/openrouter` dialog in
  `src/tui.ts` and the status RPC `openrouter.models` / `status`. It reads `PluginState` and OpenCode's own lists
  (`ctx.mcp.list()`, `ctx.tool.list()`, agents, skills), never OpenRouter. The TUI reads the status RPC only; it holds
  event listeners only while the dialog is open, and never reopens a dialog the user closed.
- **Scripts**: `src/host/tools-rpc.ts` is the family's shared adapter. Its methods are `RPC_TOOLS`; `NATIVE_ONLY`
  (`generate-image`) is never a method and is reported separately in status. The plugin registers it with
  `operationalShapers(guard.assertOperational)`, so the guard runs before every script dispatch.
- **Skills**: `skills/<name>/SKILL.md` and `src/skills.ts`: read at step 2 outside every transform, registered at step 7.
  A new skill is added to `SKILL_NAMES` and to `jelly.skills` in `package.json`. A user's skill of the same name wins and
  is reported `shadowed`; a missing or malformed file is `SKILLS_INVALID` in `PluginState`, never a setup failure.

## Rules

- **Public API only.** Use only the public `@opencode/plugin` 2.2.3 API. `opencode.host` in `package.json` and
  `SUPPORTED_HOST` in `src/constants.ts` both say exactly `>=2.2.3 <2.3.0`, never `^2.2.3`. `TESTED_HOSTS` in
  `src/constants.ts` is the one list of tested releases (2.2.3, 2.2.4, 2.2.5 and 2.2.6): the host and pack stages and CI
  run on each. Inside the range an untested release, such as 2.2.99, still starts.
- **The icon is OpenRouter's own glyph.** `assets/icon.svg` (and the two PNGs rendered from it with resvg) is OpenRouter's published Volt-on-Ink square glyph from https://openrouter.ai/brand, only scaled (its path data is pre-scaled to the 48 grid; the Ink backdrop square is the vendor's own and has no rounded corners). Do not stretch, recolour, redraw, round or combine it, and keep the README's trademark line. `opencode.vendor.mark: true` tells `scripts/check-icons.mjs` (contract revision 2) so. Revision 2 of that script is ahead of the kit's copy until the release-kit rollout; do not edit it here.
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
  Its 31 names, and each tool's class, come from the signed-in capture in `test/fixtures/live-tools.json` (descriptions,
  schemas and annotations); anything that bills or may spend is billable, and when in doubt it is.
  `test/fixtures/documented-tools.json` is labelled `documented` and never stands in for a live capture. The capture is recorded in
  `test/fixtures/provenance.json` with its host version, protocol and digest. Only `scripts/capture-live.ts` writes it, by
  hand, never from `npm run check` or CI; it calls only the free reads in `FREE_READS` (`scripts/live-catalog.ts`) and
  refuses every other `tools/call` before it is sent. A script method's `scriptOutput` becomes `live-observed` only when
  `test/unit/live-catalog.test.ts`'s reconcile says the capture confirms it.
- **The `jelly` section** of `package.json` declares every reviewed tool, the skills, the sign-in, the `access` setting,
  a one-line `summary` and the `icon`, with only the keys Jelly reads. Each tool's effect is the default rules' decision
  under `ask-changes`; `test/unit/jelly.test.ts` keeps it in step with the catalog. See [docs/jelly.md](docs/jelly.md).
- **Errors** read `CODE: What happened. Next step: What to do.`, built by `pluginError`, `errorText` or `codeText`.
  `CODES` in `src/constants.ts` is the one table, and the README's `Errors` table is checked equal to it.
- **Redaction.** Host or network text is shown only through `src/redact.ts`: one line, at most 160 characters, no
  credentials, URL queries or userinfo, controls or bidi characters.
- **Native-only tools.** A tool whose useful result is media the tools RPC drops (`rpcExclusion: "native-media-required"`)
  or that describes the signed-in key (`"key-metadata"`) is never a script method. A new media generator joins them.
- **The tools RPC.** `src/host/tools-rpc.ts` is a copy of a module several plugins share. Change only its block between
  the `PLUGIN-SPECIFIC` markers; `scripts/check-copies.mjs` (the `copies` stage) fails when the rest differs from the
  family's hash, and a change there is made in every plugin at once. `test/unit/tools-rpc.test.ts` is the family's suite,
  copied unchanged. Keep the RPC id `openrouter.models.tools` and the hyphenated method names: scripts call them by name.
  A method's output evidence is the `scriptOutput` column of the catalog; only a signed-in capture may make it
  `live-observed`, and a method whose live result is media leaves `RPC_TOOLS`. The next steps never tell a script to
  repeat `send-message` or `send-feedback` after an uncertain outcome.
- **No paid or signed-in calls from a check.** Tests use the loopback fake with synthetic names, prompts, tokens and
  accounts. Never sign in to OpenRouter or call its API from a check.
- **TypeScript.** No enums, namespaces or parameter properties. `import type` for types, `.js` in relative imports.
- **Tests.** Unit tests use narrow fakes of the public context. Host tests use the public `@opencode/sdk` with
  `OpenCode.create({ app: { version } })`, a loopback fake and the temp root from `test/host/isolate.ts`. Every temp root
  of the host and pack tests is a git repository under the system's temp folder (`os.tmpdir()`), so OpenCode's upward
  search for `.opencode` folders stops there; each stock server has its own port.
- **Text.** Docs and model-facing text describe what the code does now: no process narrative, machine-local paths,
  secrets or personal data. Never claim an unpublished tag can be installed.
- **Releases** come only from `.github/workflows/release.yml` ("Releasing" in [CONTRIBUTING.md](CONTRIBUTING.md)). A
  release-prep PR sets `version` in `package.json` and the install specs and runs `node scripts/changelog.mjs release`;
  once it is on `master` and CI passed, start the release with
  `gh workflow run release.yml --ref master -f sha=<its full sha>`. The workflow builds `dist/`, makes the release
  commit on a temporary `release/v<version>` branch, checks and stages everything, and waits for the owner to approve
  the `release` environment; only then does it create the tag `v<version>` and the GitHub Release. Never push a tag or a
  `release/*` branch, and never commit, tag or publish a release by hand. Agents never approve a release, never call the
  deployment-approval API, and never bypass a ruleset or the environment.
- **No personal email in anything we publish.** Every commit is authored and committed as
  `joe-broadhead <91376460+joe-broadhead@users.noreply.github.com>`, except the release commit and tag, which the
  release workflow makes as `github-actions[bot]`. Check `git config user.email` before committing.
- **One check command.** `npm run check` passes before every commit. Never skip, weaken or delete a test to get green.

## Forbidden in this repository

`scripts/check-forbidden.mjs` enforces this list in `src/`, `test/`, `scripts/` and `dist/`:

- internal wording: a decision attributed to the owner, the lead or a reviewer; a lane's name or identifier;
- dispatch-lease, catalog-ownership and text-only markers, and tool `options.mcp` delegation;
- `Plugin.image` and profile images; imported OAuth grants;
- the V1 plugin API: `@opencode-ai/*` packages and hooks such as `tool.execute.before`, `chat.message` or
  `permission.ask`; the deprecated `ctx.generate.text` and `experimental.policies`; importing `@opencode/ai`;
- a permission hook, except the one `permission.hook("evaluate")` in `src/host/tools-rpc.ts` (and the bundle that inlines
  it), exactly once each: it turns an `ask` on one of the tools RPC's own script calls in flight into a deny, because no
  one can answer it, and touches nothing else;
- computing the host's MCP integration hash in `src/` or `dist/`;
- references to private host source or host checkouts; machine-local home and temp paths;
- `.tsx` or `.jsx` files in `dist/`.
