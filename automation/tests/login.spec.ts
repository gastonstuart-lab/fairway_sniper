import { test, expect } from '@playwright/test';
import { ensureLoggedIn } from './helpers.js';

test('manual login bootstrap', async ({ page, context }) => {
  // Correct login page
  await page.goto('https://members.brsgolf.com/galgorm/login');

  // Use GUI/ILGU username if provided, else fallback to email
  const USER = process.env.FS_USERNAME ?? process.env.FS_EMAIL ?? '';

  // Fill login form using robust selectors
  await page.getByPlaceholder(/8 digit GUI|username/i).fill(USER);
  await page.getByPlaceholder(/password/i).fill(process.env.FS_PASSWORD ?? '');

  // Click LOGIN
  await page.getByRole('button', { name: /login/i }).click();

  // Persist session and wait for a logged-in signal instead of networkidle
  await ensureLoggedIn(page);
  // Some clubs redirect to the root '/galgorm' after login — treat any non-login
  // URL as success to be resilient.
  await expect(page).not.toHaveURL(/\/login\b/i);

  // session saved inside ensureLoggedIn
});
