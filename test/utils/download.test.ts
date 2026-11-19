// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createDownloader } from '@/utils/download';
import { generateZip } from '@/utils/file-generator';
import { courseState } from '@/utils/storage';
import type { ProcessingState, UdemyCurriculumItem } from '@/utils/types';
import { fetchCurriculum, fetchTranscript, getCourseId, type TranscriptResult } from '@/utils/udemy-api';

// Only the network and the page are replaced; isVideoLecture, transcriptMarkdown and the
// title parsing stay real, as does storage (WXT's fake browser).
vi.mock('@/utils/udemy-api', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/utils/udemy-api')>()),
	getCourseId: vi.fn(),
	fetchCurriculum: vi.fn(),
	fetchTranscript: vi.fn(),
}));
vi.mock('@/utils/file-generator', () => ({ generateZip: vi.fn(async () => {}) }));

const COURSE_ID = 1;
const ENGLISH = { code: 'en', label: 'English', auto: false };

const lecture = (id: number): UdemyCurriculumItem => ({
	_class: 'lecture',
	id,
	title: `Lecture ${id}`,
	sort_order: id,
	type: 'lecture',
	asset: { id: id * 10, title: `video-${id}.mp4`, asset_type: 'Video' },
});
const chapter: UdemyCurriculumItem = { _class: 'chapter', id: 100, title: 'Chapter 1', sort_order: 0, type: 'chapter' };

const transcript = (markdown: string): TranscriptResult => ({ kind: 'transcript', markdown });

/** A promise resolved from the test, to hold the loop at a chosen await. */
const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

const saved = () => courseState(COURSE_ID).getValue();
/** Every state the loop saved for the course, in order. */
const savedStates = (setSpy: { mock: { calls: unknown[][] } }) =>
	setSpy.mock.calls
		.map(([items]) => (items as Record<string, ProcessingState>)[`course:${COURSE_ID}`])
		.filter((state) => state !== undefined);

beforeEach(() => {
	fakeBrowser.reset();
	document.title = 'Course: Test Course | Udemy';
	vi.mocked(getCourseId).mockReturnValue(COURSE_ID);
	vi.mocked(fetchCurriculum).mockResolvedValue([chapter, lecture(1), lecture(2)]);
	vi.mocked(fetchTranscript).mockImplementation(async (_courseId, lectureId) => transcript(`Text ${lectureId}`));
});

afterEach(() => {
	vi.clearAllMocks();
	vi.restoreAllMocks();
});

