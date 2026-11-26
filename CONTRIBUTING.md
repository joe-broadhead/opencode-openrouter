# Contributing

This repository is an OpenCode plugin on [plugin-contract](https://github.com/we-the-rebel-alliance/plugin-contract) v0.
The contract is [docs/contract.md](https://github.com/we-the-rebel-alliance/plugin-contract/blob/master/docs/contract.md),
the bar for every plugin repository is
[docs/plugin-standard.md](https://github.com/we-the-rebel-alliance/plugin-contract/blob/master/docs/plugin-standard.md),
and [AGENTS.md](AGENTS.md) is the working guide.

## Set up and check

You need Node 24.

```sh
npm ci --ignore-scripts
npm run check
```

`npm run check` runs the whole gate:

| Step | What it proves |
|---|---|
| `npm run lint` | `@biomejs/biome` finds no lint problem |
| `npm run typecheck` | the sources and tests typecheck under strict settings |
| `npm run bundle` | `dist/index.js` is rebuilt from `src/index.ts` with esbuild; the result is committed |
| `npm test` | the manifest, accounts, provider, probe, fixture and real-host skills, parity and MCP tests pass |
| `npm run test:pack` | the tarball's contents, and that its `./server` entry loads beside `@opencode/plugin` 2.4.1 |
| `plugin-kit check` | conformance T0 and T1, the doc file set, the forbidden patterns and no bundled kit |
| `plugin-kit docs --check` | every generated doc section matches the manifest |

CI runs the same steps in one job named `ci`. `dist/index.js` is committed: `npm run bundle` rebuilds it, and CI runs
`npm run bundle && git diff --exit-code dist/` to fail when the committed bundle is stale. To run `npm run test:pack` or
the host skills test on its own, run `npm run bundle` first, because both read `dist/`.

## The contract pin

`package.json` pins the contract to its release tag,
`github:we-the-rebel-alliance/plugin-contract#v0.0.0`, and moves the pin with the contract's release. Never copy a
contract module into this repository.

The committed `package-lock.json` records the contract's repository over `git+https`, so a fresh `npm ci` needs no SSH
key. Keep it that way; CI also rewrites an `ssh://git@github.com/` URL to HTTPS for an older lockfile.

## Pull requests

One change per pull request, based on `master`, with a conventional commit (`feat:`, `fix:`, `docs:`, `chore:`). The
pull request says what changed and why, the contract section it implements, and the exact `npm run check` result.

A new method starts in `package.json` `capabilities`, then its handler if the plugin owns it, then its tests, then
`npx plugin-kit docs`, then `npx plugin-kit check`. An OpenRouter tool is declared as an `mcp:<tool>` row and has no
handler. Every capability has tests, including its negative cases.

## Contract decisions for a pass-through plugin

OpenRouter's 31 tools are pass-through `mcp:` methods. The plugin performs no write of its own, so there is no plugin
write to emit a `changed` nudge for; `capabilities.events` is `{}` (task item 8 / standard §4.7).

A pass-through `mcp:` method has no handler — the contract's `register` refuses one — and takes no `account` input, so it
cannot be a `sources` read or an `actions` preview/commit. `capabilities.sources` and `capabilities.actions` are
therefore `[]`; spend is expressed in each billed row's class and `effect: "ask"`, plus the docs and skills.

The recorded decisions are [Lead decisions requested (4b)](https://github.com/we-the-rebel-alliance/openrouter-plugin/issues/23#issuecomment-7179966441),
[Resolutions (4b): 34 methods](https://github.com/we-the-rebel-alliance/openrouter-plugin/issues/23#issuecomment-7170504331)
and [plugin-contract#74](https://github.com/we-the-rebel-alliance/plugin-contract/issues/74).

## Fixtures

`fixtures/conformance.json` is the plugin's evidence to the conformance kit. This repository has no live OpenRouter
account on the recording machine, so `scripts/record-fixture.mjs` records the plugin's own two-alias runtime and says so
in the file. Rebuild it with `npm run fixtures` after changing the accounts, the probe answer or the package version. If a
live account is available later, record it instead:

```sh
npx plugin-kit record --account work
npx plugin-kit record --account personal
```

`npx plugin-kit record` redacts credentials, emails, phone numbers and home directories before it writes.

The plugin has no cursor-bearing read, so the fixture records no cross-account cursor case. The kit reports that as
`accounts.cursors`; it is a known contract issue, not a case to invent.

## Releases

Releases are tags, not npm packages. A release is prepared in one pull request,
`chore(release): prepare vX.Y.Z`: the version in `package.json` and `package-lock.json`, the `CHANGELOG.md` section, and
`npx plugin-kit docs` if the manifest changed. The owner pushes the tag after `master`'s CI passed; the release workflow
checks the tag, builds, and creates the GitHub release with the packed tarball, the conformance report and `SHA256SUMS`.
