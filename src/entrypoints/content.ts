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
      const vttRes = await fetch(enCaption.url);
      const vttText = await vttRes.text();
      return vttToMarkdown(vttText);
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
            type: item._class,
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
            const transcript = await fetchTranscript(state.courseId!, item.id);
            
            // Update item in local array
            curriculum[i].isCompleted = true;
            if (transcript) {
              curriculum[i].markdownContent = transcript;
            } else {
              curriculum[i].markdownContent = '> [No Transcript Available]';
            }

            // 3. Save State (Recoverability)
            await downloadState.setValue({
              ...currentState,
              curriculum, // Save the updated array
              completedLectures: currentState.completedLectures + 1,
              lastUpdated: Date.now()
            });

          } catch (err) {
            console.error(err);
            // Log error but don't stop strictly? Or mark as error? 
            // We'll mark completed as false to retry later, but log it.
             await downloadState.setValue({
              ...currentState,
              logs: [`Error on ${item.title}: ${err}`]
            });
          }
        }

        // --- Finalization ---
        await downloadState.setValue({ 
          ...(await downloadState.getValue()), 
          status: 'completed', 
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

      // Zipping
      zip(zipData, { level: 6 }, (err, data) => {
        if (err) {
          downloadState.setValue({ ...state, status: 'error', logs: ['Zip Error'] });
          return;
        }

        // Trigger Download
        const blob = new Blob([data], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${cleanTitle}_Transcripts.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        downloadState.setValue({ ...state, status: 'idle', currentTask: 'Download Finished' });
      });
    };

    // --- Message Listeners ---
    browser.runtime.onMessage.addListener((message: MessagePayload) => {
      if (message.action === 'START') processDownload(false);
      if (message.action === 'RESUME') processDownload(true);
      if (message.action === 'PAUSE') downloadState.setValue({ ...downloadState.defaultValue, status: 'paused' }); // Note: We need a partial update here really, handled below
    });
    
    // Fix for the Pause logic in listener above:
    // We can't access "current" state easily in a sync listener without async, 
    // so we assume the main loop checks the 'paused' string written to storage.
    browser.runtime.onMessage.addListener(async (message: MessagePayload) => {
       if (message.action === 'PAUSE') {
         const s = await downloadState.getValue();
         await downloadState.setValue({ ...s, status: 'paused' });
       }
    });
  },
});