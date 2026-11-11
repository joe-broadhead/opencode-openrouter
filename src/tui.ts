// The terminal UI part. It registers nothing yet: the status dialog and its palette entry read the status RPC, which
// does not exist yet. The entry exists so the package's `./tui` export and its bundle are in place and tested.
import { Plugin } from "@opencode/plugin/tui"

export const TUI_ID = "openrouter.models.tui"

export default Plugin.define({ id: TUI_ID, setup: () => {} })
