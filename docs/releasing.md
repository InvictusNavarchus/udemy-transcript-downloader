# Releasing

Everything about cutting a release: the steps, what the tooling does behind them, and how to write the changelog entries that become the release notes.

Preparing a release (writing the changelog, choosing the version, previewing) is usually done by an AI agent; a human reviews that and performs the release itself. The steps below are marked with who does them; [`AGENTS.md`](../AGENTS.md) sets out an agent's part and what it must not do.

## 1. The steps

1. **Write changelog entries** (agent or human) under `## [Unreleased]` at the top of [`CHANGELOG.md`](../CHANGELOG.md). Ideally each user-visible change adds its entry in the same commit, while the context is fresh. Before a release, check that the section covers everything since the last tag:

   ```bash
   git log --no-merges --format='%h %s' "$(git describe --tags --abbrev=0)"..HEAD
   ```

   See [§3](#3-writing-changelog-entries) for what to write. Never add a version heading by hand; the release turns `[Unreleased]` into one.

2. **Choose the version** (agent proposes, human decides). While the version is below 1.0:
   - **minor** (`0.2.0` → `0.3.0`) when the release adds something or changes behaviour: anything under Added, Changed, Deprecated or Removed, or an `**Upgrading:**` note.
   - **patch** (`0.2.0` → `0.2.1`) when it only fixes bugs.

3. **Check and preview** (agent or human):

   ```bash
   bun run compile && bun run test
   bun run release minor --dry-run   # or patch
   ```

   Commit the changelog first: release-it refuses to run on a dirty working tree, even as a dry run. The dry run shows the new version, the release notes (the `[Unreleased]` section), and every command the real run would execute, and changes nothing. It does **not** run the hooks, so it does not type-check, test or build; that is why the first line is there. It fails if `[Unreleased]` is empty.

4. **Run the live smoke test** (human). Udemy's API can change without notice, and only a browser logged in to Udemy can check it: follow "Live smoke test" in the Testing section of [docs/development.md](development.md#testing).

5. **Release** (human):

   ```bash
   bun run release minor   # or patch
   ```

   release-it asks before each step (commit, tag, push, GitHub release); answer yes to each. Requirements: the `master` branch with a clean working tree and an upstream, `gh` logged in to GitHub, and your Git signing key, since the release commit and tag are signed.

6. **Check the release page** (human): the notes, both ZIPs attached, and the release marked Latest.

**Never create a release or a `v*` tag by hand** in Git or the GitHub web UI: the version in `package.json`, the changelog section, the tag and the ZIPs would no longer match.

## 2. What happens behind the steps

[`.release-it.json`](../.release-it.json) configures [release-it](https://github.com/release-it/release-it) and its [keep-a-changelog plugin](https://github.com/release-it/keep-a-changelog). `bun run release` reads a GitHub token from `gh auth token` and runs, in order:

1. **Checks:** on `master`, clean working tree, then `bun run compile` and `bun run test`. A failure stops the release before anything changes.
2. **Version bump** in `package.json`. WXT copies it into both manifests, so nothing else holds a version.
3. **Changelog rollover:** `## [Unreleased]` becomes `## [0.3.0] - <date>`, a fresh empty `## [Unreleased]` goes above it, and the compare links at the bottom gain a line for the new version.
4. **Build:** `bun run zip` and `bun run zip:firefox` write `.output/udemy-transcript-downloader-<version>-chrome.zip` and `-firefox.zip`. The Firefox build also writes a `-sources.zip`, which is not attached to the release (GitHub offers the tagged source already) but is what Firefox Add-ons asks for if the extension is ever submitted there.
5. **Commit and tag:** a signed commit `chore(release): bump version to v<version>` with the two files, and a signed annotated tag `v<version>`, both pushed.
6. **GitHub release** named `v<version>`, with the version's changelog section as its notes. release-it creates it as a draft, uploads both ZIPs, and only then publishes it, so the release never appears without its files. It is a normal release, not a pre-release, so the README's `releases/latest` download links point to it.

### If a release fails part-way

- **Before the commit** (failed check or build, or you answered no): nothing was committed or pushed. Undo the bump with `git restore package.json CHANGELOG.md`, fix the cause, and start again.
- **After the tag was pushed, but the GitHub release failed:** don't bump again. `bun run release --no-increment --no-git` rebuilds the ZIPs and creates the GitHub release for the existing tag, using that version's changelog section.

## 3. Writing changelog entries

The notes are for **someone updating the extension**, not someone reading the diff. Commit messages already explain the code to maintainers; the changelog tells users what changed for them.

### What a version's section can contain

All parts are optional; use what the release needs, in this order. Omit empty headings.

| Part                  | Use it when                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Lead paragraph        | Big releases only. One to three sentences: what changed overall.                                                                             |
| `**Upgrading:**` note | Updating costs the user something or needs an action: saved downloads are deleted, a new permission prompts, the extension must be reloaded. |
| `### Added`           | Something new to use: a feature, button, setting, supported browser.                                                                         |
| `### Changed`         | Something existing behaves differently: defaults, file names, output format, permissions.                                                    |
| `### Deprecated`      | Still works, but will be removed later.                                                                                                      |
| `### Removed`         | Gone: a feature, setting or supported browser.                                                                                               |
| `### Fixed`           | A bug that happened, or one that could have.                                                                                                 |
| `### Security`        | Anything about a vulnerability, including dependency updates made for one.                                                                   |

Start an entry with `**Behaviour change:**` when it could surprise someone who updates without reading further.

### What gets an entry

The deciding question is **would someone updating notice this, or need to act on it?**, not what type of commit it was.

- A `fix`, `feat` or `uiux` commit usually gets one. A `refactor` that makes downloads noticeably faster gets one too.
- Tests, refactors, dependency updates, build and tooling changes, and most documentation changes do not. They are in `git log`, which the compare links cover.
- **Compare with the last release, not commit by commit.** A bug introduced and fixed again since the last release never reached users, so it gets no entry; describe only the net result of the feature it was in.

**Hardening counts as a fix** if you can finish this sentence: "Before this, \_\_\_ could happen when ___." Write it with "could", so it claims nothing that did not happen:

```markdown
- The ZIP download could be cancelled in some browsers because its link was released too early.
```

If the only honest description is "more robust" or "improved stability", with no concrete condition, it gets no entry.

### Style

- One line per paragraph and per bullet; don't hard-wrap. GitHub shows single line breaks in release notes as line breaks.
- Describe what the user sees, using the popup's own words in quotes or bold ("Pausing", **Save ZIP**).
- Leave out commit hashes, file paths and function names.

### When a release has only internal changes

Usually, don't release: nothing reaches users, and the work ships with the next release that does. If you release anyway, write one honest line, which also tells users that updating is optional:

```markdown
### Changed

- Internal changes only; no change in behaviour.
```
