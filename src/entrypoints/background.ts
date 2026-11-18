import { defineBackground } from '#imports';
import { migrateLegacyState } from '@/utils/storage';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => migrateLegacyState());
});
