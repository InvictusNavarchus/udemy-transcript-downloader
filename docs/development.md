# Development

How to set up, test and release the extension, and how it works inside. For what the extension does and how to use it, see the [README](../README.md).

## Prerequisites

- [Bun](https://bun.sh/) - JavaScript runtime and package manager
- Node.js `^22.12`, `^24`, or `>=26`. Required even with Bun: `bun run` starts the WXT and Vitest CLIs with Node. Vitest 5 sets this range and doesn't support Node 23 or 25
- Git

## Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/InvictusNavarchus/udemy-transcript-downloader.git
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

## Project Structure

```
src/
├── entrypoints/
│   ├── background.ts           # Toolbar badge; removes state saved by older versions
│   ├── content.ts              # Content script - answers the popup, runs the downloader
│   └── popup/
│       ├── index.html          # Popup UI
│       ├── main.ts             # Popup controller and state binding
│       └── style.css           # Popup styling
├── utils/
│   ├── types.ts                # TypeScript interfaces
│   ├── udemy-api.ts            # Udemy API integration
│   ├── download.ts             # Download loop: progress, pause/resume, ZIP
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

## Available Commands

| Command                 | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `bun run dev`           | Start development with live reloading (Chrome/Edge) |
| `bun run dev:firefox`   | Start development for Firefox with MV3              |
| `bun run build`         | Build extension for production (Chrome/Edge)        |
| `bun run build:firefox` | Build extension for Firefox                         |
| `bun run zip`           | Create distributable ZIP (Chrome/Edge)              |
| `bun run zip:firefox`   | Create distributable ZIP (Firefox)                  |
| `bun run compile`       | Type-check TypeScript (no emit)                     |
| `bun run test`          | Run the Vitest suite once                           |
| `bun run test:watch`    | Run Vitest in watch mode                            |
| `bun run release`       | Cut a release (see [Releasing](#releasing))         |

## Type Checking

Always check for type errors when making changes:

```bash
bun run compile
```

## Testing

Testing has two layers, because the extension depends on an API it doesn't control:

- **Offline tests (`bun run test`)**: Vitest runs the code in `src/utils` against fixtures in `test/fixtures/`, which are dated snapshots of real Udemy responses. They check that, given those responses, the code produces the right output. Run them on every change. Known bugs are marked `it.fails`. When you fix one, that test starts failing, which tells you to turn it into a normal test.
- **Live smoke test (`scripts/smoke-test.js`)**: checks whether Udemy still returns what the extension expects. Open any lecture page of a course you're enrolled in, paste the script into the DevTools console, and read the pass/fail table. Run it before a release or when downloads break. If Udemy has changed a format, run `copy(__udemyFixtures)` to capture the new responses and add them as a new fixture set (see `test/fixtures/README.md`).

## Releasing

User-visible changes get an entry under `[Unreleased]` in [`CHANGELOG.md`](../CHANGELOG.md), which becomes the next release's notes. `bun run release` (with [release-it](https://github.com/release-it/release-it)) bumps the version, rolls the changelog over, builds both ZIPs, and publishes a signed tag and GitHub release. Preview with `--dry-run` first. The steps and how to write entries: [docs/releasing.md](releasing.md).

## Technology Stack

- **Language**: TypeScript 7+
- **Framework**: [WXT](https://wxt.dev/) 0.21+ (Web Extension Framework) on [Vite](https://vite.dev/) 8
- **Runtime & Package Manager**: Bun 1.3.1+
- **Compression**: [fflate](https://github.com/101arrowz/fflate) 0.8.3 (ZIP compression)
- **Testing**: [Vitest](https://vitest.dev/) 5 with happy-dom

## Architecture

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

### Entry Points

#### Content Script (`content.ts`)

- Runs on all Udemy course pages (`*://www.udemy.com/course/*`), since Udemy moves between them without full page loads; downloads start from the course player (lecture, quiz, etc.)
- Answers the popup's messages and runs the download loop from `utils/download.ts`, which orchestrates the download workflow
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

- On install or update, deletes the state saved by older versions (one shared state for all courses). Its download is not carried over; start the course again
- Sets the toolbar badge for a downloading tab, since content scripts cannot use the action API

#### Popup Script (`main.ts`)

- Shows the course open in the active tab, or explains what to open
- Provides UI for user control (Start, Pause, Resume)
- Detects a download whose tab was closed or reloaded mid-download and shows it as Interrupted, instead of Running forever
- Uses reactive storage watching for automatic UI updates
- Sends messages to content script to trigger actions

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

- A failed request is not treated as "no transcript": the lecture stays unfinished, so a retry fetches it again
- Continues processing even if individual lecture fails

## Resources

- [WXT Documentation](https://wxt.dev/) - Web extension framework
