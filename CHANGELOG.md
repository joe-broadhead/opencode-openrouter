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
