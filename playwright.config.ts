import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  snapshotDir: './tests/visual/__screenshots__',
  use: {
    ...devices['Desktop Chrome'],
    viewport: {
      width: 900,
      height: 700
    }
  }
});
