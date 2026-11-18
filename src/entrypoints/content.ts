import { defineContentScript } from '#imports';
import { downloadState } from '@/utils/storage';
import type { MessagePayload } from '@/utils/types';
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

    // Only one download loop may run in this tab. Pause does not stop the loop immediately: it
    // finishes the current lecture and stops at its next status check. A Resume (or Start) that
    // arrives before then must not start a second loop, which would process lectures twice and
    // double-count progress.
    let loopRunning = false;

    const processDownload = async (resume = false) => {
      if (loopRunning) {
        if (resume) {
          // The live loop sees 'running' again at its next check and simply carries on.
          const s = await downloadState.getValue();
          await downloadState.setValue({ ...s, status: 'running', currentTask: 'Resuming...' });
        }
        return;
      }
      loopRunning = true;
      try {
        await runDownload(resume);
      } finally {
        loopRunning = false;
      }
    };

    const runDownload = async (resume: boolean) => {
      try {
        let state = await downloadState.getValue();
        
        // --- Initialization Phase ---
        if (!resume || state.status === 'completed' || state.status === 'error') {
          const courseId = getCourseId();
          const courseTitle = courseTitleFromDocumentTitle(document.title);

          await downloadState.setValue({
            ...state,
            status: 'running',
            courseId,
            courseTitle,
            currentTask: 'Fetching Curriculum...',
            logs: [],
          });

          const curriculum = await fetchCurriculum(courseId);
          const totalLectures = curriculum.filter(isVideoLecture).length;

          state = {
            status: 'running',
            courseId,
            courseTitle,
            totalLectures,
            completedLectures: 0,
            currentTask: 'Starting download...',
            logs: ['Curriculum loaded'],
            curriculum,
            lastUpdated: Date.now()
          };
          await downloadState.setValue(state);
        } else {
          // Resume: Just update status
          await downloadState.setValue({ ...state, status: 'running', currentTask: 'Resuming...' });
        }

        // --- Processing Loop ---
        // Re-read state to ensure we have the latest curriculum array
        state = await downloadState.getValue();
        
        // Guard: Ensure courseId is available
        if (!state.courseId) {
          throw new Error('Course ID not available. Cannot proceed with download.');
        }
        
        const curriculum = [...state.curriculum];
        let failedLectures = 0;

        for (const item of curriculum) {
          // 1. Check Pause State
          const currentState = await downloadState.getValue();
          if (currentState.status === 'paused') {
            await downloadState.setValue({ ...currentState, currentTask: 'Paused by user.' });
            return;
          }

          // Skip non-video items (they have no captions and are not in the total) and finished ones
          if (!isVideoLecture(item) || item.isCompleted) {
            continue;
          }

          // 2. Fetch
          await downloadState.setValue({ 
            ...currentState, 
            currentTask: `Processing: ${item.title}` 
          });

          // Only the fetch is guarded here. A failed progress save is a storage problem (e.g. the
          // quota), not a transcript problem: it propagates and stops the run with an error
          // instead of replacing an already-fetched transcript with a failure placeholder.
          let transcript: string | null;
          try {
            transcript = await fetchTranscript(state.courseId, item.id);
          } catch (err) {
            console.error(err);
            // Leave the lecture incomplete so Resume (after a pause) retries it, and mark the gap
            // in the ZIP rather than leaving the lecture out silently.
            failedLectures++;
            item.markdownContent = `> [Transcript download failed: ${err instanceof Error ? err.message : err}]`;
            const latestState = await downloadState.getValue();
            await downloadState.setValue({
              ...latestState,
              logs: [...latestState.logs, `Error on ${item.title}: ${err}`]
            });
            continue;
          }

          // Update item in local array
          item.isCompleted = true;
          item.markdownContent = transcript || '> [No Transcript Available]';

          // 3. Save State (Recoverability)
          const latestState = await downloadState.getValue();
          await downloadState.setValue({
            ...latestState,
            curriculum, // Save the updated array
            completedLectures: latestState.completedLectures + 1,
            lastUpdated: Date.now()
          });
        }

        // --- Finalization ---
        const finalState = await downloadState.getValue();
        await downloadState.setValue({ 
          ...finalState, 
          currentTask: 'Zipping files...' 
        });
        
        await generateZip(curriculum, finalState.courseTitle);

        // Mark as completed
        const completedState = await downloadState.getValue();
        await downloadState.setValue({ 
          ...completedState, 
          status: 'completed', 
          currentTask: failedLectures > 0
            ? `Download Finished. ${failedLectures} lecture(s) failed and are marked in the ZIP.`
            : 'Download Finished'
        });

      } catch (e: any) {
        console.error(e);
        await downloadState.setValue({ 
          ...(await downloadState.getValue()), 
          status: 'error', 
          currentTask: `Error: ${e.message}` 
        });
      }
    };

    // --- Message Listeners ---
    browser.runtime.onMessage.addListener(async (message: MessagePayload) => {
      if (message.action === 'START') {
        processDownload(false);
      } else if (message.action === 'RESUME') {
        processDownload(true);
      } else if (message.action === 'PAUSE') {
        const s = await downloadState.getValue();
        await downloadState.setValue({ ...s, status: 'paused' });
      }
    });
  },
});