# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses semantic versioning.

## [Unreleased]

### Added

- The `openrouter` MCP server at `https://mcp.openrouter.ai/mcp`, registered with OpenCode's own sign-in, or the
  user's exact entry adopted unchanged. A conflicting or disabled entry is left untouched.
- The server's `/connect` entry is named "OpenRouter tools", apart from the built-in OpenRouter model provider.
- The reviewed catalog of OpenRouter's 17 documented tools, with their effect, billing, visibility and script status.
- The `access` and `allowUntestedHost` options, with `ask-changes` the default.
- Default permission rules in every agent with OpenCode's base allow, generated from the catalog: reads allowed;
  billable inference, image generation, feedback and any tool OpenRouter adds later denied, asked or allowed by
  `access`. Later rules still win; agents without the base allow are unchanged. A conflicting or disabled `openrouter`
  entry gets no rules.
- An operational guard on every OpenRouter tool: until the rules are applied and the server entry is the plugin's own or
  the user's exact one, and after the plugin unloads, every call fails with `POLICY_UNAVAILABLE` before anything is sent.
- `generate-image` runs as a direct tool, outside Code Mode.
- Four skills: `openrouter` (research and integration), `openrouter-evaluate` (bounded model tests),
  `openrouter-images` (image generation) and `openrouter-troubleshoot` (diagnosis), registered from the installed
  package. A skill of the same name that you already have is kept and reported as shadowed; a missing or malformed skill
  file is recorded as `SKILLS_INVALID` and does not stop the plugin.
- One local status model, shown by `/openrouter-status` (a synthetic message, no model turn), the `/openrouter` dialog
  and its palette entry (refresh with `r`, close with Escape), and the status RPC `openrouter.models` / `status`:
  connection state, access and rules, the tool catalog with unknown and missing tools and when it was last seen, the
  script capability, skills, agents without the rules or with their own allow, and one next step. It never calls
  OpenRouter. A status that cannot be read is `STATUS_UNAVAILABLE`.
- The tools RPC `openrouter.models.tools` for scripts and Jobs, the family's shared adapter: `describe` and 16 reviewed
  methods by their exact hyphenated names, run through OpenCode's own executor as a named session's agent. Only an
  `allow` runs; an `ask` or a `deny` is refused with nothing sent, and the plugin's guard refuses every method with
  `POLICY_UNAVAILABLE` while its rules are not in place. `generate-image` is native only, so its route does not exist.
  After a paid or feedback call that may have run, the next step says to check the generation before sending it again.
  The methods' output is checked against the test server only, not yet against OpenRouter's live server.
- The `jelly` declaration: all 17 reviewed tools with the default rules' effect (reads allowed and read-only;
  `send-message`, `generate-image` and `send-feedback` ask), the four skills, the "OpenRouter tools" sign-in by server,
  and the `access` setting with `ask-changes` the default. No views, Jelly RPC, feeds or widgets.
