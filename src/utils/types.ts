export interface UdemyCurriculumItem {
  _class: string;
  id: number;
  title: string;
  sort_order: number;
  asset?: {
    id: number;
    title: string;
    asset_type: string;
  };
  type: 'chapter' | 'lecture' | 'quiz' | 'other';
  // Internal state
  isCompleted?: boolean;
  markdownContent?: string;
}

/** One caption track of a lecture, as returned by Udemy's lecture asset API. */
export interface UdemyCaption {
  locale_id: string; // e.g. 'en_US', 'en_GB', 'pt_BR'
  source: string; // 'manual' (written by the instructor) or 'auto' (machine-generated)
  url?: string;
  video_label?: string; // e.g. 'English', 'German [Auto]'
}

export interface ProcessingState {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  courseId: number | null;
  courseTitle: string;
  totalLectures: number;
  completedLectures: number;
  currentTask: string;
  logs: string[];
  curriculum: UdemyCurriculumItem[];
  lastUpdated: number;
}

export interface MessagePayload {
  action: 'START' | 'PAUSE' | 'RESUME';
}