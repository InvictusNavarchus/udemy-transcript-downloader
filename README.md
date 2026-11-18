# Udemy Transcript Downloader

[![Version](https://img.shields.io/badge/version-0.1.0-orange)](https://github.com/InvictusNavarchus/udemy-transcript-downloader)
[![License](https://img.shields.io/badge/license-MPL--2.0-green)](https://mozilla.org/MPL/2.0/)
[![Built with WXT](https://img.shields.io/badge/built%20with-WXT-7c3aed)](https://wxt.dev/)

A browser extension that enables you to download complete course transcripts from Udemy lectures as markdown files, organized by chapters and packaged into a convenient ZIP archive.

## 🎯 Features

- **One-Click Download**: Start downloading all transcripts from a course with a single click
- **Language Choice**: Pick any caption language the course offers; English is preselected the first time, then your last choice
- **Chapter Organization**: Transcripts are automatically organized into folders by chapter
- **Pause & Resume**: Pause downloads mid-process and resume exactly where you left off
- **ZIP Export**: All transcripts are bundled into a single ZIP file for easy distribution
- **Saved Courses**: The popup lists every course you've downloaded with its status and storage size. Save a course's ZIP again without re-downloading, or delete it to free space
- **Merged Transcript**: Includes a full course transcript combining all lectures
- **Real-Time Progress**: Live progress tracking shows exactly which lecture is being processed, and the toolbar icon of a downloading tab shows its percentage (grey while paused, ✓ when finished, ! on error)
- **Robust Error Handling**: Gracefully handles missing transcripts and API errors
- **Cross-Browser Support**: Works on Chrome/Edge and Firefox
- **Lightweight & Efficient**: Random request delays prevent API rate limiting

## 📋 How It Works

1. Open the course player of a Udemy course you're enrolled in (any lecture page)
2. Click the extension icon in your toolbar. The popup shows the course open in the active tab
3. Click **"Start Download"** to begin fetching transcripts
4. The extension:
   - Extracts the course structure from the page
   - Fetches captions from Udemy's API for each lecture
   - Converts VTT format captions to readable markdown
   - Organizes lectures by chapter
   - Generates a ZIP file with individual chapter folders plus a merged full transcript
5. The ZIP file automatically downloads to your default download folder

### Data Flow

```
Lecture Page (Data Extraction)
    ↓
Curriculum Fetch (Course Structure)
    ↓
Transcript Loop (Per Lecture)
    ├─ Caption Fetch (from Udemy API)
    ├─ VTT → Markdown Conversion
    ├─ Progress Update
    └─ Local State Persistence
    ↓
ZIP Generation (File Organization)
    ├─ Chapter Folders
    ├─ Individual .md Files
    └─ Full Transcript Merge
    ↓
Download Trigger
```

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

## 🛠️ Development

<details>
<summary>Click to see setup instructions and development guide</summary>

### Prerequisites

- [Bun](https://bun.sh/) - JavaScript runtime and package manager
- Node.js `^22.12`, `^24`, or `>=26`. Required even with Bun: `bun run` starts the WXT and Vitest CLIs with Node. Vitest 5 sets this range and doesn't support Node 23 or 25
- Git

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd udemy-transcript-downloader
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Start development server**
   ```bash
   bun run dev
   ```
   
   For Firefox:
   ```bash
   bun run dev:firefox
   ```

   The dev server doesn't open a browser. Load the unpacked extension yourself from `.output/chrome-mv3-dev` or `.output/firefox-mv3-dev`. WXT only launches a browser when the optional `web-ext` package is installed.

### Project Structure

```
src/
├── entrypoints/
│   ├── background.ts           # Toolbar badge; migrates state saved by older versions
│   ├── content.ts              # Main content script - orchestrates downloads
│   └── popup/
│       ├── index.html          # Popup UI
│       ├── main.ts             # Popup controller and state binding
│       └── style.css           # Popup styling
├── utils/
│   ├── types.ts                # TypeScript interfaces
│   ├── udemy-api.ts            # Udemy API integration
│   ├── file-generator.ts       # ZIP file creation and download
│   ├── storage.ts              # Persistent state management
│   └── helpers.ts              # Utility functions
└── assets/                     # Extension assets (icons, etc.)
scripts/
└── smoke-test.js               # Console check against the live Udemy API
test/
├── fixtures/                   # Trimmed snapshots of real Udemy responses
└── utils/                      # Vitest tests for src/utils
```

### Available Commands

| Command | Purpose |
|---------|---------|
| `bun run dev` | Start development with live reloading (Chrome/Edge) |
| `bun run dev:firefox` | Start development for Firefox with MV3 |
| `bun run build` | Build extension for production (Chrome/Edge) |
| `bun run build:firefox` | Build extension for Firefox |
| `bun run zip` | Create distributable ZIP (Chrome/Edge) |
| `bun run zip:firefox` | Create distributable ZIP (Firefox) |
| `bun run compile` | Type-check TypeScript (no emit) |
| `bun run test` | Run the Vitest suite once |
| `bun run test:watch` | Run Vitest in watch mode |

### Type Checking

Always check for type errors when making changes:

```bash
bun run compile
```

### Testing

Testing has two layers, because the extension depends on an API it doesn't control:

- **Offline tests (`bun run test`)**: Vitest runs the code in `src/utils` against fixtures in `test/fixtures/`, which are dated snapshots of real Udemy responses. They check that, given those responses, the code produces the right output. Run them on every change. Known bugs are marked `it.fails`. When you fix one, that test starts failing, which tells you to turn it into a normal test.
- **Live smoke test (`scripts/smoke-test.js`)**: checks whether Udemy still returns what the extension expects. Open any lecture page of a course you're enrolled in, paste the script into the DevTools console, and read the pass/fail table. Run it before a release or when downloads break. If Udemy has changed a format, run `copy(__udemyFixtures)` to capture the new responses and add them as a new fixture set (see `test/fixtures/README.md`).

### Technology Stack

- **Language**: TypeScript 7+
- **Framework**: [WXT](https://wxt.dev/) 0.21+ (Web Extension Framework) on [Vite](https://vite.dev/) 8
- **Runtime & Package Manager**: Bun 1.3.1+
- **Compression**: [fflate](https://github.com/101arrowz/fflate) 0.8.3 (ZIP compression)
- **Testing**: [Vitest](https://vitest.dev/) 5 with happy-dom

</details>

## 📦 Architecture

### Entry Points

#### Content Script (`content.ts`)
- Runs on all Udemy course pages (`*://www.udemy.com/course/*`), since Udemy moves between them without full page loads; downloads start from the course player (lecture, quiz, etc.)
- Orchestrates the entire download workflow
- Implements pause/resume functionality through state management
- Recoverable: saves state after each lecture for crash resilience
- Keeps a separate state per course (`local:course:<id>`), so different courses can download in different tabs. Only the tab running a download writes its state; Pause is a message to that tab

**Workflow**:
1. Extract course ID and title from page DOM
2. Fetch complete course curriculum
3. Iterate through lectures and fetch transcripts
4. Save progress to persistent storage after each lecture
5. Generate ZIP file when complete
6. Support pause/resume mid-process

#### Background Script (`background.ts`)
- On install or update, moves a download saved by older versions (one shared state) into its course's state
- Sets the toolbar badge for a downloading tab, since content scripts cannot use the action API

#### Popup Script (`main.ts`)
- Shows the course open in the active tab, or explains what to open (a non-Udemy tab, the course landing page, or a page that needs a reload)
- Provides UI for user control (Start, Pause, Resume)
- If the course is downloading in another tab, says so and offers to switch to it
- If a download's tab was closed or reloaded mid-download, shows it as Interrupted with Resume, instead of Running forever
- Lists all saved courses (from any tab, Udemy or not) with status, progress and approximate storage size. **Save ZIP** rebuilds the ZIP from stored transcripts in the popup itself; **Delete** asks for a second click and is unavailable while a tab is downloading that course
- Displays real-time progress, current task, and status badge
- Uses reactive storage watching for automatic UI updates
- Sends messages to content script to trigger actions

#### Popup UI (`index.html` + `style.css`)
- Clean, minimal interface matching Udemy's design language
- Progress bar with lecture counter
- Status badge (Not started, Running, Pausing, Paused, Completed, Error). Pause takes effect after the lecture being fetched, so the popup shows "Pausing" until then; Resume during that time cancels the pause
- Current task description for transparency

**API Endpoints**:
- Curriculum: `https://www.udemy.com/api-2.0/courses/{courseId}/subscriber-curriculum-items/`
- Transcripts: `https://www.udemy.com/api-2.0/users/me/subscribed-courses/{courseId}/lectures/{lectureId}/`

### Endpoints Used

1. **Curriculum Endpoint**
   ```
   GET /api-2.0/courses/{courseId}/subscriber-curriculum-items/
   ```
   Returns chapters, lectures, and quizzes with metadata

2. **Lecture Endpoint**
   ```
   GET /api-2.0/users/me/subscribed-courses/{courseId}/lectures/{lectureId}/
   ```
   Returns asset details including caption URLs

### Error Handling
- Lectures without any captions are included as "[No Transcript Available]"
- Lectures without captions in the chosen language say which languages they do have, e.g. "[No German transcript. Available: English, Spanish]", so you know a download in another language would fill the gap
- A failed request (HTTP error, rate limit, network) is not treated as "no transcript": the lecture is marked "[Transcript download failed: …]" in the ZIP and stays unfinished. The popup lists failed lectures with the reason, and **Retry N failed** fetches only those and saves a new ZIP
- If a download stops with an error (e.g. storage), **Resume** continues from the saved progress; **Start Over** fetches everything again
- The popup shows the download's log (the last 50 entries)
- Continues processing even if individual lecture fails

## 🔒 Permissions

The extension requests minimal permissions:

| Permission | Purpose |
|-----------|---------|
| `storage` | Persist download state locally |
| `unlimitedStorage` | Keep the transcripts of several courses. Chrome otherwise caps extension storage at 10 MB, and a large course alone can take a few MB |
| `activeTab` | Detect active Udemy page |
| `host_permissions: https://www.udemy.com/*` | API access to Udemy services |

No data is sent to external servers except Udemy's official API.

## 💾 Auto Recover

Downloads are fully recoverable via persistent storage:

If the tab is closed or reloaded, or the browser closes mid-download, the popup shows the course as **Interrupted**. Open the course again and click **Resume** to continue from the last completed lecture.

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


## ⚠️ Limitations

- **Enrollment Required**: Only works for courses you're enrolled in
- **One Language per Download**: The language list comes from the course's first lecture with captions, so a few lectures may lack the chosen language. Locales are merged (US and UK English are both "English"), and instructor-written captions are preferred over auto-generated ones
- **Video Lectures Only**: Skips non-video content (quizzes, documents)
- **API Dependent**: Requires Udemy API availability (can be shutdown by Udemy at any time)
- **Rate Limiting**: Random delays to prevent API throttling may increase download time

## 📄 License

This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Create a feature branch (`git checkout -b feature/amazing-feature`)
2. Make your changes and ensure type safety
3. Run type checking and tests: `bun run compile && bun run test`
4. Commit with conventional commit messages: `feat:`, `fix:`, `docs:`, etc.
5. Push and create a Pull Request

## 📚 Resources

- [WXT Documentation](https://wxt.dev/) - Web extension framework

