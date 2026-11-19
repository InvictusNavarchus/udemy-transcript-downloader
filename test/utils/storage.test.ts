import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { storage } from '#imports';
import {
  courseState,
  deleteCourseState,
  LEGACY_STATE_KEY,
  listCourseStates,
  preferredLanguage,
  removeLegacyState,
  stateSize,
} from '@/utils/storage';
import type { ProcessingState } from '@/utils/types';

const state = (courseId: number, patch: Partial<ProcessingState> = {}): ProcessingState => ({
  status: 'paused',
  courseId,
  courseTitle: `Course ${courseId}`,
  language: 'en',
  languageLabel: 'English',
  totalLectures: 10,
  completedLectures: 4,
  currentTask: 'Paused by user.',
  logs: [],
  curriculum: [],
  lastUpdated: 1,
  ...patch,
});

beforeEach(() => {
  fakeBrowser.reset();
});

describe('courseState', () => {
  it('is null for a course that was never started', async () => {
    expect(await courseState(1).getValue()).toBeNull();
  });

  it('keeps courses separate', async () => {
    await courseState(1).setValue(state(1));
    await courseState(2).setValue(state(2, { status: 'completed' }));
    expect((await courseState(1).getValue())?.status).toBe('paused');
    expect((await courseState(2).getValue())?.status).toBe('completed');
  });
});

describe('removeLegacyState', () => {
  it('deletes the old shared state and leaves course states alone', async () => {
    await storage.setItem(LEGACY_STATE_KEY, { ...state(7), status: 'paused' });
    await courseState(1).setValue(state(1));
    await removeLegacyState();
    expect(await storage.getItem(LEGACY_STATE_KEY)).toBeNull();
    expect(await courseState(7).getValue()).toBeNull();
    expect(await courseState(1).getValue()).toEqual(state(1));
  });
});

describe('listCourseStates', () => {
  it('lists only course states, most recently updated first', async () => {
    await courseState(1).setValue(state(1, { lastUpdated: 10 }));
    await courseState(2).setValue(state(2, { lastUpdated: 30 }));
    await courseState(3).setValue(state(3, { lastUpdated: 20 }));
    await preferredLanguage.setValue('de');
    expect((await listCourseStates()).map((s) => s.courseId)).toEqual([2, 3, 1]);
  });

  it('no longer lists a deleted course', async () => {
    await courseState(1).setValue(state(1));
    await courseState(2).setValue(state(2));
    await deleteCourseState(1);
    expect((await listCourseStates()).map((s) => s.courseId)).toEqual([2]);
  });
});

describe('stateSize', () => {
  it('counts UTF-8 bytes of the JSON', () => {
    const ascii = state(1, { courseTitle: 'a' });
    const accented = state(1, { courseTitle: 'é' });
    expect(stateSize(ascii)).toBe(JSON.stringify(ascii).length);
    expect(stateSize(accented)).toBe(stateSize(ascii) + 1);
  });
});
