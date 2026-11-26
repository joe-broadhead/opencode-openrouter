# Automations

This plugin has no sources, so there is nothing to read on a timer and no cursor to store. It adds no OpenCode
automation and no schedule of its own.

An OpenCode automation can still call the MCP tools directly when a person writes one. The tools are pass-through, and a
spending or sending call asks before it runs even at `access: "all"`; never put one on a schedule without the person's
explicit agreement, and use `read-only` when an automation must not spend.

There are also no actions to confirm: every write OpenRouter offers is one of its own MCP tools, and the plugin performs
none itself.
