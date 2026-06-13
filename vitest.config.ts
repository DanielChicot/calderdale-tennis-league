import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // apps/web has its own Vitest config (with the SvelteKit `$lib` alias its
    // tests need). Run it via `pnpm --filter @ctl/web run test`. The root suite
    // can't resolve `$lib`, so exclude it here.
    exclude: ['**/node_modules/**', 'apps/web/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['**/dist/**', '**/*.config.*', 'fixtures/**', '**/migrations/**'],
    },
  },
});
