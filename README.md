# Udemy Transcript Downloader

[![Version](https://img.shields.io/github/v/release/InvictusNavarchus/udemy-transcript-downloader?label=version&color=orange)](https://github.com/InvictusNavarchus/udemy-transcript-downloader/releases/latest)
[![License](https://img.shields.io/badge/license-MPL--2.0-green)](https://mozilla.org/MPL/2.0/)
[![Built with WXT](https://img.shields.io/badge/built%20with-WXT-7c3aed)](https://wxt.dev/)

A browser extension that enables you to download complete course transcripts from Udemy lectures as markdown files, organized by chapters and packaged into a convenient ZIP archive.

## 🎯 Features

- **One-Click Download**: Start downloading all transcripts from a course with a single click
- **Language Choice**: Pick any caption language the course offers; English is preselected the first time, then your last choice
- **Chapter Organization**: Transcripts are organized into one folder per chapter, plus a merged transcript of the whole course, bundled into a single ZIP file
- **Pause & Resume**: Pause downloads mid-process and resume exactly where you left off, even after the tab or browser was closed
- **Saved Courses**: The popup lists every course you've downloaded with its status and storage size. Save a course's ZIP again without re-downloading, or delete it to free space
- **Real-Time Progress**: Live progress tracking shows exactly which lecture is being processed, and the toolbar icon of a downloading tab shows its percentage (grey while paused, ✓ when finished, ! on error)
- **Robust Error Handling**: Lectures without a transcript are marked in the ZIP, and lectures that failed to download can be retried on their own
- **Cross-Browser Support**: Works on Chrome/Edge and Firefox

## 📥 Installation

> [!IMPORTANT]
> Chrome/Edge and Firefox: Not yet available on official extension stores. Use the manual installation steps below.

<details>
<summary>Click for manual installation instructions</summary>

### Download from GitHub Releases

#### For Google Chrome/Edge:

1. Download the latest Chrome extension package from [GitHub Releases](https://github.com/InvictusNavarchus/udemy-transcript-downloader/releases/latest)
2. Extract the downloaded ZIP file to a folder on your computer.
3. Open Chrome/Edge and navigate to `chrome://extensions/`.
4. Enable **Developer mode** (toggle in the top right).
5. Click on **Load unpacked**.
6. Select the extracted folder containing the extension files.

#### For Mozilla Firefox:

1. Download the latest Firefox extension package from [GitHub Releases](https://github.com/InvictusNavarchus/udemy-transcript-downloader/releases/latest)
2. Extract the downloaded ZIP file to a folder on your computer.
3. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
4. Click on **Load Temporary Add-on...**.
5. Select the `manifest.json` file located inside the extracted folder.

The extension icon should now appear in your browser's toolbar.

</details>

## 📋 Usage

1. Open the course player of a Udemy course you're enrolled in (any lecture page)
2. Click the extension icon in your toolbar. The popup shows the course open in the active tab, or tells you what to open instead (for example, on a course's landing page or a page that needs a reload)
3. Choose the transcript language if you want a different one, then click **Start Download**
4. When every lecture is done, the ZIP file downloads to your default download folder

The download runs in the course's tab, so keep that tab open until it finishes.

### Controls and Status

- **Pause** takes effect after the lecture being fetched, so the status shows **Pausing** until then. **Resume** during that time cancels the pause
- If the course is already downloading in another tab, the popup says so and offers to switch to it
- **Saved courses** lists every course you've downloaded, from any tab (Udemy or not), with its status, progress and approximate storage size:
  - **Save ZIP** rebuilds the ZIP from the stored transcripts, without fetching anything again
  - **Delete** asks for a second click, and is unavailable while a tab is downloading that course
  - A running course has **Pause**, which also works when Udemy has moved that tab to another course page while it keeps downloading
- The popup shows the download's log (the last 50 entries)

## 📝 File Output Format

### ZIP Structure

```
CourseTitle_Transcripts.zip
├── 01_Chapter1/
│   ├── 01_Lecture1.md
│   ├── 02_Lecture2.md
│   └── ...
├── 02_Chapter2/
│   ├── 01_Lecture1.md
│   └── ...
└── CourseTitle_Full.md
```

### Markdown Format

- Clean, plain text with light markdown formatting
- Timestamps and metadata removed for readability
- Properly formatted for note-taking and searching
- Compatible with all markdown viewers and note-taking apps

## 🩹 When Something Goes Wrong

- **The tab was closed or reloaded, or the browser closed, mid-download**: the popup shows the course as **Interrupted**. Open the course again and click **Resume** to continue from the last completed lecture
- **Some lectures failed to download** (HTTP error, rate limit, network): the other lectures continue, and each failed one is marked "[Transcript download failed: …]" in the ZIP. The popup lists the failed lectures with the reason, and **Retry N failed** fetches only those and saves a new ZIP
- **The download stopped with an error**: **Resume** continues from the saved progress; **Start Over** fetches everything again. If loading the lecture list itself failed, there is nothing to continue and only Start Over is offered. If the error status can't be saved either (e.g. storage full), the course shows as Interrupted, which also offers Resume
- **A lecture has no transcript**: it is included as "[No Transcript Available]". If it has captions, just not in the chosen language, it says which languages it does have, e.g. "[No German transcript. Available: English, Spanish]", so you know a download in another language would fill the gap

## 🔒 Permissions

The extension requests minimal permissions:

| Permission                                  | Purpose                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                   | Persist download state locally                                                                                                        |
| `unlimitedStorage`                          | Keep the transcripts of several courses. Chrome otherwise caps extension storage at 10 MB, and a large course alone can take a few MB |
| `activeTab`                                 | Detect active Udemy page                                                                                                              |
| `host_permissions: https://www.udemy.com/*` | API access to Udemy services                                                                                                          |

No data is sent to external servers except Udemy's official API.

## ⚠️ Limitations

- **Enrollment Required**: Only works for courses you're enrolled in
- **One Language per Download**: The language list comes from the course's first lecture with captions, so a few lectures may lack the chosen language. Locales are merged (US and UK English are both "English"), and instructor-written captions are preferred over auto-generated ones
- **Video Lectures Only**: Skips non-video content (quizzes, documents)
- **API Dependent**: Requires Udemy API availability (can be shutdown by Udemy at any time)
- **Rate Limiting**: Random delays to prevent API throttling may increase download time

## 🛠️ Development

Setup, commands, testing, releasing and how the extension works inside: [docs/development.md](docs/development.md).

## 📄 License

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Create a feature branch (`git checkout -b feature/amazing-feature`)
2. Make your changes and ensure type safety
3. Run type checking and tests: `bun run compile && bun run test`
4. Add an entry under `[Unreleased]` in `CHANGELOG.md` for user-visible changes (see [docs/releasing.md](docs/releasing.md#3-writing-changelog-entries))
5. Commit with conventional commit messages: `feat:`, `fix:`, `docs:`, etc.
6. Push and create a Pull Request
