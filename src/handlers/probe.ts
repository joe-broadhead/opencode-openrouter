/** `probe`: which OpenCode MCP server an account signs in to. It reads no OpenRouter content. */
import { refusal, RegisterError, type MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { EMPTY, PROBE_ANSWER } from "./shared.ts"
import { serverLabel, serverName } from "../provider/mcp.ts"
import type { HandlerRuntime } from "./index.ts"

/**
 * `probe` answers OpenCode's own connection identity for one alias: the server the plugin registered, never a provider
 * identity, and never a credential. The server entry itself is the proof that the alias was registered.
 */
export function probeHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description: "Report which OpenCode MCP server an account signs in to. It reads no OpenRouter content.",
    input: EMPTY,
    output: PROBE_ANSWER,
    async run(_input, call) {
      const name = serverName(call.account)
      const entry = await runtime.provider.server(name)
      if (entry === undefined) {
        throw new RegisterError(
          refusal("UNAVAILABLE", `OpenCode lists no MCP server ${name} for the ${call.account} account`, "Reload OpenCode so the plugin registers its servers, then probe again."),
        )
      }
      return {
        account: call.account,
        owner: { id: `mcp:${name}`, label: serverLabel(call.account), verified: false },
        trust: "untrusted",
      }
    },
  }
}
