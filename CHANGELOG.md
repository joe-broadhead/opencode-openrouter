# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses semantic versioning.

## [0.0.0] - 2026-11-12

### Added

- The `openrouter` MCP server at `https://mcp.openrouter.ai/mcp`, registered with OpenCode's own sign-in, or the
  user's exact entry adopted unchanged. A conflicting or disabled entry is left untouched.
- The server's `/connect` entry is named "OpenRouter tools", apart from the built-in OpenRouter model provider.
- The reviewed catalog of the 31 tools OpenRouter's live server lists, each classified from its live description,
  schemas and annotations: 23 reads; seven billable tools (`send-message`, `send-batch`, `send-decision`,
  `transcribe-audio`, `generate-image`, `generate-speech`, `generate-video`); and `send-feedback`.
- The `access` and `allowUntestedHost` options, with `ask-changes` the default.
- Default permission rules in every agent with OpenCode's base allow, generated from the catalog: reads allowed;
  every billable tool, feedback and any tool OpenRouter adds later denied, asked or allowed by
  `access`. Later rules still win; agents without the base allow are unchanged. A conflicting or disabled `openrouter`
  entry gets no rules.
- An operational guard on every OpenRouter tool: until the rules are applied and the server entry is the plugin's own or
  the user's exact one, and after the plugin unloads, every call fails with `POLICY_UNAVAILABLE` before anything is sent.
- `generate-image` runs as a direct tool, outside Code Mode.
- Four skills: `openrouter` (research and integration), `openrouter-evaluate` (bounded model tests, and decision tests
  and batches on explicit request), `openrouter-images` (image generation, and speech, video and transcription on
  explicit request) and `openrouter-troubleshoot` (diagnosis, with `get-current-key` after an out-of-credit error).
  Every billable tool is called only on the user's explicit request, once, and never repeated after an uncertain
  outcome without first checking `get-generation`, `get-batch` or `get-video`. They are registered from the installed
  package. A skill of the same name that you already have is kept and reported as shadowed; a missing or malformed skill
  file is recorded as `SKILLS_INVALID` and does not stop the plugin.
- One local status model, shown by `/openrouter-status` (a synthetic message, no model turn), the `/openrouter` dialog
  and its palette entry (refresh with `r`, close with Escape), and the status RPC `openrouter.models` / `status`:
  connection state, access and rules, the tool catalog with unknown and missing tools and when it was last seen, the
  script capability, skills, agents without the rules or with their own allow, and one next step. It never calls
  OpenRouter. A status that cannot be read is `STATUS_UNAVAILABLE`.
- The tools RPC `openrouter.models.tools` for scripts and Jobs, the family's shared adapter: `describe` and 27 reviewed
  methods by their exact hyphenated names, run through OpenCode's own executor as a named session's agent. Only an
  `allow` runs; an `ask` or a `deny` is refused with nothing sent, and the plugin's guard refuses every method with
  `POLICY_UNAVAILABLE` while its rules are not in place. `generate-image`, `generate-speech` and `generate-video`
  (media the RPC drops) and `get-current-key` (the signed-in key's own metadata) are native only, so their routes do not
  exist. After a paid or feedback call that may have run, the next step says to check the generation before sending it
  again. Nine read methods have their output checked against OpenRouter's live server; the rest against their declared
  output schema or the test server.
- The `jelly` declaration: all 31 reviewed tools with the default rules' effect (reads allowed and read-only; the seven
  billable tools and `send-feedback` ask), the four skills, the "OpenRouter tools" sign-in by server, and the `access`
  setting with `ask-changes` the default. No views, Jelly RPC, feeds or widgets.
- `scripts/capture-live.ts`, a read-only capture of OpenRouter's live catalog, run by hand after a sign-in, never by the
  checks: it records the tool names, description digests, schemas and annotations and the result shapes of free reads,
  and refuses every other tool call before it is sent. `test/fixtures/live-tools.json` holds the 2026-11-12 capture, and
  `test/unit/live-catalog.test.ts` fails on an unknown or missing tool, an edited fixture, a read-only hint the catalog
  contradicts, or a script method's evidence label the capture does not support.

### Changed

- The icon is OpenRouter's published Volt-on-Ink square glyph, only scaled, used under OpenRouter's brand guidelines.
  `opencode.vendor.mark` is `true`, and the README carries OpenRouter's trademark line.
- `scripts/check-icons.mjs` is the icon contract's revision 2: with `opencode.vendor.mark: true` it accepts the vendor's
  own mark in place of the family tile (any square viewBox, path numbers bounded by four times its width) and requires
  the README to say "not affiliated with" the vendor and to carry a trademark line. The sanitizer block is unchanged.
