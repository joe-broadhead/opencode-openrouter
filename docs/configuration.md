# Configuration

The options and their defaults, generated from `capabilities.options`.

<!-- generated:configuration -->
| Option | Type | Default | Description |
|---|---|---|---|
| `access` | `all` \| `ask-changes` \| `read-only` | `"all"` | How much the plugin's methods may do. |
| `accounts` | object | — | One empty profile per account alias; the alias is the setting. |
| `allowUntestedHost` | boolean | `false` | Start outside the tested OpenCode range. |
<!-- /generated:configuration -->

## Examples

Two aliases, with changes asking first:

```json
{
  "access": "ask-changes",
  "accounts": { "work": {}, "personal": {} },
  "allowUntestedHost": false
}
```

- `access` is the ceiling: reads run at every level; every reviewed write or send asks before it runs at `all` and
  `ask-changes` and is off under `read-only`; the two recipe reads ask at every level.
- `accounts` is one empty profile per alias. There is no per-alias setting: the alias is the whole account, and its
  profile must stay `{}`. The alias names the OpenCode MCP server, `openrouter` for `default` and `openrouter-<alias>`
  otherwise.
- `allowUntestedHost` starts the plugin outside `>=2.4.1 <2.5.0`. Leave it `false`: the plugin refuses an untested host
  with `HOST_UNTESTED` and a next step.

## Spending

The plugin has no budget option and sets no spending cap. Seven tools bill the account's OpenRouter credit, and the
OpenRouter key's own cap is the provider-side control for the usage it covers. Even under the default `access: "all"`,
every spending or sending call asks first; `read-only` turns them off.
