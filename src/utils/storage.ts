import { storage } from '#imports'; // Use #imports for cleaner WXT usage
import { ProcessingState } from './types';

export const downloadState = storage.defineItem<ProcessingState>(
  'local:udemy_dl_state',
  {
    fallback: {
      status: 'idle',
      courseId: null,
      courseTitle: 'Ready',
      totalLectures: 0,
      completedLectures: 0,
      currentTask: 'Idle',
      logs: [],
      curriculum: [],
      lastUpdated: 0,
    },
  }
);