import type { Page } from '@playwright/test';

// Robust wait for the tee-sheet UI to be ready. This avoids using
// `page.waitForLoadState('networkidle')` which is brittle on slow or
// resource-blocked environments. The function waits for one of several
// visible signals: a date header, any time-like text, or an action button.
export async function waitForTeeSheet(page: Page, timeout = 30000) {
  // Accept cookie banners if present to avoid blocking UI
  const cookie = page
    .locator('button:has-text("Accept"), button:has-text("I Agree")')
    .first();
  if (await cookie.isVisible().catch(() => false))
    await cookie.click().catch(() => {});

  // If the page unexpectedly shows a login form, attempt auto-login and refresh state
  const loginIndicator = page
    .locator('text=/Member Login|Enter your 8 digit GUI|Username/i')
    .first();
  if (await loginIndicator.isVisible().catch(() => false)) {
    console.log(
      '⚠️ Detected login page while waiting for tee sheet — attempting auto-login',
    );
    try {
      await ensureLoggedIn(page);
    } catch (e) {
      console.log('⚠️ Auto-login attempt failed:', e);
    }
  }

  const dateHeader = page
    .locator('button', {
      hasText: /JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/i,
    })
    .first();
  const anyTime = page
    .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
    .first();
  const anyAction = page
    .locator(
      'button:has-text("Book"), button:has-text("Waiting"), a:has-text("Book"), [role="button"]:has-text("Book")',
    )
    .first();

  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await dateHeader.isVisible().catch(() => false)) {
      console.log('✅ date header visible');
      return;
    }
    if (await anyTime.isVisible().catch(() => false)) {
      console.log('✅ a tee time is visible');
      return;
    }
    if (await anyAction.isVisible().catch(() => false)) {
      console.log('✅ a booking action is visible');
      return;
    }
    await page.waitForTimeout(300);
  }
  throw new Error(
    'Tee sheet not detected within ' +
      timeout +
      'ms (no date header, times, or buttons).',
  );
}

// Ensure user is logged in; if page still shows a /login URL, perform a
// fallback auto-login using env creds and persist the refreshed storage state.
export async function ensureLoggedIn(page: Page) {
  if (!/\/login\b/i.test(page.url())) return;

  const USER = process.env.FS_USERNAME ?? process.env.FS_EMAIL ?? '';
  const PASS = process.env.FS_PASSWORD ?? '';

  const userInput = page.getByPlaceholder(/8 digit GUI|ILGU|username/i).first();
  const passInput = page.getByPlaceholder(/password/i).first();
  await userInput.waitFor({ state: 'visible', timeout: 8000 });
  await userInput.fill(USER);
  await passInput.fill(PASS);

  await page.getByRole('button', { name: /login/i }).first().click();

  const loggedInSignal = page
    .getByRole('link', { name: /tee sheet/i })
    .first()
    .or(page.getByRole('button', { name: /book a tee time/i }).first());
  await loggedInSignal.waitFor({ state: 'visible', timeout: 15000 });

  await page.context().storageState({ path: 'state.json' });
  console.log('🔐 Auto-login detected and state.json refreshed');
}

// Open a calendar overlay using a variety of selectors; resilient to different
// datepicker implementations.
export async function openCalendar(page: Page) {
  const dateBtn = page
    .locator('button', {
      hasText: /JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC/i,
    })
    .first();
  await dateBtn.waitFor({ state: 'visible', timeout: 7000 });
  await dateBtn.click();

  const calendarSelectors = [
    '.mat-calendar',
    '.mat-datepicker-content',
    '.mat-datepicker-popup',
    '.cdk-overlay-container .mat-calendar',
    '.ui-datepicker',
    '.datepicker',
    '[role="dialog"]',
    'body .mat-calendar',
  ];

  const start = Date.now();
  const timeout = 9000;
  while (Date.now() - start < timeout) {
    for (const sel of calendarSelectors) {
      if (
        await page
          .locator(sel)
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        console.log('📅 Calendar opened via selector', sel);
        return;
      }
    }

    const dayLike = page
      .locator(
        'button:has-text("1"), button:has-text("2"), button:has-text("3"), .mat-calendar-body-cell, .ui-datepicker-day',
      )
      .first();
    if (await dayLike.isVisible().catch(() => false)) {
      console.log('📅 Calendar-like day cell visible');
      return;
    }

    await page.waitForTimeout(200);
  }

  throw new Error(
    'Calendar did not appear after clicking date button (checked several selectors)',
  );
}

export async function selectCalendarDay(page: Page, day: string, maxHops = 12) {
  for (let i = 0; i <= maxHops; i++) {
    const daySelectors = [
      `.mat-calendar-body-cell:not(.mat-calendar-body-disabled) .mat-calendar-body-cell-content:text-is("${day}")`,
      `.mat-calendar-body-cell-content:text-is("${day}")`,
      `button:has-text("${day}")`,
      `.ui-datepicker-calendar td:not(.ui-datepicker-unselectable) :text-is("${day}")`,
      `.datepicker td:not(.disabled) :text-is("${day}")`,
      `text("${day}")`,
    ];

    for (const sel of daySelectors) {
      const enabledDay = page.locator(sel).first();
      if (await enabledDay.isVisible().catch(() => false)) {
        console.log(
          `📅 Clicking day ${day} on month hop ${i} using selector ${sel}`,
        );
        await enabledDay.click().catch(() => {});
        return true;
      }
    }

    const nextBtn = page
      .locator(
        '.mat-calendar-next-button, button[aria-label="Next month"], button.mat-calendar-next-button',
      )
      .first();
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(250);
    } else {
      break;
    }
  }
  return false;
}
