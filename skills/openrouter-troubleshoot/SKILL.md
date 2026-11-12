---
name: openrouter-troubleshoot
description: Diagnose OpenRouter MCP connection, authentication, discovery, credit, generation, routing, or tool failures using safe local diagnostics and current service information. Prepare or submit generation feedback only when the user explicitly requests that action.
---

# OpenRouter troubleshooting

Find the narrowest verified explanation for the problem and give a concrete next step. Start with read operations and avoid turning diagnostics into paid tests or account administration.

## Execution contract

- Read current host-exposed tool schemas before supplying arguments. Do not infer undocumented input fields, status meanings, or response structures.
- Native actions use names such as `openrouter_ping` and `openrouter_get-generation`; a compatible Code Mode bridge uses `tools.openrouter["ping"]` and `tools.openrouter["get-generation"]`. Raw upstream names retain hyphens. Use whichever surface the host exposes.
- Respect the default `ask-changes` policy. Existing troubleshooting authorization covers appropriate read operations; it does not automatically authorize paid inference, feedback submission, installers, credential replacement, or administrative changes.
- Never print tokens, authorization headers, OAuth codes, secrets, raw credential files, or sensitive prompt bodies into diagnostics. Use redacted status information.

## Diagnostic workflow

1. Identify the failing operation, time, observed error, and whether a generation identifier exists. Request missing identifiers only when needed. Do not ask the user to paste an API key into chat.
2. Inspect the effective server configuration and available native connection/discovery status using documented host interfaces. Confirm the intended server is `openrouter` and the official endpoint is `https://mcp.openrouter.ai/mcp`. Preserve a user's intentional supported configuration; do not silently rewrite it.
3. If connected, use `ping` to check service reachability. A successful health check does not prove that every tool or model is authorized or available.
4. For authentication failures, distinguish missing authentication from expired or revoked access when the host provides that distinction. Guide the user through OpenCode's native MCP authentication flow when required. Let OpenCode manage credentials; do not copy them, create a parallel store, invent a refresh-token flow, or repeatedly prompt after an unrelated service error.
5. After an out-of-credit or key-limit error (such as a 402), use `get-current-key` first: it reports this key's spend limit, remaining limit, reset, and usage. Then use `get-credits` for the account balance. Report the limits and usage; never repeat the key's label if it looks like a key. Clearly distinguish reported account credit from an individual key cap, a workspace budget, or remaining authorization for this test. If the call is unsupported or denied, report that fact. Do not silently fall back to the REST credits endpoint, request a management key, or expand administrative access.
6. For a known generation, use `get-generation` to inspect the metadata actually available: cost, token counts, provider, model, and timing where present. Do not assume the response includes full prompt or completion content, and do not fabricate missing values.
7. For model or routing failures, validate the identifier with `get-model` or `list-models`, then inspect `list-model-endpoints`, `list-providers`, and `get-endpoint-uptime-history` (to see which provider degraded in the failure window) as needed. For a batch or video job, read its state with `get-batch`, `list-batches`, or `get-video`. Use `search-docs` for current error, authentication, routing, and request-format guidance.
8. Distinguish transport failures, protocol failures, tool-reported errors, and model/provider failures. Preserve safe error codes and relevant retry timing. Missing metadata or a timeout is not proof that no billable execution occurred.
9. Retry a read operation only when the failure is plausibly temporary, using bounded backoff and any applicable retry guidance. Stop on authorization or exhausted-budget failures. Never automatically repeat a paid or feedback call after an uncertain outcome; check `get-generation`, `get-batch`, or `get-video` for what actually ran. Diagnostics never call `send-message`, `send-decision`, `send-batch`, `transcribe-audio`, `generate-image`, `generate-speech`, or `generate-video`.

## Feedback requires an explicit request

- Use `send-feedback` only if the user explicitly asks to submit feedback about a generation. A request to diagnose, fix, inspect, or summarize a failure does not authorize sending feedback.
- Confirm the intended generation and prepare the category and comment using the tool's current schema. Use only content the user authorized to share with OpenRouter; do not attach logs or source code implicitly.
- If the request is only to draft feedback, return the draft without submitting it. If the user already explicitly authorized submission of the concrete feedback, use that authorization and obey the host's permission decision without asking again unnecessarily.
- Report success only when the result confirms submission. On an ambiguous failure, report the unknown outcome and do not automatically resubmit.

## Deliver the diagnosis

State what was observed, the most likely explanation with uncertainty where appropriate, the evidence behind it, the one concrete next step, and what was not checked.

- Keep observation and inference apart. Quote only safe identifiers, error codes, and retry timing that a tool or the host returned; never include tokens, headers, or prompt bodies.
- Give a single next step the user can take now, such as signing in again through OpenCode, correcting a model identifier, or waiting for a stated retry time. Offer feedback only as a separate option, and only for a generation.
- Name what was not checked, such as a tool that was denied, a lookup that returned nothing, or a paid call that was deliberately not repeated, so the user knows what the diagnosis does not rule out.
