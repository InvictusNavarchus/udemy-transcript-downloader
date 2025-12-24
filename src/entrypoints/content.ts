import { defineContentScript } from '#imports';
import { zip } from 'fflate';
import { downloadState } from '@/utils/storage';
import { UdemyCurriculumItem, MessagePayload } from '@/utils/types';
import { randomDelay, vttToMarkdown, sanitizeFileName, stringToBuffer } from '@/utils/helpers';

export default defineContentScript({
  matches: ['*://www.udemy.com/course/*/learn/lecture/*'],
  async main() {
    console.log('Udemy Downloader: Content Script Loaded');

    // --- Core Logic ---

    const getCourseId = (): number => {
      try {
        const el = document.querySelector('[data-module-id="course-taking"]');
        if (!el) throw new Error('Course element not found');
        const args = el.getAttribute('data-module-args');
        if (!args) throw new Error('Course args not found');
        return JSON.parse(args).courseId;
      } catch (e) {
        throw new Error('Could not find Course ID. Ensure you are on the Course Learning Page.');
      }
    };

    const fetchCurriculum = async (courseId: number): Promise<UdemyCurriculumItem[]> => {
      // Fetching up to 1000 items to be safe
      const url = `https://www.udemy.com/api-2.0/courses/${courseId}/subscriber-curriculum-items/?curriculum_types=chapter%2Clecture%2Cquiz&page_size=1000&fields%5Blecture%5D=title%2Casset&fields%5Bchapter%5D=title`;
      
      await randomDelay();
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Curriculum API Error: ${response.status}`);
      const data = await response.json();
      return data.results || [];
    };

    const fetchTranscript = async (courseId: number, lectureId: number): Promise<string | null> => {
      const url = `https://www.udemy.com/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${lectureId}/?fields%5Blecture%5D=asset&fields%5Basset%5D=captions`;
      
      await randomDelay();
      const response = await fetch(url);
      if (!response.ok) return null; // Likely no access or not a video
      
      const data = await response.json();
      const captions = data?.asset?.captions;

      if (!captions || !Array.isArray(captions)) return null;

      // Filter for English
      const enCaption = captions.find((c: any) => c.locale_id === 'en_US' || c.language === 'en');
      if (!enCaption?.url) return null;

      // Fetch VTT content
      try {
        const vttRes = await fetch(enCaption.url);
        if (!vttRes.ok) return null;
        const vttText = await vttRes.text();
        return vttToMarkdown(vttText);
      } catch {
        return null;
      }
    };

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

          const rawCurriculum = await fetchCurriculum(courseId);
          
          // Map to internal structure
          const curriculum: UdemyCurriculumItem[] = rawCurriculum.map((item: any) => ({
            _class: item._class,
            id: item.id,
            title: item.title,
            sort_order: item.sort_order,
            asset: item.asset,
            type: (['chapter', 'lecture', 'quiz'].includes(item._class) ? item._class : 'other') as UdemyCurriculumItem['type'],
            isCompleted: false
          }));

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
        await downloadState.setValue({ 
          ...(await downloadState.getValue()), 
          currentTask: 'Zipping files...' 
        });
        
        await generateZip(curriculum);

      } catch (e: any) {
        console.error(e);
        await downloadState.setValue({ 
          ...(await downloadState.getValue()), 
          status: 'error', 
          currentTask: `Error: ${e.message}` 
        });
      }
    };

    const generateZip = async (curriculum: UdemyCurriculumItem[]) => {
      const zipData: Record<string, Uint8Array> = {};
      
      const state = await downloadState.getValue();
      const cleanTitle = sanitizeFileName(state.courseTitle);

      let mergedContent = `# ${state.courseTitle}\n\n`;
      let currentChapterDir = '00_Intro';
      let chapterCount = 0;
      let lectureCount = 0;

      for (const item of curriculum) {
        if (item.type === 'chapter') {
          chapterCount++;
          lectureCount = 0; // Reset lecture count per chapter
          const safeTitle = sanitizeFileName(item.title);
          currentChapterDir = `${String(chapterCount).padStart(2, '0')}_${safeTitle}`;
          mergedContent += `\n\n## ${chapterCount}. ${item.title}\n\n`;
        } else if (item.type === 'lecture' && item.markdownContent) {
          lectureCount++;
          const safeTitle = sanitizeFileName(item.title);
          const fileName = `${String(lectureCount).padStart(2, '0')}_${safeTitle}.md`;
          const filePath = `${currentChapterDir}/${fileName}`;

          // Add individual file
          zipData[filePath] = stringToBuffer(item.markdownContent);

          // Append to merged file
          mergedContent += `### ${lectureCount}. ${item.title}\n\n${item.markdownContent}\n\n---\n\n`;
        }
      }

      // Add merged file
      zipData[`${cleanTitle}_Full.md`] = stringToBuffer(mergedContent);

      // Zipping with Promise wrapper for proper async flow
      return new Promise<void>((resolve, reject) => {
        zip(zipData, { level: 6 }, async (err, data) => {
          if (err) {
            await downloadState.setValue({ ...state, status: 'error', logs: [...state.logs, 'Zip Error'] });
            reject(err);
            return;
          }

          // Trigger Download
          const blob = new Blob([new Uint8Array(data)], { type: 'application/zip' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${cleanTitle}_Transcripts.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          await downloadState.setValue({ ...state, status: 'completed', currentTask: 'Download Finished' });
          resolve();
        });
      });
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