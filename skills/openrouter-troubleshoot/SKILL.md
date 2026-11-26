---
name: openrouter-troubleshoot
description: Diagnose OpenRouter MCP connection, sign-in, credit, generation, routing or tool failures with safe local checks. Send feedback only when the user explicitly asks.
---

# OpenRouter troubleshooting

Find the narrowest verified explanation and give one concrete next step. Diagnostics use reads; never turn them into a
spending test or account administration.

## Look

1. Identify the failing operation, when it failed, what it answered, and whether a generation id exists. Do not ask for an
   API key in chat.
2. Read `tools.openrouter.status` for the plugin's version, host and every alias's state, and `tools.openrouter.probe` to
   see which OpenCode MCP server an alias signs in to. Confirm the expected alias and that the server is the vendor's.
3. If the server is connected, `ping` checks reachability. A successful ping does not prove that every tool or model is
   authorized.
4. For a sign-in failure, distinguish missing from expired or revoked access when OpenCode reports it, then guide the
   person through OpenCode's own MCP sign-in. Let OpenCode hold the credential: do not copy it, store it, or build a
   refresh flow.
5. After an out-of-credit or key-limit error, use `get-current-key` first for the key's limit, remaining limit, reset and
   usage, then `get-credits` for the account balance. Keep account credit, a key cap and a workspace budget apart. Never
   repeat a key's label if it looks like a key.
6. For a known generation, `get-generation` shows the cost, tokens, provider, model and timing it actually returns. Do not
   invent fields it omits or present a timeout as proof that nothing ran.
7. For model or routing failures, validate the id with `get-model` or `list-models`, then read `list-model-endpoints`,
   `list-providers` and `get-endpoint-uptime-history` for the failure window. For a batch or video job, read `get-batch`,
   `list-batches` or `get-video`. Use `search-docs` for current error, authentication, routing and request-format guidance.

## Retry rules

Retry a read only when the failure looks temporary, with a bounded wait. Stop on an authorization or budget failure. Never
repeat a spending or feedback call after an unclear outcome: read `get-generation`, `get-batch` or `get-video` to see what
actually ran. Diagnostics never call `send-message`, `send-decision`, `send-batch`, `transcribe-audio`, `generate-image`,
`generate-speech` or `generate-video`.

## Feedback only on request

Use `send-feedback` only when the user explicitly asks to submit feedback about a generation. Diagnosing or summarising a
failure is not permission to send it. If the user only wants a draft, return the draft and send nothing. Report success
only when the tool confirms submission; on an unclear failure, say the outcome is unknown and do not resubmit.

## Report

State what you observed, the most likely explanation with its uncertainty, the evidence, one next step the person can take
now, and what was not checked. Keep observation and inference apart. Quote only safe ids, codes and retry times; never a
token, a header or a prompt body. Offer feedback only as a separate option, and only for a generation.
