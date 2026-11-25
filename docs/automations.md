# Automations

This plugin has no sources, so there is nothing to read on a timer and no cursor to store. It adds no OpenCode
automation and no schedule of its own.

An OpenCode automation can still call the MCP tools directly when a person writes one. The tools are pass-through, so a
spending call is a spending call wherever it comes from: use `ask-changes` or `read-only` when an automation must not
spend, and never put a spending tool on a schedule without the person's explicit agreement.

There are also no actions to confirm: every write OpenRouter offers is one of its own MCP tools, and the plugin performs
none itself.
