import { defineConfig, type UserManifest } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
	srcDir: 'src',
	modules: ['@wxt-dev/auto-icons'],
	manifest: ({ browser }) => {
		const manifest: UserManifest = {
			permissions: ['storage', 'unlimitedStorage', 'activeTab'],
			host_permissions: ['https://www.udemy.com/*'],
			action: {
				default_popup: 'entrypoints/popup/index.html',
			},
		};

		if (browser === 'firefox') {
			manifest.browser_specific_settings = {
				gecko: {
					id: 'udemy-transcript-downloader@InvictusNavarchus',
					data_collection_permissions: {
						required: ['none'],
					},
				},
			};
		}

		return manifest;
	},
});
