// The restated setting contract refuses what Jelly's refuses, so the declaration test cannot pass on a check that
// takes anything.
import { describe, expect, test } from "bun:test"
import { ACCESS_CHOICES, settingProblems, settingsProblems, settingValueIssue } from "../support/jelly-settings.js"

const base = { key: "mode", label: "Mode", type: "string", description: "A mode." }

describe("the restated Jelly setting contract", () => {
  test("takes a plain setting, a closed set and a bounded number", () => {
    expect(settingProblems(base)).toEqual([])
    expect(settingProblems({ ...base, choices: ACCESS_CHOICES, default: "all" })).toEqual([])
    expect(settingProblems({ ...base, enum: ["a", "b"], default: "a" })).toEqual([])
    expect(settingProblems({ ...base, type: "number", integer: true, min: 1, max: 8, default: 2 })).toEqual([])
    expect(settingProblems({ ...base, type: "number", min: 0.01, step: 0.01 })).toEqual([])
  })

  test("refuses what Jelly's strict schema refuses", () => {
    const refused = [
      { ...base, unknown: true },
      { ...base, enum: ["a"] },
      { ...base, enum: ["a", "b"], choices: ACCESS_CHOICES },
      { ...base, choices: [{ value: "a", note: "x" }, { value: "b" }] },
      { ...base, enum: ["a", "a"] },
      { ...base, enum: ["a", "b"], default: "c" },
      { ...base, type: "number", enum: ["a", "b"] },
      { ...base, min: 1 },
      { ...base, type: "number", min: 2, max: 1 },
      { ...base, type: "number", step: 0 },
      { ...base, type: "number", integer: true, default: 1.5 },
      { ...base, type: "number", min: 1, default: 0 },
      { ...base, type: "boolean", default: "true" },
      { ...base, type: "secret", default: "x" },
      { ...base, key: "1bad" },
    ]
    for (const setting of refused) expect(settingProblems(setting)).not.toEqual([])
    expect(settingsProblems([base, base])).not.toEqual([])
  })

  test("checks a saved value as Jelly's host does", () => {
    const closed = { enum: ["a", "b"] }
    expect(settingValueIssue(closed, "a")).toBeNull()
    expect(settingValueIssue(closed, "c")).toBe("not one of the declared values")
    const bounded = { min: 0.01, step: 0.01, integer: false }
    expect(settingValueIssue(bounded, 0.01)).toBeNull()
    expect(settingValueIssue(bounded, 12.34)).toBeNull()
    expect(settingValueIssue(bounded, 0)).toBe("below the minimum")
    expect(settingValueIssue(bounded, 0.015)).toBe("not on a step")
    expect(settingValueIssue({ integer: true, max: 8 }, 9)).toBe("above the maximum")
    expect(settingValueIssue({ integer: true }, 1.5)).toBe("not a whole number")
  })
})
