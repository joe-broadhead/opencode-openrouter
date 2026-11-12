# OpenRouter for OpenCode

An unofficial OpenCode plugin for [OpenRouter's hosted MCP server](https://openrouter.ai/docs/guides/overview/mcp-server):
live models, endpoints and providers, benchmarks and rankings, OpenRouter's documentation, account credit, generation,
batch and preset lookups, test prompts, decisions and batches, transcription, and image, speech and video generation,
through OpenCode's own MCP connection and sign-in.

Unofficial; not affiliated with OpenRouter. OpenRouter and its logo are trademarks of OpenRouter, Inc., used here only to identify the service this plugin connects to. The icon is OpenRouter's published Volt-on-Ink square glyph, only scaled, from [openrouter.ai/brand](https://openrouter.ai/brand).

The plugin is in early development. It registers the `openrouter` MCP server, adopts your own exact entry for it, reports
a conflicting one, and names the server's sign-in "OpenRouter tools" in `/connect`. It adds default permission rules to
every agent, so by default every billable tool and feedback asks before it runs, and a guard that refuses every
OpenRouter tool call before anything is sent while those rules are not in place. It also ships four skills, a status
command and dialog that never call OpenRouter, and script access to the reviewed tools through a tools RPC.

## Requirements

- OpenCode 2.2.3 to 2.2.x (`>=2.2.3 <2.3.0`). The checks run on 2.2.3, 2.2.4, 2.2.5 and 2.2.6.
- An OpenRouter account, to sign in to the MCP server.

## Install

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

The install takes the GitHub release tag. Its commit carries the built `dist/`, so the install runs no build. A new
release is a new tag: install it with its own `#v<version>` spec.

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
| Reads: models, endpoints and their uptime, providers, benchmarks, rankings, harness session costs, docs, `ping`; your credit, key, generations, batches, video jobs and presets; the Ori recipes | allow | allow | allow |
| Billable: `send-message`, `send-batch`, `send-decision`, `transcribe-audio`, `generate-image`, `generate-speech`, `generate-video` | deny | ask | allow |
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
| `openrouter` | Finding and shortlisting models, comparing endpoints and their uptime, explaining routing, usage trends, harness session costs, your saved presets, and integration questions answered from OpenRouter's current documentation. Read-only. |
| `openrouter-evaluate` | A bounded test or comparison of models on a real prompt: a plan, then serial `send-message` calls, the output, and the cost OpenRouter reports. Decision tests (`send-decision`), batches (`send-batch`) and Ori only when you ask for them. |
| `openrouter-images` | An image requested from OpenRouter, generated once through the native `generate-image` tool so the image reaches you; also speech, video and transcription when you ask for them, each called once, a video job followed with `get-video`. |
| `openrouter-troubleshoot` | Connection, sign-in, credit, key-limit, generation, batch, video-job, routing or tool failures, diagnosed with read operations (`get-current-key` after an out-of-credit error). Feedback only when you ask for it. |

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
- **Scripts**: the number of script methods, the native-only tools, and how many methods have their output
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

Scripts and Jobs call 27 reviewed tools with no model through the tools RPC `openrouter.models.tools`, as a session and
the agent it names. A script gets the same decision a conversation would, with no prompt: an `allow` runs, an `ask` is
refused because no one can answer it, a `deny` is refused, and while the plugin's rules are not in place every call fails
with `POLICY_UNAVAILABLE` before anything is sent. Under the default `ask-changes`, the billable `send-message`,
`send-batch`, `send-decision` and `transcribe-audio`, and `send-feedback`, need an explicit allow rule for the script's
session or agent.

Four tools are not script methods, and their routes do not exist: `generate-image`, `generate-speech` and
`generate-video`, because the RPC keeps text and structured results only and a script would pay for media it never
receives, and `get-current-key`, which describes the signed-in key itself. Use them in a conversation.

Nine read methods have their output checked against OpenRouter's live server; the rest against their declared output
schema or a test server. See [docs/scripting.md](docs/scripting.md) for the methods, the envelope, the errors and how to
handle a paid call whose outcome is uncertain.

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

- **What was checked live.** One signed-in, read-only capture of OpenRouter's server (2026-11-12) observed the 31 tool
  names, their input and output schemas and annotations, and the result shapes of nine free reads: `list-models`,
  `list-providers`, `list-benchmarks`, `list-daily-model-rankings`, `list-app-rankings`, `list-task-classifications`,
  `search-docs`, `ping` and `get-credits`. No other tool was called live, `get-model` and `list-model-endpoints`
  included; their output is known from declared schemas or a local test server. OpenRouter may change its tools at any
  time.
- **Which tools bill.** OpenRouter's documentation states it for every tool except `transcribe-audio`, which the plugin
  treats as billable anyway, and the nine reads added after the documentation page (`get-batch`, `list-batches`,
  `get-video`, `get-preset`, `list-presets`, `list-preset-versions`, `get-current-key`, `get-endpoint-uptime-history`,
  `get-session-cost`), which it treats as free. Those judgements are assumed from tool descriptions the capture did not
  store.
- **Paid and feedback tools were never run by this project.** `send-message`, `send-batch`, `send-decision`,
  `transcribe-audio`, `generate-image`, `generate-speech`, `generate-video` and `send-feedback` were never called
  against OpenRouter, so how their media reaches you (a video above all) has not been checked live.
- **Your key, your cap.** You sign in with your own OpenRouter account; the key it mints is yours, with the spend limit
  you set on OpenRouter's consent page. The plugin enforces no spending limit of its own.
- An `ask` prompt in a conversation is a per-call decision. Approving it always, or a later allow in your config,
  removes the prompt for that tool.
- Script methods return text and structured results only. `generate-image`, `generate-speech`, `generate-video` and
  `get-current-key` run only natively.

## License

[MIT](LICENSE). Not affiliated with or endorsed by OpenRouter. OpenRouter is a trademark of OpenRouter, Inc.
