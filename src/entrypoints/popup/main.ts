import { browser, type Browser } from 'wxt/browser';
import { deleteCourseState, listCourseStates, preferredLanguage, stateSize } from '@/utils/storage';
import { failedLectures, isActiveStatus, isInterrupted } from '@/utils/status';
import { formatBytes } from '@/utils/helpers';
import { generateZip } from '@/utils/file-generator';
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
  saveZip: getElement<HTMLButtonElement>('btn-save'),
  elsewhere: getElement<HTMLElement>('elsewhere'),
  busy: getElement<HTMLElement>('busy'),
  switchTab: getElement<HTMLButtonElement>('btn-switch'),
  languageRow: getElement<HTMLElement>('language-row'),
  language: getElement<HTMLSelectElement>('language'),
  saved: getElement<HTMLElement>('saved'),
  total: getElement<HTMLElement>('storage-total'),
  list: getElement<HTMLUListElement>('course-list'),
  failures: getElement<HTMLDetailsElement>('failures'),
  failuresSummary: getElement<HTMLElement>('failures-summary'),
  failuresList: getElement<HTMLUListElement>('failures-list'),
  log: getElement<HTMLDetailsElement>('log'),
  logSummary: getElement<HTMLElement>('log-summary'),
  logList: getElement<HTMLOListElement>('log-list'),
};

const COURSE_TAB_PATTERN = 'https://www.udemy.com/course/*';

type Tab = Browser.tabs.Tab;

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

/** Which open tab runs a download loop, by course. */
async function findLoopTabs(): Promise<Map<number, Tab>> {
  const tabs = await browser.tabs.query({ url: COURSE_TAB_PATTERN });
  const answers = await Promise.allSettled(
    tabs.map(async (tab) => {
      const info: PageInfo = await browser.tabs.sendMessage(tab.id!, { action: 'GET_PAGE' } satisfies MessagePayload);
      return [info.runningCourseId, tab] as const;
    })
  );
  const loops = new Map<number, Tab>();
  for (const a of answers) if (a.status === 'fulfilled' && a.value[0] !== null) loops.set(a.value[0], a.value[1]);
  return loops;
}

function show(el: HTMLElement, visible: boolean) {
  el.classList.toggle('hidden', !visible);
}

/** Small element builder for the course list. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
}

const hasTranscripts = (state: ProcessingState) => state.curriculum.some((item) => item.markdownContent);

const saveZip = (state: ProcessingState) => generateZip(state.curriculum, state.courseTitle);

/** Title of another course whose loop runs in this tab, if any. */
let busyCourseTitle: string | null = null;
function busyWith(tabId: number, courseId: number): string | null {
  for (const [id, tab] of loops) {
    if (tab.id === tabId && id !== courseId) return courses.find((c) => c.courseId === id)?.courseTitle ?? 'another course';
  }
  return null;
}

function renderCourse(page: Extract<ActivePage, { kind: 'course' }>, state: ProcessingState | null, loopTab: Tab | null) {
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

  // A tab runs one loop at a time. If Udemy moved this tab to another course page while it keeps
  // downloading a course, Start and Resume here would be ignored, so say why instead.
  busyCourseTitle = busyWith(page.tabId, page.courseId);
  show(els.busy, busyCourseTitle !== null);
  els.busy.textContent = busyCourseTitle
    ? `This tab is still downloading “${busyCourseTitle}”. Pause it in the list below or wait for it to finish, then start this course.`
    : '';
  els.start.disabled = busyCourseTitle !== null || languages === null;
  els.resume.disabled = busyCourseTitle !== null;

  const total = state?.totalLectures ?? 0;
  const done = state?.completedLectures ?? 0;
  els.fill.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;
  els.count.textContent = `${done} / ${total}`;

  renderDetails(state);

  show(els.start, false);
  show(els.resume, false);
  show(els.pause, false);
  show(els.saveZip, false);
  show(els.languageRow, false);
  els.resume.textContent = 'Resume';
  const failed = state ? failedLectures(state.curriculum).length : 0;
  if (interrupted) {
    show(els.resume, true);
  } else if (state?.status === 'running') {
    show(els.pause, true);
  } else if (state?.status === 'paused' || state?.status === 'pausing') {
    // While pausing, Resume cancels the pause and the loop carries on.
    show(els.resume, true);
  } else {
    // A finished course: save its ZIP again from the stored transcripts, or download it again
    // (e.g. for lectures added since, or in another language).
    show(els.saveZip, state?.status === 'completed');
    // Resume fetches only the lectures not done yet: the failed ones after completion, or the rest
    // after an error. Starting over is still offered next to it.
    if (state?.status === 'completed' && failed > 0) {
      els.resume.textContent = `Retry ${failed} failed`;
      show(els.resume, true);
    } else if (state?.status === 'error' && state.curriculum.length > 0) {
      show(els.resume, true);
    }
    els.start.textContent =
      state?.status === 'completed' ? 'Download Again' : state?.status === 'error' ? 'Start Over' : 'Start Download';
    show(els.start, true);
    show(els.languageRow, true);
    void loadLanguages(page.tabId, state);
  }
}

