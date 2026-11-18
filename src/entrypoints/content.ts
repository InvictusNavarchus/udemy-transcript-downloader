import { defineContentScript } from '#imports';
import { courseState } from '@/utils/storage';
import type { CaptionLanguage, MessagePayload, PageInfo, ProcessingState } from '@/utils/types';
import {
  getCourseId,
  fetchCaptionLanguages,
  fetchCurriculum,
  fetchTranscript,
  isVideoLecture,
  courseTitleFromDocumentTitle,
  transcriptMarkdown,
} from '@/utils/udemy-api';
import { generateZip } from '@/utils/file-generator';

export default defineContentScript({
  // All course pages, not only /learn/lecture/*: Udemy navigates between course pages (landing,
  // lecture, quiz, practice) without full page loads, and a content script is only injected on
  // a full load. The course ID is read from the page when Start is clicked, not at injection.
  matches: ['*://www.udemy.com/course/*'],
  async main() {
    console.log('Udemy Downloader: Content Script Loaded');

    // --- Orchestration Logic ---

    // Only one download loop may run in this tab, and only that loop writes the download state
    // while it runs. Pause is an in-memory signal the loop reads at each lecture, not a storage
    // write: a storage write from outside raced with the loop's own progress saves, and whichever
    // landed last won (a Pause could be overwritten back to 'running', or a Resume lost).
    let loopRunning = false;
    let pauseRequested = false;
    // The course the running loop downloads; Pause names its course so it only stops that one.
    let loopCourseId: number | null = null;
    // The running loop's state writer, so Pause and Resume can show their effect at once. They
    // write through the loop's own in-memory state, which keeps it the single source of truth.
    let loopUpdate: ((patch: Partial<ProcessingState>) => Promise<void>) | null = null;

    /** Start fetches the course again in `language`; Resume continues with the saved language. */
    type Run = { mode: 'start'; language: CaptionLanguage } | { mode: 'resume' };

    const processDownload = async (run: Run) => {
      if (loopRunning) {
        // Resume while the loop is still finishing the lecture it was on when Pause arrived:
        // cancelling the signal lets that loop carry on. Start is ignored while a loop runs.
        if (run.mode === 'resume' && pauseRequested) {
          pauseRequested = false;
          await loopUpdate?.({ status: 'running', currentTask: 'Resuming...' });
        }
        return;
      }
      loopRunning = true;
      pauseRequested = false;
      try {
        await runDownload(run);
      } finally {
        loopRunning = false;
        loopCourseId = null;
        loopUpdate = null;
      }
    };

    const runDownload = async (run: Run) => {
      // The course is the one open in this tab. Udemy switches pages without reloading, so read
      // it now rather than when the script was injected.
      let courseId: number;
      try {
        courseId = getCourseId();
      } catch (e) {
        // No course to record the error against; the popup only offers Start on a player page.
        console.error(e);
        return;
      }
      loopCourseId = courseId;
      const item = courseState(courseId);
      const saved = await item.getValue();
      const courseTitle = courseTitleFromDocumentTitle(document.title);

      let state: ProcessingState = saved ?? {
        status: 'running',
        courseId,
        courseTitle,
        language: 'en',
        languageLabel: 'English',
        totalLectures: 0,
        completedLectures: 0,
        currentTask: '',
        logs: [],
        curriculum: [],
        lastUpdated: 0,
      };
      // The loop keeps the authoritative state in memory and writes it whole; nothing else
      // writes it while the loop runs, so there is no need to re-read before each save.
      const update = async (patch: Partial<ProcessingState>) => {
        state = { ...state, ...patch, lastUpdated: Date.now() };
        await item.setValue(state);
      };
      loopUpdate = update;

      try {
        // --- Initialization Phase ---
        // Resume continues saved progress; anything else (or nothing to continue) starts over.
        if (run.mode === 'start' || !saved || state.status === 'completed' || state.status === 'error') {
          await update({
            status: 'running',
            courseTitle,
            // A Resume that has to start over keeps the language of the earlier run.
            ...(run.mode === 'start' && { language: run.language.code, languageLabel: run.language.label }),
            totalLectures: 0,
            completedLectures: 0,
            currentTask: 'Fetching Curriculum...',
            logs: [],
            curriculum: [],
          });

          const curriculum = await fetchCurriculum(courseId);
          await update({
            totalLectures: curriculum.filter(isVideoLecture).length,
            currentTask: 'Starting download...',
            logs: ['Curriculum loaded'],
            curriculum,
          });
        } else {
          await update({ status: 'running', currentTask: 'Resuming...' });
        }

        const curriculum = [...state.curriculum];
        let failedLectures = 0;

        for (const item of curriculum) {
          // 1. Check Pause
          if (pauseRequested) {
            await update({ status: 'paused', currentTask: 'Paused by user.' });
            // A Resume that arrived during that save cleared the signal: carry on instead of
            // leaving the course marked paused with no loop to resume it.
            if (pauseRequested) return;
            await update({ status: 'running', currentTask: 'Resuming...' });
          }

          // Skip non-video items (they have no captions and are not in the total) and finished ones
          if (!isVideoLecture(item) || item.isCompleted) {
            continue;
          }

          // 2. Fetch
          await update({ currentTask: `Processing: ${item.title}` });

          // Only the fetch is guarded here. A failed progress save is a storage problem (e.g. the
          // quota), not a transcript problem: it propagates and stops the run with an error
          // instead of replacing an already-fetched transcript with a failure placeholder.
          let markdown: string;
          try {
            markdown = transcriptMarkdown(await fetchTranscript(courseId, item.id, state.language), state.languageLabel);
          } catch (err) {
            console.error(err);
            // Leave the lecture incomplete so Resume (after a pause) retries it, and mark the gap
            // in the ZIP rather than leaving the lecture out silently.
            failedLectures++;
            item.markdownContent = `> [Transcript download failed: ${err instanceof Error ? err.message : err}]`;
            await update({ curriculum, logs: [...state.logs, `Error on ${item.title}: ${err}`] });
            continue;
          }

          item.isCompleted = true;
          item.markdownContent = markdown;

          // 3. Save State (Recoverability)
          await update({ curriculum, completedLectures: state.completedLectures + 1 });
        }

        // --- Finalization ---
        await update({ currentTask: 'Zipping files...' });
        await generateZip(curriculum, state.courseTitle);

        await update({
          status: 'completed',
          currentTask: failedLectures > 0
            ? `Download Finished. ${failedLectures} lecture(s) failed and are marked in the ZIP.`
            : 'Download Finished',
        });
      } catch (e: any) {
        console.error(e);
        await update({ status: 'error', currentTask: `Error: ${e.message}` });
      }
    };

    // --- Message Listeners ---
    // Per page load and course: the popup asks each time it opens on a course not yet started.
    const languageRequests = new Map<number, Promise<CaptionLanguage[]>>();
    const captionLanguages = (courseId: number) => {
      let request = languageRequests.get(courseId);
      if (!request) {
        request = fetchCaptionLanguages(courseId);
        // Do not keep a failure: the next popup opening asks again.
        request.catch(() => languageRequests.delete(courseId));
        languageRequests.set(courseId, request);
      }
      return request;
    };

    const pageInfo = (): PageInfo => {
      let courseId: number | null = null;
      try {
        courseId = getCourseId();
      } catch {
        // Not the course player (e.g. the landing page): the popup explains what to open.
      }
      return { courseId, courseTitle: courseTitleFromDocumentTitle(document.title), runningCourseId: loopCourseId };
    };

    browser.runtime.onMessage.addListener((message: MessagePayload, _sender, sendResponse) => {
      if (message.action === 'GET_PAGE') {
        sendResponse(pageInfo());
      } else if (message.action === 'GET_LANGUAGES') {
        const { courseId } = pageInfo();
        if (courseId === null) {
          sendResponse([]);
          return;
        }
        // An empty list (also on failure) makes the popup offer English, the old default.
        captionLanguages(courseId).then(sendResponse, () => sendResponse([]));
        return true; // Keeps the channel open for the asynchronous sendResponse.
      } else if (message.action === 'START') {
        processDownload({ mode: 'start', language: message.language });
      } else if (message.action === 'RESUME') {
        processDownload({ mode: 'resume' });
      } else if (message.action === 'PAUSE') {
        // Only a running loop can pause; the popup sends Pause to every Udemy tab because the
        // loop may be in a tab other than the active one.
        if (loopRunning && loopCourseId === message.courseId && !pauseRequested) {
          pauseRequested = true;
          // The loop only stops between lectures; say so instead of looking unresponsive.
          void loopUpdate?.({ status: 'pausing', currentTask: 'Pausing after the current lecture...' });
        }
      }
    });
  },
});