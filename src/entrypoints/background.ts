import { defineBackground } from '#imports';
import { removeLegacyState } from '@/utils/storage';
import type { BackgroundMessage } from '@/utils/types';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => removeLegacyState());

  // Content scripts cannot use the action API, so they send their badge here. It is set for the
  // sending tab only: each tab shows the course it downloads, and the browser drops a tab's badge
  // when the tab navigates to another page.
  browser.runtime.onMessage.addListener((message: BackgroundMessage, sender) => {
    const tabId = sender.tab?.id;
    if (message.action !== 'SET_BADGE' || tabId === undefined) return;
    void browser.action.setBadgeText({ tabId, text: message.text });
    void browser.action.setBadgeBackgroundColor({ tabId, color: message.color });
  });
});
