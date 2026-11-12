// Runs one scripts/capture-live.ts capture in a fresh process, as the script itself does, against the loopback fake the
// parent test started. Not a test file: test/host/capture.test.ts spawns it. Its options arrive as JSON in
// CAPTURE_CHILD; it prints one JSON line: the result, the URLs it was asked to open, or the error.
// Every fetch that leaves loopback is refused before the capture's tap is installed on top.
import { capture } from "../../scripts/capture-live.js"
import { createOpenRouterPlugin } from "../../src/plugin.js"

const input = JSON.parse(process.env["CAPTURE_CHILD"] ?? "{}") as {
  endpoint: string
  oauth: boolean
  home: string
  sdk: string
  signIn: "wait" | "until-login" | "never"
  /** `follow`: act as the person's browser, following the sign-in page to OpenCode's callback. */
  browser: "none" | "follow"
  urlFile?: string
}

const real = globalThis.fetch
const loopbackOnly = Object.assign(
  (request: string | URL | Request, init?: RequestInit) => {
    const url = new URL(request instanceof Request ? request.url : request)
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return real(request, init)
    return Promise.reject(new Error(`capture child blocked a fetch to ${url.origin}`))
  },
  { preconnect: real.preconnect },
) as typeof fetch
globalThis.fetch = loopbackOnly

const opened: string[] = []
const follow = async (url: string) => {
  const page = await fetch(url, { redirect: "manual" })
  await fetch(page.headers.get("location")!)
}
try {
  const result = await capture({
    endpoint: input.endpoint,
    plugin: createOpenRouterPlugin({ endpoint: input.endpoint, ...(input.oauth ? {} : { oauth: false as const }) }),
    home: input.home,
    sdk: input.sdk,
    signIn: input.signIn,
    ...(input.urlFile ? { urlFile: input.urlFile } : {}),
    open: (url) => {
      opened.push(url)
      if (input.browser === "follow") void follow(url)
    },
    timeoutMs: 60_000,
  })
  console.log(JSON.stringify({ result, opened, fetchRestored: globalThis.fetch === loopbackOnly }))
} catch (error) {
  console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
}
process.exit(0)
