import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
	// Resolves WXT's `#imports` / `@/` aliases and provides a fake `browser` API.
	plugins: [WxtVitest()],
	test: {
		// Node by default; DOM-dependent test files opt in with `// @vitest-environment happy-dom`.
		environment: 'node',
		include: ['test/**/*.test.ts'],
	},
});
