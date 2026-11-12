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
| `pack` | `bun test ./test/pack`: builds, packs and installs the package, imports both entry points, sets up the installed TUI bundle's status dialog against a fake TUI context, checks that each stock TUI closes a plugin's alert on every path, and loads the package in stock OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6, where status and the tools RPC run against the loopback fake |
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
and script eligibility. Its 31 names, with their schemas and annotations, come from a signed-in `tools/list` capture in
`test/fixtures/live-tools.json`, which has its own provenance entry. [OpenRouter's MCP documentation](https://openrouter.ai/docs/guides/overview/mcp-server)
lists 17 of them, without schemas; `test/fixtures/documented-tools.json` records that list, labelled `documented`, and is
never relabelled as live.

### The live capture

`scripts/capture-live.ts` makes that capture. It is never part of `npm run check` or CI, because it needs a person to
sign in to OpenRouter. Run it on a machine with a desktop browser:

```sh
bun scripts/capture-live.ts --home <scratch folder>                # sign in, capture, write the fixture
bun scripts/capture-live.ts --home <scratch folder> --until-login  # stop once OpenRouter's sign-in page is open
bun scripts/capture-live.ts --home <scratch folder> --check        # capture again and report drift, write nothing
```

It builds the plugin and runs it in an embedded OpenCode host whose home, config, database and project are in the
scratch folder, and opens OpenCode's own sign-in page for the `openrouter` server in a browser profile of its own, also
in that folder. After the sign-in it records every `tools/list` page (names, description digests, input and output
schemas, annotations), the protocol, and the result shapes of the free reads in `FREE_READS` (types only, never values).
It refuses, before it is sent, every `tools/call` outside those reads, so it never calls `send-message`,
`generate-image`, `send-feedback` or `spawn-ori-eval`, and it records no key, token, account id, balance or result text.

`test/unit/live-catalog.test.ts` then reconciles the fixture with the catalog: it fails on an unknown or a missing tool,
on a fixture edited without its provenance digest, and on a script method whose label does not match the capture. A
method whose free read returned text or structured content is labelled `live-observed` in the catalog; one whose
result holds content the tools RPC drops leaves the script methods. Delete the scratch folder afterwards: it holds the
signed-in credential.

## Commits

Use `type(scope): summary`, for example `fix(mcp): treat an explicit default port as a mismatch`. Keep commits small, and
keep `npm run check` green.

## Releases

Each release is the GitHub tag `v<version>`, where `<version>` is the `version` in `package.json`, and users install from
that tag. The release is one commit on top of a `master` head that CI passed, and the tag points at it. The release
workflow makes both, in GitHub Actions: nobody builds, commits or tags a release on their own machine, and no personal
key signs it.

While changes land, their notes go under `## [Unreleased]` at the top of `CHANGELOG.md`. Each earlier GitHub release is
a `## [x.y.z] - YYYY-MM-DD` heading below it, newest first, and the npm history stays last, under
`## Earlier releases on npm`.

1. On `master`, set `version` in `package.json` to the new version, and change every install spec in the README,
   `CONTRIBUTING.md` and `docs/` to `#v<version>` (`test/docs.test.ts` fails until they match). Then run
   `node scripts/changelog.mjs release`: it turns `## [Unreleased]` into `## [<version>] - <today>`, above the earlier
   releases, and refuses a CHANGELOG it cannot shape. Run `npm run check`.
2. Push that commit to `master`, and wait for CI to pass on it.
3. Start the release with that commit's full sha:
   `gh workflow run release.yml --ref master -f sha=<full sha>`, or from Actions → release →
   Run workflow, on `master`.
4. Read the run's summary, then approve the `release` environment. The summary is on the run page, under the `stage`
   job: the tag, the parent and its CI run, the release commit and its tree, the sha256 of `SHA256SUMS` and the staged
   artifact's id, `SHA256SUMS` itself, and the notes. Open the release commit on `release/v<version>` and read them
   before approving: the approval releases exactly those bytes. Only the owner approves a release. Agents never approve
   one, never call the deployment-approval API, and never bypass a ruleset or the environment; the kit's scripts make
   only their own GitHub calls and refuse every other.
5. Check the published Release: not a draft, its notes, and every asset against `SHA256SUMS`.

Before the approval, the workflow:
- **plans:** refuses a run that is not on `master`, a sha that is not `master`'s head, a sha without a successful `ci.yml`
  push run, a version that is not `x.y.z`, a CHANGELOG whose newest release is not this version, a release that does not
  move forward from the last published Release, a leftover `release/v<version>` branch, a native run that did not build
  this sha on `master`, by hand, with success, and a missing `native_run` (or one given to a plugin that is not native);
- **builds** `dist/` with `npm ci --ignore-scripts` and `npm run build`, with a read-only token, and writes the release
  files: `dist/`, `package.json` without its lifecycle scripts, and the vetted native manifest;
- **commits** them on a temporary branch `release/v<version>` at the parent, through GitHub's API with the workflow's token,
  so GitHub signs the commit (author `github-actions[bot]`, committer GitHub). This job runs no npm. It refuses a commit
  that GitHub does not verify, or whose parent or tree is not the one the files give;
- **verifies** on a fresh runner: the commit's identity, one parent on `master`, `package.json` exactly the parent's
  without the lifecycle scripts, only regular files in the allowed paths, no `package.json` under `dist/`, and a second,
  independent build of the parent (its own job) equal to the committed `dist/` byte for byte;
- **installs** the release commit with `plugin add` on each stock OpenCode host (2.2.3 to 2.2.6);
- **packs** the commit before installing anything and keeps that tarball, then runs the pack stage against a copy;
- **stages** the Release: verifies the attested native files, writes `SHA256SUMS` and the notes (the version's CHANGELOG
  section), and shows them all in the run summary with the sha256 of `SHA256SUMS`.

A job either runs repository or dependency code (`npm ci`, the build, the pack stage, a host install) and has no write
token, or uses the API and runs only the kit's scripts on a fresh checkout, after checking that the release commit's
`scripts/` and `.github/` are the parent's. The first kind is not token-free: `actions/checkout` fetches with the job's
read-only (`contents: read`) token, and its post step and the artifact uploads run after repository code on the same
runner, so that code could reach a read-only token for this public repository and the runner's artifact token. Jobs
pass files as artifacts downloaded by the id the uploading job gave, and each is checked again on arrival.

After the approval, it downloads the staged artifact by the id the summary names, and refuses unless `SHA256SUMS` has
the sha256 the summary shows and every staged file matches it, and every native file is the one the release commit's
`manifest/native.json` pins, size and sha256, with each gzip holding the pinned executable. Then it checks everything again, creates the annotated tag
`v<version>` on the release commit (tagger `github-actions[bot]`, unsigned), checks the tag, creates the Release with the
notes, the tarball, the native files and `SHA256SUMS`, and deletes `release/v<version>`. The tag keeps the commit.

GitHub's signature and the bot identity show only that GitHub made the commit through its API for the workflow; anyone
with write access can make such a commit. What ties the release to `master` is its content: one parent CI passed, the
exact `package.json`, the allowed paths and the byte-for-byte rebuild. Never relax those because the commit is signed.

**A rejected, expired or failed run** leaves nothing behind: the `cleanup` job deletes `release/v<version>` when it points
at the parent or at that run's commit, and never touches another branch. No tag exists before the approval, so the
version is not burned: fix `master` and start again. If `cleanup` itself failed, the next run refuses until the branch
is deleted: `gh api -X DELETE repos/joe-broadhead/opencode-openrouter/git/refs/heads/release/v<version>`.

**Resume.** If the run fails after creating the tag and before the Release is complete, start it again with the same `sha`. The plan finds the kit's tag on a release commit on that sha with no published Release, and resumes:
it makes no new commit, checks and installs the tagged commit, stages the files, and after a new approval reuses the tag
and adds what the Release lacks. Delete a draft Release a failed upload left first: the publish step refuses a draft.
Any other existing tag is refused: release the next version.

The repository's tag ruleset keeps a `v*` tag from being moved or deleted. A stray `v*` tag, one that never became a
Release, does not block later releases: only published Releases count, and drafts do not. Its version cannot be
released, so release the next one. To remove the tag anyway, an admin disables the `release tags` ruleset, deletes the
tag, and restores the ruleset exactly as it was.

**Known limit: a `v*` tag pushed by hand.** No ruleset limits who creates a `v*` tag, so anyone with write access can
push one by hand, pointing at any commit. Such a tag has no published Release, the forward-only check ignores it, and
Jelly installs only a published Release whose `SHA256SUMS` it verifies. But a user who installs
`github:joe-broadhead/opencode-openrouter#v<x>` directly gets whatever that tag points at. Only the release workflow makes
release tags; never push one by hand.

The release kit is these files, the same in every plugin: `scripts/release-rules.mjs`, `scripts/release-commit.mjs`,
`scripts/release-github.mjs`, `scripts/check-release-shape.mjs`, `scripts/changelog.mjs`, `scripts/release-version.mjs`,
`scripts/release-pack.mjs`, `scripts/publish-release.mjs`, `scripts/attach-native.mjs`, `scripts/native-manifest.mjs`,
`scripts/tested-hosts.mjs`, `scripts/check-release-plugin-add.sh`, `scripts/release-kit.test.mjs` and
`.github/workflows/release.yml`. Do not re-run the older `apply-release-kit.mjs`: it writes back the kit that could
release only `v0.0.0`.
