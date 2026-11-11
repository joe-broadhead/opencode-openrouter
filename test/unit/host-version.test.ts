import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { SUPPORTED_HOST, TESTED_HOSTS, UNTESTED_EXAMPLE } from "../../src/constants.js"
import { checkHost, isSupportedHost, isTestedHost } from "../../src/host-version.js"

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { opencode: { host: string }; devDependencies: Record<string, string> }

describe("the host range", () => {
  test("is the package's opencode.host, and the tested list is 2.2.3 to 2.2.6", () => {
    expect(SUPPORTED_HOST).toBe(">=2.2.3 <2.3.0")
    expect(pkg.opencode.host).toBe(SUPPORTED_HOST)
    expect(TESTED_HOSTS).toEqual(["2.2.3", "2.2.4", "2.2.5", "2.2.6"])
    expect(pkg.devDependencies["@opencode/plugin"]).toBe(TESTED_HOSTS[0])
  })

  test("supports the range and nothing outside it", () => {
    for (const version of [...TESTED_HOSTS, UNTESTED_EXAMPLE, "2.2.10"]) expect(isSupportedHost(version)).toBe(true)
    for (const version of ["2.2.2", "2.3.0", "3.0.0", "1.9.9", "2.2.3-beta.1", "2.2", "unknown", "", "v2.2.3"]) expect(isSupportedHost(version)).toBe(false)
  })

  test("a supported but untested release loads, reported as untested", () => {
    expect(isTestedHost(UNTESTED_EXAMPLE)).toBe(false)
    expect(checkHost(UNTESTED_EXAMPLE, false)).toEqual({ version: UNTESTED_EXAMPLE, range: SUPPORTED_HOST, tested: false })
    for (const version of TESTED_HOSTS) expect(checkHost(version, false)).toEqual({ version, range: SUPPORTED_HOST, tested: true })
  })

  test("an out-of-range host is refused unless the user opts in", () => {
    expect(() => checkHost("2.3.0", false)).toThrow(
      'HOST_UNTESTED: This plugin supports OpenCode >=2.2.3 <2.3.0, found 2.3.0. Next step: Use OpenCode >=2.2.3 <2.3.0, or set the plugin option "allowUntestedHost": true to run anyway.',
    )
    expect(() => checkHost("", false)).toThrow("found no version")
    expect(checkHost("2.3.0", true)).toEqual({ version: "2.3.0", range: SUPPORTED_HOST, tested: false })
    expect(checkHost("", true)).toEqual({ version: null, range: SUPPORTED_HOST, tested: false })
  })
})
