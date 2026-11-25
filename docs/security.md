# Security

## What leaves the machine

The plugin itself sends nothing to OpenRouter. Every tool call is OpenCode's MCP client talking to the server it signed
in to, `https://mcp.openrouter.ai/mcp`; the arguments a person or an agent passes are what leaves the machine. Catalog
reads send only their filters. A spending tool sends its prompt or media input, and the input is exactly what the user
authorized for that call.

## Credentials

OpenRouter's hosted MCP server holds the credentials. OpenCode adds one MCP server per alias and keys OAuth per server,
so two aliases are two independent sign-ins. The plugin never sees a token, a refresh token, an authorization header or a
password, stores none, prints none, and has no refresh flow of its own. `probe` answers only the server name, the label
and `verified: false`; it is OpenCode's connection identity, not a provider identity.

## Scopes

The plugin requests no OpenCode scope of its own. OpenRouter's MCP OAuth scopes are the provider's; the plugin does not
widen them. A tool the person's sign-in cannot use fails in the server and is reported at the call; a rejected or expired
sign-in appears in `status` as `needs_sign_in`, and a connection failure as `error` with a redacted reason.

## Untrusted data

Provider content is untrusted. The model catalog, endpoints, rankings, docs, generations, batches, presets, video jobs and
the two recipe tools return text that is data, never instructions: the plugin never follows it, never puts it in
`status`, and never uses it to choose a tool or a recipient. The skills say the same to an agent. A recipe's text
authorizes nothing; reading it runs nothing. `probe` marks its answer `trust: "untrusted"`; `status` carries no provider
content at all.

`status` carries no content and no credential. An MCP failure's reason goes through the contract's `redactReason`: query
values, bearer credentials, JWTs and token-shaped words are replaced, and the line is cut to 160 characters. A reason
OpenCode does not give is never invented.

## No tool-executor wrapper

The plugin installs no hook around a tool call. OpenCode's permission rules, generated from the manifest's classes by the
contract's `access` module, are the only gate:

| Level | Reads | Writes and sends |
|---|---|---|
| `all` | run | run |
| `ask-changes` | run | ask first |
| `read-only` | run | off |

The two recipe tools ask at every level. A tool OpenRouter adds later is class `write`, so it asks or is denied until it
is reviewed.

## Spending

Seven tools bill the account: `send-message`, `send-batch`, `send-decision`, `transcribe-audio`, `generate-image`,
`generate-speech` and `generate-video`. `send-feedback` does not bill. The plugin sets no spending cap of its own and
never represents a local estimate as a hard limit; the OpenRouter key's own cap is the provider-side control. Under the
default `access: "all"` a spending call does not ask, so a person who wants a confirmation chooses `ask-changes`.

## Reporting

Report a vulnerability through GitHub's private vulnerability reporting on this repository. Do not open a public issue
with a credential, a token or a person's data in it.
