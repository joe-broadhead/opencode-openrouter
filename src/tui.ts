// The terminal UI part: the `/openrouter` status dialog and its palette entry. It shows the status RPC's answer, the
// same model `/openrouter-status` reports, refreshes on `r` and on relevant events while it is open, and closes with
// Escape. It never calls OpenRouter.
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { errorText, SERVER_NAME } from "./constants.js"
import { shortReason } from "./redact.js"
import { formatStatus, StatusRpc, type Status } from "./status.js"

export const TUI_ID = "openrouter.models.tui"
const TITLE = "OpenRouter status"
const KEYS = "r refresh · esc close"
/** The palette and slash command that opens the dialog, and the key that refreshes it. */
export const STATUS_COMMAND_ID = "openrouter.models.status"
export const REFRESH_COMMAND_ID = "openrouter.models.status.refresh"

type Context = Plugin.Context

/** The dialog's text: the /openrouter-status report without its heading, which the dialog title carries, and the keys. */
export function viewMessage(result: { readonly status: Status } | { readonly error: unknown }) {
  return `${reportOf(result)}\n\n${KEYS}`
}

function reportOf(result: { readonly status: Status } | { readonly error: unknown }) {
  if ("status" in result) return formatStatus(result.status).split("\n").slice(1).join("\n")
  const { error } = result
  const type = typeof error === "object" && error !== null && "type" in error ? error.type : undefined
  // The server part could not read the status; it says why and what to do.
  if (type === "unavailable") {
    const { message, data } = error as { message?: unknown; data?: { nextStep?: unknown } }
    if (typeof message === "string" && typeof data?.nextStep === "string") return `${message} Next step: ${data.nextStep}`
  }
  // No server part answers: the plugin did not start there, and the host's plugin list says why.
  if (type === "rpc.unavailable" || type === "rpc.method_not_found") {
    return errorText("STATUS_UNAVAILABLE", "The OpenRouter plugin is not running on this OpenCode server.", "Run /plugins to see why it did not start.")
  }
  // The host's text, cut as status cuts a failure's reason: one line, redacted, at most 160 characters.
  const reason = shortReason(typeof error === "object" && error !== null && "message" in error ? String(error.message) : String(error))
  return errorText("STATUS_UNAVAILABLE", `Could not read OpenRouter's status${reason ? ` (${reason})` : ""}.`, "Restart OpenCode, then run /openrouter again.")
}

/** The members of the TUI context the view uses. */
export interface ViewContext {
  readonly location: Context["location"]
  readonly client: Pick<Context["client"], "rpc">
  readonly data: Pick<Context["data"], "on">
  readonly ui: { readonly dialog: Pick<Context["ui"]["dialog"], "alert" | "set" | "clear"> }
  readonly keymap: Pick<Context["keymap"], "layer">
}

export function setupView(context: ViewContext) {
  let open: number | undefined
  let latest = 0
  let closed = false
  /** The event listeners, held only while the view is open. */
  let stops: (() => void)[] = []
  const unsubscribe = () => {
    for (const stop of stops.splice(0)) stop()
  }
  const subscribe = () => {
    if (stops.length) return
    stops = [
      context.data.on("mcp.status.changed", (event) => {
        if (event.data.server === SERVER_NAME) refresh()
      }),
      // Status events can be missed while the TUI is reconnecting.
      context.data.on("server.connected", refresh),
      context.data.on("agent.updated", refresh),
      // Signing in, out or switching accounts changes the sign-in state.
      context.data.on("integration.updated", refresh),
      context.data.on("credential.updated", refresh),
      context.data.on("credential.switched", refresh),
    ]
  }
  // The refresh key is live only while the view is open, so `r` never reaches it from anywhere else.
  const [shown, setShown] = createSignal(false)
  /** Opens the view; with `refresh`, redraws it only while it is open. A new dialog replaces the shown one. */
  const show = async (refresh: boolean) => {
    if (closed || (refresh && open === undefined)) return
    const request = ++latest
    const location = context.location
    const result = await context.client
      .rpc(StatusRpc)
      .status({}, location ? { location } : {})
      // The host validates the output against the contract's schema before it answers.
      .then((status) => ({ status: status as Status }), (error: unknown) => ({ error }))
    // The newest request wins, a refresh never reopens a view the user closed meanwhile, and nothing opens after unload.
    if (closed || request !== latest || (refresh && open === undefined)) return
    open = request
    setShown(true)
    subscribe()
    // The alert closes on Esc; replacing it with a newer one closes it too.
    void context.ui.dialog.alert({ title: TITLE, message: viewMessage(result) }).then(() => {
      if (open !== request) return
      open = undefined
      setShown(false)
      unsubscribe()
    })
    // Showing resets the size; the rule list in the agent fix reads better wide.
    context.ui.dialog.set({ size: "large" })
  }
  const refresh = () => void show(true)

  // Called from setup itself, because keymap layers need the host's reactive owner. Global, because the palette
  // and slash completion list only the commands reachable from their own input mode.
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
        run: () => show(false),
      },
      { id: REFRESH_COMMAND_ID, title: "Refresh OpenRouter status", group: "OpenRouter", bind: "r", enabled: shown, run: refresh },
    ],
  }))
  return () => {
    closed = true
    unsubscribe()
    if (open === undefined) return
    open = undefined
    setShown(false)
    context.ui.dialog.clear()
  }
}

export default Plugin.define({ id: TUI_ID, setup: setupView })
