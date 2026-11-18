import { defineContentScript } from '#imports';
import { downloadState } from '@/utils/storage';
import type { MessagePayload } from '@/utils/types';
import { getCourseId, fetchCurriculum, fetchTranscript } from '@/utils/udemy-api';
import { generateZip } from '@/utils/file-generator';

export default defineContentScript({
  matches: ['*://www.udemy.com/course/*/learn/lecture/*'],
  async main() {
    console.log('Udemy Downloader: Content Script Loaded');

    // --- Orchestration Logic ---

    const processDownload = async (resume = false) => {
      try {
        let state = await downloadState.getValue();
        
        // --- Initialization Phase ---
        if (!resume || state.status === 'completed' || state.status === 'error') {
          const courseId = getCourseId();
          const courseTitle = (document.title.split('|')[0] ?? '').trim();

          await downloadState.setValue({
            ...state,
            status: 'running',
            courseId,
            courseTitle,
            currentTask: 'Fetching Curriculum...',
            logs: [],
          });

          const curriculum = await fetchCurriculum(courseId);
          const totalLectures = curriculum.filter(i => i.type === 'lecture' && i.asset?.asset_type === 'Video').length;

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

          // Skip if not a lecture or if already done
          if (item.type !== 'lecture' || !item.asset || item.isCompleted) {
            continue;
          }

          // 2. Fetch
          await downloadState.setValue({ 
            ...currentState, 
            currentTask: `Processing: ${item.title}` 
          });

          try {
            const transcript = await fetchTranscript(state.courseId, item.id);
            
            // Update item in local array
            item.isCompleted = true;
            if (transcript) {
              item.markdownContent = transcript;
            } else {
              item.markdownContent = '> [No Transcript Available]';
            }

            // 3. Save State (Recoverability)
            const latestState = await downloadState.getValue();
            await downloadState.setValue({
              ...latestState,
              curriculum, // Save the updated array
              completedLectures: latestState.completedLectures + 1,
              lastUpdated: Date.now()
            });

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
          }
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