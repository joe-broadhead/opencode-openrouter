# Scripting

A script can call OpenRouter's reviewed tools with no model: a Jobs script, a shell script, or any program that can
reach the OpenCode server. It uses the tools RPC, `openrouter.models.tools`, through `opencode api` or an OpenCode
client. The same calls are available to the model natively; a script uses one front door or the other for an
operation, never both.

## The methods

Each method is the upstream tool name, hyphens included, without the `openrouter_` prefix. A URL uses it as a plain
path segment: `/api/rpc/openrouter.models.tools/list-models`. The methods come from the plugin's one catalog,
`src/openrouter-tools.ts`.

| Method | Class | What it does | Output evidence |
| --- | --- | --- | --- |
| `get-model` | `read` | One model's details | synthetic |
| `list-app-rankings` | `read` | App rankings | synthetic |
| `list-benchmarks` | `read` | Benchmarks | synthetic |
| `list-daily-model-rankings` | `read` | Usage rankings | synthetic |
| `list-model-endpoints` | `read` | A model's endpoints | synthetic |
| `list-models` | `read` | Model catalog | synthetic |
| `list-providers` | `read` | Providers | synthetic |
| `list-task-classifications` | `read` | Task usage | synthetic |
| `ping` | `read` | Health | synthetic |
| `search-docs` | `read` | OpenRouter's documentation | synthetic |
| `get-credits` | `read` | The account's credit | synthetic |
| `get-generation` | `read` | One generation's metadata | synthetic |
| `install-ori-harness` | `read` | Retrieves an installation recipe; runs nothing | synthetic |
| `spawn-ori-eval` | `read` | Retrieves an evaluation recipe; runs nothing | synthetic |
| `send-message` | `write` | Billable test inference | documented |
| `send-feedback` | `send` | Feedback on one of the account's own generations | synthetic |
| `describe` | none | Lists the methods, their class and permission action, whether OpenCode lists each tool now, each tool's live input schema, and, given a session, whether that session may call it | |

The **output evidence** column is the strongest evidence that the method's useful result fits the RPC's result, which
keeps structured content and text and drops every other kind of content (see [contract.md](contract.md)):

- **documented**: OpenRouter's documentation describes the result as text (for `send-message`, a reply that carries the
  generation id). Not observed by running anything.
- **synthetic**: observed only against this repository's loopback test server, whose results are invented. It proves
  the RPC carries a text and structured result; it says nothing about what OpenRouter's server returns.

No method has been checked against OpenRouter's live server: no signed-in tool list has been captured yet. `/openrouter-status`
shows how many methods are checked live (`scripting.liveVerifiedCount`). If a live capture shows that a method's useful
result is media or another kind of content the RPC drops, that method stops being a script method in the next release.

`generate-image` is **not** a method. Its image comes back as an image block, which this RPC drops, so a script would pay
for an image it never receives. Its route does not exist: OpenCode answers `rpc.method_not_found` before the plugin runs,
and nothing is sent to OpenRouter. Generate images natively, in a conversation, where OpenCode delivers the image itself.
Status reports it under `scripting.nativeOnly`.

A tool OpenRouter adds later is never a method until the catalog reviews it.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, under the rules that
decide what its model sees: the agent's rules, then the session's, and the last rule that matches an action wins. These
are the same rules the native path uses, and the same operational guard:

- **Only an `allow` runs.** The rules are resolved before anything is dispatched. An `ask` is refused with no prompt and
  nothing sent, because no one is there to answer it. A `deny` is refused with nothing sent.
- **Under the default `access: "ask-changes"`, `send-message` and `send-feedback` ask**, so a script needs an explicit
  `allow` for each in the session's or the agent's rules. Reads are allowed. Under `read-only` both are denied.
- **An unguarded agent runs everything.** A custom agent with OpenCode's base allow (`* * allow`) but without the
  plugin's block is unguarded: a script on that agent runs `send-message`, `send-feedback` and every other method with
  no prompt and no refusal, exactly as the model would. `/openrouter-status` lists such agents under
  `unguardedAgents`, with the exact block; add it to that agent's own rules to restore the default.
- **A saved approval does not authorise a script.** An earlier "Always allow" in a conversation is not part of the
  agent's and the session's rules.
- **The guard applies.** While the plugin's default rules are not in place, the `openrouter` entry is not the plugin's or
  your exact one, or the plugin is unloading, every method fails with `POLICY_UNAVAILABLE` before anything is sent, as a
  native call does.