/** Shown in the popup; older entries stay in storage and are visible again after a Start. */
const LOG_LINES = 50;

/** The failed-lecture list and the log, below the buttons. Their open/closed state is kept. */
function renderDetails(state: ProcessingState | null) {
  const failed = state ? failedLectures(state.curriculum) : [];
  show(els.failures, failed.length > 0);
  els.failuresSummary.textContent = `${failed.length} lecture${failed.length === 1 ? '' : 's'} failed`;
  els.failuresList.replaceChildren(
    ...failed.map((item) => h('li', {}, h('strong', { textContent: item.title }), ` — ${item.failedReason}`))
  );

  const logs = state?.logs ?? [];
  show(els.log, logs.length > 0);
  els.logSummary.textContent = `Log (${logs.length})`;
  els.logList.replaceChildren(...logs.slice(-LOG_LINES).map((line) => h('li', { textContent: line })));
}

// --- Course list ---

/** Delete needs a second click within this time, as a confirmation (Firefox popups cannot show confirm()). */
const DELETE_CONFIRM_MS = 3000;
let armedDelete: number | null = null;

function courseRow(state: ProcessingState, loopTab: Tab | null, isActiveCourse: boolean) {
  const status = isInterrupted(state, loopTab !== null) ? 'interrupted' : state.status;
  const meta = `${status[0]!.toUpperCase()}${status.slice(1)} · ${state.completedLectures} / ${state.totalLectures} · ${formatBytes(stateSize(state))}`;
  const actions = h('div', { className: 'row-actions' });

  // Every running download can be paused from here. The current-course Pause only covers the course
  // on the active page, and a tab can keep downloading a course after Udemy has moved it to another
  // course page without a reload, leaving that download with no other Pause.
  if (loopTab?.id !== undefined && state.status === 'running') {
    const tabId = loopTab.id;
    actions.append(
      h('button', {
        className: 'link',
        textContent: 'Pause',
        onclick: () => sendToTab(tabId, { action: 'PAUSE', courseId: state.courseId }),
      })
    );
  }
  if (hasTranscripts(state)) {
    actions.append(h('button', { className: 'link', textContent: 'Save ZIP', onclick: () => saveZip(state) }));
  }
  // A running loop would write the state straight back, so it has to be paused first.
  if (!loopTab) {
    const armed = armedDelete === state.courseId;
    actions.append(
      h('button', {
        className: armed ? 'link danger' : 'link',
        textContent: armed ? 'Confirm delete' : 'Delete',
        onclick: async () => {
          if (armedDelete === state.courseId) {
            armedDelete = null;
            await deleteCourseState(state.courseId);
            return; // The storage change re-renders.
          }
          armedDelete = state.courseId;
          renderList();
          setTimeout(() => {
            if (armedDelete === state.courseId) {
              armedDelete = null;
              renderList();
            }
          }, DELETE_CONFIRM_MS);
        },
      })
    );
  }

  return h(
    'li',
    { className: isActiveCourse ? 'course-row current' : 'course-row' },
    h('div', { className: 'row-title', textContent: state.courseTitle, title: state.courseTitle }),
    h('div', { className: 'row-meta', textContent: isActiveCourse ? `${meta} · this tab` : meta }),
    actions
  );
}

