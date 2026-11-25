# Accounts

Several aliases at once, each signed in separately.

<!-- generated:accounts -->
Accounts are held by the **mcp** mechanism: the vendor's MCP server holds them.

The profile has no fields.
<!-- /generated:accounts -->

## Sign in

The mechanism is `mcp`: OpenRouter's hosted MCP server holds the credentials. OpenCode adds one server per alias, named
`openrouter` for `default` and `openrouter-work` / `openrouter-personal` for the other aliases, each pointing at
`https://mcp.openrouter.ai/mcp`. Every server has its own OAuth, so two aliases are two independent sessions. Sign in
through OpenCode's MCP sign-in, once per alias.

The plugin stores no credential and has no per-alias setting. The alias is the account.

## Picking an account

Pass `account: "<alias>"` on a method that takes one. With two aliases and no account, the call is refused with
`ACCOUNT_REQUIRED`, whose next step lists the aliases. An alias the plugin does not serve is `ACCOUNT_UNKNOWN`.

Pass-through MCP tools keep their own permission action per alias, `<server>_<tool>`: a rule for `openrouter-work` never
reaches a tool on `openrouter-personal`.

## What `probe` answers

`probe({ account })` answers OpenCode's own connection identity for the alias:

```json
{
  "account": "work",
  "owner": { "id": "mcp:openrouter-work", "label": "OpenRouter (work)", "verified": false },
  "trust": "untrusted"
}
```

The owner id is the OpenCode MCP server name, not a provider account id. The `label` is the plugin's own answer, built
from the alias: OpenCode's MCP config has no display field and its server list shows only the name. `verified` is always
`false`: the plugin does not ask OpenRouter who the account is. `probe` reads no catalog content and returns no
credential. If OpenCode lists no server for the alias, it refuses with `UNAVAILABLE` and a next step.

## Status

`status` lists every alias in the order the options name them, with `ready`, `needs_sign_in` or `error`, from what
OpenCode reports for that alias's server:

| OpenCode reports | `status` says |
|---|---|
| `connected` | `ready` |
| `needs_auth` | `needs_sign_in` |
| `failed` | `error`, with the redacted reason |
| `disabled` | `error`, "the server is disabled" |
| `pending` | `error`, "the server is still connecting" |
| no entry | `error`, "OpenCode lists no such server" |

A failure's reason is one line of at most 160 characters, with query values, bearer credentials and token-shaped words
replaced. The plugin-level state is `error` when registering the accounts or reading the agent or server list failed,
else `needs_sign_in` when an alias does, else `ready`; an alias's own `error` is reported in its entry, with its reason.
