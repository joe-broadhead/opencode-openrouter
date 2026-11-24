# Contributing

Thanks for helping. This repository is an unofficial OpenCode plugin for OpenRouter's hosted MCP server. Read
[AGENTS.md](AGENTS.md) before changing code: it lists the layout, the rules and the one check command.

## Setup

```sh
npm ci
npm run check
```

Node 24 and [Bun](https://bun.sh) 1.4 are needed. `npm run check` is the whole check: typecheck, unit tests, build,
icons, the host suite on OpenCode 2.4.1, pack, forbidden references, the copied-kit check, the release-kit tests, an
`actionlint` pass when it is installed, and the package whitelist.

## Checks and tests

| Stage | What it runs |
| --- | --- |
| `typecheck` | `tsc --noEmit` over `src/`, `test/` and `scripts/` |
| `unit` | `bun test ./test/unit` |
| `build` | one self-contained esbuild bundle per entry in `dist/` |
| `icons` | the family's icon contract (revision 2) |
| `host` | the plugin on the embedded `@opencode/sdk` 2.4.1 against a loopback fake |
| `pack` | builds, packs and installs the tarball, imports both entries, and loads it in stock OpenCode 2.4.1 |
| `forbidden` | the API and wording rules in [AGENTS.md](AGENTS.md) |
| `copies` | the shared files every plugin carries, byte for byte |
| `release-kit` | the release kit's own tests |
| `lint:actions` | `actionlint`, when it is on `PATH` |
| `whitelist` | the package's files, exports, dev pins and `dist/` |

`HOST_SDK_DIR=/path/to/an/sdk` points the host suite at another released SDK. `OPENCODE_BIN_2_4_1=/path/to/opencode`
skips the download in the pack stage. A check never signs in to OpenRouter or calls its API: everything is a loopback
fake with synthetic names, tokens and accounts.

## Style

- Public APIs only. TypeScript, `.js` in relative imports, `import type` for types.
- Docs and model-facing text describe what the code does now: no process narrative, machine-local paths, secrets or
  personal data. Never claim an unpublished tag can be installed.
- Keep the fixed-context budget: the Code Mode namespace line is at most 400 characters, each skill description at most
  300, nothing is pinned, and there is no per-request hook.

## Commits and pull requests

Use conventional commits (`feat:`, `fix:`, `docs:`, `chore:`). Open a pull request against `master`; the `ci` job must
pass. Never push to `master`, never push a tag or a `release/*` branch, and never change repository settings from a pull
request.

## Releasing

Releases are made only by the owner from `.github/workflows/release.yml`, after a version-preparation pull request is on
`master` and its CI passed. The workflow builds `dist/`, makes the release commit on a temporary `release/v<version>`
branch, checks and stages everything, waits for approval of the `release` environment, and only then creates the tag
`v<version>` and the GitHub Release. Agents never approve or publish a release.

## Security

Do not open a public issue for a security problem; see [SECURITY.md](SECURITY.md).
