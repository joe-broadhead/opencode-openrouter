# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this package's `package.json` as JSON,
without loading the plugin, when a person reviews the exact version. Jelly's declaration contracts drop a top-level key
they don't know, and refuse an unknown key inside a tool, sign-in or `contributes` entry, so the section uses only the
keys Jelly reads: `title`, `summary`, `icon`, `tools`, `skills`, `rpc`, `views`, `signIns` and `contributes`.

Jelly names the plugin **OpenRouter** (`jelly.title`) with the one line in `jelly.summary` and the mark in `jelly.icon`
(`assets/icon.svg`, shipped in the package). The mark is this family's own neutral drawing, not OpenRouter's logo.
`opencode.vendor` names OpenRouter's domain, so a display app may show OpenRouter's official logo from OpenRouter's own
site; the package carries no vendor marks.

## Tools and permissions

31 tools are declared, every reviewed tool in `src/openrouter-tools.ts`, in catalog order. Each `name` is the Code Mode
path (`openrouter.send-message`) and each `permission` the host's action (`openrouter_send-message`); the hyphens stay.
Each `effect` is what the plugin's default rules decide under the default `access`, `ask-changes`:

- the 23 reads (models, endpoints and their uptime, providers, benchmarks, rankings, harness session costs,
  documentation, `ping`, the account's credit, key, generations, batches, video jobs and presets, and the two Ori
  recipes) are `allow` and `readOnly`;
- the seven billable tools (`send-message`, `send-batch`, `send-decision`, `transcribe-audio`, `generate-image`,
  `generate-speech`, `generate-video`) and `send-feedback`, which sends feedback to OpenRouter, are `ask` and not
  `readOnly`.

Jelly's agents have no base "allow everything" rule, so the plugin's own rules, which it puts after that rule, never
reach them: Jelly writes each declared `ask` as that tool's default. A tool OpenRouter adds later is not declared until a
new version of this plugin reviews it. The declaration carries no billing, budget or media field: the plugin claims no
spending limit, and the cap on the key OpenRouter mints at sign-in is OpenRouter's control.

`test/unit/jelly.test.ts` keeps the list in step with the catalog, and each effect with the default rules.

## Skills

Declared: `openrouter`, `openrouter-evaluate`, `openrouter-images` and `openrouter-troubleshoot`, the four the package
ships.

## Signing in

`jelly.signIns` declares one sign-in, `openrouter`, labelled "OpenRouter tools", for the MCP server `openrouter`. It names
the `server`, so it resolves the integration OpenCode makes for that MCP server, never the built-in OpenRouter model
provider, whose key OpenCode manages separately.

## RPC, views and settings

`jelly.rpc` and `jelly.views` are empty, and the plugin contributes no Home feed or widget: a feed would call OpenRouter
unasked. An empty `jelly.rpc` does not mean the plugin has no RPC: its status RPC `openrouter.models` and its tools RPC
`openrouter.models.tools` are OpenCode RPCs, a different surface. The one setting is `access`, with `ask-changes` the
default.
