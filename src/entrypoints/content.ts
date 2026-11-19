import { defineContentScript } from '#imports';
import { createDownloader } from '@/utils/download';
import type { CaptionLanguage, MessagePayload, PageInfo } from '@/utils/types';
import { courseTitleFromDocumentTitle, fetchCaptionLanguages, getCourseId } from '@/utils/udemy-api';

export default defineContentScript({
	// All course pages, not only /learn/lecture/*: Udemy navigates between course pages (landing,
	// lecture, quiz, practice) without full page loads, and a content script is only injected on
	// a full load. The course ID is read from the page when Start is clicked, not at injection.
	matches: ['*://www.udemy.com/course/*'],
	async main() {
		console.log('Udemy Downloader: Content Script Loaded');

		const downloader = createDownloader();

		// --- Message Listeners ---
		// Per page load and course: the popup asks each time it opens on a course not yet started.
		const languageRequests = new Map<number, Promise<CaptionLanguage[]>>();
		const captionLanguages = (courseId: number) => {
			let request = languageRequests.get(courseId);
			if (!request) {
				request = fetchCaptionLanguages(courseId);
				// Do not keep a failure: the next popup opening asks again.
				request.catch(() => languageRequests.delete(courseId));
				languageRequests.set(courseId, request);
			}
			return request;
		};

		const pageInfo = (): PageInfo => {
			let courseId: number | null = null;
			try {
				courseId = getCourseId();
			} catch {
				// Not the course player (e.g. the landing page): the popup explains what to open.
			}
			return {
				courseId,
				courseTitle: courseTitleFromDocumentTitle(document.title),
				runningCourseId: downloader.runningCourseId(),
			};
		};

		browser.runtime.onMessage.addListener((message: MessagePayload, _sender, sendResponse) => {
			if (message.action === 'GET_PAGE') {
				sendResponse(pageInfo());
			} else if (message.action === 'GET_LANGUAGES') {
				const { courseId } = pageInfo();
				if (courseId === null) {
					sendResponse([]);
					return;
				}
				// An empty list (also on failure) makes the popup offer English, the old default.
				captionLanguages(courseId).then(sendResponse, () => sendResponse([]));
				return true; // Keeps the channel open for the asynchronous sendResponse.
			} else if (message.action === 'START') {
				void downloader.start(message.language);
			} else if (message.action === 'RESUME') {
				void downloader.resume(message.courseId);
			} else if (message.action === 'PAUSE') {
				downloader.pause(message.courseId);
			}
		});
	},
});
