# OpenRouter for OpenCode

An unofficial OpenCode plugin for [OpenRouter's hosted MCP server](https://openrouter.ai/docs/guides/overview/mcp-server):
live models, endpoints and providers, benchmarks and rankings, OpenRouter's documentation, account credit and generation
lookups, test prompts and image generation, through OpenCode's own MCP connection and sign-in.

> **Not yet released.** This repository has no release tag yet, so nothing below can be installed from GitHub today.
> The installation steps describe the first planned release, `v0.0.0`. Until it exists, run a local checkout (see
> [CONTRIBUTING.md](CONTRIBUTING.md)).

The plugin is in early development. It registers the `openrouter` MCP server, adopts your own exact entry for it, reports
a conflicting one, and names the server's sign-in "OpenRouter tools" in `/connect`. Default permission rules, the
operational guard, skills, the status command, the status dialog and script access are not built yet: until they are, a
local checkout leaves OpenRouter's tools on OpenCode's default permissions, which may allow billable calls without asking.

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
| `access` | `all`, `ask-changes`, `read-only` | `ask-changes` | How much the default rules restrict billable inference, feedback and unknown tools. The rules themselves are not built yet. |
| `allowUntestedHost` | `true`, `false` | `false` | Start on an OpenCode version outside `>=2.2.3 <2.3.0`. |

An unknown option, or a wrong value, stops the plugin with `OPTIONS_INVALID` and the list of accepted options.

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

## Known limits

- Not released: there is no `v0.0.0` tag yet.
- No default permission rules or operational guard yet: billable tools (`send-message`, `generate-image`) and
  `send-feedback` follow OpenCode's own defaults.
- No skills, status command, status dialog or script access yet.
- The tool catalog comes from OpenRouter's public documentation. No signed-in tool list has been captured, so input
  schemas are whatever the server reports at run time.
- The plugin does not enforce a spending limit. The provider-side cap on the MCP key is OpenRouter's control.

## License

[MIT](LICENSE). Not affiliated with or endorsed by OpenRouter.
