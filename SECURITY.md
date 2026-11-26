# Security

## Reporting a vulnerability

Report a vulnerability through GitHub's private vulnerability reporting on this repository. Do not open a public issue
with a credential, a token or a person's data in it.

## What this plugin holds

Nothing. OpenRouter's hosted MCP server holds the credentials, and OpenCode owns sign-in. The plugin stores no token,
reads no credential, and sends nothing to OpenRouter itself: the MCP client in OpenCode makes every tool call.

See [docs/security.md](docs/security.md) for the data flow, the spend classes and the redaction.
