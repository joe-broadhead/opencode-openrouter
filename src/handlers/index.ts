/**
 * The handler table: one entry per method the plugin itself registers, by the method's name.
 *
 * Pass-through MCP tools have no handler here: OpenRouter's server owns them, and the manifest declares each one as an
 * `mcp:<tool>` row for its class and access rule. A handler says what one method looks like and does the work; the
 * contract's `register` adds the account selector, the doors, the permission assertions and the answer checks.
 */
import type { AccountProfile } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { HandlerTable } from "@we-the-rebel-alliance/plugin-contract/register"
import { probeHandler } from "./probe.ts"
import { statusHandler } from "./status.ts"
import type { Provider } from "../provider/mcp.ts"

/** The plugin state the handlers may read, built once in `setup`. */
export interface HandlerRuntime {
  /** The manifest the plugin runs with. */
  readonly manifest: Manifest
  /** The installed package's version, which `status` reports. */
  readonly version: string
  /** The OpenCode release the plugin runs on, read once in `setup`. */
  readonly hostVersion: string
  /** The accounts the options declare, in their order. */
  readonly accounts: readonly AccountProfile[]
  /** What registering the accounts could not do, one redacted line each. */
  readonly accountProblems: readonly string[]
  /** OpenCode's live MCP server list, and the contract signal it maps to. */
  readonly provider: Provider
}

/** Every method's handler. */
export function handlersFor(runtime: HandlerRuntime): HandlerTable {
  return {
    status: statusHandler(runtime),
    probe: probeHandler(runtime),
  }
}
