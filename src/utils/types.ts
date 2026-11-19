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
	failedReason?: string; // Set while the last attempt failed; the lecture stays incomplete
}

/** One caption track of a lecture, as returned by Udemy's lecture asset API. */
export interface UdemyCaption {
	locale_id: string; // e.g. 'en_US', 'en_GB', 'pt_BR'
	source: string; // 'manual' (written by the instructor) or 'auto' (machine-generated)
	url?: string;
	video_label?: string; // e.g. 'English', 'German [Auto]'
}

/** Download state of one course. A course that was never started has no state at all. */
/** A caption language offered for download, merged across locales (en_US + en_GB -> en). */
export interface CaptionLanguage {
	code: string; // Lowercase ISO 639-1, the language part of locale_id, e.g. 'en'
	label: string; // e.g. 'English'
	auto: boolean; // Only machine-generated tracks exist for it
}

export interface ProcessingState {
	// 'pausing': Pause was clicked; the loop finishes its current lecture, then becomes 'paused'.
	status: 'running' | 'pausing' | 'paused' | 'completed' | 'error';
	courseId: number;
	courseTitle: string;
	language: string; // CaptionLanguage.code chosen at Start; Resume keeps it
	languageLabel: string;
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
	| { action: 'GET_LANGUAGES' }
	| { action: 'START'; language: CaptionLanguage }
	| { action: 'RESUME'; courseId: number }
	| { action: 'PAUSE'; courseId: number };

/** The content script's answer to GET_PAGE. */
export interface PageInfo {
	/** null when the page is not the course player, e.g. the course landing page. */
	courseId: number | null;
	courseTitle: string;
	/** The course this tab is downloading right now, if any. */
	runningCourseId: number | null;
}
/** Messages from a content script to the background script. */
export type BackgroundMessage = { action: 'SET_BADGE'; text: string; color: string };
