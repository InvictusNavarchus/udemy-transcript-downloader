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