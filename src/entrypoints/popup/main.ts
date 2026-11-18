import { browser } from 'wxt/browser';
import { courseState } from '@/utils/storage';
import type { MessagePayload, PageInfo, ProcessingState } from '@/utils/types';

// Helper for safe element retrieval
function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Required element #${id} not found`);
  return el as T;
}

// Elements
const els = {
  notice: getElement<HTMLElement>('notice'),
  course: getElement<HTMLElement>('course'),
  title: getElement<HTMLElement>('course-title'),
  badge: getElement<HTMLElement>('status-badge'),
  fill: getElement<HTMLElement>('fill'),
  count: getElement<HTMLElement>('count'),
  task: getElement<HTMLElement>('task'),
  start: getElement<HTMLButtonElement>('btn-start'),
  resume: getElement<HTMLButtonElement>('btn-resume'),
  pause: getElement<HTMLButtonElement>('btn-pause'),
};

const COURSE_TAB_PATTERN = 'https://www.udemy.com/course/*';

/** The course open in the active tab, or why there is none. */
type ActivePage =
  | { kind: 'notice'; message: string }
  | { kind: 'course'; tabId: number; courseId: number; courseTitle: string };

async function detectActivePage(): Promise<ActivePage> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url?.startsWith('https://www.udemy.com/course/')) {
    return { kind: 'notice', message: 'Open a Udemy course you are enrolled in to download its transcripts.' };
  }
  let info: PageInfo;
  try {
    info = await browser.tabs.sendMessage(tab.id, { action: 'GET_PAGE' } satisfies MessagePayload);
  } catch {
    // No content script answered: the tab was open before the extension was installed or updated.
    return { kind: 'notice', message: 'Reload this Udemy page, then open the extension again.' };
  }
  if (info.courseId === null) {
    return {
      kind: 'notice',
      message: 'Open the course player (“Go to course”) to download transcripts. The course page itself has no lecture list to read.',
    };
  }
  return { kind: 'course', tabId: tab.id, courseId: info.courseId, courseTitle: info.courseTitle };
}

function show(el: HTMLElement, visible: boolean) {
  el.classList.toggle('hidden', !visible);
}

function renderCourse(page: Extract<ActivePage, { kind: 'course' }>, state: ProcessingState | null) {
  show(els.notice, false);
  show(els.course, true);

  els.title.textContent = state?.courseTitle || page.courseTitle;
  els.badge.textContent = (state?.status ?? 'not started').toUpperCase();
  show(els.badge, true);
  els.task.textContent = state?.currentTask ?? '';

  const total = state?.totalLectures ?? 0;
  const done = state?.completedLectures ?? 0;
  els.fill.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;
  els.count.textContent = `${done} / ${total}`;

  show(els.start, false);
  show(els.resume, false);
  show(els.pause, false);
  if (state?.status === 'running') {
    show(els.pause, true);
  } else if (state?.status === 'paused') {
    show(els.resume, true);
  } else {
    els.start.textContent = state?.status === 'completed' ? 'Download Again' : 'Start Download';
    show(els.start, true);
  }
}

// The loop may be running in a tab other than the active one, and only that tab's content script
// can pause it. Tabs without a running loop for the course ignore the message.
async function pauseEverywhere(courseId: number) {
  const tabs = await browser.tabs.query({ url: COURSE_TAB_PATTERN });
  await Promise.allSettled(
    tabs
      .filter((t) => t.id !== undefined)
      .map((t) => browser.tabs.sendMessage(t.id!, { action: 'PAUSE', courseId } satisfies MessagePayload))
  );
}

async function sendToTab(tabId: number, message: MessagePayload) {
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch {
    els.task.textContent = 'Error: Refresh the Udemy page first.';
  }
}

const page = await detectActivePage();
if (page.kind === 'notice') {
  els.notice.textContent = page.message;
} else {
  const item = courseState(page.courseId);
  renderCourse(page, await item.getValue());
  item.watch((state) => renderCourse(page, state));

  els.start.addEventListener('click', () => sendToTab(page.tabId, { action: 'START' }));
  els.resume.addEventListener('click', () => sendToTab(page.tabId, { action: 'RESUME' }));
  els.pause.addEventListener('click', () => pauseEverywhere(page.courseId));
}