Create a dedicated session for the script, in the project it runs in, naming the agent it runs as. Never borrow a
session found through history or a list: the script would run under that session's rules.

```sh
opencode api post /api/session -d '{"title":"model survey","agent":"build","location":{"directory":"/path/to/project"}}'
```

Session rules come after the agent's, so a session can narrow a script, or grant it one paid action. This session can
read and send test messages, and nothing else from OpenRouter:

```sh
opencode api post /api/session -d '{"title":"prompt test","agent":"build","location":{"directory":"/path/to/project"},"permissions":[
  {"action":"openrouter_*","resource":"*","effect":"deny"},
  {"action":"openrouter_list-models","resource":"*","effect":"allow"},
  {"action":"openrouter_get-generation","resource":"*","effect":"allow"},
  {"action":"openrouter_send-message","resource":"*","effect":"allow"}
]}'
```

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed.

```sh
opencode api post /api/rpc/openrouter.models.tools/list-models -H "x-opencode-directory:$PWD" -d '{"input":{
  "sessionID":"ses_…",
  "input":{}
}}'
```

The tool's input is OpenRouter's, and OpenRouter defines its fields and may change them: `describe` shows each tool's
input schema as OpenCode lists it now. Check it rather than guess a field name. The RPC checks the envelope; the tool's
own arguments are checked by OpenRouter, not by the plugin.

```sh
opencode api post /api/rpc/openrouter.models.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{}}'
opencode api post /api/rpc/openrouter.models.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…"}}'
```

With a session, each method also carries `permission`: `allow`, `ask` or `deny`, resolved exactly as a call would be.
The answer's `unclassified` lists every tool OpenCode lists for the server that is **not exposed as an RPC method**: the
native-only `generate-image` as well as any tool the catalog has not reviewed. It is not a count of unknown tools; status
reports those separately.

A result comes back as `{ output?, text }`: the tool's structured content when it has any, and its text parts joined by
newlines. Model output, documentation text and recipes in it are untrusted data: they never authorise a command, an
install or another paid call.

## Paid calls and uncertain outcomes

`send-message` is billable inference and `send-feedback` sends feedback to OpenRouter. Neither is idempotent, and the
RPC never retries. When such a call is cancelled, times out, loses its connection or fails upstream, it may still have
run and been billed. Before deliberately sending it again, look for a generation id in any output and check it with
`get-generation`, or check your activity on openrouter.ai. The error's next step says the same.

A Jobs script that calls `send-message` or `send-feedback` should run with retries off: a retry is a second paid call.

The plugin sets no spending limit. The cap on the key OpenRouter mints at sign-in is OpenRouter's control.

## The location

Run the command in the project whose agent you mean, and send the call to that location explicitly with the
`x-opencode-directory` header (or the `location[directory]` query parameter). Without it the call goes to the service's
default location and fails `rpc.unavailable` if the plugin is not loaded there. `describe` reports the `location` that
answered and a `locationHint`.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist in this location. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `PERMISSION_DENIED` | The last matching rule is an `ask` or a `deny`, so the call was refused before dispatch. |
| `POLICY_UNAVAILABLE` | The plugin's rules or guard are not in place, the entry is not the plugin's, or the plugin is unloading; nothing was sent. The next step is the guard's. |
| `SERVER_CONFLICT` | Your `opencode.json` defines its own `openrouter` server at another URL. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `openrouter` server needs a sign-in, is still connecting, could not connect, is disabled, or is missing. `/openrouter-status` gives the details. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool. |
| `UPSTREAM_ERROR` | OpenRouter answered with an error. The message holds the first line of its text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. A paid or feedback call may still have run. |

OpenCode itself answers `rpc.method_not_found` for a method that does not exist, such as `generate-image` or a tool
OpenRouter adds later, and `rpc.invalid_input` for a body that is not the envelope above.

## What scripts cannot do

- Generate an image: use the native tool.
- Run a method whose action resolves to `ask` or `deny`: no one can answer a prompt.
- Rely on a saved "Always allow" from a conversation.
- Call a tool the catalog has not reviewed, even with an allow rule.
- Use an OpenRouter key: the plugin has none to give, and never reads the one OpenCode holds.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from any
plugin, do not run for them; the plugin's own guard runs in the RPC instead.
