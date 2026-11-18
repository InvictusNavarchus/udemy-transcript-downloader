import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { storage } from '#imports';
import { courseState, LEGACY_STATE_KEY, migrateLegacyState } from '@/utils/storage';
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

describe('migrateLegacyState', () => {
  it('moves a started download into its course item as English and deletes the old item', async () => {
    const { language, languageLabel, ...legacy } = state(7);
    await storage.setItem(LEGACY_STATE_KEY, legacy);
    await migrateLegacyState();
    expect(await courseState(7).getValue()).toEqual(state(7));
    expect(await storage.getItem(LEGACY_STATE_KEY)).toBeNull();
  });

  it('drops an idle state, which has no course', async () => {
    await storage.setItem(LEGACY_STATE_KEY, { ...state(0), status: 'idle', courseId: null });
    await migrateLegacyState();
    expect(await storage.getItem(LEGACY_STATE_KEY)).toBeNull();
    expect(await storage.snapshot('local')).toEqual({});
  });

  it('keeps an existing per-course item', async () => {
    await courseState(7).setValue(state(7, { completedLectures: 9 }));
    await storage.setItem(LEGACY_STATE_KEY, state(7));
    await migrateLegacyState();
    expect((await courseState(7).getValue())?.completedLectures).toBe(9);
  });

  it('does nothing when there is no old item', async () => {
    await migrateLegacyState();
    expect(await storage.snapshot('local')).toEqual({});
  });
});
