import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // A copy of an old project kept for reference only; its tests are not ours.
    exclude: [...configDefaults.exclude, 'demo-delete-after-we-finish-task/**'],
  },
});
