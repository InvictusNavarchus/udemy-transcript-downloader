# Working on Udemy Transcript Downloader

## Changelog entries

When a change is user-visible, add its entry under `## [Unreleased]` in `CHANGELOG.md` in the same commit. Follow "Writing changelog entries" in [docs/releasing.md](docs/releasing.md#3-writing-changelog-entries): write for someone updating the extension, and compare with the last release rather than listing commits.

## Preparing a release

Agents prepare releases; a human reviews the preparation and performs the release. Read [docs/releasing.md](docs/releasing.md) before starting. When asked to prepare a release:

1. List the commits since the last tag:

   ```bash
   git log --no-merges --format='%h %s' "$(git describe --tags --abbrev=0)"..HEAD
   ```

   Read the bodies of the `feat`, `fix` and `uiux` commits, and of any other commit that may change what users see. Check that `[Unreleased]` covers every user-visible change, and add or rewrite entries where it doesn't. Leave out bugs introduced and fixed again since the last tag; a commit body that says "Fixes a regression from <hash>" usually marks one.
2. Propose the increment (`minor` or `patch`) using the rules in docs/releasing.md, and say which entries decide it.
3. Commit only `CHANGELOG.md`, as `docs(changelog): prepare <version>` (for example `docs(changelog): prepare 0.3.0`), so the human can review the release notes in a single commit. Commit before previewing: release-it refuses to run, even as a dry run, on a dirty working tree.
4. Run `bun run compile && bun run test`, then `bun run release <increment> --dry-run`. Report the outcome, and quote the release notes from the dry-run output. If the preview shows a problem in the notes, fix it in a new commit or amend yours; it has not been pushed.
5. Hand over: the proposed increment, the command for the human to run (`bun run release <increment>`), and anything you were unsure about. Mention that the live smoke test in docs/development.md is still theirs to run.

Never perform the release itself. Do not:

- run `bun run release` or `release-it` without `--dry-run`;
- change `version` in `package.json`, or add a version heading or compare link to `CHANGELOG.md` by hand;
- create, move, delete or push `v*` tags;
- create, edit or publish GitHub releases, for example with `gh release`.

The release commit and tag are signed with the human's key, and a published release is what users download. If a release fails part-way, report what you see and point to "If a release fails part-way" in docs/releasing.md; leave the recovery to the human.
