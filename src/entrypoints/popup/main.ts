import { browser } from 'wxt/browser';
import { courseState, preferredLanguage } from '@/utils/storage';
import { isActiveStatus, isInterrupted } from '@/utils/status';
import type { CaptionLanguage, MessagePayload, PageInfo, ProcessingState } from '@/utils/types';

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
  elsewhere: getElement<HTMLElement>('elsewhere'),
  switchTab: getElement<HTMLButtonElement>('btn-switch'),
  languageRow: getElement<HTMLElement>('language-row'),
  language: getElement<HTMLSelectElement>('language'),
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

/** The open tab whose content script is downloading the course, if any. */
async function findLoopTab(courseId: number) {
  const tabs = await browser.tabs.query({ url: COURSE_TAB_PATTERN });
  const answers = await Promise.allSettled(
    tabs.map(async (tab) => {
      const info: PageInfo = await browser.tabs.sendMessage(tab.id!, { action: 'GET_PAGE' } satisfies MessagePayload);
      return info.runningCourseId === courseId ? tab : null;
    })
  );
  for (const a of answers) if (a.status === 'fulfilled' && a.value) return a.value;
  return null;
}

type LoopTab = Awaited<ReturnType<typeof findLoopTab>>;

function renderCourse(page: Extract<ActivePage, { kind: 'course' }>, state: ProcessingState | null, loopTab: LoopTab) {
  show(els.notice, false);
  show(els.course, true);

  const interrupted = isInterrupted(state, loopTab !== null);
  els.title.textContent = state?.courseTitle || page.courseTitle;
  els.badge.textContent = interrupted ? 'INTERRUPTED' : (state?.status ?? 'not started').toUpperCase();
  show(els.badge, true);
  els.task.textContent = interrupted
    ? 'The download stopped when its tab was closed or reloaded. Resume continues where it left off.'
    : (state?.currentTask ?? '');
  show(els.elsewhere, !interrupted && loopTab !== null && loopTab.id !== page.tabId);

  const total = state?.totalLectures ?? 0;
  const done = state?.completedLectures ?? 0;
  els.fill.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;
  els.count.textContent = `${done} / ${total}`;

  show(els.start, false);
  show(els.resume, false);
  show(els.pause, false);
  show(els.languageRow, false);
  if (interrupted) {
    show(els.resume, true);
  } else if (state?.status === 'running') {
    show(els.pause, true);
  } else if (state?.status === 'paused' || state?.status === 'pausing') {
    // While pausing, Resume cancels the pause and the loop carries on.
    show(els.resume, true);
  } else {
    els.start.textContent = state?.status === 'completed' ? 'Download Again' : 'Start Download';
    show(els.start, true);
    show(els.languageRow, true);
    void loadLanguages(page.tabId, state);
  }
}

/** Used when the course's languages could not be read: English was the only language before. */
const FALLBACK_LANGUAGES: CaptionLanguage[] = [{ code: 'en', label: 'English', auto: false }];
let languages: CaptionLanguage[] | null = null;
let languagesRequested = false;

/** Fills the language picker once; Start waits for it so it always sends a listed language. */
async function loadLanguages(tabId: number, state: ProcessingState | null) {
  if (languagesRequested) return;
  languagesRequested = true;
  els.start.disabled = true;
  let found: CaptionLanguage[] = [];
  try {
    found = await browser.tabs.sendMessage(tabId, { action: 'GET_LANGUAGES' } satisfies MessagePayload);
  } catch {
    // The content script went away; the fallback still allows a Start once the page is back.
  }
  languages = found.length > 0 ? found : FALLBACK_LANGUAGES;

  // A course downloaded before keeps its language; otherwise the language chosen last time.
  const wanted = [state?.language, await preferredLanguage.getValue(), 'en'];
  const selected = wanted.find((code) => languages!.some((l) => l.code === code)) ?? languages[0]!.code;
  els.language.replaceChildren(
    ...languages.map((l) => new Option(l.auto ? `${l.label} (auto-generated)` : l.label, l.code, false, l.code === selected))
  );
  els.language.disabled = false;
  els.start.disabled = false;
}

els.language.addEventListener('change', () => preferredLanguage.setValue(els.language.value));

const selectedLanguage = (): CaptionLanguage =>
  languages?.find((l) => l.code === els.language.value) ?? FALLBACK_LANGUAGES[0]!;

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
  let state = await item.getValue();
  // Asking every course tab is only needed when the status says a loop should exist, and a loop
  // starts or stops only together with a status change.
  const lookUpLoop = async (s: ProcessingState | null) => (s && isActiveStatus(s.status) ? findLoopTab(page.courseId) : null);
  let loopTab = await lookUpLoop(state);
  renderCourse(page, state, loopTab);
  item.watch(async (next) => {
    const statusChanged = next?.status !== state?.status;
    // Set before awaiting, so a quicker later update is not overwritten by this older one.
    state = next;
    if (statusChanged) loopTab = await lookUpLoop(next);
    renderCourse(page, state, loopTab);
  });

  els.switchTab.addEventListener('click', async () => {
    if (loopTab?.id === undefined) return;
    await browser.tabs.update(loopTab.id, { active: true });
    await browser.windows.update(loopTab.windowId, { focused: true });
  });

  els.start.addEventListener('click', () => sendToTab(page.tabId, { action: 'START', language: selectedLanguage() }));
  els.resume.addEventListener('click', () => sendToTab(page.tabId, { action: 'RESUME' }));
  els.pause.addEventListener('click', () => pauseEverywhere(page.courseId));
}
