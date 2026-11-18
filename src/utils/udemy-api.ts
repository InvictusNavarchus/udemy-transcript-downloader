import type { CaptionLanguage, UdemyCaption, UdemyCurriculumItem } from './types';
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
 * Extracts the course title from the course player's tab title, e.g.
 * "Course: Touch Typing Mastery | Udemy" -> "Touch Typing Mastery".
 * Only the English "Course: " label is removed; other UI languages may use a translated label.
 */
export const courseTitleFromDocumentTitle = (documentTitle: string): string =>
  // Remove only Udemy's own " | Udemy" suffix: a course name may itself contain "|".
  documentTitle.replace(/\s*\|\s*Udemy\s*$/, '').trim().replace(/^Course:\s+/, '');

/**
 * Fetches the complete course curriculum from Udemy API.
 * @param courseId - The Udemy course ID
 * @returns Array of curriculum items (chapters, lectures, quizzes)
 */
export const fetchCurriculum = async (courseId: number): Promise<UdemyCurriculumItem[]> => {
  // Pages hold up to 1000 items; longer courses continue at the absolute URL in `next`.
  let url: string | null = `https://www.udemy.com/api-2.0/courses/${courseId}/subscriber-curriculum-items/?curriculum_types=chapter%2Clecture%2Cquiz&page_size=1000&fields%5Blecture%5D=title%2Casset&fields%5Bchapter%5D=title`;
  const rawResults: any[] = [];
  const fetched = new Set<string>();

  while (url) {
    // Guard against a `next` that points back to a page already fetched, which would otherwise
    // request Udemy's API in an endless loop from the user's account.
    if (fetched.has(url)) throw new Error(`Curriculum pagination loops back to ${url}`);
    fetched.add(url);
    await randomDelay();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Curriculum API Error: ${response.status}`);
    const data: { results?: any[]; next?: string | null } = await response.json();
    rawResults.push(...(data.results || []));
    url = data.next || null;
  }

  // Map to internal structure
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
 * Whether a curriculum item is a video lecture, the only kind that can have captions.
 * Articles, e-books, files and other lecture types are skipped by the download loop and
 * left out of the progress total.
 */
export const isVideoLecture = (item: UdemyCurriculumItem): boolean =>
  item.type === 'lecture' && item.asset?.asset_type === 'Video';

/** The language part of a track's locale_id, e.g. 'en' for en_GB. */
const languageOf = (caption: UdemyCaption): string => caption.locale_id?.split('_')[0]?.toLowerCase() ?? '';

/**
 * Picks the caption track to download for a language.
 * Matches on the language part of `locale_id`, so 'en' accepts en_US, en_GB, en_AU, etc.
 * Among matches, an instructor-written ('manual') track wins over a machine-generated one.
 * @param language - Lowercase ISO 639-1 code, e.g. 'en'
 * @returns The chosen track, or null if no track with a URL is in that language
 */
export const pickCaption = (captions: UdemyCaption[], language: string): UdemyCaption | null => {
  const matches = captions.filter((c) => c.url && languageOf(c) === language);
  return matches.find((c) => c.source === 'manual') ?? matches[0] ?? null;
};

/** Display name of a track's language: its label without Udemy's " [Auto]" marker. */
const languageLabel = (caption: UdemyCaption): string => {
  const label = caption.video_label?.replace(/\s*\[auto\]\s*$/i, '').trim();
  if (label) return label;
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(languageOf(caption)) ?? languageOf(caption);
  } catch {
    return languageOf(caption);
  }
};

/**
 * The languages a lecture's captions are available in, one entry per language (locales merged,
 * as pickCaption does), sorted by label. Tracks without a URL cannot be downloaded and are left out.
 */
export const listCaptionLanguages = (captions: UdemyCaption[]): CaptionLanguage[] => {
  const byCode = new Map<string, CaptionLanguage>();
  for (const c of captions) {
    const code = languageOf(c);
    if (!c.url || !code) continue;
    const manual = c.source === 'manual';
    const known = byCode.get(code);
    // Prefer the label of a manual track, the one pickCaption downloads.
    if (!known || (manual && known.auto)) byCode.set(code, { code, label: languageLabel(c), auto: !manual });
  }
  return [...byCode.values()].sort((a, b) => a.label.localeCompare(b.label));
};

/** Fetches a lecture's caption tracks; an empty list when it has none. */
const fetchLectureCaptions = async (courseId: number, lectureId: number): Promise<UdemyCaption[]> => {
  const url = `https://www.udemy.com/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${lectureId}/?fields%5Blecture%5D=asset&fields%5Basset%5D=captions`;
  await randomDelay();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Lecture API Error: ${response.status}`);
  const captions = (await response.json())?.asset?.captions;
  return Array.isArray(captions) ? captions : [];
};

/** Video lectures checked for languages; the first one may lack captions (e.g. a short intro). */
const LANGUAGE_PROBE_LECTURES = 3;

/**
 * The caption languages of a course, read from its first video lecture that has captions.
 * Instructors usually caption every lecture alike, but a lecture can still lack a language
 * listed here; the download marks such lectures (see transcriptMarkdown).
 */
export const fetchCaptionLanguages = async (courseId: number): Promise<CaptionLanguage[]> => {
  const lectures = (await fetchCurriculum(courseId)).filter(isVideoLecture).slice(0, LANGUAGE_PROBE_LECTURES);
  for (const lecture of lectures) {
    const languages = listCaptionLanguages(await fetchLectureCaptions(courseId, lecture.id));
    if (languages.length > 0) return languages;
  }
  return [];
};

/** What a lecture has for the chosen language. */
export type TranscriptResult =
  | { kind: 'transcript'; markdown: string }
  | { kind: 'no-captions' }
  | { kind: 'language-missing'; available: string[] };

/**
 * Fetches and processes the transcript for a specific lecture.
 * @param courseId - The Udemy course ID
 * @param lectureId - The specific lecture ID
 * @param language - Lowercase ISO 639-1 code, e.g. 'en'
 * @returns The transcript, or why there is none: no captions at all, or none in `language`
 *   (with the languages it does have, so the user knows a different language would work)
 * @throws {Error} If a request fails (HTTP error or network), so the caller can retry the
 *   lecture later instead of recording it as having no transcript
 */
export const fetchTranscript = async (courseId: number, lectureId: number, language: string): Promise<TranscriptResult> => {
  const captions = await fetchLectureCaptions(courseId, lectureId);
  const caption = pickCaption(captions, language);
  if (!caption?.url) {
    const available = listCaptionLanguages(captions).map((l) => l.label);
    return available.length > 0 ? { kind: 'language-missing', available } : { kind: 'no-captions' };
  }

  // Fetch VTT content
  const vttRes = await fetch(caption.url);
  if (!vttRes.ok) throw new Error(`Caption download error: ${vttRes.status}`);
  return { kind: 'transcript', markdown: vttToMarkdown(await vttRes.text()) };
};

/** The lecture file's content: the transcript, or a note saying why there is none. */
export const transcriptMarkdown = (result: TranscriptResult, languageLabel: string): string => {
  switch (result.kind) {
    case 'transcript':
      // An empty caption file still counts as no transcript.
      return result.markdown || '> [No Transcript Available]';
    case 'no-captions':
      return '> [No Transcript Available]';
    case 'language-missing':
      return `> [No ${languageLabel} transcript. Available: ${result.available.join(', ')}]`;
  }
};
