# Security

## Supported versions

The plugin is checked on OpenCode 2.4.1 and supports `>=2.4.1 <2.5.0` on macOS, Linux and Windows. An older release is
refused with `HOST_UNTESTED` unless the `allowUntestedHost` option is set.

## Reporting a vulnerability

Report it privately through GitHub's security advisory form on
<https://github.com/we-the-rebel-alliance/openrouter-plugin/security/advisories/new>. Do not open a public issue. Include
the version, the OpenCode version, what happened and how to reproduce it; we answer within a week.

## What leaves the machine

- The plugin registers OpenRouter's hosted MCP server and uses OpenCode's own sign-in. The credential never passes
  through the plugin: it reads the server's status and renames its `/connect` entry, and never reads a header, token or
  key. A user's own `openrouter` server entry may carry headers; the plugin never reads them.
- Every tool call goes to `https://mcp.openrouter.ai/mcp`, the only endpoint in `src/`. The plugin has no other network
  code: status, the skills and the tests never call OpenRouter.
- Tool results are untrusted data. The plugin never follows them as instructions and never echoes a key, a sign-in URL,
  a balance or an expiry in status. Failure reasons are redacted and cut to 160 characters.
- The only files the plugin reads are its packaged `skills/` files.

## Spending

Seven reviewed tools spend the OpenRouter account's credit: `send-message`, `send-batch`, `send-decision`,
`transcribe-audio`, `generate-image`, `generate-speech` and `generate-video`. `send-feedback` sends feedback to
OpenRouter. The skills call a spending tool only on your explicit request, once. That is guidance to the model, not a
permission.

Two controls are real: the spend cap on the key OpenRouter mints at sign-in (set on its consent page), and the plugin's
`access` option. Set `"access": "ask-changes"` to be asked before every spending call, feedback and unreviewed tool, or
`"access": "read-only"` to deny them. Under both, a guard refuses every OpenRouter tool call before anything is sent
while the plugin's default rules are not in place. The plugin itself enforces no spending limit.

## Secrets

Never put an OpenRouter key in a script, a config file or an agent prompt. Sign in with `/connect` → **OpenRouter tools**,
or `opencode mcp auth openrouter`; OpenCode stores and refreshes the credential. The plugin's checks use a loopback fake
and no real credential.
