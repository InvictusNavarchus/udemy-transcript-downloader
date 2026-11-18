import type { ProcessingState, UdemyCurriculumItem } from './types';

/** Statuses during which a download loop should be alive in some tab. */
export const isActiveStatus = (status: ProcessingState['status']): boolean =>
  status === 'running' || status === 'pausing';

/**
 * Whether a saved download claims to be running although no tab is running it: its tab was
 * closed or reloaded mid-download, which ends the loop without a chance to save another status.
 * @param loopFound - Whether any open tab reported a running loop for the course
 */
export const isInterrupted = (state: ProcessingState | null, loopFound: boolean): boolean =>
  !!state && isActiveStatus(state.status) && !loopFound;

/** Lectures whose last download attempt failed; Resume (or Retry) fetches them again. */
export const failedLectures = (curriculum: UdemyCurriculumItem[]): UdemyCurriculumItem[] =>
  curriculum.filter((item) => item.failedReason !== undefined && !item.isCompleted);
