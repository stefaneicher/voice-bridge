import { defineConfig } from 'vitest/config';

// End-to-end smoke test of the built Electron app (run `npm run build` first).
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
