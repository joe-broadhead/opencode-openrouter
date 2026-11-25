# Changelog

## 0.0.0 (unreleased)

- The plugin is rebuilt on plugin-contract v0: `Plugin.define`, `assertHost`, one `register` call and the `mcp` account
  mechanism with `work` and `personal`, each an OpenRouter MCP server of its own.
- The manifest classifies all 31 of OpenRouter's hosted MCP tools: 23 reads (two of them recipes that ask), four writes
  that bill, and four sends. `mcp:*` is a write so a tool added later asks or is denied until it is reviewed.
- `status` reports the plugin's version, the OpenCode host, the state of every alias and the agents whose rules no
  longer match; `probe` names the OpenCode MCP server an alias signs in to.
