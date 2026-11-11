// Tests for the release kit: the CHANGELOG shape, the version and its tag, the pack stage's tarball check, and the
// Release upload that never deletes or replaces an asset. They run with Node's own runner and need only git:
//
//   node --test scripts/release-kit.test.mjs
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { changelogProblems, releaseNotes, shapeChangelog } from "./changelog.mjs"
import { publish } from "./publish-release.mjs"
import { allowedPath, fetchReleases, modeProblems, NOREPLY_DOMAIN, releasedTags, releasePackageText, serialise } from "./release-commit.mjs"
import { namesTarball, readsTarball } from "./release-pack.mjs"
import { RELEASE_VERSION, tagFor, tagProblem, versionProblem } from "./release-version.mjs"

const SCRIPTS = fileURLToPath(new URL(".", import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), "release-kit-test-"))
after(() => rmSync(scratch, { recursive: true, force: true }))
let made = 0
const folder = () => {
  const dir = join(scratch, String(made++))
  mkdirSync(dir, { recursive: true })
  return dir
}

const PREAMBLE = "# Changelog\n\nAll notable changes to this project are documented here.\n"
const EARLIER = "## Earlier releases on npm\n\nThese versions were published to npm.\n\n### npm 0.0.10 - 2026-11-08\n\n#### Added\n\n- An npm feature.\n"
const V000 = "## [0.0.0] - 2026-11-10\n\n### Changed\n\n- Installed from GitHub.\n"
const V001 = "## [0.0.1] - 2026-11-12\n\n### Fixed\n\n- A config fix.\n"
const UNRELEASED = "## [Unreleased]\n\n### Fixed\n\n- A config fix.\n"
const doc = (...sections) => [PREAMBLE, ...sections].join("\n")

/** One GitHub release, then the npm history. */
const ONE = doc(V000, EARLIER)
/** Two GitHub releases, newest first, then the npm history. */
const TWO = doc(V001, V000, EARLIER)

describe("the CHANGELOG with one GitHub release", () => {
  test("is in the release shape for that version, and its notes are its section", () => {
    assert.deepEqual(changelogProblems(ONE, "0.0.0"), [])
    assert.equal(releaseNotes(ONE, "0.0.0"), V000.trim())
  })

  test("is refused for a version it has no heading for", () => {
    assert.deepEqual(changelogProblems(ONE, "0.0.1"), ["expected one ## [0.0.1] heading, found 0"])
    assert.throws(() => releaseNotes(ONE, "0.0.1"), /no "## \[0\.0\.1\]" heading/)
  })
})

