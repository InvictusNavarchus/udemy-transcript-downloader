import { defineContentScript } from '#imports';
import { downloadState } from '@/utils/storage';
import { MessagePayload } from '@/utils/types';
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
          const courseTitle = document.title.split('|')[0].trim();

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

        for (let i = 0; i < curriculum.length; i++) {
          // 1. Check Pause State
          const currentState = await downloadState.getValue();
          if (currentState.status === 'paused') {
            await downloadState.setValue({ ...currentState, currentTask: 'Paused by user.' });
            return;
          }

          const item = curriculum[i];

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
            curriculum[i].isCompleted = true;
            if (transcript) {
              curriculum[i].markdownContent = transcript;
            } else {
              curriculum[i].markdownContent = '> [No Transcript Available]';
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
            // Log error but don't stop - append to logs for visibility
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
          currentTask: 'Download Finished' 
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