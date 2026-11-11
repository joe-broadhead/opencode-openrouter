// Narrow fakes of the public plugin context: only the members a test touches, typed from Plugin.Context so they stay
// valid against later 2.2.x context shapes.
import type { Plugin } from "@opencode/plugin"

type Transform<Editor> = (callback: (editor: Editor) => void) => Promise<{ dispose: () => Promise<void> }>

/** Collects transform callbacks; `run` replays them on a fresh editor value, as the host does on each rebuild. */
export function transforms<Editor>() {
  const callbacks: ((editor: Editor) => void)[] = []
  let disposed = 0
  const transform: Transform<Editor> = (callback) => {
    callbacks.push(callback)
    return Promise.resolve({
      dispose: async () => {
        disposed++
        callbacks.splice(callbacks.indexOf(callback), 1)
      },
    })
  }
  return { transform, callbacks, disposed: () => disposed, run: (editor: Editor) => callbacks.forEach((callback) => callback(editor)) }
}

export type McpEditor = Parameters<Parameters<Plugin.Context["mcp"]["transform"]>[0]>[0]
export type ServerConfig = NonNullable<ReturnType<McpEditor["get"]>>

/**
 * An MCP editor over a map of entries. Reading an entry's `headers` throws, so a test fails if the plugin ever looks at
 * a user's header values.
 */
export function mcpEditor(initial: Record<string, ServerConfig> = {}) {
  const servers = new Map(Object.entries(structuredClone(initial)))
  const guarded = (config: ServerConfig) =>
    new Proxy(config, {
      get(target, key, receiver) {
        if (key === "headers") throw new Error("the plugin read a server's headers")
        return Reflect.get(target, key, receiver)
      },
    })
  const editor: McpEditor = {
    list: () => [...servers].map(([name, config]) => [name, guarded(config)] as [string, ServerConfig]),
    get: (name) => {
      const config = servers.get(name)
      return config && guarded(config)
    },
    set: (name, config) => void servers.set(name, structuredClone(config) as ServerConfig),
    update: (name, update) => {
      const config = servers.get(name)
      if (config) update(config)
    },
    remove: (name) => void servers.delete(name),
  }
  return { editor, servers }
}

/**
 * Counts live timers: every setTimeout and setInterval until it fires or is cleared. `stop` restores the globals and
 * returns how many are still pending.
 */
export function timerProbe() {
  const live = new Set<unknown>()
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval }
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const handle = real.setTimeout(
      (...inner: unknown[]) => {
        live.delete(handle)
        callback(...inner)
      },
      ms,
      ...args,
    )
    live.add(handle)
    return handle
  }) as typeof setTimeout
  globalThis.clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => {
    live.delete(handle)
    real.clearTimeout(handle)
  }) as typeof clearTimeout
  globalThis.setInterval = ((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const handle = real.setInterval(callback, ms, ...args)
    live.add(handle)
    return handle
  }) as typeof setInterval
  globalThis.clearInterval = ((handle: Parameters<typeof clearInterval>[0]) => {
    live.delete(handle)
    real.clearInterval(handle)
  }) as typeof clearInterval
  return {
    pending: () => live.size,
    stop() {
      Object.assign(globalThis, real)
      return live.size
    },
  }
}
