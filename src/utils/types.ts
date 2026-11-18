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

/** Download state of one course. A course that was never started has no state at all. */
export interface ProcessingState {
  status: 'running' | 'paused' | 'completed' | 'error';
  courseId: number;
  courseTitle: string;
  totalLectures: number;
  completedLectures: number;
  currentTask: string;
  logs: string[];
  curriculum: UdemyCurriculumItem[];
  lastUpdated: number;
}

/** Messages from the popup to a course tab's content script. */
export type MessagePayload =
  | { action: 'GET_PAGE' }
  | { action: 'START' }
  | { action: 'RESUME' }
  | { action: 'PAUSE'; courseId: number };

/** The content script's answer to GET_PAGE. */
export interface PageInfo {
  /** null when the page is not the course player, e.g. the course landing page. */
  courseId: number | null;
  courseTitle: string;
  /** The course this tab is downloading right now, if any. */
  runningCourseId: number | null;
}