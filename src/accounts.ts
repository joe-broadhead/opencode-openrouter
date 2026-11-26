/**
 * The account wiring for the `mcp` mechanism: one OpenRouter MCP server per alias, through the contract's `accounts`
 * module.
 *
 * OpenCode holds the credentials and keys OAuth per MCP server. This module only supplies the server config, named
 * `openrouter` for `default` and `openrouter-<alias>` for every other alias. There is no per-alias setting: the alias
 * is the account.
 */
import type { Plugin } from "@opencode/plugin"
import { registerAccounts, type AccountsRegistration } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { serverConfig } from "./provider/mcp.ts"

/** The context part registration needs: the two transforms a plugin's setup context has. */
export type AccountsContext = Pick<Plugin.Context, "integration" | "mcp">

/** Register one vendor MCP server per alias and return what was registered, with any problem for `status`. */
export function registerOpenRouterAccounts(context: AccountsContext, manifest: Manifest, options: Readonly<Record<string, unknown>>): Promise<AccountsRegistration> {
  return registerAccounts(context, {
    manifest,
    options,
    server: () => serverConfig(),
  })
}
