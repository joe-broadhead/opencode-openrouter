# Contributing

Read [AGENTS.md](AGENTS.md) first: it lists the rules for this repository and the APIs that must never appear in it.
[docs/contract.md](docs/contract.md) records what each host and service fact rests on.

## Set up

You need Node.js 22.18 or later, npm, and [Bun](https://bun.sh). CI uses Node.js 24 and Bun 1.4.4, the Bun inside stock
OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6.

```sh
npm ci --ignore-scripts
```

### Run your checkout in OpenCode

```sh
npm run build
```

Then list the folder in `plugins`, as an absolute path or a path relative to the config file that contains it, and restart
OpenCode. One entry loads both the server part and the terminal UI part. Run `npm run build` again after you pull changes.

```json
{
  "plugins": ["/path/to/opencode-openrouter"]
}
```

## Check

One command runs every check, in order, and stops at the first failure:

```sh
npm run check
```

| Stage | What it does |
| --- | --- |
| `typecheck` | `tsc --noEmit` over `src/` and `test/`, strict, with unused names as errors |
| `unit` | `bun test ./test/unit`: every module in `src/`, the catalog and its fixtures, and the docs' error table |
| `build` | `node scripts/build.mjs`: deletes `dist/` and bundles `src/index.ts` and `src/tui.ts` into the self-contained `dist/index.js` and `dist/tui.js`. Fails if a bundle imports anything the host does not provide |
| `icons` | `node scripts/check-icons.mjs`, the family's icon check, copied verbatim |
| `host` | `bun test ./test/host`: the plugin and the host contract facts inside an embedded OpenCode host, once on each tested release |
| `pack` | `bun test ./test/pack`: builds, packs and installs the package, imports both entry points, and loads it in stock OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6 |
| `forbidden` | `node scripts/check-forbidden.mjs`: scans `src/`, `test/`, `scripts/` and `dist/` for forbidden APIs and machine-local paths |
| `copies` | `node scripts/check-copies.mjs`: the shared part of `src/host/tools-rpc.ts`, outside its `PLUGIN-SPECIFIC` block, still has the family's hash |
| `release-kit` | `node --test scripts/release-kit.test.mjs`: the family's release kit, copied unchanged |
| `lint:actions` | `actionlint` over the workflows, when it is on PATH; CI runs it as its own job |
| `whitelist` | Checks `package.json` against the approved package shape, and that `dist/` holds exactly `index.js` and `tui.js` |

To run some stages only, name them; they run in the order given:

```sh
node scripts/check.mjs typecheck unit
```

Shortcuts: `npm run typecheck`, `npm run build`, `npm test` (the `unit` stage), `npm run test:host`, `npm run test:pack`
and `npm run lint` (the `forbidden` stage).

The host stage starts an embedded OpenCode host in a temporary home folder, with a loopback fake of OpenRouter's MCP and
sign-in server, once for each tested release. A request to any address other than the local machine fails the test. 2.2.3
is the locked `@opencode/sdk`; the stage installs the others from npm, outside the lockfile, into a temporary folder that
it deletes afterwards. To run it on one other 2.2.x only, install that SDK in a separate folder and point `HOST_SDK_DIR`
at it:

```sh
mkdir ../sdk-2.2.99 && cd ../sdk-2.2.99 && npm init -y && npm install @opencode/sdk@2.2.99 --ignore-scripts && cd -
HOST_SDK_DIR=../sdk-2.2.99 node scripts/check.mjs host
```

Every temporary folder of the host and pack stages is a git repository under the system's temp folder, so OpenCode's
upward search for `.opencode` folders and project config stops there and never picks up your own agents or skills. Set
`TMPDIR` to put them on another disk: the SDKs and stock binaries take a few hundred megabytes each.

The pack stage needs network access to the npm registry. It checks the tarball against the `files` whitelist, that
`dist/` holds only the two bundles with no relative or dynamic import, and that they import only modules OpenCode
provides. Then it loads the installed tarball with `opencode serve` from each stock release, offline, in its own temporary
home, port and password, and checks the plugin is active, the `openrouter` server is registered, `/connect` lists it as
"OpenRouter tools" apart from the built-in OpenRouter provider, and that a copy pointed at the fake starts OpenCode's own
sign-in. To use `opencode` binaries you already have, set `OPENCODE_BIN_2_2_3` through `OPENCODE_BIN_2_2_6`.

CI (`.github/workflows/ci.yml`) runs `npm ci --ignore-scripts` and `npm run check` on Linux and macOS.

## OpenRouter's tools

`src/openrouter-tools.ts` is the one record of the tools the plugin knows, with each tool's effect, billing, visibility
and script eligibility. Its names come from [OpenRouter's MCP documentation](https://openrouter.ai/docs/guides/overview/mcp-server),
which publishes no schemas. `test/fixtures/documented-tools.json` records that list, labelled `documented`, and
`test/fixtures/provenance.json` records its digest. A signed-in `tools/list` capture, when one exists, goes in
`test/fixtures/live-tools.json` with its own provenance entry; the documented fixture is never relabelled as live.

## Commits

Use `type(scope): summary`, for example `fix(mcp): treat an explicit default port as a mismatch`. Keep commits small, and
keep `npm run check` green.

## Releases

Not set up yet. The release kit's scripts (`scripts/release-*.mjs`, `changelog.mjs`, `check-release-shape.mjs`,
`publish-release.mjs` and the native-manifest helpers) are copied from the family's kit unchanged, and their tests run in
the `release-kit` stage. The release workflow is not part of this repository yet. Releases will come from a
`v<version>` tag on `master`, with the version in `package.json`; the first planned release is `v0.0.0`.
