import { defineContentScript } from '#imports';
import { downloadState } from '@/utils/storage';
import type { MessagePayload, ProcessingState } from '@/utils/types';
import { getCourseId, fetchCurriculum, fetchTranscript, isVideoLecture, courseTitleFromDocumentTitle } from '@/utils/udemy-api';
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

    const processDownload = async (mode: 'start' | 'resume') => {
      if (loopRunning) {
        // Resume while the loop is still finishing the lecture it was on when Pause arrived:
        // cancelling the signal lets that loop carry on. Start is ignored while a loop runs.
        if (mode === 'resume') pauseRequested = false;
        return;
      }
      loopRunning = true;
      pauseRequested = false;
      try {
        await runDownload(mode);
      } finally {
        loopRunning = false;
      }
    };

    const runDownload = async (mode: 'start' | 'resume') => {
      let state = await downloadState.getValue();
      // The loop keeps the authoritative state in memory and writes it whole; nothing else
      // writes it while the loop runs, so there is no need to re-read before each save.
      const update = async (patch: Partial<ProcessingState>) => {
        state = { ...state, ...patch, lastUpdated: Date.now() };
        await downloadState.setValue(state);
      };

      try {
        // --- Initialization Phase ---
        if (mode === 'start' || state.status === 'completed' || state.status === 'error') {
          const courseId = getCourseId();
          const courseTitle = courseTitleFromDocumentTitle(document.title);

          await update({
            status: 'running',
            courseId,
            courseTitle,
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

        // Guard: Ensure courseId is available
        const courseId = state.courseId;
        if (!courseId) {
          throw new Error('Course ID not available. Cannot proceed with download.');
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
          let transcript: string | null;
          try {
            transcript = await fetchTranscript(courseId, item.id);
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
          item.markdownContent = transcript || '> [No Transcript Available]';

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
    browser.runtime.onMessage.addListener((message: MessagePayload) => {
      if (message.action === 'START') {
        processDownload('start');
      } else if (message.action === 'RESUME') {
        processDownload('resume');
      } else if (message.action === 'PAUSE') {
        // Only a running loop can pause; the popup sends Pause to every Udemy tab because the
        // loop may be in a tab other than the active one.
        if (loopRunning) pauseRequested = true;
      }
    });
  },
});