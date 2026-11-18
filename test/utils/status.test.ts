import { describe, expect, it } from 'vitest';
import { failedLectures, isInterrupted } from '@/utils/status';
import type { ProcessingState, UdemyCurriculumItem } from '@/utils/types';

const withStatus = (status: ProcessingState['status']) => ({ status }) as ProcessingState;

describe('isInterrupted', () => {
  it.each(['running', 'pausing'] as const)('is true for %s with no loop in any tab', (status) => {
    expect(isInterrupted(withStatus(status), false)).toBe(true);
  });

  it.each(['running', 'pausing'] as const)('is false for %s while a tab runs the loop', (status) => {
    expect(isInterrupted(withStatus(status), true)).toBe(false);
  });

  it.each(['paused', 'completed', 'error'] as const)('is false for %s', (status) => {
    expect(isInterrupted(withStatus(status), false)).toBe(false);
  });

  it('is false for a course that was never started', () => {
    expect(isInterrupted(null, false)).toBe(false);
  });
});

describe('failedLectures', () => {
  const item = (id: number, patch: Partial<UdemyCurriculumItem>) =>
    ({ _class: 'lecture', id, title: `L${id}`, sort_order: id, type: 'lecture', ...patch }) as UdemyCurriculumItem;

  it('lists incomplete lectures whose last attempt failed', () => {
    const curriculum = [
      item(1, { isCompleted: true }),
      item(2, { failedReason: 'Lecture API Error: 429' }),
      item(3, {}),
      // Completed on retry; a leftover reason must not count it as failed.
      item(4, { isCompleted: true, failedReason: 'old' }),
    ];
    expect(failedLectures(curriculum).map((i) => i.id)).toEqual([2]);
  });
});
