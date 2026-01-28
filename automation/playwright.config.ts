import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const FAST = process.env.PW_FAST === '1';
if (FAST) console.log('⚡ FAST mode (headless, no artifacts)');

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  use: FAST
    ? {
        headless: true,
        trace: 'off',
        screenshot: 'off',
        video: 'off',
        storageState: 'state.json',
      }
    : {
        headless: false,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        storageState: 'state.json',
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
