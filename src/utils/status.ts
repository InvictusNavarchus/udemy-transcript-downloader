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

/** What the toolbar icon shows on a downloading tab. */
export interface Badge {
  text: string;
  color: string;
}

/**
 * The toolbar badge for a course's state: the percentage while it downloads or is paused (the
 * colour tells them apart), a check mark when finished (orange if some lectures failed), and
 * "!" on error. About four characters fit on the badge.
 */
export const badgeFor = (state: ProcessingState): Badge => {
  const percent = state.totalLectures > 0 ? Math.floor((state.completedLectures / state.totalLectures) * 100) : 0;
  switch (state.status) {
    case 'running':
      return { text: `${percent}%`, color: '#a435f0' };
    case 'pausing':
    case 'paused':
      return { text: `${percent}%`, color: '#6a6f73' };
    case 'completed':
      return { text: '✓', color: failedLectures(state.curriculum).length > 0 ? '#e59819' : '#1e8a44' };
    case 'error':
      return { text: '!', color: '#c4122f' };
  }
};
