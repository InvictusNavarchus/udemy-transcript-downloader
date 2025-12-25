import { UdemyCurriculumItem } from './types';
import { randomDelay, vttToMarkdown } from './helpers';

/**
 * Extracts the Udemy course ID from the current page's DOM.
 * @throws {Error} If course element, args, or courseId cannot be found/validated
 */
export const getCourseId = (): number => {
  try {
    const el = document.querySelector('[data-module-id="course-taking"]');
    if (!el) throw new Error('Course element not found');
    const args = el.getAttribute('data-module-args');
    if (!args) throw new Error('Course args not found');
    
    const parsed = JSON.parse(args);
    
    // Validate courseId exists and is a number
    if (parsed.courseId === null || parsed.courseId === undefined) {
      throw new Error('Course ID not found in module args');
    }
    if (typeof parsed.courseId !== 'number') {
      throw new Error(`Course ID must be a number, got ${typeof parsed.courseId}`);
    }
    
    return parsed.courseId;
  } catch (e) {
    throw new Error('Could not find Course ID. Ensure you are on the Course Learning Page.');
  }
};

/**
 * Fetches the complete course curriculum from Udemy API.
 * @param courseId - The Udemy course ID
 * @returns Array of curriculum items (chapters, lectures, quizzes)
 */
export const fetchCurriculum = async (courseId: number): Promise<UdemyCurriculumItem[]> => {
  // Fetching up to 1000 items to be safe
  const url = `https://www.udemy.com/api-2.0/courses/${courseId}/subscriber-curriculum-items/?curriculum_types=chapter%2Clecture%2Cquiz&page_size=1000&fields%5Blecture%5D=title%2Casset&fields%5Bchapter%5D=title`;
  
  await randomDelay();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Curriculum API Error: ${response.status}`);
  const data = await response.json();
  
  // Map to internal structure
  const rawResults = data.results || [];
  return rawResults.map((item: any) => ({
    _class: item._class,
    id: item.id,
    title: item.title,
    sort_order: item.sort_order,
    asset: item.asset,
    type: (['chapter', 'lecture', 'quiz'].includes(item._class) ? item._class : 'other') as UdemyCurriculumItem['type'],
    isCompleted: false
  }));
};

/**
 * Fetches and processes the transcript for a specific lecture.
 * @param courseId - The Udemy course ID
 * @param lectureId - The specific lecture ID
 * @returns Markdown-formatted transcript, or null if unavailable
 */
export const fetchTranscript = async (courseId: number, lectureId: number): Promise<string | null> => {
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