describe('start', () => {
	it('downloads every video lecture, then zips them', async () => {
		const downloader = createDownloader();
		await downloader.start(ENGLISH);

		const state = await saved();
		expect(state?.status).toBe('completed');
		expect(state?.currentTask).toBe('Download Finished');
		expect(state?.courseTitle).toBe('Test Course');
		expect(state?.totalLectures).toBe(2); // The chapter is not counted
		expect(state?.completedLectures).toBe(2);
		expect(state?.curriculum.filter((item) => item.isCompleted).map((item) => item.markdownContent)).toEqual([
			'Text 1',
			'Text 2',
		]);
		expect(fetchTranscript).toHaveBeenCalledWith(COURSE_ID, 1, 'en');
		expect(generateZip).toHaveBeenCalledWith(state?.curriculum, 'Test Course');
		expect(downloader.runningCourseId()).toBeNull();
	});

	it('keeps a failed lecture incomplete, marks it in the ZIP, and goes on', async () => {
		vi.mocked(fetchTranscript).mockImplementation(async (_courseId, lectureId) => {
			if (lectureId === 1) throw new Error('HTTP 503');
			return transcript(`Text ${lectureId}`);
		});
		await createDownloader().start(ENGLISH);

		const state = await saved();
		const first = state?.curriculum.find((item) => item.id === 1);
		expect(first?.isCompleted).toBeFalsy();
		expect(first?.failedReason).toBe('HTTP 503');
		expect(first?.markdownContent).toBe('> [Transcript download failed: HTTP 503]');
		expect(state?.completedLectures).toBe(1);
		expect(state?.status).toBe('completed');
		expect(state?.currentTask).toContain('1 lecture(s) failed');
	});

	it('stops with an error when saving progress fails, keeping the fetched transcript', async () => {
		const realSet = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
		let failed = false;
		vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(async (items) => {
			const state = (items as Record<string, ProcessingState>)[`course:${COURSE_ID}`];
			if (!failed && state?.completedLectures === 1) {
				failed = true;
				throw new Error('QUOTA_BYTES quota exceeded');
			}
			return realSet(items);
		});
		await createDownloader().start(ENGLISH);

		const state = await saved();
		expect(state?.status).toBe('error');
		expect(state?.currentTask).toBe('Error: QUOTA_BYTES quota exceeded');
		// Not replaced with a failure placeholder: the fetch succeeded, the save did not.
		expect(state?.curriculum.find((item) => item.id === 1)?.markdownContent).toBe('Text 1');
		expect(fetchTranscript).toHaveBeenCalledTimes(1);
		expect(generateZip).not.toHaveBeenCalled();
	});

	it('is ignored while a download runs in the tab', async () => {
		const fetch = deferred<TranscriptResult>();
		vi.mocked(fetchTranscript).mockReturnValueOnce(fetch.promise);
		const downloader = createDownloader();
		const first = downloader.start(ENGLISH);
		await vi.waitFor(() => expect(fetchTranscript).toHaveBeenCalled());

		await downloader.start(ENGLISH);
		expect(fetchCurriculum).toHaveBeenCalledTimes(1);

		fetch.resolve(transcript('Text 1'));
		await first;
		expect((await saved())?.status).toBe('completed');
	});

	it('does nothing outside the course player', async () => {
		vi.mocked(getCourseId).mockImplementation(() => {
			throw new Error('Course ID not found');
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const downloader = createDownloader();
		await downloader.start(ENGLISH);

		expect(fetchCurriculum).not.toHaveBeenCalled();
		expect(downloader.runningCourseId()).toBeNull();
	});
});

describe('pause and resume', () => {
	/** Starts a download and holds it in the fetch of lecture 1. */
	const startHeldInFirstLecture = async () => {
		const fetch = deferred<TranscriptResult>();
		vi.mocked(fetchTranscript).mockReturnValueOnce(fetch.promise);
		const downloader = createDownloader();
		const run = downloader.start(ENGLISH);
		await vi.waitFor(() => expect(fetchTranscript).toHaveBeenCalledTimes(1));
		return { downloader, run, fetch };
	};

	it('pauses after the current lecture, and Resume continues from saved progress', async () => {
		const { downloader, run, fetch } = await startHeldInFirstLecture();
		expect(downloader.runningCourseId()).toBe(COURSE_ID);

		downloader.pause(COURSE_ID);
		await vi.waitFor(async () => expect((await saved())?.status).toBe('pausing'));

		fetch.resolve(transcript('Text 1'));
		await run;
		let state = await saved();
		expect(state?.status).toBe('paused');
		expect(state?.completedLectures).toBe(1);
		expect(fetchTranscript).toHaveBeenCalledTimes(1);
		expect(downloader.runningCourseId()).toBeNull();

		await downloader.resume(COURSE_ID);
		state = await saved();
		expect(state?.status).toBe('completed');
		expect(state?.completedLectures).toBe(2);
		expect(fetchCurriculum).toHaveBeenCalledTimes(1); // Resumed, not started over
		expect(fetchTranscript).toHaveBeenCalledTimes(2); // Lecture 1 is not fetched again
	});

	it('carries on when Resume arrives before the current lecture finishes', async () => {
		const setSpy = vi.spyOn(fakeBrowser.storage.local, 'set');
		const { downloader, run, fetch } = await startHeldInFirstLecture();

		downloader.pause(COURSE_ID);
		await downloader.resume(COURSE_ID);
		fetch.resolve(transcript('Text 1'));
		await run;

		expect((await saved())?.status).toBe('completed');
		expect(savedStates(setSpy).map((state) => state.status)).not.toContain('paused');
	});

	it('carries on when Resume arrives while the pause is being saved', async () => {
		const realSet = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
		const pauseSave = deferred<void>();
		const pauseSaveStarted = deferred<void>();
		vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(async (items) => {
			const state = (items as Record<string, ProcessingState>)[`course:${COURSE_ID}`];
			if (state?.status === 'paused') {
				pauseSaveStarted.resolve();
				await pauseSave.promise;
			}
			return realSet(items);
		});
		const { downloader, run, fetch } = await startHeldInFirstLecture();

		downloader.pause(COURSE_ID);
		fetch.resolve(transcript('Text 1'));
		await pauseSaveStarted.promise;
		const resume = downloader.resume(COURSE_ID);
		pauseSave.resolve();
		await Promise.all([run, resume]);

		// Not left 'paused' with no loop to resume it.
		const state = await saved();
		expect(state?.status).toBe('completed');
		expect(state?.completedLectures).toBe(2);
	});

	it('ignores Pause and Resume for another course', async () => {
		const { downloader, run, fetch } = await startHeldInFirstLecture();

		downloader.pause(2); // Not the downloading course: no effect
		downloader.pause(COURSE_ID);
		await downloader.resume(2); // Must not cancel the pause of course 1
		fetch.resolve(transcript('Text 1'));
		await run;

		expect((await saved())?.status).toBe('paused');
	});

	it('ignores Resume when the page has moved to another course', async () => {
		vi.mocked(getCourseId).mockReturnValue(2);
		await createDownloader().resume(COURSE_ID);

		expect(fetchCurriculum).not.toHaveBeenCalled();
		expect(await saved()).toBeNull();
	});
});
