import { storage } from '#imports';
import type { ProcessingState } from './types';

/**
 * One storage item per course, so downloads of different courses (in different tabs) keep
 * separate progress and a finished course does not block starting another.
 * `getValue()` returns null for a course that has never been started.
 */
export const courseState = (courseId: number) =>
  storage.defineItem<ProcessingState>(`local:course:${courseId}`);

/** The single shared state used before per-course states. */
export const LEGACY_STATE_KEY = 'local:udemy_dl_state';

type LegacyState = Omit<ProcessingState, 'status' | 'courseId' | 'language' | 'languageLabel'> & {
  status: ProcessingState['status'] | 'idle';
  courseId: number | null;
};

/**
 * Moves the old shared state into its course's item and deletes it, so a download paused before
 * the update can still be resumed. The shared item also had an 'idle' status with no course,
 * which has nothing to move. An existing per-course item is newer and is kept. Old downloads
 * were always English, the only language before the language choice.
 */
export const migrateLegacyState = async (): Promise<void> => {
  const legacy = await storage.getItem<LegacyState>(LEGACY_STATE_KEY);
  if (legacy?.courseId && legacy.status !== 'idle') {
    const item = courseState(legacy.courseId);
    if (!(await item.getValue())) {
      await item.setValue({
        ...legacy,
        courseId: legacy.courseId,
        status: legacy.status,
        language: 'en',
        languageLabel: 'English',
      });
    }
  }
  await storage.removeItem(LEGACY_STATE_KEY);
};

/** The language last chosen in the popup, preselected for the next course that offers it. */
export const preferredLanguage = storage.defineItem<string>('local:preferred_language', { fallback: 'en' });
