# Security

Unofficial; not affiliated with OpenRouter.

## Supported versions

OpenCode `>=2.2.3 <2.3.0`. Tested on 2.2.3, 2.2.4, 2.2.5 and 2.2.6. macOS and Linux.

## Reporting a vulnerability

Report privately through GitHub's private vulnerability reporting on
<https://github.com/joe-broadhead/opencode-openrouter>. Do not open a public issue for a security problem.

## Data handling

- **The sign-in is OpenCode's.** OpenRouter's consent page mints a dedicated key for the `openrouter` MCP server, with a
  spend cap you set there (USD 10 by default) and a lifetime of at most seven days, with no refresh. OpenCode stores it
  and sends it; the plugin never reads, stores, logs or prints it, and never computes the integration's id. It renames
  only the MCP integration OpenCode made for its server, and never reads or changes the built-in OpenRouter model
  provider's key.
- **The plugin sends nothing itself.** It contributes the server entry `{ type: "remote", url }` and no header, client
  id or scope. Every request to OpenRouter is a tool call that OpenCode's own MCP connection makes. Status reads only
  OpenCode's own lists and the plugin's memory: it never calls OpenRouter and never shows a key, a sign-in URL, a balance
  or an expiry.
- **Scripts never get a key.** The tools RPC dispatches through OpenCode's own executor as a named session's agent.
  `get-current-key`, which describes the signed-in key, is never a script method.
- **Redaction.** Text from OpenCode or the network is cut to one line, at most 160 characters, with credentials, URL
  queries and userinfo, controls and bidi characters removed, before it reaches status, the dialog, an error or the
  session.
- **Untrusted content.** Model output, documentation text and the Ori recipes that tools return are data, never
  instructions: they never authorise a command, an install or another paid call.

## Permissions

**Every tool is allowed by default.** With `access: "all"` an agent, or a script running as one, can without asking:

- **Spend your credits.** `send-message`, `send-batch`, `send-decision`, `transcribe-audio`, `generate-image`,
  `generate-speech` and `generate-video` bill the account you signed in with. A batch bills each request that
  completes, over up to 24 hours. None of them is idempotent, and a retry is a second paid call. The plugin sets no
  spending limit of its own: the bound is the cap on the key OpenRouter minted at sign-in.
- **Send feedback to OpenRouter.** `send-feedback` sends text about one of the account's own generations to
  OpenRouter's team.
- **Use a tool OpenRouter adds later.** The `openrouter_*` rule allows it, and status names it as unknown. It is never a
  script method until a release reviews it.

The skills call a billable tool only on your explicit request, once. That is guidance to the model, not a permission.

One option restricts all of it: set `"access": "ask-changes"` (reads run, every billable tool, feedback and new tool
asks) or `"access": "read-only"` (reads run, everything else is denied), or add a rule for one tool, such as
`{ "action": "openrouter_send-batch", "resource": "*", "effect": "deny" }`. Under those two values a guard also refuses
every OpenRouter call before anything is sent while the plugin's rules are not in place. A script never waits on a
prompt: an ask is refused, and a saved "Always allow" approval does not authorise a script.
