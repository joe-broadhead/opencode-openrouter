// src/tui.ts
import { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";

// src/constants.ts
var PLUGIN_ID = "openrouter.models";
var SERVER_NAME = "openrouter";
var SUPPORTED_HOST = ">=2.2.3 <2.3.0";
var TESTED_HOSTS = ["2.2.3", "2.2.4", "2.2.5", "2.2.6"];
var errorText = (code, message, nextStep) => `${code}: ${message} Next step: ${nextStep}`;

// src/redact.ts
var SECRETS = [
  [/\b(bearer|basic|token)\s+[\w.~+/=-]{8,}/gi, "$1 [redacted]"],
  [/\b([\w-]*(?:api[_-]?key|access[_-]?key|private[_-]?key|token|secret|password|signature|credential)["']?\s*[:=]\s*)["']?[^\s"'&,;]+["']?/gi, "$1[redacted]"],
  [/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g, "[redacted]"],
  [/\b(?:tvly|sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abposr]|lin_api|lin_oauth)[-_][\w-]{8,}/gi, "[redacted]"],
  [/[\w+=-]{40,}/g, "[redacted]"]
];
var REASON_LIMIT = 160;
var CONTROLS = /[\u0000-\u001f\u007f-\u009f]+/g;
var BIDI = /[‎‏‪-‮⁦-⁩]/g;
var withoutUrlSecrets = (text) => text.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => url.replace(/^(https?:\/\/)[^/?#@]*@/i, "$1").replace(/[?#].*$/s, ""));
var oneLine = (text) => text.replace(BIDI, "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
function cut(text, limit) {
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}\u2026` : text;
}
function shortReason(text) {
  const reason = oneLine(SECRETS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), withoutUrlSecrets(text))).replace(/[.\s]+$/, "");
  if (reason === "") return void 0;
  return cut(reason, REASON_LIMIT);
}

// src/host-version.ts
var RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;
var parse = (version) => RELEASE.exec(version)?.slice(1).map(Number);
var [LOWEST, ABOVE] = SUPPORTED_HOST.split(" ").map((bound) => parse(bound.replace(/^[<>]=?/, "")));
var compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function isSupportedHost(version) {
  const parts = parse(version);
  return parts !== void 0 && compare(parts, LOWEST) >= 0 && compare(parts, ABOVE) < 0;
}

// src/openrouter-tools.ts
var MCP_DOCS = "https://openrouter.ai/docs/guides/overview/mcp-server";
var docs = (source) => ({ level: "documented", source });
var ON_MCP_PAGE = docs(MCP_DOCS);
var UNSTATED_FREE = {
  level: "assumed",
  source: "Marked read-only by the live server; no OpenRouter page states that it is free. Its description, read at the 2026-11-12 capture but stored only as a digest, mentioned no charge."
};
var read = (name, visibility, scriptOutput, billingEvidence = ON_MCP_PAGE) => ({
  name,
  effect: "read",
  billable: false,
  visibility,
  rpc: true,
  scriptOutput,
  effectEvidence: "live-observed",
  billingEvidence
});
var paid = (name, scriptOutput, billingEvidence) => ({
  name,
  effect: "write",
  billable: true,
  visibility: "execution",
  rpc: true,
  scriptOutput,
  effectEvidence: "live-observed",
  billingEvidence
});
var media = (name, billingEvidence) => ({
  name,
  effect: "write",
  billable: true,
  visibility: "execution",
  rpc: false,
  rpcExclusion: "native-media-required",
  effectEvidence: "live-observed",
  billingEvidence
});
var REVIEWED_TOOLS = [
  read("get-endpoint-uptime-history", "public-data", "synthetic", UNSTATED_FREE),
  read("get-model", "public-data", "synthetic"),
  // Weekly cost-per-session statistics of published coding harnesses: aggregate public data, not the account's spend.
  read("get-session-cost", "public-data", "synthetic", UNSTATED_FREE),
  read("list-app-rankings", "public-data", "live-observed"),
  read("list-benchmarks", "public-data", "live-observed"),
  read("list-daily-model-rankings", "public-data", "live-observed"),
  read("list-model-endpoints", "public-data", "synthetic"),
  read("list-models", "public-data", "live-observed"),
  read("list-providers", "public-data", "live-observed"),
  read("list-task-classifications", "public-data", "live-observed"),
  read("ping", "public-data", "live-observed"),
  read("search-docs", "public-data", "live-observed"),
  read("get-batch", "account-data", "documented", UNSTATED_FREE),
  read("get-credits", "account-data", "live-observed"),
  // The signed-in key's label, spend limit, remaining limit and usage: native only, so a script never receives it.
  { name: "get-current-key", effect: "read", billable: false, visibility: "account-data", rpc: false, rpcExclusion: "key-metadata", effectEvidence: "live-observed", billingEvidence: UNSTATED_FREE },
  read("get-generation", "account-data", "documented"),
  read("get-preset", "account-data", "synthetic", UNSTATED_FREE),
  // A video job's status, cost and output links; it starts nothing. The links are in its structured result.
  read("get-video", "account-data", "documented", UNSTATED_FREE),
  read("list-batches", "account-data", "documented", UNSTATED_FREE),
  read("list-preset-versions", "account-data", "synthetic", UNSTATED_FREE),
  read("list-presets", "account-data", "synthetic", UNSTATED_FREE),
  // Recipe retrieval: the returned text describes later installer or evaluation commands; retrieving it runs nothing.
  read("install-ori-harness", "recipe", "synthetic"),
  read("spawn-ori-eval", "recipe", "synthetic"),
  // Billable inference whose result is media: an image block, an audio block, or a finished video. A script would pay
  // for a result its RPC drops, so they run only natively.
  media("generate-image", ON_MCP_PAGE),
  media("generate-speech", docs("https://openrouter.ai/docs/cookbook/audio/two-voice-podcast")),
  media("generate-video", docs("https://openrouter.ai/docs/cookbook/video-generation/text-to-video")),
  // Billable inference whose result is text or structured content.
  paid("send-batch", "documented", docs("https://openrouter.ai/docs/batch-quickstart")),
  paid("send-decision", "documented", docs("https://openrouter.ai/docs/cookbook/evaluate-and-optimize/jev-classification")),
  // OpenRouter documents send-message's reply as text with the generation id.
  paid("send-message", "documented", ON_MCP_PAGE),
  paid("transcribe-audio", "documented", { level: "assumed", source: "Billable by the rule that a tool which may spend is billable. Its live description, stored only as a digest, said it bills the user; no OpenRouter page found states it." }),
  // Feedback on one of the account's own generations, sent to OpenRouter's team.
  { name: "send-feedback", effect: "send", billable: false, visibility: "execution", rpc: true, scriptOutput: "synthetic", effectEvidence: "live-observed", billingEvidence: ON_MCP_PAGE }
];
var TOOL_NAMES = REVIEWED_TOOLS.map((tool) => tool.name);
var READ_TOOLS = REVIEWED_TOOLS.filter((tool) => tool.effect === "read").map((tool) => tool.name);
var CHANGE_TOOLS = REVIEWED_TOOLS.filter((tool) => tool.effect !== "read").map((tool) => tool.name);
var BILLABLE_TOOLS = REVIEWED_TOOLS.filter((tool) => tool.billable).map((tool) => tool.name);
var RPC_TOOLS = REVIEWED_TOOLS.filter((tool) => tool.rpc).map((tool) => tool.name);
var NATIVE_ONLY = REVIEWED_TOOLS.filter((tool) => !tool.rpc).map((tool) => tool.name);
var LIVE_VERIFIED_SCRIPT_METHODS = REVIEWED_TOOLS.filter((tool) => tool.rpc && tool.scriptOutput === "live-observed").map((tool) => tool.name);
var reviewedTool = (name) => REVIEWED_TOOLS.find((tool) => tool.name === name);

// src/options.ts
var ACCESS = ["all", "ask-changes", "read-only"];
var DEFAULT_ACCESS = "ask-changes";
var ACCEPTED = {
  access: `${ACCESS.map((value) => `"${value}"`).join(", ")}, with "${DEFAULT_ACCESS}" the default`,
  allowUntestedHost: "true or false (the default)"
};

// src/mcp.ts
var namespaceOf = (name) => name.replace(/[^a-zA-Z0-9_-]/g, "_");
var nativeToolId = (name) => `${namespaceOf(SERVER_NAME)}_${namespaceOf(name)}`;

// src/permissions.ts
var BASELINE_ACTION = `${SERVER_NAME}_*`;
var changeEffect = (access) => access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny";
var effectOf = (tool, access) => tool.effect === "read" ? "allow" : changeEffect(access);
var defaultRules = (access) => [
  { action: BASELINE_ACTION, resource: "*", effect: changeEffect(access) },
  ...REVIEWED_TOOLS.map((tool) => ({ action: nativeToolId(tool.name), resource: "*", effect: effectOf(tool, access) }))
];
var UNREVIEWED_PROBE = nativeToolId("unreviewed-tool");

// src/status.ts
var SIGN_IN = `Run /connect and choose OpenRouter tools, or /mcps and choose ${SERVER_NAME} (in a terminal, run opencode mcp auth ${SERVER_NAME} from the project folder where the plugin is installed); never paste an OpenRouter key into the chat.`;
var list = (items) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
var STATE_TEXT = {
  connected: "connected",
  connecting: "connecting",
  sign_in_required: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
  policy_unavailable: "blocked: the plugin's policy is not in place"
};
var SOURCE_TEXT = {
  plugin: "registered by this plugin",
  adopted: `your own mcp.servers.${SERVER_NAME}, used unchanged`,
  disabled: `your mcp.servers.${SERVER_NAME}, disabled`,
  conflict: `your mcp.servers.${SERVER_NAME} points elsewhere and is left untouched`,
  pending: "not checked yet"
};
var postureOf = (access) => {
  const changes = `${CHANGE_TOOLS.join(", ")} and tools OpenRouter adds later`;
  if (access === "all") return "every OpenRouter tool is allowed, billable inference and feedback included";
  return `reads run without asking; ${changes} ${access === "ask-changes" ? "ask first" : "are denied"}`;
};
function catalogText({ catalog, access }) {
  if (catalog.state === "unavailable") return "not listed (no connection)";
  if (catalog.state === "pending") return "none listed yet (OpenRouter is still listing them)";
  const seen = catalog.lastObservedAt ? `; last seen ${catalog.lastObservedAt}` : "";
  const missing = catalog.missingReviewed.length ? `; reviewed but not listed: ${catalog.missingReviewed.join(", ")}` : "";
  if (catalog.unknownCount === 0) return `${catalog.observed} listed, ${catalog.reviewedPresent} reviewed, 0 unknown${missing}${seen}`;
  const more = catalog.unknownCount - catalog.unknown.length;
  const names = catalog.unknown.length ? `: ${catalog.unknown.join(", ")}${more > 0 ? ` and ${more} more` : ""}` : "";
  const effect = access === "all" ? "allowed" : access === "ask-changes" ? "asked about" : "denied";
  return `${catalog.observed} listed, ${catalog.reviewedPresent} reviewed, ${catalog.unknownCount} unknown${names} (${effect}, never a script method)${missing}${seen}`;
}
function scriptingText({ scripting }) {
  const { liveVerifiedCount: live, reviewedMethodCount: total } = scripting;
  const verified = live === total ? "their output checked against OpenRouter's live server" : live === 0 ? `output checked against a test server only, not yet against OpenRouter's live server (0 of ${total} checked live)` : `${live} of ${total} with output checked against OpenRouter's live server, the rest against its declared output or a test server`;
  const reason = (exclusion) => scripting.nativeOnly.filter((name) => reviewedTool(name)?.rpcExclusion === exclusion);
  const media2 = reason("native-media-required");
  const key = reason("key-metadata");
  const native = [
    ...media2.length ? [`${list(media2)} (media the script result drops)`] : [],
    ...key.length ? [`${list(key)} (the signed-in key's own metadata)`] : []
  ];
  return `${total} methods through ${PLUGIN_ID}.tools, ${verified}${native.length ? `; native only: ${native.join("; ")}` : ""}`;
}
function skillsText({ skills }) {
  const loaded = skills.filter((skill) => skill.state === "loaded").length;
  const other = skills.filter((skill) => skill.state !== "loaded").map((skill) => `${skill.name} ${skill.state}${skill.shadowedBy ? ` by ${skill.shadowedBy}` : ""}`);
  return `${loaded} of ${skills.length} loaded${other.length ? `; ${other.join("; ")}` : ""}`;
}
var POLICY_TEXT = { pending: "not applied yet", ready: "applied", failed: "failed to apply" };
var agentRules = (access) => defaultRules(access).map((rule, index, rules) => `  ${JSON.stringify(rule)}${index < rules.length - 1 ? "," : ""}`).join("\n");
var TESTED_TEXT = `${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}`;
function hostText({ host }) {
  const outside = host.version === null || !isSupportedHost(host.version);
  const note = outside ? `. It is outside the supported range; the plugin runs because allowUntestedHost is true. If OpenRouter's tools misbehave, use OpenCode ${TESTED_TEXT}` : "";
  return `${host.version ?? "unknown version"} (${host.tested ? "tested" : "untested"}; supported range ${host.range})${note}`;
}
function formatStatus(status) {
  const details = [status.error, SOURCE_TEXT[status.source]].filter(Boolean).join("; ");
  const agents = status.unguardedAgents;
  return [
    "OpenRouter status",
    `- Connection: ${STATE_TEXT[status.state]} (${details})`,
    `- Access: ${status.access}: ${postureOf(status.access)}`,
    `- Default rules: ${POLICY_TEXT[status.policy.installation]}`,
    `- Tools: ${catalogText(status)}`,
    `- Scripts: ${scriptingText(status)}`,
    `- Skills: ${skillsText(status)}`,
    `- Agents without default rules: ${agents.length ? `${agents.join(", ")}
${agentRules(status.access)}` : "none"}`,
    `- Agents that allow OpenRouter changes with their own rule: ${status.explicitlyAllowedAgents.length ? status.explicitlyAllowedAgents.join(", ") : "none"}`,
    `- OpenCode: ${hostText(status)}`,
    `- Problems: ${status.problems.length ? status.problems.map((problem) => `
  ${problem.message}`).join("") : "none"}`,
    `- Next step: ${status.nextStep}`
  ].join("\n");
}
var strings = { type: "array", items: { type: "string" } };
var count = { type: "integer", minimum: 0 };
var nullableString = { type: ["string", "null"] };
var STATES = ["connecting", "connected", "sign_in_required", "disabled", "failed", "not_configured", "conflict", "policy_unavailable"];
var StatusRpc = {
  id: PLUGIN_ID,
  methods: {
    status: {
      input: { type: "object" },
      output: {
        type: "object",
        required: ["version", "host", "state", "access", "source", "catalog", "scripting", "policy", "skills", "unguardedAgents", "explicitlyAllowedAgents", "problems", "nextStep"],
        properties: {
          version: { type: "string" },
          host: { type: "object", required: ["version", "range", "tested"], properties: { version: nullableString, range: { type: "string" }, tested: { type: "boolean" } } },
          state: { enum: [...STATES] },
          access: { enum: [...ACCESS] },
          source: { enum: ["plugin", "adopted", "disabled", "conflict", "pending"] },
          error: { type: "string" },
          catalog: {
            type: "object",
            required: ["state", "observed", "reviewedPresent", "unknownCount", "unknown", "missingReviewed"],
            properties: {
              state: { enum: ["pending", "ready", "unavailable"] },
              observed: count,
              reviewedPresent: count,
              unknownCount: count,
              unknown: strings,
              missingReviewed: strings,
              lastObservedAt: { type: "string" }
            }
          },
          scripting: {
            type: "object",
            required: ["reviewedMethodCount", "nativeOnly", "liveVerifiedCount"],
            properties: { reviewedMethodCount: count, nativeOnly: strings, liveVerifiedCount: count }
          },
          policy: { type: "object", required: ["installation"], properties: { installation: { enum: ["pending", "ready", "failed"] } } },
          skills: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "state"],
              properties: { name: { type: "string" }, state: { enum: ["loaded", "missing", "invalid", "shadowed"] }, shadowedBy: { type: "string" } }
            }
          },
          unguardedAgents: strings,
          explicitlyAllowedAgents: strings,
          problems: { type: "array", items: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } },
          nextStep: { type: "string" }
        }
      },
      errors: { unavailable: { type: "object", required: ["nextStep"], properties: { nextStep: { type: "string" } } } }
    }
  },
  events: {}
};

// src/tui.ts
var TUI_ID = "openrouter.models.tui";
var TITLE = "OpenRouter status";
var KEYS = "r refresh \xB7 esc close";
var STATUS_COMMAND_ID = "openrouter.models.status";
var REFRESH_COMMAND_ID = "openrouter.models.status.refresh";
function viewMessage(result) {
  return `${reportOf(result)}

${KEYS}`;
}
function reportOf(result) {
  if ("status" in result) return formatStatus(result.status).split("\n").slice(1).join("\n");
  const { error } = result;
  const type = typeof error === "object" && error !== null && "type" in error ? error.type : void 0;
  if (type === "unavailable") {
    const { message, data } = error;
    if (typeof message === "string" && typeof data?.nextStep === "string") return `${message} Next step: ${data.nextStep}`;
  }
  if (type === "rpc.unavailable" || type === "rpc.method_not_found") {
    return errorText("STATUS_UNAVAILABLE", "The OpenRouter plugin is not running on this OpenCode server.", "Run /plugins to see why it did not start.");
  }
  const reason = shortReason(typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error));
  return errorText("STATUS_UNAVAILABLE", `Could not read OpenRouter's status${reason ? ` (${reason})` : ""}.`, "Restart OpenCode, then run /openrouter again.");
}
function setupView(context) {
  let open;
  let latest = 0;
  let closed = false;
  let stops = [];
  const unsubscribe = () => {
    for (const stop of stops.splice(0)) stop();
  };
  const subscribe = () => {
    if (stops.length) return;
    stops = [
      context.data.on("mcp.status.changed", (event) => {
        if (event.data.server === SERVER_NAME) refresh();
      }),
      // Status events can be missed while the TUI is reconnecting.
      context.data.on("server.connected", refresh),
      context.data.on("agent.updated", refresh),
      // Signing in, out or switching accounts changes the sign-in state.
      context.data.on("integration.updated", refresh),
      context.data.on("credential.updated", refresh),
      context.data.on("credential.switched", refresh)
    ];
  };
  const [shown, setShown] = createSignal(false);
  const show = async (refresh2) => {
    if (closed || refresh2 && open === void 0) return;
    const request = ++latest;
    const location = context.location;
    const result = await context.client.rpc(StatusRpc).status({}, location ? { location } : {}).then((status) => ({ status }), (error) => ({ error }));
    if (closed || request !== latest || refresh2 && open === void 0) return;
    open = request;
    setShown(true);
    subscribe();
    void context.ui.dialog.alert({ title: TITLE, message: viewMessage(result) }).then(() => {
      if (open !== request) return;
      open = void 0;
      setShown(false);
      unsubscribe();
    });
    context.ui.dialog.set({ size: "large" });
  };
  const refresh = () => void show(true);
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: STATUS_COMMAND_ID,
        title: "OpenRouter: Status",
        description: "Sign-in, rules, tools, scripts and the next step for OpenRouter tools",
        group: "OpenRouter",
        palette: true,
        slash: { name: "openrouter" },
        run: () => show(false)
      },
      { id: REFRESH_COMMAND_ID, title: "Refresh OpenRouter status", group: "OpenRouter", bind: "r", enabled: shown, run: refresh }
    ]
  }));
  return () => {
    closed = true;
    unsubscribe();
    if (open === void 0) return;
    open = void 0;
    setShown(false);
    context.ui.dialog.clear();
  };
}
var tui_default = Plugin.define({ id: TUI_ID, setup: setupView });
export {
  REFRESH_COMMAND_ID,
  STATUS_COMMAND_ID,
  TUI_ID,
  tui_default as default,
  setupView,
  viewMessage
};
