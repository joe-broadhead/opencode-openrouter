# Changelog

## 0.0.0 (2026-11-25)

- The plugin is rebuilt on plugin-contract v0: `Plugin.define`, `assertHost`, one `register` call and the `mcp` account
  mechanism with `work` and `personal`, each an OpenRouter MCP server of its own.
- The manifest classifies all 31 of OpenRouter's hosted MCP tools: 23 reads (two of them recipes that ask), four writes
  that bill, and four sends. `mcp:*` is a write so a tool added later asks or is denied until it is reviewed.
- `status` reports the plugin's version, the OpenCode host, the state of every alias and the agents whose rules no
  longer match; `probe` names the OpenCode MCP server an alias signs in to.
- The plugin registers its own four skills through `ctx.skill.transform`; the contract's `register` does not touch
  skills, and a missing or malformed skill refuses setup with `UNAVAILABLE`.
- `dist/index.js` is committed and rebuilt with `npm run bundle`, so a git install needs no build or prepare script.

### Removed since v0.0.7

- The per-request tool-executor wrapper (`src/guard.ts`): forbidden by the plugin standard; the contract's `access`
  rules and OpenCode's permission gate replace it.
- The tools RPC (`openrouter.models.tools/<name>`): superseded by doors 1–3; OpenRouter's tools are pass-through MCP
  tools owned by the vendor's server.
- The rich status and policy surface (`/openrouter-status`, `openrouter.models/status` with server source, guard state,
  policy installation and tool list): replaced by the closed contract `status` on the tool, Code Mode and RPC doors.
- The TUI (`./tui`, `src/tui.ts`): replaced by the contract `status`.
- Adoption and conflict handling of a user's own `openrouter` server entry: the contract's `accounts` module owns the
  `openrouter*` servers, one per alias.
- The legacy app metadata block, its settings and its cost line: replaced by `capabilities` and the docs and skills.
- Support for OpenCode before 2.4.1: the contract's host range is `>=2.4.1 <2.5.0`, tested on `2.4.1`.
