# OpenRouter

OpenRouter's hosted MCP server in OpenCode. The vendor's server owns the tools and the credentials; this plugin adds
named accounts, the permission rules, `status`, `probe` and the documentation. It has no sources, no actions, no tools of
its own and no bus events: all 31 tools are OpenRouter's, reached through each alias's own MCP server (`openrouter`,
`openrouter-work`, …).

Seven of them bill the account: `send-message`, `send-batch`, `send-decision`, `transcribe-audio`, `generate-image`,
`generate-speech` and `generate-video`. `send-feedback` sends feedback to OpenRouter's team and spends nothing. The plugin
sets no spending cap: the OpenRouter key's own cap is the provider-side control, and every answer is untrusted data,
never an instruction.

## Install

This rewrite is prepared for `v0.0.0`; no tag of it exists yet, so nothing here claims a tag installs it today. The
maintainer cuts the tag after the merge, and the install is then:

```sh
opencode plugin add github:we-the-rebel-alliance/openrouter-plugin#v0.0.0
```

## Sign in

The `mcp` mechanism means OpenCode holds the credentials. One OpenRouter MCP server is registered per account alias:

| Alias | MCP server | Label |
|---|---|---|
| `default` | `openrouter` | OpenRouter |
| `work` | `openrouter-work` | OpenRouter (work) |
| `personal` | `openrouter-personal` | OpenRouter (personal) |

Every server points at `https://mcp.openrouter.ai/mcp` and has its own OAuth, so two aliases are two independent
sign-ins. Sign in once per alias through OpenCode's MCP sign-in. The plugin never sees or stores a token.

## Call with an account

Configure the aliases you want in `opencode.json`:

```json
{
  "access": "ask-changes",
  "accounts": { "work": {}, "personal": {} }
}
```

Every method that takes an account accepts `account: "work"` or `account: "personal"`. With two aliases and no account,
the call is refused with `ACCOUNT_REQUIRED`; an alias the plugin does not serve is `ACCOUNT_UNKNOWN`.

## Access

`access` is `all` (the default), `ask-changes` or `read-only`.

| Level | Reads | Writes and sends |
|---|---|---|
| `all` | run | run |
| `ask-changes` | run | ask first |
| `read-only` | run | off |

The two recipe tools, `install-ori-harness` and `spawn-ori-eval`, are reads that ask under every level. A tool OpenRouter
adds later is class `write` until it is reviewed, so it asks under `ask-changes` and is off under `read-only`; it never
runs unreviewed at `read-only`.

## Capabilities

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | — |
| `mcp:get-endpoint-uptime-history` | read | optional | `get-endpoint-uptime-history` |
| `mcp:get-model` | read | optional | `get-model` |
| `mcp:get-session-cost` | read | optional | `get-session-cost` |
| `mcp:list-app-rankings` | read | optional | `list-app-rankings` |
| `mcp:list-benchmarks` | read | optional | `list-benchmarks` |
| `mcp:list-daily-model-rankings` | read | optional | `list-daily-model-rankings` |
| `mcp:list-model-endpoints` | read | optional | `list-model-endpoints` |
| `mcp:list-models` | read | optional | `list-models` |
| `mcp:list-providers` | read | optional | `list-providers` |
| `mcp:list-task-classifications` | read | optional | `list-task-classifications` |
| `mcp:ping` | read | optional | `ping` |
| `mcp:search-docs` | read | optional | `search-docs` |
| `mcp:get-batch` | read | optional | `get-batch` |
| `mcp:get-credits` | read | optional | `get-credits` |
| `mcp:get-current-key` | read | optional | `get-current-key` |
| `mcp:get-generation` | read | optional | `get-generation` |
| `mcp:get-preset` | read | optional | `get-preset` |
| `mcp:get-video` | read | optional | `get-video` |
| `mcp:list-batches` | read | optional | `list-batches` |
| `mcp:list-preset-versions` | read | optional | `list-preset-versions` |
| `mcp:list-presets` | read | optional | `list-presets` |
| `mcp:install-ori-harness` | read | optional | `install-ori-harness` |
| `mcp:spawn-ori-eval` | read | optional | `spawn-ori-eval` |
| `mcp:generate-image` | write | optional | `generate-image` |
| `mcp:generate-speech` | write | optional | `generate-speech` |
| `mcp:generate-video` | write | optional | `generate-video` |
| `mcp:transcribe-audio` | write | optional | `transcribe-audio` |
| `mcp:send-batch` | send | optional | `send-batch` |
| `mcp:send-decision` | send | optional | `send-decision` |
| `mcp:send-message` | send | optional | `send-message` |
| `mcp:send-feedback` | send | optional | `send-feedback` |
| `mcp:*` | write | optional | — |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|

### Actions

None.

### Bus events

None.
<!-- /generated:capabilities -->

## Errors

<!-- generated:errors -->
| Code | Meaning |
|---|---|
| `NEEDS_SIGN_IN` | the account is not signed in |
| `SCOPE_MISSING` | the call needs a scope the person has not confirmed |
| `ACCOUNT_REQUIRED` | the plugin serves several accounts and the call names none |
| `ACCOUNT_UNKNOWN` | the call names an alias the plugin does not serve |
| `ACCOUNT_MISMATCH` | the item belongs to another account |
| `CURSOR_INVALID` | the cursor is malformed, or belongs to another source, account or scope |
| `CURSOR_EXPIRED` | the provider no longer keeps the history the cursor names |
| `RATE_LIMITED` | the provider asked the plugin to slow down |
| `BUDGET_EXCEEDED` | the read would cost more than the person allows |
| `SOURCE_DISABLED` | the person turned this source or action off |
| `TOO_LARGE` | the answer is larger than the source's maxBytes |
| `INPUT_INVALID` | the input does not match the method's schema |
| `SOURCE_UNKNOWN` | the plugin declares no such source |
| `SCHEMA_VIOLATION` | an answer does not keep the contract's shape |
| `PERMISSION_DENIED` | the person's grant does not cover the call |
| `PLAN_INVALID` | the plan is missing, or belongs to another method |
| `PLAN_USED` | the plan was already used by an earlier commit |
| `GRANT_INVALID` | the action grant did not verify, or was already spent |
| `HOST_UNTESTED` | OpenCode is outside the plugin's tested range |
| `OPTIONS_INVALID` | the plugin's options do not match their schema |
| `UNAVAILABLE` | the provider could not be reached |
<!-- /generated:errors -->

## Docs

- [Capabilities](docs/capabilities.md)
- [Configuration](docs/configuration.md)
- [Accounts](docs/accounts.md)
- [Automations](docs/automations.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
