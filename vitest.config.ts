import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  resolve: { conditions: ['browser'] },
  test: {
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,svelte}'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text-summary', 'html', 'lcov'],
      // Gate: the pure core logic must stay at least 90 % covered. Everything else is reported only.
      thresholds: {
        'src/core/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});