describe("the CHANGELOG with two GitHub releases", () => {
  test("is in the release shape for the newest, and the notes stop at the next release", () => {
    assert.deepEqual(changelogProblems(TWO, "0.0.1"), [])
    assert.equal(releaseNotes(TWO, "0.0.1"), V001.trim())
    assert.equal(releaseNotes(TWO, "0.0.0"), V000.trim())
  })

  test("is refused for the older release, which is not the newest heading", () => {
    assert.deepEqual(changelogProblems(TWO, "0.0.0"), ["## [0.0.0] is not the newest release heading"])
  })

  test("is refused with the releases out of order, repeated or undated", () => {
    assert.match(changelogProblems(doc(V000, V001, EARLIER), "0.0.1").join("; "), /"## \[0\.0\.0\] - 2026-11-10" is above "## \[0\.0\.1\] - 2026-11-12"/)
    assert.match(changelogProblems(doc(V001, V001, V000), "0.0.1").join("; "), /expected one ## \[0\.0\.1\] heading, found 2/)
    assert.match(changelogProblems(doc("## [0.0.1]\n\n- A fix.\n", V000), "0.0.1").join("; "), /"## \[0\.0\.1\]" is not dated/)
    assert.match(changelogProblems(doc("## [0.0.1] - soon\n\n- A fix.\n", V000), "0.0.1").join("; "), /is not dated/)
  })

  test("is refused with the npm history above a release, or a heading the shape does not know", () => {
    assert.match(changelogProblems(doc(V001, EARLIER, V000), "0.0.1").join("; "), /"## Earlier releases on npm" must be the last section/)
    assert.match(changelogProblems(doc(V001, "## Notes\n\n- Something.\n", V000), "0.0.1").join("; "), /"## Notes" is not a heading the release shape knows/)
  })

  test("is refused when the release has no notes", () => {
    assert.match(changelogProblems(doc("## [0.0.1] - 2026-11-12\n", V000), "0.0.1").join("; "), /the ## \[0\.0\.1\] section has no notes/)
  })
})

describe("a leftover ## [Unreleased]", () => {
  test("is refused, and names the step that releases it", () => {
    const problems = changelogProblems(doc(UNRELEASED, V000, EARLIER), "0.0.1")
    assert.match(problems.join("; "), /an ## \[Unreleased\] section is still there: run node scripts\/changelog\.mjs release/)
    assert.match(problems.join("; "), /expected one ## \[0\.0\.1\] heading, found 0/)
    assert.match(changelogProblems(doc(UNRELEASED, V001, V000), "0.0.1").join("; "), /an ## \[Unreleased\] section is still there/)
  })
})

describe("shapeChangelog", () => {
  const release = (text, version = "0.0.1") => shapeChangelog(text, { version, date: "2026-11-12" })

  test("turns ## [Unreleased] into the dated release, above the earlier ones, and changes nothing else", () => {
    assert.equal(release(doc(UNRELEASED, V000, EARLIER)), TWO)
  })

  test("is idempotent: a released CHANGELOG comes back unchanged", () => {
    assert.equal(release(TWO), TWO)
    assert.equal(release(release(doc(UNRELEASED, V000, EARLIER))), TWO)
    assert.equal(release(ONE, "0.0.0"), ONE)
  })

  test("moves an ## [Unreleased] found below a release to the top", () => {
    assert.equal(release(doc(V000, UNRELEASED, EARLIER)), TWO)
  })

  test("ignores a ## line inside fenced code", () => {
    const fenced = "## [Unreleased]\n\n- A fix:\n\n```md\n## [9.9.9] - not a heading\n```\n"
    const shaped = release(doc(fenced, V000))
    assert.equal(shaped, doc(fenced.replace("## [Unreleased]", "## [0.0.1] - 2026-11-12"), V000))
    assert.deepEqual(changelogProblems(shaped, "0.0.1"), [])
    assert.match(releaseNotes(shaped, "0.0.1"), /## \[9\.9\.9\] - not a heading\n```$/)
  })

  test("refuses what it cannot shape, so nothing is written", () => {
    assert.throws(() => release(ONE), /no ## \[Unreleased\] section to release as 0\.0\.1/)
    assert.throws(() => release(doc(UNRELEASED, V001, V000)), /both ## \[Unreleased\] and a ## \[0\.0\.1\] heading/)
    assert.throws(() => release(doc(UNRELEASED, "## [0.0.2] - 2026-11-11\n\n- Later.\n", V000)), /"## \[0\.0\.2\] - 2026-11-11" is not older than 0\.0\.1/)
    assert.throws(() => release(doc("## [Unreleased]\n", V000)), /has no notes/)
    assert.throws(() => release(doc(UNRELEASED, UNRELEASED, V000)), /2 ## \[Unreleased\] sections/)
    assert.throws(() => release(doc(UNRELEASED, "## Notes\n\n- Something.\n")), /"## Notes" is not a heading/)
    assert.throws(() => shapeChangelog(ONE, { version: "0.0.1-rc.1", date: "2026-11-12" }), /is not x\.y\.z/)
    assert.throws(() => shapeChangelog(ONE, { version: "0.0.1", date: "12 Nov" }), /is not YYYY-MM-DD/)
  })
})

describe("code fences, as CommonMark reads them", () => {
  const fenced = (...lines) => `${lines.join("\n")}\n`

  test("refuse a CHANGELOG whose fence is never closed: it would swallow every later section", () => {
    const open = doc(V001 + fenced("```md", "- code"), V000, EARLIER)
    assert.match(changelogProblems(open, "0.0.1").join("; "), /the code fence on line \d+ is never closed/)
    assert.throws(() => releaseNotes(open, "0.0.1"), /is never closed/)
    assert.throws(() => shapeChangelog(doc(UNRELEASED + fenced("~~~"), V000), { version: "0.0.1", date: "2026-11-12" }), /is never closed/)
  })

  test("close only with the same character, at least as many: a ``` fence does not end at ~~~", () => {
    // The ~~~ line is code; the ``` after it closes the fence, so the ## [0.0.2] below is a real heading, out of order.
    const text = doc(V001 + fenced("```md", "~~~", "```"), "## [0.0.2] - 2026-11-13\n\n- Hidden before.\n", V000)
    assert.match(changelogProblems(text, "0.0.1").join("; "), /"## \[0\.0\.1\] - 2026-11-12" is above "## \[0\.0\.2\] - 2026-11-13"/)
    // Inside a ~~~ fence, ``` is code, and so is the ## line; ~~~ closes it.
    const tilde = doc(V001 + fenced("~~~", "```", "## [9.9.9] - code", "~~~"), V000)
    assert.deepEqual(changelogProblems(tilde, "0.0.1"), [])
    assert.match(releaseNotes(tilde, "0.0.1"), /## \[9\.9\.9\] - code\n~~~$/)
    // A longer fence needs a closing fence as long; one with an info string does not close.
    assert.deepEqual(changelogProblems(doc(V001 + fenced("````", "```", "## [9.9.9] - code", "````"), V000), "0.0.1"), [])
    assert.deepEqual(changelogProblems(doc(V001 + fenced("```", "```js", "## [9.9.9] - code", "```"), V000), "0.0.1"), [])
  })

  test("recognise a fence indented by up to three spaces, and not by four", () => {
    assert.deepEqual(changelogProblems(doc(V001 + fenced("   ```", "## [9.9.9] - code", "   ```"), V000), "0.0.1"), [])
    assert.match(changelogProblems(doc(V001 + fenced("    ```", "## [9.9.9] - code", "    ```"), V000), "0.0.1").join("; "), /9\.9\.9/)
    // A backtick fence's info string has no backtick, so this line opens nothing.
    assert.match(changelogProblems(doc(V001 + fenced("``` a`b", "## [9.9.9] - code"), V000), "0.0.1").join("; "), /9\.9\.9/)
  })

  test("refuse a heading indented by spaces, which renders as a heading but is not one here", () => {
    assert.match(changelogProblems(doc(V001 + fenced("  ## [0.0.2] - 2026-11-13"), V000), "0.0.1").join("; "), /heading indented by spaces/)
  })
})

describe("one version pattern", () => {
  test("x.y.z with no leading zeros and no prerelease or build part, in every kit script", () => {
    for (const version of ["0.0.0", "0.0.1", "1.20.3", "10.0.0"]) assert.match(version, RELEASE_VERSION)
    for (const version of ["01.0.0", "0.01.0", "0.0.01", "0.0.1-rc.1", "0.0.1+build", "0.0", "v0.0.1"]) assert.doesNotMatch(version, RELEASE_VERSION)
    assert.match(changelogProblems(doc("## [01.0.0] - 2026-11-12\n\n- A fix.\n", V000), "0.0.0").join("; "), /"## \[01\.0\.0\] - 2026-11-12" is not a heading the release shape knows/)
    assert.deepEqual(changelogProblems(ONE, "00.0.0"), ['the version "00.0.0" is not x.y.z'])
    assert.throws(() => shapeChangelog(doc(UNRELEASED, V000), { version: "0.0.01", date: "2026-11-12" }), /is not x\.y\.z/)
    for (const script of ["changelog.mjs", "release-commit.mjs", "check-release-shape.mjs"]) {
      const source = readFileSync(join(SCRIPTS, script), "utf8")
      assert.match(source, /from "\.\/release-version\.mjs"/, script)
      assert.doesNotMatch(source, /\\d\+\\\.|\[1-9\]\\d\*/, `${script} has a version pattern of its own`)
    }
  })
})

describe("the version and its tag", () => {
  test("the tag is exactly v<version>, for an x.y.z version", () => {
    assert.equal(tagFor("0.0.1"), "v0.0.1")
    assert.equal(tagProblem("v0.0.1", "0.0.1"), undefined)
    assert.equal(tagProblem("v1.20.3", "1.20.3"), undefined)
  })

  test("refuses a tag that differs from v<version>", () => {
    assert.equal(tagProblem("v0.0.0", "0.0.1"), "the tag is v0.0.0, and package.json's version 0.0.1 releases only as v0.0.1")
    for (const tag of ["0.0.1", "v0.0.1 ", "V0.0.1", "v0.0.10", "release-0.0.1"]) assert.match(tagProblem(tag, "0.0.1"), /releases only as v0\.0\.1/, tag)
  })

  test("refuses a version that is not x.y.z", () => {
    for (const version of ["0.0.1-rc.1", "0.0.1+build", "01.0.0", "0.0", "v0.0.1", "", undefined, 1]) {
      assert.match(versionProblem(version), /is not x\.y\.z/, String(version))
      assert.match(tagProblem(`v${version}`, version), /is not x\.y\.z/, String(version))
    }
  })
})

/** A published GitHub Release of a tag, as the Releases API lists it, and a draft (never published). */
const published = (tag) => ({ tag_name: tag, draft: false, published_at: "2026-11-10T12:00:00Z" })
const draft = (tag) => ({ tag_name: tag, draft: true, published_at: null })

/**
 * A `gh` for the scripts under test: `api repos/<repo>/releases?...&page=1` prints the Releases file, a later page an
 * empty list, and FAKE_GH_FAIL makes every call fail as a refused request does.
 */
const FAKE_GH = `#!/bin/sh
if [ -n "$FAKE_GH_FAIL" ]; then echo "HTTP 403: Resource not accessible by integration" >&2; exit 1; fi
case "$*" in
  "api repos/owner/kit-test/releases?per_page=100&page=1") cat "$FAKE_GH_RELEASES" ;;
  "api repos/owner/kit-test/releases?per_page=100&page="*) echo "[]" ;;
  *) echo "fake gh: unexpected call: $*" >&2; exit 1 ;;
esac
`

/**
 * A git repository in a scratch folder, with no global or system config, committing as a noreply identity. Its origin
 * is owner/kit-test on GitHub, and `gh` is the fake above, answering with `releases`.
 */
function repository(files, { releases = [] } = {}) {
  const dir = folder()
  const home = folder()
  const bin = folder()
  writeFileSync(join(home, ".gitconfig"), "")
  writeFileSync(join(bin, "gh"), FAKE_GH, { mode: 0o755 })
  const releasesFile = join(home, "releases.json")
  const env = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_REPOSITORY: "owner/kit-test",
    FAKE_GH_RELEASES: releasesFile,
    FAKE_GH_FAIL: "",
  }
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: dir, env, encoding: "utf8" })
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`)
    return result.stdout.trim()
  }
  git("init", "-q", "-b", "master")
  git("config", "user.name", "kit-test")
  git("config", "user.email", `kit-test@${NOREPLY_DOMAIN}`)
  git("config", "commit.gpgsign", "false")
  git("config", "tag.gpgsign", "false")
  git("remote", "add", "origin", "https://github.com/owner/kit-test.git")
  for (const [path, text] of Object.entries(files)) writeFileSync(join(dir, path), text)
  git("add", ".")
  git("commit", "-q", "-m", "chore: the source")
  const setReleases = (list) => writeFileSync(releasesFile, JSON.stringify(list))
  setReleases(releases)
  const node = (script, args, extra = {}) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { cwd: dir, env: { ...env, ...extra }, encoding: "utf8" })
  return { dir, git, node, setReleases, head: git("rev-parse", "HEAD") }
}

/** A later commit on master, so a release can have older source than another. Returns its sha. */
function laterCommit(repo, name = "later.txt") {
  writeFileSync(join(repo.dir, name), `${name}\n`)
  repo.git("add", name)
  repo.git("commit", "-q", "-m", `chore: ${name}`)
  return repo.git("rev-parse", "HEAD")
}

/**
 * A release commit on `from`: dist/ and the given package.json text, tagged (annotated), then back to master. `tweak`
 * changes the index before the commit (a mode, a symlink, an extra file).
 */
function releaseOn(repo, { tag, pkgText, from, tweak }) {
  repo.git("checkout", "-q", "--detach", from ?? repo.git("rev-parse", "master"))
  mkdirSync(join(repo.dir, "dist"), { recursive: true })
  writeFileSync(join(repo.dir, "dist", "index.js"), "export default 1\n")
  writeFileSync(join(repo.dir, "dist", "tui.js"), "export default 2\n")
  writeFileSync(join(repo.dir, "package.json"), pkgText)
  repo.git("add", "-f", "dist", "package.json")
  tweak?.(repo)
  repo.git("commit", "-q", "-m", `chore(release): ${tag}`)
  repo.git("tag", "-a", tag, "-m", tag)
  repo.git("checkout", "-q", "-f", "master")
}

/** check-release-shape.mjs on a tag, with no allowed signers: the signature checks fail, and the others are read. */
function shapeOf(repo, tag, extra) {
  const signers = join(repo.dir, "..", `signers-${made++}`)
  writeFileSync(signers, "")
  return repo.node("check-release-shape.mjs", ["--tag", tag, "--verify", "git", "--allowed-signers", signers, "--branch", "master"], extra).stdout
}

describe("check-release-shape.mjs: the tag is v<package.json version>", () => {
  test("refuses a tag that is not v<package.json version>, and accepts the one that is", () => {
    const repo = repository({ "package.json": serialise({ name: "kit-test", version: "0.0.1" }), "CHANGELOG.md": TWO })
    repo.git("tag", "-a", "v0.0.2", "-m", "v0.0.2")
    repo.git("tag", "-a", "v0.0.1", "-m", "v0.0.1")
    const wrong = shapeOf(repo, "v0.0.2")
    assert.match(wrong, /FAIL the version: the tag is v0\.0\.2, and package\.json's version 0\.0\.1 releases only as v0\.0\.1/)
    const right = shapeOf(repo, "v0.0.1")
    assert.match(right, /ok {3}the tag is v0\.0\.1, and the version is 0\.0\.1/)
    assert.doesNotMatch(right, /FAIL the version/)
  })
})

describe("check-release-shape.mjs: package.json is exactly the parent's without its lifecycle scripts", () => {
  const SOURCE = { name: "kit-test", version: "0.0.1", main: "dist/index.js", scripts: { build: "node build.mjs", test: "node --test" } }
  const RELEASED = JSON.parse(releasePackageText(SOURCE))
  const caseOf = (pkgText, tag = "v0.0.1") => {
    const repo = repository({ "package.json": serialise(SOURCE), "CHANGELOG.md": TWO })
    releaseOn(repo, { tag, pkgText })
    return shapeOf(repo, tag)
  }

  test("accepts what release-commit.mjs writes", () => {
    assert.deepEqual(RELEASED.scripts, { test: "node --test" })
    assert.match(caseOf(releasePackageText(SOURCE)), /ok {3}package\.json is the parent's without its lifecycle scripts/)
  })

  test("refuses an added dependency, a changed main or version, reordered keys, a kept build script and another form", () => {
    const { name, ...rest } = RELEASED
    const cases = {
      "an added dependency": serialise({ ...RELEASED, dependencies: { "left-pad": "1.3.0" } }),
      "a changed main": serialise({ ...RELEASED, main: "dist/tui.js" }),
      "reordered keys": serialise({ ...rest, name }),
      "a kept build script": serialise(SOURCE),
      "another JSON form": `${JSON.stringify(RELEASED, null, "\t")}\n`,
    }
    for (const [label, pkgText] of Object.entries(cases)) {
      assert.match(caseOf(pkgText), /FAIL package\.json: it is not exactly the parent's without its lifecycle scripts/, label)
    }
    const version = caseOf(serialise({ ...RELEASED, version: "0.0.2" }), "v0.0.2")
    assert.match(version, /ok {3}the tag is v0\.0\.2/)
    assert.match(version, /FAIL package\.json: it is not exactly the parent's/)
  })
})

describe("check-release-shape.mjs: regular files only, and no package.json in dist/", () => {
  const SOURCE = { name: "kit-test", version: "0.0.1", scripts: { build: "node build.mjs" } }
  const caseOf = (tweak) => {
    const repo = repository({ "package.json": serialise(SOURCE), "CHANGELOG.md": TWO })
    releaseOn(repo, { tag: "v0.0.1", pkgText: releasePackageText(SOURCE), tweak })
    return shapeOf(repo, "v0.0.1")
  }
  const symlink = (path, to) => (repo) => {
    const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.dir, input: to, encoding: "utf8" }).stdout.trim()
    repo.git("update-index", "--add", "--cacheinfo", `120000,${blob},${path}`)
  }

  test("accepts regular files", () => {
    assert.match(caseOf(), /ok {3}every path it changes is a regular file/)
  })

  test("refuses an executable or a symlink in dist/", () => {
    assert.match(caseOf((repo) => repo.git("update-index", "--chmod=+x", "dist/index.js")), /FAIL the file modes: dist\/index\.js is an executable, not a regular file/)
    assert.match(caseOf(symlink("dist/tui.js", "../../outside.js")), /FAIL the file modes: dist\/tui\.js is a symlink, not a regular file/)
  })

  test("refuses a package.json that is executable or a symlink, before reading it", () => {
    assert.match(caseOf((repo) => repo.git("update-index", "--chmod=+x", "package.json")), /FAIL package\.json: package\.json is an executable, not a regular file/)
    const linked = caseOf(symlink("package.json", "dist/index.js"))
    assert.match(linked, /FAIL package\.json: package\.json is a symlink, not a regular file/)
  })

  test("refuses a package.json added anywhere under dist/", () => {
    for (const path of ["dist/package.json", "dist/browser/package.json"]) {
      const out = caseOf((repo) => {
        mkdirSync(join(repo.dir, path, ".."), { recursive: true })
        writeFileSync(join(repo.dir, path), '{ "type": "commonjs" }\n')
        repo.git("add", "-f", path)
      })
      assert.match(out, new RegExp(`FAIL the change from the parent: paths outside the allowed set: ${path.replaceAll(".", "\\.")}`), path)
    }
  })

  test("allowedPath keeps dist/ files and refuses a nested package.json; modeProblems names each mode", () => {
    assert.equal(allowedPath("dist/index.js"), true)
    assert.equal(allowedPath("dist/browser/vega.js"), true)
    assert.equal(allowedPath("dist/package.json"), false)
    assert.equal(allowedPath("dist/a/package.json"), false)
    assert.equal(allowedPath("dist/package.json.map"), true)
    assert.deepEqual(modeProblems([{ path: "a", mode: "100644" }, { path: "b", mode: "100755" }, { path: "c", mode: "120000" }, { path: "d", mode: "160000" }]), [
      "b is an executable, not a regular file",
      "c is a symlink, not a regular file",
      "d is a submodule, not a regular file",
    ])
  })
})

describe("check-release-shape.mjs: releases move forward from the last published Release", () => {
  const PKG = (version) => releasePackageText({ name: "kit-test", version })
  const twoCommits = () => {
    const repo = repository({ "package.json": serialise({ name: "kit-test", version: "0.0.0" }), "CHANGELOG.md": ONE })
    return { repo, first: repo.head, second: laterCommit(repo) }
  }

  test("accepts the first Release, and one whose parent descends from the last Release's parent", () => {
    const { repo, first, second } = twoCommits()
    releaseOn(repo, { tag: "v0.0.0", pkgText: PKG("0.0.0"), from: first })
    assert.match(shapeOf(repo, "v0.0.0"), /ok {3}v0\.0\.0 is the first published Release/)
    repo.setReleases([published("v0.0.0")])
    releaseOn(repo, { tag: "v0.0.1", pkgText: PKG("0.0.1"), from: second })
    assert.match(shapeOf(repo, "v0.0.1"), /ok {3}the parent descends from the parent of v0\.0\.0, the last published Release/)
  })

  test("refuses a release built on older source than the last Release", () => {
    const { repo, first, second } = twoCommits()
    releaseOn(repo, { tag: "v0.0.0", pkgText: PKG("0.0.0"), from: second })
    repo.setReleases([published("v0.0.0")])
    releaseOn(repo, { tag: "v0.0.1", pkgText: PKG("0.0.1"), from: first })
    assert.match(shapeOf(repo, "v0.0.1"), /FAIL the release order: the parent does not descend from the parent of v0\.0\.0, the last Release/)
  })

  test("refuses a version that is not newer than a published Release", () => {
    const { repo, second } = twoCommits()
    releaseOn(repo, { tag: "v0.0.2", pkgText: PKG("0.0.2"), from: second })
    repo.setReleases([published("v0.0.2")])
    releaseOn(repo, { tag: "v0.0.1", pkgText: PKG("0.0.1"), from: second })
    assert.match(shapeOf(repo, "v0.0.1"), /FAIL the release order: the published Release v0\.0\.2 is not older than v0\.0\.1/)
  })

  test("is not blocked by a stray higher tag with no Release, or by a draft", () => {
    const { repo, first, second } = twoCommits()
    releaseOn(repo, { tag: "v0.0.0", pkgText: PKG("0.0.0"), from: first })
    releaseOn(repo, { tag: "v9.9.9", pkgText: PKG("9.9.9"), from: second })
    releaseOn(repo, { tag: "v0.0.2", pkgText: PKG("0.0.2"), from: second })
    repo.setReleases([published("v0.0.0"), draft("v0.0.2"), { ...published("v0.0.3"), draft: true }])
    releaseOn(repo, { tag: "v0.0.1", pkgText: PKG("0.0.1"), from: second })
    const out = shapeOf(repo, "v0.0.1")
    assert.match(out, /ok {3}the parent descends from the parent of v0\.0\.0, the last published Release/)
    assert.doesNotMatch(out, /FAIL the release order/)
  })

  test("refuses, and never passes, when the Releases cannot be listed", () => {
    const { repo, first } = twoCommits()
    releaseOn(repo, { tag: "v0.0.1", pkgText: PKG("0.0.1"), from: first })
    const out = shapeOf(repo, "v0.0.1", { FAKE_GH_FAIL: "1" })
    assert.match(out, /FAIL the release order: the published Releases could not be listed \(HTTP 403: Resource not accessible by integration\), so the order is not checked/)
    assert.doesNotMatch(out, /ok {3}.*(first published Release|descends from)/)
  })

  test("releasedTags keeps published, non-draft v<x.y.z> Releases; fetchReleases reads every page", () => {
    assert.deepEqual(releasedTags([published("v0.0.0"), draft("v0.0.1"), { ...published("v0.0.2"), published_at: null }, published("v1.0.0-rc.1"), published("nightly")]), ["v0.0.0"])
    const calls = []
    const pages = { 1: Array.from({ length: 100 }, (_, i) => published(`v0.0.${i}`)), 2: [published("v0.1.0")] }
    const gh = (args) => {
      calls.push(args[1])
      return JSON.stringify(pages[Number(/page=(\d+)$/.exec(args[1])[1])] ?? [])
    }
    assert.equal(fetchReleases("owner/kit-test", gh).length, 101)
    assert.deepEqual(calls, ["repos/owner/kit-test/releases?per_page=100&page=1", "repos/owner/kit-test/releases?per_page=100&page=2"])
    assert.throws(() => fetchReleases("owner/kit-test", () => '{"message":"Not Found"}'), /did not answer with a list/)
  })
})

describe("release-commit.mjs", () => {
  const source = (version, changelog = TWO) => ({ "package.json": serialise({ name: "kit-test", version }), "CHANGELOG.md": changelog })
  const run = (repo, extra) => repo.node("release-commit.mjs", ["--ci-sha", repo.git("rev-parse", "HEAD"), "--dry-run"], extra)
  // The refusal after every version, tag, CHANGELOG and release-order check: a package with no build script.
  const PAST = /release-commit: package\.json has no "build" script/

  test("refuses a version that is not x.y.z", () => {
    const repo = repository(source("0.0.1-rc.1"))
    assert.match(run(repo).stderr, /release-commit: package\.json version "0\.0\.1-rc\.1" is not x\.y\.z/)
  })

  test("refuses a tag that already exists", () => {
    const repo = repository(source("0.0.1"))
    repo.git("tag", "-a", "v0.0.1", "-m", "v0.0.1")
    assert.match(run(repo).stderr, /release-commit: tag v0\.0\.1 already exists/)
  })

  test("refuses a CHANGELOG that is not ready for the version, before anything is built", () => {
    const repo = repository(source("0.0.1", doc(UNRELEASED, V000, EARLIER)))
    const result = run(repo)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /release-commit: CHANGELOG\.md is not ready for v0\.0\.1: an ## \[Unreleased\] section is still there/)
    assert.match(run(repository(source("0.0.0"))).stderr, /CHANGELOG\.md is not ready for v0\.0\.0: ## \[0\.0\.0\] is not the newest release heading/)
  })

  test("takes the version from package.json, past every version check, as the first Release", () => {
    assert.match(run(repository(source("0.0.1"))).stderr, PAST)
  })

  test("refuses, before any commit or tag, a release that does not move forward from the last published Release", () => {
    const newer = repository(source("0.0.1"), { releases: [published("v0.0.2")] })
    assert.match(run(newer).stderr, /release-commit: the published Release v0\.0\.2 is not older than v0\.0\.1/)

    // v0.0.0 was released on a later commit than the master head this release would be built on.
    const stale = repository(source("0.0.1"), { releases: [published("v0.0.0")] })
    stale.git("checkout", "-q", "-b", "side")
    const later = laterCommit(stale)
    releaseOn(stale, { tag: "v0.0.0", pkgText: releasePackageText({ name: "kit-test", version: "0.0.0" }), from: later })
    const result = run(stale)
    assert.match(result.stderr, /release-commit: the parent does not descend from the parent of v0\.0\.0, the last Release/)
    assert.equal(stale.git("tag", "--list", "v0.0.1"), "")

    const missing = repository(source("0.0.1"), { releases: [published("v0.0.0")] })
    assert.match(run(missing).stderr, /the tag v0\.0\.0 is not in this checkout, so its parent cannot be read: fetch the tags/)
  })

  test("goes past the order check after the last Release, despite a stray tag; refuses when the Releases cannot be listed", () => {
    const repo = repository(source("0.0.1"), { releases: [published("v0.0.0"), draft("v0.0.5")] })
    const first = repo.head
    releaseOn(repo, { tag: "v0.0.0", pkgText: releasePackageText({ name: "kit-test", version: "0.0.0" }), from: first })
    releaseOn(repo, { tag: "v9.9.9", pkgText: releasePackageText({ name: "kit-test", version: "9.9.9" }), from: first })
    laterCommit(repo)
    assert.match(run(repo).stderr, PAST)
    assert.match(run(repo, { FAKE_GH_FAIL: "1" }).stderr, /release-commit: the published Releases of owner\/kit-test could not be listed \(HTTP 403: Resource not accessible by integration\)/)
  })
})

describe("the pack stage's tarball", () => {
  test("is named only as a whole word", () => {
    for (const text of ["process.env.PACK_TARBALL", 'env["PACK_TARBALL"]', '"$PACK_TARBALL"', "${PACKED_DIR}/x.tgz", "const { PACKED_DIR } = process.env"]) {
      assert.equal(namesTarball(text), true, text)
    }
    for (const text of ["process.env.SLACK_PACK_TARBALL", "PACK_TARBALLS", "MY_PACKED_DIR", "PACKED_DIR_2", "pack_tarball"]) {
      assert.equal(namesTarball(text), false, text)
    }
  })

  test("is read by a pack test, not by a longer name or the kit's own files", () => {
    const root = folder()
    mkdirSync(join(root, "scripts"))
    mkdirSync(join(root, "test", "pack"), { recursive: true })
    writeFileSync(join(root, "scripts", "release-pack.mjs"), "env: { PACK_TARBALL: tarball, PACKED_DIR: dir }\n")
    writeFileSync(join(root, "scripts", "release-kit.test.mjs"), "namesTarball('process.env.PACK_TARBALL')\n")
    writeFileSync(join(root, "test", "pack", "pack.test.ts"), "const tarball = process.env.SLACK_PACK_TARBALL\n")
    assert.equal(readsTarball(root), false)
    writeFileSync(join(root, "test", "pack", "install.test.ts"), "const tarball = process.env.PACK_TARBALL\n")
    assert.equal(readsTarball(root), true)
  })
})

describe("publish-release.mjs", () => {
  test("never deletes or replaces an asset: a kit file with other contents stops the upload", () => {
    const dir = folder()
    writeFileSync(join(dir, "SHA256SUMS"), "sums\n")
    writeFileSync(join(dir, "kit-test-0.0.1.tgz"), "tarball\n")
    const calls = []
    const gh = (args) => {
      calls.push(args[1])
      if (args[1] === "view") return JSON.stringify({ isDraft: false, assets: [{ name: "SHA256SUMS" }, { name: "speech.bin" }] })
      if (args[1] === "download") writeFileSync(join(args[args.indexOf("--dir") + 1], "SHA256SUMS"), "other sums\n")
      return ""
    }
    assert.throws(() => publish({ tag: "v0.0.1", dir, notes: join(dir, "SHA256SUMS"), gh }), /SHA256SUMS is on the Release with other contents: nothing was uploaded/)
    assert.deepEqual(calls, ["view", "download"])
  })

  test("adds only the missing kit files, and leaves the assets it does not know alone", () => {
    const dir = folder()
    writeFileSync(join(dir, "SHA256SUMS"), "sums\n")
    writeFileSync(join(dir, "kit-test-0.0.1.tgz"), "tarball\n")
    const calls = []
    const gh = (args) => {
      calls.push(args)
      if (args[1] === "view") return JSON.stringify({ isDraft: false, assets: [{ name: "SHA256SUMS" }, { name: "speech.bin" }] })
      if (args[1] === "download") writeFileSync(join(args[args.indexOf("--dir") + 1], "SHA256SUMS"), "sums\n")
      return ""
    }
    const result = publish({ tag: "v0.0.1", dir, notes: join(dir, "SHA256SUMS"), gh })
    assert.deepEqual(result, { action: "uploaded", uploaded: ["kit-test-0.0.1.tgz"], unknown: ["speech.bin"] })
    assert.deepEqual(calls.map((args) => args[1]), ["view", "download", "upload"])
    assert.ok(calls.every((args) => !args.includes("delete") && !args.includes("--clobber")))
  })
})
