# OpenRouter for OpenCode

An unofficial OpenCode plugin for [OpenRouter's hosted MCP server](https://openrouter.ai/docs/guides/overview/mcp-server):
live models, endpoints and providers, benchmarks and rankings, OpenRouter's documentation, account credit and generation
lookups, test prompts and image generation, through OpenCode's own MCP connection and sign-in.

> **Not yet released.** This repository has no release tag yet, so nothing below can be installed from GitHub today.
> The installation steps describe the first planned release, `v0.0.0`. Until it exists, run a local checkout (see
> [CONTRIBUTING.md](CONTRIBUTING.md)).

The plugin is in early development. It registers the `openrouter` MCP server, adopts your own exact entry for it, reports
a conflicting one, and names the server's sign-in "OpenRouter tools" in `/connect`. It adds default permission rules to
every agent, so by default billable inference and feedback ask before they run, and a guard that refuses every
OpenRouter tool call before anything is sent while those rules are not in place. Skills, the status command, the status
dialog and script access are not built yet.

## Requirements

- OpenCode 2.2.3 to 2.2.x (`>=2.2.3 <2.3.0`). The checks run on 2.2.3, 2.2.4, 2.2.5 and 2.2.6.
- An OpenRouter account, to sign in to the MCP server.

## Installation (planned for v0.0.0)

```sh
opencode plugin add github:joe-broadhead/opencode-openrouter#v0.0.0
opencode reload
opencode mcp auth openrouter
```

Or add it to `opencode.json`:

```json
{
  "plugins": [
    {
      "package": "github:joe-broadhead/opencode-openrouter#v0.0.0",
      "options": { "access": "ask-changes", "allowUntestedHost": false }
    }
  ]
}
```

You can also sign in from `/connect` → **OpenRouter tools**, or from `/mcps` → `openrouter`.

## Two OpenRouter connections

OpenCode can hold two separate OpenRouter credentials, and this plugin uses only one of them:

- **OpenRouter tools** is the MCP server's sign-in. OpenRouter's consent page mints a dedicated key for this connection,
  with a spend cap you can edit there (USD 10 by default) and a lifetime of at most seven days. It enables this plugin's
  tools.
- **OpenRouter** is OpenCode's built-in model provider, for chatting with OpenRouter's models. OpenCode manages its key
  separately; this plugin never reads or changes it.

## Options

| Option | Values | Default | What it does |
| --- | --- | --- | --- |
| `access` | `all`, `ask-changes`, `read-only` | `ask-changes` | How much the default rules restrict billable inference, image generation, feedback and tools OpenRouter adds later. See [Permissions](#permissions). |
| `allowUntestedHost` | `true`, `false` | `false` | Start on an OpenCode version outside `>=2.2.3 <2.3.0`. |

An unknown option, or a wrong value, stops the plugin with `OPTIONS_INVALID` and the list of accepted options.

## Permissions

The plugin adds one block of rules to every agent that starts from OpenCode's base allow (`* * allow`), right after that
rule, so everything after it still wins: the agent's own stricter rules, your `permissions`, a session's rules and saved
approvals. The block is a broad `openrouter_*` rule first, which covers a tool OpenRouter adds later, then one rule per
reviewed tool:

| Tools | `read-only` | `ask-changes` (default) | `all` |
| --- | --- | --- | --- |
| Reads: models, endpoints, providers, benchmarks, rankings, docs, `get-credits`, `get-generation`, `ping`, the Ori recipes | allow | allow | allow |
| Billable inference: `send-message`, `generate-image` | deny | ask | allow |
| Feedback: `send-feedback` | deny | ask | allow |
| A tool OpenRouter adds later | deny | ask | allow |

The block is added only while `openrouter` is the plugin's own entry or your exact one, and while the plugin has not
checked the entry yet. A conflicting or disabled entry is your own server: it gets no rules, no guard and no label.

These are defaults, not an administrative policy: a later allow in your config or an approval you save changes the
result. An agent without the base allow, such as one you wrote with its own `* * deny`, is left unchanged. A custom
agent can miss the block; give it the block yourself, the same rules in the same order, before its own rules.

`generate-image` is a direct tool, outside Code Mode, so its image reaches the conversation as an image.

### The guard

Every OpenRouter tool runs behind a small check that the plugin's policy is in place: the rules applied, and the
`openrouter` entry is the plugin's own or your exact one. While it is not (the plugin is still starting, the rules could
not be applied, the entry changed, or the plugin is unloading) every OpenRouter tool call fails with
`POLICY_UNAVAILABLE` before anything is sent to OpenRouter. The check adds no prompt of its own; OpenCode's permission
decision still follows it, and the tool's result passes through unchanged.

## Your own `openrouter` server entry

- No entry: the plugin adds `{ "type": "remote", "url": "https://mcp.openrouter.ai/mcp" }` and OpenCode's own sign-in.
- An entry with exactly that URL: the plugin adopts it unchanged, with your OAuth settings or your own headers. It never
  reads your headers.
- That entry with `"disabled": true`: it stays disabled.
- An entry with any other URL (a trailing slash, a query string, user credentials, another host, port or path) or a
  local command: the plugin leaves it untouched and reports `SERVER_CONFLICT`.
- Another entry, under a different name, pointing at OpenRouter's MCP host: the plugin reports `SERVER_DUPLICATE` and
  does not take it over.

## Errors

Every error reads `CODE: What happened. Next step: What to do.`

| Code | When |
| --- | --- |
| `HOST_UNTESTED` | OpenCode is outside the supported range and `allowUntestedHost` is not set. |
| `OPTIONS_INVALID` | An option is unknown or has a wrong value. |
| `SETUP_FAILED` | A registration failed part-way through setup; everything registered before it was removed. |
| `SERVER_NOT_REGISTERED` | The `openrouter` server entry could not be read or written. |
| `SERVER_CONFLICT` | `mcp.servers.openrouter` is a local command or points at another URL; it is left untouched. |
| `SERVER_DUPLICATE` | Another server entry points at OpenRouter's MCP host under a different name. |
| `NAMESPACE_COLLISION` | Another server's tool ids would start with `openrouter_`. |
| `POLICY_UNAVAILABLE` | The default permission rules or the tool guard are not in place, the server entry is not the plugin's, or the plugin is unloading; OpenRouter's tools are refused before anything is sent. |

## Known limits

- Not released: there is no `v0.0.0` tag yet.
- No skills, status command, status dialog or script access yet, so a failed rules installation or an agent without the
  rules is not reported anywhere but in the refused calls.
- An `ask` prompt in a conversation is a per-call decision. Approving it always, or a later allow in your config,
  removes the prompt for that tool.
- The tool catalog comes from OpenRouter's public documentation. No signed-in tool list has been captured, so input
  schemas are whatever the server reports at run time.
- The plugin does not enforce a spending limit. The provider-side cap on the MCP key is OpenRouter's control.

## License

[MIT](LICENSE). Not affiliated with or endorsed by OpenRouter.
