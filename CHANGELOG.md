# Changelog

Notable changes to Udemy Transcript Downloader, newest first. Each version's section is published verbatim as its GitHub release notes, so write entries for someone updating the extension, not for someone reading the diff. How to write entries and cut a release: [docs/releasing.md](docs/releasing.md).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A welcome page opens on first install explaining how to pin the toolbar icon and start a download, and can be reopened anytime from the `?` button in the popup.

## [0.2.0] - 2026-11-22

Downloads are now kept per course, in any caption language, and can be paused, resumed and retried from any tab. Many transcript and file-name bugs are fixed.

**Upgrading:** the update deletes the download state saved by 0.1.0. A finished course shows Start again; a paused download has to be started over.

### Added

- Choose the transcript language before starting. The list comes from the course's first lectures with captions; when none are found, English is offered and labelled as a fallback.
- A "Saved courses" list in the popup, available from any tab, shows every downloaded course with its status, progress and approximate size. **Save ZIP** rebuilds the ZIP without fetching the lectures again, **Delete** frees the space, and running downloads can be paused from there.
- Failed lectures are listed with the reason they failed and can be retried without starting the course over. The download log can be viewed in the popup.
- The toolbar icon shows the download progress of its tab.
- Downloads interrupted by closing or reloading the tab are shown as Interrupted and can be resumed.

### Changed

- **Behaviour change:** each course keeps its own download, and the popup shows the course in the active tab. Before, it showed whichever course was started last.
- After clicking Pause, the popup shows "Pausing" until the current lecture finishes, with Resume to cancel the pause.
- Only video lectures are downloaded. Articles, e-books and files no longer add empty "[No Transcript Available]" files to the ZIP or push the progress past its total (e.g. "34 / 30").
- ZIP and file names no longer start with "Course", and the merged file's heading no longer starts with "Course:".
- File names keep accented letters and non-Latin scripts, turn dashes into hyphens and collapse repeated spaces. Before, "Café" became "Caf", and titles in other scripts became "untitled".
- The extension requests the `unlimitedStorage` permission so that several saved courses fit. Chrome shows no prompt for it.

### Fixed

- Courses whose English captions are en_GB, en_AU or another English locale than en_US got "[No Transcript Available]" for every lecture. When several tracks match the chosen language, instructor-written captions are now preferred over auto-generated ones.
- Courses with more than 1000 curriculum items were cut off, and the missing lectures were silently left out of the ZIP.
- Caption lines that were only a number ("2024") or began with a time ("10:30 is when…") were dropped from transcripts.
- A failed request (rate limit, server error or dropped connection) was saved as "[No Transcript Available]" and never retried. Such lectures are now marked as failed and fetched again on retry.
- Clicking Resume shortly after Pause, or Start twice, could run two downloads in one tab and count progress twice.
- Opening a course on a quiz, practice or landing page left the popup asking to refresh the page.
- Course names containing "|" were cut off at the first "|".
- The ZIP download could be cancelled in some browsers, notably older Firefox releases, because its link was released too early.

## [0.1.0] - 2025-12-25

Initial working prototype.

[Unreleased]: https://github.com/InvictusNavarchus/udemy-transcript-downloader/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/InvictusNavarchus/udemy-transcript-downloader/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/InvictusNavarchus/udemy-transcript-downloader/releases/tag/v0.1.0
