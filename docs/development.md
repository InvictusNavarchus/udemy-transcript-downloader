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

## Project Layout

- `src/entrypoints/`: the content script, background script and popup. WXT builds the manifest from them
- `src/utils/`: everything else, including the Udemy API client, the download loop and ZIP generation. The tests cover this directory
- `scripts/smoke-test.js`: console check against the live Udemy API
- `test/fixtures/`: trimmed snapshots of real Udemy responses; `test/utils/`: Vitest tests for `src/utils`

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

TypeScript, [WXT](https://wxt.dev/) on [Vite](https://vite.dev/), Bun as package manager, [fflate](https://github.com/101arrowz/fflate) for the ZIP, and [Vitest](https://vitest.dev/) with happy-dom. `package.json` has the versions.

## Architecture

The extension has three parts, which talk through messages and extension storage:

- **Content script** (`content.ts`) runs the download in the course's tab. It reads the course ID from the page, fetches the curriculum, then fetches each lecture's captions, converts them from VTT to Markdown and saves progress after every lecture, so a closed tab can resume from the last completed one. When all lectures are done, it builds the ZIP. It runs on every course page (`*://www.udemy.com/course/*`), not only the player, because Udemy moves between course pages without full page loads and a content script is only injected on a full load.
- **Popup** (`popup/main.ts`) shows the state it reads from storage, updating as it changes, and sends the content script Start, Pause and Resume messages. A course whose status is still running while no open tab reports a running download is shown as Interrupted.
- **Background** (`background.ts`) sets the toolbar badge for the content script, which cannot use the action API itself. On install or update it also removes the single shared state older versions saved.

Each course has its own state (`local:course:<id>`), so different courses can download in different tabs. Only the tab running a download writes its state; Pause is a message to that tab.

A failed request is never treated as "no transcript": the lecture stays unfinished, so Resume or Retry fetches it again.

### Udemy Endpoints

- `GET /api-2.0/courses/{courseId}/subscriber-curriculum-items/`: chapters, lectures and quizzes
- `GET /api-2.0/users/me/subscribed-courses/{courseId}/lectures/{lectureId}/`: a lecture's asset, including its caption URLs
