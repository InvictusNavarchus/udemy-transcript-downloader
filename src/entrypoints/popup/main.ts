import { browser } from 'wxt/browser';
import { downloadState } from '@/utils/storage';
import { ProcessingState } from '@/utils/types';

// Elements
const els = {
  title: document.getElementById('course-title')!,
  badge: document.getElementById('status-badge')!,
  fill: document.getElementById('fill')!,
  count: document.getElementById('count')!,
  task: document.getElementById('task')!,
  start: document.getElementById('btn-start')!,
  resume: document.getElementById('btn-resume')!,
  pause: document.getElementById('btn-pause')!
};

// 1. Initial Render
const initialState = await downloadState.getValue();
render(initialState);

// 2. Watch for changes (Reactive)
downloadState.watch((newState) => {
  render(newState);
});

// Render Function
function render(state: ProcessingState) {
  if (!state) return;

  // Text
  if (state.courseTitle) els.title.textContent = state.courseTitle;
  els.task.textContent = state.currentTask;
  els.badge.textContent = state.status.toUpperCase();
  
  // Progress
  const percent = state.totalLectures > 0 
    ? Math.round((state.completedLectures / state.totalLectures) * 100) 
    : 0;
  els.fill.style.width = `${percent}%`;
  els.count.textContent = `${state.completedLectures} / ${state.totalLectures}`;

  // Buttons visibility
  els.start.classList.add('hidden');
  els.resume.classList.add('hidden');
  els.pause.classList.add('hidden');

  if (state.status === 'running') {
    els.pause.classList.remove('hidden');
  } else if (state.status === 'paused') {
    els.resume.classList.remove('hidden');
  } else {
    // idle, completed, error
    els.start.textContent = state.status === 'completed' ? 'Download Again' : 'Start Download';
    els.start.classList.remove('hidden');
  }
}

// Button Actions
async function send(action: 'START' | 'RESUME' | 'PAUSE') {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      await browser.tabs.sendMessage(tab.id, { action });
    } catch (e) {
      els.task.textContent = 'Error: Refresh the Udemy page first.';
    }
  } else {
    els.task.textContent = 'No active tab found.';
  }
}

els.start.addEventListener('click', () => send('START'));
els.resume.addEventListener('click', () => send('RESUME'));
els.pause.addEventListener('click', () => send('PAUSE'));