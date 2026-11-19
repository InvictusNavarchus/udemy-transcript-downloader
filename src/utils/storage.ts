import { storage } from '#imports';
import type { ProcessingState } from './types';

/**
 * One storage item per course, so downloads of different courses (in different tabs) keep
 * separate progress and a finished course does not block starting another.
 * `getValue()` returns null for a course that has never been started.
 */
export const courseState = (courseId: number) => storage.defineItem<ProcessingState>(`local:course:${courseId}`);

/** The single shared state used before per-course states. */
export const LEGACY_STATE_KEY = 'local:udemy_dl_state';

/**
 * Deletes the old shared state. Its download is not carried over (it can simply be started
 * again), but the item must go: it can hold a whole course of transcripts, and nothing else
 * reads it or lists it for deletion.
 */
export const removeLegacyState = (): Promise<void> => storage.removeItem(LEGACY_STATE_KEY);

/** The language last chosen in the popup, preselected for the next course that offers it. */
export const preferredLanguage = storage.defineItem<string>('local:preferred_language', { fallback: 'en' });

const COURSE_KEY = /^course:\d+$/;

/** All saved course states, most recently updated first. */
export const listCourseStates = async (): Promise<ProcessingState[]> => {
	const all = await storage.snapshot('local');
	return Object.entries(all)
		.filter(([key]) => COURSE_KEY.test(key))
		.map(([, value]) => value as ProcessingState)
		.sort((a, b) => b.lastUpdated - a.lastUpdated);
};

/** Removes a course's saved state, transcripts included. */
export const deleteCourseState = (courseId: number) => courseState(courseId).removeValue();

/**
 * Approximate storage taken by a state: its JSON size in UTF-8, which is how Chrome measures
 * storage.local use. Computed from states the popup has already loaded, instead of one
 * getBytesInUse call per course (available for storage.local only since Firefox 144).
 */
export const stateSize = (state: ProcessingState): number => new TextEncoder().encode(JSON.stringify(state)).length;
