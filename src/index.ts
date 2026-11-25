/**
 * The plugin's one entry: `Plugin.define({ id, setup })`, the host gate, the accounts, and one `register` call.
 *
 * `register` wires doors 1–3 from `handlers`, resolves accounts and generates the access rules. This file never calls
 * `ctx.tool`, `ctx.rpc` or `ctx.permission` itself. OpenRouter's own MCP tools are declared in the manifest as `mcp:`
 * rows and are not registered here: the vendor's server owns them.
 */
import { Plugin } from "@opencode/plugin"
import { accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { registerOpenRouterAccounts } from "./accounts.ts"
import { handlersFor } from "./handlers/index.ts"
import { manifest, version } from "./manifest.ts"
import { createMcpProvider } from "./provider/mcp.ts"
import { addPackagedSkills, loadSkills } from "./skills.ts"

export default Plugin.define({
  id: manifest.plugin.name,
  async setup(context) {
    assertHost(context, manifest)
    const options = context.options ?? {}

    // The alias is the account: an unreadable accounts option is refused before anything is registered.
    const accounts = accountsOf(manifest, options)
    if (!accounts.ok) throw new Error(`OPTIONS_INVALID: ${accounts.problems.join("; ")}. Next step: fix the plugin's accounts option.`)

    // One OpenRouter MCP server per alias, named openrouter or openrouter-<alias>; OpenCode holds each OAuth.
    const accountRegistration = await registerOpenRouterAccounts(context, manifest, options)

    const handlers = handlersFor({
      manifest,
      version,
      hostVersion: context.app.version,
      accounts: accounts.value.accounts,
      accountProblems: accountRegistration.problems,
      provider: createMcpProvider(context.mcp),
    })
    const registration = await register(context, manifest, handlers)

    // The contract's register does not touch skills; this plugin registers its own four, and disposes them first.
    try {
      const skills = await loadSkills()
      const skillRegistration = await context.skill.transform(addPackagedSkills(skills))
      return async () => {
        await skillRegistration.dispose()
        await registration.dispose()
      }
    } catch (error) {
      await registration.dispose()
      throw error
    }
  },
})
