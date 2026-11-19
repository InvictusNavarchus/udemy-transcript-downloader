import { defineContentScript } from '#imports';
import { courseState } from '@/utils/storage';
import type { BackgroundMessage, CaptionLanguage, MessagePayload, PageInfo, ProcessingState } from '@/utils/types';
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
import { badgeFor, failedLectures } from '@/utils/status';

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
    type Run = { mode: 'start'; language: CaptionLanguage } | { mode: 'resume'; courseId: number };

    const processDownload = async (run: Run) => {
      if (loopRunning) {
        // Resume while the loop is still finishing the lecture it was on when Pause arrived:
        // cancelling the signal lets that loop carry on. Only a Resume for that loop's course
        // counts: the tab may since have moved to another course page, and a Resume meant for
        // that course must not cancel the pause of the one downloading. Start is ignored while
        // a loop runs (one loop per tab; the popup says so).
        if (run.mode === 'resume' && run.courseId === loopCourseId && pauseRequested) {
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
      // The popup sent Resume for the course it saw on this page; if the page has moved to
      // another course since, resuming would act on the wrong one.
      if (run.mode === 'resume' && run.courseId !== courseId) return;
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
      let badgeKey = '';
      const update = async (patch: Partial<ProcessingState>) => {
        state = { ...state, ...patch, lastUpdated: Date.now() };
        await item.setValue(state);
        // Progress on the toolbar icon, sent only when it changes (most saves change only the task).
        const badge = badgeFor(state);
        if (`${badge.text}|${badge.color}` !== badgeKey) {
          badgeKey = `${badge.text}|${badge.color}`;
          const message: BackgroundMessage = { action: 'SET_BADGE', ...badge };
          browser.runtime.sendMessage(message).catch(() => {
            // The badge is cosmetic; a missing background (e.g. mid-update) must not stop the download.
          });
        }
      };
      loopUpdate = update;

      try {
        // --- Initialization Phase ---
        // Resume continues saved progress, whatever the status: after a pause or interruption, after
        // an error, and after completion with failed lectures (Retry), which are still incomplete.
        // It starts over only when there is nothing to continue.
        if (run.mode === 'start' || !saved || state.curriculum.length === 0) {
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
            // Leave the lecture incomplete so Resume or Retry fetches it again, and mark the gap in
            // the ZIP rather than leaving the lecture out silently.
            const reason = err instanceof Error ? err.message : String(err);
            item.failedReason = reason;
            item.markdownContent = `> [Transcript download failed: ${reason}]`;
            await update({ curriculum, logs: [...state.logs, `Failed: ${item.title} (${reason})`] });
            continue;
          }

          item.isCompleted = true;
          item.markdownContent = markdown;
          delete item.failedReason;

          // 3. Save State (Recoverability)
          await update({ curriculum, completedLectures: state.completedLectures + 1 });
        }

        // --- Finalization ---
        await update({ currentTask: 'Zipping files...' });
        await generateZip(curriculum, state.courseTitle);

        const failed = failedLectures(curriculum).length;
        await update({
          status: 'completed',
          currentTask: failed > 0
            ? `Download Finished. ${failed} lecture(s) failed and are marked in the ZIP.`
            : 'Download Finished',
          logs: [...state.logs, failed > 0 ? `Finished with ${failed} failed lecture(s)` : 'Finished'],
        });
      } catch (e: any) {
        console.error(e);
        await update({ status: 'error', currentTask: `Error: ${e.message}`, logs: [...state.logs, `Stopped: ${e.message}`] });
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
        processDownload({ mode: 'resume', courseId: message.courseId });
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