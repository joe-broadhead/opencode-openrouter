# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses semantic versioning.

## 0.0.0 (unreleased)

The first release under the new name and organization. It has no compatibility with any earlier release:
install it as a new plugin.

### Added

- The plugin package is `@we-the-rebel-alliance/openrouter-plugin` and starts at `0.0.0`.
- One explicit spend class per reviewed OpenRouter tool, in `src/openrouter-tools.ts`: `spend` bills the OpenRouter
  account, and when in doubt a tool is `spend`. The default rules, status (a `Spend` line), the skills, the docs and the
  Jelly cost line derive it from that one column, and `actionEffectOf` maps each change to the contract effect it will
  take (`spend`, or `notify` for feedback).
- Status reports the spend class of the tools that bill the account and the access mode they run under.

### Changed

- OpenCode 2.4.1 exactly: `@opencode/*` devDependencies and `effect` `4.1.0`, host range `>=2.4.1 <2.5.0`, and 2.4.1 as
  the only tested release. Older test matrices and their code paths are gone.
- `generate-image` is no longer forced out of Code Mode: it stays in the `openrouter` namespace like every other tool.
  Nothing is pinned, so no tool's signature is sent on every turn. Images still arrive through OpenCode's native tool
  result; the tools RPC still excludes the media generators.
- Status follows the current rules, tools and spend classification.

### Removed

- `docs/jelly.md` and the old host-contract matrix; [docs/scripting.md](docs/scripting.md) is the remaining guide, and
  the full docs set comes with the plugin-contract manifest.
- The retired Jobs product from the scripting guide; a script is an automation, a shell script or any OpenCode client.
- The release history before `0.0.0`. The repository keeps its history; the changelog starts here.
