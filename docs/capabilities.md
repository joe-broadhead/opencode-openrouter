# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | — |
| `mcp:get-endpoint-uptime-history` | read | optional | `get-endpoint-uptime-history` |
| `mcp:get-model` | read | optional | `get-model` |
| `mcp:get-session-cost` | read | optional | `get-session-cost` |
| `mcp:list-app-rankings` | read | optional | `list-app-rankings` |
| `mcp:list-benchmarks` | read | optional | `list-benchmarks` |
| `mcp:list-daily-model-rankings` | read | optional | `list-daily-model-rankings` |
| `mcp:list-model-endpoints` | read | optional | `list-model-endpoints` |
| `mcp:list-models` | read | optional | `list-models` |
| `mcp:list-providers` | read | optional | `list-providers` |
| `mcp:list-task-classifications` | read | optional | `list-task-classifications` |
| `mcp:ping` | read | optional | `ping` |
| `mcp:search-docs` | read | optional | `search-docs` |
| `mcp:get-batch` | read | optional | `get-batch` |
| `mcp:get-credits` | read | optional | `get-credits` |
| `mcp:get-current-key` | read | optional | `get-current-key` |
| `mcp:get-generation` | read | optional | `get-generation` |
| `mcp:get-preset` | read | optional | `get-preset` |
| `mcp:get-video` | read | optional | `get-video` |
| `mcp:list-batches` | read | optional | `list-batches` |
| `mcp:list-preset-versions` | read | optional | `list-preset-versions` |
| `mcp:list-presets` | read | optional | `list-presets` |
| `mcp:install-ori-harness` | read | optional | `install-ori-harness` |
| `mcp:spawn-ori-eval` | read | optional | `spawn-ori-eval` |
| `mcp:generate-image` | write | optional | `generate-image` |
| `mcp:generate-speech` | write | optional | `generate-speech` |
| `mcp:generate-video` | write | optional | `generate-video` |
| `mcp:transcribe-audio` | write | optional | `transcribe-audio` |
| `mcp:send-batch` | send | optional | `send-batch` |
| `mcp:send-decision` | send | optional | `send-decision` |
| `mcp:send-message` | send | optional | `send-message` |
| `mcp:send-feedback` | send | optional | `send-feedback` |
| `mcp:*` | write | optional | — |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|

### Actions

None.

### Bus events

None.
<!-- /generated:capabilities -->

## Notes

- **31 pass-through tools.** Each `mcp:<tool>` row is one tool OpenRouter's hosted server owns. The plugin registers no
  handler for them and never proxies a call: OpenCode talks to the server it signed in to, and the plugin only declares
  each tool's class and access rule. The tools take no `account`: the alias is the server, so `work` is
  `tools["openrouter-work"]["<tool>"]`. The MCP tool's own permission is `<server>_<tool>`, so a rule for `openrouter-work`
  never reaches `openrouter-personal`.
- **Reads.** Twenty-one tools read public catalog data, the account's own batches, credits, key metadata, generations,
  presets and video jobs, or the docs. `get-session-cost` reports published per-session costs in coding harnesses, not
  the account's spend.
- **Recipes ask.** `install-ori-harness` and `spawn-ori-eval` return instructions and run nothing, but their names say
  install and spawn, so both carry `effect: "ask"` and ask under every access level.
- **Writes bill.** `generate-image`, `generate-speech`, `generate-video` and `transcribe-audio` create new media or text
  and spend the account's credit. Each carries `effect: "ask"`, so it asks at `all` and `ask-changes` and is off under
  `read-only`.
- **Sends bill or reach someone.** `send-message`, `send-batch` and `send-decision` run inference on the account's credit;
  `send-feedback` sends feedback about a generation to OpenRouter's team and spends nothing. All four are class `send`, as
  contract §16 requires for a `send_*` name, and all four carry `effect: "ask"`: they ask at `all` and `ask-changes` and
  are off under `read-only`.
- **`mcp:*` is a write.** A tool OpenRouter adds later is unreviewed: class `write` with `effect: "ask"` makes it ask at
  `all` and `ask-changes` and stay off under `read-only`, so it never runs unasked. The specific rows above carry the
  reviewed classes and are emitted after the wildcard, so a known read keeps running at `read-only`.
- **No sources.** The plugin cannot read OpenRouter's tool stream as a feed with a cursor, so it declares none and adds
  no `events_list`.
- **No actions.** An action needs a preview method and a separate commit method, and OpenRouter's tools write on the
  call; `register` also refuses a handler for a pass-through MCP method. So the spend classification lives in each row's
  class and in the docs instead of an `actions[].effect`.
- **No bus events.** The plugin performs no write of its own, so it has no `changed` nudge to emit and declares `events:
  {}`.
- **`status` and `probe`.** `status` takes no account and reports the version, host and every alias. The contract
  `status` shape is closed and has no `access` field: the access level is the `access` option and the generated
  permission rules, and a missing rule shows as `unguardedAgents` and `nextStep`. `probe` answers OpenCode's own MCP
  server identity for one alias; it reads no catalog content.
