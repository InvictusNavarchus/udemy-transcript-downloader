import { describe, expect, it } from 'vitest';
import { isInterrupted } from '@/utils/status';
import type { ProcessingState } from '@/utils/types';

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
