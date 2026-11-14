# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this package's `package.json` as JSON,
without loading the plugin, when a person reviews the exact version. Jelly's declaration contracts drop a top-level key
they don't know, and refuse an unknown key inside a tool, sign-in or `contributes` entry, so the section uses only the
keys Jelly reads: `title`, `summary`, `icon`, `tools`, `skills`, `rpc`, `views`, `signIns` and `contributes`.

Jelly names the plugin **OpenRouter** (`jelly.title`) with the one line in `jelly.summary` and the mark in `jelly.icon`
(`assets/icon.svg`, shipped in the package). The mark is OpenRouter's own published Volt-on-Ink square glyph, only
scaled, from https://openrouter.ai/brand, and `opencode.vendor.mark` is `true`. Unofficial; not affiliated with
OpenRouter. OpenRouter and its logo are trademarks of OpenRouter, Inc., used only to identify the service this plugin
connects to.

## Tools and permissions

31 tools are declared, every reviewed tool in `src/openrouter-tools.ts`, in catalog order. Each `name` is the Code Mode
path (`openrouter.send-message`) and each `permission` the host's action (`openrouter_send-message`); the hyphens stay.
Each `effect` is what the plugin's default rules decide under the default `access`, `all`: every tool is `allow`,
billable inference and feedback included. `readOnly` is the tool's class:

- the 23 reads (models, endpoints and their uptime, providers, benchmarks, rankings, harness session costs,
  documentation, `ping`, the account's credit, key, generations, batches, video jobs and presets, and the two Ori
  recipes) are `readOnly`;
- the seven billable tools (`send-message`, `send-batch`, `send-decision`, `transcribe-audio`, `generate-image`,
  `generate-speech`, `generate-video`) and `send-feedback`, which sends feedback to OpenRouter, are not `readOnly`.

Every `readOnly` is the server's own `readOnlyHint` in the committed live capture (`test/fixtures/live-tools.json`,
2026-11-12); nothing is declared stricter than the server. `install-ori-harness` and `spawn-ori-eval` are read-only
truthfully: each returns a recipe as text and runs nothing (the server marks both `readOnlyHint: true`, and OpenRouter
documents them as returning a recipe and instructions). Running the commands a recipe describes is a separate step that
the skills never take on a recipe's word.

A tool OpenRouter adds later is not declared until a new version of this plugin reviews it. The declaration carries no
billing, budget or media field: the plugin claims no spending limit, and the cap on the key OpenRouter mints at sign-in is
OpenRouter's control.

`test/unit/jelly.test.ts` keeps the list in step with the catalog, and each effect with the default rules.
`test/unit/declaration-drift.test.ts` checks the declaration against the committed capture directly: every served tool
is declared, every declared tool was served, each `readOnly` is the server's hint, and every effect is `allow`.

## Skills

Declared: `openrouter`, `openrouter-evaluate`, `openrouter-images` and `openrouter-troubleshoot`, the four the package
ships.

## Signing in

`jelly.signIns` declares one sign-in, `openrouter`, labelled "OpenRouter tools", for the MCP server `openrouter`. It names
the `server`, so it resolves the integration OpenCode makes for that MCP server, never the built-in OpenRouter model
provider, whose key OpenCode manages separately.

The sign-in mints an OpenRouter key that lasts **at most seven days** (less under an account's key-lifetime policy), with
a USD 10 default spend cap the person can edit on OpenRouter's consent page, and OpenRouter grants no refresh. Sign in
again at least once a week: when the key lapses, the server needs a sign-in again and the card shows it.

## RPC, views and settings

`jelly.rpc` and `jelly.views` are empty, and the plugin contributes no Home feed or widget: a feed would call OpenRouter
unasked. An empty `jelly.rpc` does not mean the plugin has no RPC: its status RPC `openrouter.models` and its tools RPC
`openrouter.models.tools` are OpenCode RPCs, a different surface. The one setting is `access`, with `all` the
default. It declares its three values as `choices` with Jelly's own labels: **Allowed** (`all`), **Ask before changes**
(`ask-changes`) and **Read only** (`read-only`), so Jelly draws a choice, never free text. Choices need a Jelly that
includes app#1301: an older Jelly refuses a setting that declares them. `test/unit/jelly.test.ts` checks the settings
against Jelly's setting contract, restated in `test/support/jelly-settings.ts`, and checks that the options parser takes
every declared value and refuses one outside the set.
