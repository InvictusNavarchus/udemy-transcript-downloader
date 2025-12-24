import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
    srcDir: 'src',
    modules: ['@wxt-dev/auto-icons'],
    manifest: {
        permissions: ['storage', 'activeTab'],
        host_permissions: ['https://www.udemy.com/*'],
        action: {
            default_popup: 'entrypoints/popup/index.html',
     },
  },
});