function renderList() {
  show(els.saved, courses.length > 0);
  const used = courses.reduce((sum, state) => sum + stateSize(state), 0);
  els.total.textContent = `${formatBytes(used)} used`;
  const activeId = page.kind === 'course' ? page.courseId : null;
  els.list.replaceChildren(
    ...courses.map((state) => courseRow(state, loops.get(state.courseId) ?? null, state.courseId === activeId))
  );
}

// --- Language picker ---

/** Used when the course's languages could not be read: English was the only language before. */
const FALLBACK_LANGUAGES: CaptionLanguage[] = [{ code: 'en', label: 'English', auto: false }];
let languages: CaptionLanguage[] | null = null;
let languagesRequested = false;

/**
 * The picker's text for a language. The fallback says that it is one: the course's first
 * lectures (see fetchCaptionLanguages) had no captions, or they could not be read.
 */
const optionLabel = (language: CaptionLanguage, isFallback: boolean) =>
  isFallback
    ? `${language.label} (no captions found in the first lectures)`
    : language.auto
      ? `${language.label} (auto-generated)`
      : language.label;

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
    ...languages.map((l) => new Option(optionLabel(l, found.length === 0), l.code, false, l.code === selected))
  );
  els.language.disabled = false;
  els.start.disabled = busyCourseTitle !== null;
}

els.language.addEventListener('change', () => preferredLanguage.setValue(els.language.value));

const selectedLanguage = (): CaptionLanguage =>
  languages?.find((l) => l.code === els.language.value) ?? FALLBACK_LANGUAGES[0]!;

// --- Actions ---

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

// --- State and refresh ---

const page = await detectActivePage();
let courses: ProcessingState[] = [];
let loops = new Map<number, Tab>();
let lastStatuses = '';

async function refresh() {
  courses = await listCourseStates();
  // Asking every course tab is only needed when some status says a loop should exist. Ask again
  // when a status changes, and while an active course has no known loop: resuming an interrupted
  // download goes from 'running' to 'running', so no status change announces its new loop.
  // A loop tab closing or reloading also ends a loop without a status change (see below).
  const statuses = courses.map((c) => `${c.courseId}:${c.status}`).join();
  const unowned = courses.some((c) => isActiveStatus(c.status) && !loops.has(c.courseId));
  if (statuses !== lastStatuses || unowned) {
    lastStatuses = statuses;
    loops = courses.some((c) => isActiveStatus(c.status)) ? await findLoopTabs() : new Map();
  }
  if (page.kind === 'course') {
    const state = courses.find((c) => c.courseId === page.courseId) ?? null;
    renderCourse(page, state, loops.get(page.courseId) ?? null);
  }
  renderList();
}

// Refreshes run one at a time, so an older one cannot finish after a newer one and show stale data.
let refreshing = Promise.resolve();
const scheduleRefresh = () => {
  refreshing = refreshing.then(refresh, refresh);
};

if (page.kind === 'notice') els.notice.textContent = page.message;
scheduleRefresh();
// Closing or reloading the tab that runs a loop ends the loop without a status change.
const loopTabGone = (tabId: number) => {
  if (![...loops.values()].some((tab) => tab.id === tabId)) return;
  lastStatuses = ''; // Forces a new lookup.
  scheduleRefresh();
};
browser.tabs.onRemoved.addListener((tabId) => loopTabGone(tabId));
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') loopTabGone(tabId);
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((key) => key.startsWith('course:'))) scheduleRefresh();
});

if (page.kind === 'course') {
  const current = () => courses.find((c) => c.courseId === page.courseId);
  els.start.addEventListener('click', () => sendToTab(page.tabId, { action: 'START', language: selectedLanguage() }));
  // While pausing, the loop may be in another tab (Pause reaches every tab). Resume must go to
  // that loop: sent to the active tab, it would start a second loop on the same course, and the
  // two would overwrite each other's progress. With no loop anywhere, the active tab resumes.
  els.resume.addEventListener('click', () =>
    sendToTab(loops.get(page.courseId)?.id ?? page.tabId, { action: 'RESUME', courseId: page.courseId })
  );
  els.pause.addEventListener('click', () => pauseEverywhere(page.courseId));
  els.saveZip.addEventListener('click', () => {
    const state = current();
    if (state) void saveZip(state);
  });
  els.switchTab.addEventListener('click', async () => {
    const tab = loops.get(page.courseId);
    if (tab?.id === undefined) return;
    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
  });
}
