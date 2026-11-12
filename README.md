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
OpenRouter tool call before anything is sent while those rules are not in place. It also ships four skills, a status
command and dialog that never call OpenRouter, and script access to the reviewed tools through a tools RPC.

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

## Skills

The package ships four skills. OpenCode lists them and a model loads one on demand; none is added to every prompt. A skill
describes how to use the tools, and OpenCode's permissions still decide whether a call runs.

| Skill | Use it for |
| --- | --- |
| `openrouter` | Finding and shortlisting models, comparing endpoints, explaining routing, usage trends, and integration questions answered from OpenRouter's current documentation. Read-only. |
| `openrouter-evaluate` | A bounded test or comparison of models on a real prompt: a plan, then serial `send-message` calls, the output, and the cost OpenRouter reports. Ori only when you ask for it. |
| `openrouter-images` | An image requested from OpenRouter, generated once through the native `generate-image` tool so the image reaches you. |
| `openrouter-troubleshoot` | Connection, sign-in, credit, generation, routing or tool failures, diagnosed with read operations. Feedback only when you ask for it. |

If you already have a skill with one of these names, yours is kept and the plugin's is not registered. A skill file that
is missing or malformed is skipped with `SKILLS_INVALID`; the server and its tools keep working.

## Status

`/openrouter-status` posts a report into the session, with no model turn. `/openrouter`, or **OpenRouter: Status** in the
command palette, opens the same report in a dialog: `r` refreshes it, Escape closes it, and it also refreshes when the
server's connection, sign-in or agents change while it is open. Scripts read the same model as JSON from the status RPC:

```sh
opencode api POST /api/rpc/openrouter.models/status -d '{"input":{}}' -H "x-opencode-directory:$PWD"
```

The report shows:

- **Connection**: `connected`, `connecting`, `sign-in required`, `failed`, `disabled`, `not configured`, `conflict`, or
  blocked because the plugin's policy is not in place, and whose `openrouter` entry it is.
- **Access** and **Default rules**: what the rules do under `access`, and whether they applied.
- **Tools**: how many tools OpenCode lists for the server, how many the plugin has reviewed, the names of up to 20 it has
  not, reviewed tools that are missing, and when the plugin last saw the catalog. A server that connected moments ago and
  is still listing its tools is told apart from one that lists none.
- **Scripts**: the number of script methods, the native-only `generate-image`, and how many methods have their output
  checked against OpenRouter's live server.
- **Skills**: loaded, missing, invalid, or shadowed by a skill of yours with the same name.
- **Agents without default rules**, with the exact block to paste, and agents whose own rule allows OpenRouter's
  changes, which is your decision and is left alone.
- **OpenCode**: the version, whether it is tested, and the supported range.
- **Problems** and one **Next step**.

Status reads only OpenCode's own lists and the plugin's memory. It never calls `ping`, reads credit, lists models or
looks up a generation, and it never shows a key, a sign-in URL, a balance or an expiry. To check OpenRouter itself, ask
for `ping` through the ordinary tool path.

## Scripts

Scripts and Jobs call 16 reviewed tools with no model through the tools RPC `openrouter.models.tools`, as a session and
the agent it names. A script gets the same decision a conversation would, with no prompt: an `allow` runs, an `ask` is
refused because no one can answer it, a `deny` is refused, and while the plugin's rules are not in place every call fails
with `POLICY_UNAVAILABLE` before anything is sent. Under the default `ask-changes`, `send-message` and `send-feedback`
need an explicit allow rule for the script's session or agent.

`generate-image` is not a script method: the RPC keeps text and structured results only, so a script would pay for an
image it never receives. Its route does not exist and sends nothing; generate images in a conversation.

The methods' output has been checked against a test server only, not yet against OpenRouter's live server. See
[docs/scripting.md](docs/scripting.md) for the methods, the envelope, the errors and how to handle a paid call whose
outcome is uncertain.

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
| `TOOL_NAMESPACE_MISSING` | OpenCode listed an `openrouter_` tool with no tool namespace; the plugin guards it as one of OpenRouter's. |
| `POLICY_UNAVAILABLE` | The default permission rules or the tool guard are not in place, the server entry is not the plugin's, or the plugin is unloading; OpenRouter's tools are refused before anything is sent. |
| `SKILLS_INVALID` | A packaged skill file is missing, unreadable or malformed; that skill is not registered. |
| `STATUS_UNAVAILABLE` | `/openrouter-status`, the `/openrouter` dialog or the status RPC could not read the plugin's status. |

## Known limits

- Not released: there is no `v0.0.0` tag yet.
- An `ask` prompt in a conversation is a per-call decision. Approving it always, or a later allow in your config,
  removes the prompt for that tool.
- The tool catalog comes from OpenRouter's public documentation. No signed-in tool list has been captured, so input
  schemas are whatever the server reports at run time.
- The plugin does not enforce a spending limit. The provider-side cap on the MCP key is OpenRouter's control.
- Script methods return text and structured results only, and their output has not been checked against OpenRouter's
  live server. `generate-image` runs only natively.

## License

[MIT](LICENSE). Not affiliated with or endorsed by OpenRouter.
