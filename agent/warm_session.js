import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const agentDir = path.dirname(__filename);
const profileDir = path.join(agentDir, '.session', 'profile');

let warmBrowser = null;
let warmContext = null;
let warmPage = null;
let inflightInit = null;
let keepAliveTimer = null;
let lastKeepAliveAt = null;

let status = {
  warm: false,
  authenticated: false,
  teeSheetLoaded: false,
  targetDate: null,
  lastError: null,
  lastKeepAliveAt: null,
  contextAlive: false,
  pageUrl: null,
};

const DEFAULT_LOGIN_URL =
  process.env.CLUB_LOGIN_URL || 'https://members.brsgolf.com/galgorm/login';

function log(message) {
  console.log(`[WARM] ${message}`);
}

function targetDateKey(targetDate) {
  if (typeof targetDate === 'string') {
    const match = targetDate.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const date = targetDate instanceof Date ? targetDate : new Date(targetDate);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid targetDate for warm session');
  }
  return date.toISOString().slice(0, 10);
}

function teeSheetUrl(targetDate) {
  const [year, month, day] = targetDateKey(targetDate).split('-');
  return `https://members.brsgolf.com/galgorm/tee-sheet/1/${year}/${month}/${day}`;
}

function pageIsUsable(page) {
  return Boolean(page && !page.isClosed?.());
}

function browserIsUsable(browser) {
  return Boolean(browser && browser.isConnected?.());
}

function sessionIsUsable() {
  const contextOpen = Boolean(warmContext && !warmContext.isClosed?.());
  const browserOpen = !warmBrowser || browserIsUsable(warmBrowser);
  return contextOpen && browserOpen && pageIsUsable(warmPage);
}

function pageMatchesTargetTeeSheet(page, targetDate) {
  if (!pageIsUsable(page) || !targetDate) return false;
  const dateKey = targetDateKey(targetDate);
  const [year, month, day] = dateKey.split('-');
  const url = page.url?.() || '';
  return (
    url.includes('/tee-sheet/') &&
    url.includes(`/${year}/${month}/${day}`)
  );
}

async function loginFormVisible(page) {
  if (!pageIsUsable(page)) return true;
  const url = page.url?.() || '';
  if (/\/login(?:[/?#]|$)/i.test(url)) return true;

  const passwordVisible = await page
    .locator('input[type="password"], input[placeholder*="password" i]')
    .first()
    .isVisible()
    .catch(() => false);
  if (!passwordVisible) return false;

  return page
    .locator(
      'input[name="username"], input[type="text"][name*="username"], input[placeholder*="GUI" i], input[placeholder*="username" i], input[placeholder*="email" i]',
    )
    .first()
    .isVisible()
    .catch(() => false);
}

async function targetTeeSheetSessionIsUsable(page, targetDate) {
  if (!pageMatchesTargetTeeSheet(page, targetDate)) return false;
  return !(await loginFormVisible(page));
}

function resetStatus(error = null) {
  status = {
    warm: false,
    authenticated: false,
    teeSheetLoaded: false,
    targetDate: null,
    lastError: error,
    lastKeepAliveAt,
    contextAlive: false,
    pageUrl: null,
  };
}

async function disposeBrokenSession() {
  if (warmPage && !warmPage.isClosed?.()) {
    await warmPage.close().catch(() => {});
  }
  if (warmContext) {
    await warmContext.close().catch(() => {});
  }
  if (warmBrowser && warmBrowser.isConnected?.()) {
    await warmBrowser.close().catch(() => {});
  }
  warmPage = null;
  warmContext = null;
  warmBrowser = null;
}

async function ensureContext() {
  if (sessionIsUsable()) {
    status.contextAlive = true;
    return warmContext;
  }

  await disposeBrokenSession();
  await fs.promises.mkdir(profileDir, { recursive: true }).catch(() => {});
  log('launching persistent reusable Chromium session');
  warmContext = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  warmBrowser = warmContext.browser?.() || null;
  [warmPage] = warmContext.pages();
  if (!warmPage) {
    warmPage = await warmContext.newPage();
  }

  status.warm = true;
  status.authenticated = false;
  status.teeSheetLoaded = false;
  status.targetDate = null;
  status.lastError = null;
  status.contextAlive = true;
  status.pageUrl = warmPage.url();
  return warmContext;
}

async function isAuthenticated(page) {
  if (!pageIsUsable(page)) return false;

  const logoutVisible = await page
    .locator('a[href*="logout"], button:has-text("Logout"), a:has-text("Logout")')
    .first()
    .isVisible()
    .catch(() => false);
  if (logoutVisible) return true;

  const teeSheetSignal = await page
    .locator(
      'a[href*="tee-sheet"], a:has-text("Tee Sheet"), button:has-text("Book"), a[href*="/bookings/"]',
    )
    .first()
    .isVisible()
    .catch(() => false);
  return teeSheetSignal;
}

async function robustFill(page, selector, value, label) {
  const element = page.locator(selector).first();
  await element.waitFor({ state: 'visible', timeout: 15000 });
  await element.click({ timeout: 5000 }).catch(() => {});
  await element.fill(value, { timeout: 8000 });
  log(`filled ${label}`);
}

async function performLogin(page, loginUrl, username, password) {
  if (!username || !password) {
    throw new Error('BRS credentials are required for warm session');
  }

  log('navigating to BRS login page');
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

  const userSelectors = [
    'input[name="username"]',
    'input[type="text"][name*="username"]',
    'input[placeholder*="GUI" i]',
    'input[placeholder*="username" i]',
    'input[placeholder*="email" i]',
  ];
  const passwordSelectors = [
    'input[type="password"]',
    'input[placeholder*="password" i]',
  ];

  const userSelector = await firstExistingSelector(page, userSelectors);
  const passwordSelector = await firstExistingSelector(page, passwordSelectors);
  if (!userSelector || !passwordSelector) {
    throw new Error('BRS login fields were not found');
  }

  await robustFill(page, userSelector, username, 'username');
  await robustFill(page, passwordSelector, password, 'password');

  const loginButton = page
    .locator(
      'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Log in"), button:has-text("Sign in")',
    )
    .first();
  await loginButton.waitFor({ state: 'visible', timeout: 10000 });

  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {}),
    loginButton.click({ timeout: 10000 }),
  ]);

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await isAuthenticated(page)) {
      status.authenticated = true;
      log('authenticated');
      return;
    }
    await page.waitForTimeout(250);
  }

  throw new Error('Login did not complete; auth signal not detected');
}

async function firstExistingSelector(page, selectors) {
  for (const selector of selectors) {
    if ((await page.locator(selector).first().count().catch(() => 0)) > 0) {
      return selector;
    }
  }
  return null;
}

async function ensureLoggedIn(username, password, loginUrl = DEFAULT_LOGIN_URL) {
  await ensureContext();
  if (!pageIsUsable(warmPage)) {
    throw new Error('Warm browser page is unavailable');
  }

  if (await isAuthenticated(warmPage).catch(() => false)) {
    status.authenticated = true;
    status.contextAlive = true;
    status.pageUrl = warmPage.url();
    log('reusing authenticated BRS session');
    return warmPage;
  }

  status.authenticated = false;
  await performLogin(warmPage, loginUrl, username, password);
  return warmPage;
}

async function waitForTeeSheet(page, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await loginFormVisible(page)) {
      throw new Error('BRS tee sheet redirected to login');
    }

    const bookingLinks = await page
      .locator('a[href*="/bookings/book"]')
      .count()
      .catch(() => 0);
    if (bookingLinks > 0) return true;

    const rows = await page.locator('tr').count().catch(() => 0);
    if (rows > 0) return true;

    const timeLabels = await page
      .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
      .count()
      .catch(() => 0);
    if (timeLabels > 0) return true;

    const teeSheetShell = page.locator(
      '[data-tee-sheet], .tee-sheet, #tee-sheet, [aria-label*="tee sheet" i], section:has-text("tee sheet"), div:has-text("Booking")',
    );
    if (await teeSheetShell.first().isVisible().catch(() => false)) return true;

    await page.waitForTimeout(100);
  }
  throw new Error('Tee sheet not detected after preload wait');
}

async function preloadTeeSheet(targetDate, username, password) {
  await ensureContext();
  if (!pageIsUsable(warmPage)) {
    throw new Error('Warm browser page is unavailable');
  }

  const dateKey = targetDateKey(targetDate);
  const url = teeSheetUrl(dateKey);
  log(`loading tee sheet for ${dateKey}`);
  await warmPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // The pre-release tee sheet can legitimately contain no visible Book links and
  // no visible member-nav links. Treat only an actual login page/form as an auth
  // loss. The old visible-link heuristic caused PREP to fail before release.
  if (await loginFormVisible(warmPage)) {
    status.authenticated = false;
    log('tee sheet load reached an unauthenticated page; refreshing login once');
    await performLogin(warmPage, DEFAULT_LOGIN_URL, username, password);
    await warmPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (await loginFormVisible(warmPage)) {
      status.authenticated = false;
      throw new Error('BRS session lost authentication while loading tee sheet');
    }
  }

  await waitForTeeSheet(warmPage);
  if (!(await targetTeeSheetSessionIsUsable(warmPage, dateKey))) {
    status.authenticated = false;
    status.teeSheetLoaded = false;
    throw new Error('BRS target tee sheet was not retained after preload');
  }

  status.warm = true;
  status.authenticated = true;
  status.teeSheetLoaded = true;
  status.targetDate = dateKey;
  status.lastError = null;
  status.contextAlive = true;
  status.pageUrl = warmPage.url();
  log(`tee sheet loaded and ready for ${dateKey}`);
  return warmPage;
}

async function initWarmFlow(targetDate, username, password) {
  try {
    await ensureLoggedIn(username, password);
    await preloadTeeSheet(targetDate, username, password);
    status.lastError = null;
    return warmPage;
  } catch (error) {
    status.lastError = error?.message || String(error);
    status.authenticated = false;
    status.teeSheetLoaded = false;
    log(`warm flow failed: ${status.lastError}`);
    throw error;
  }
}

export async function getWarmPage(targetDate, username, password) {
  if (!targetDate) throw new Error('targetDate is required for warm session');
  if (!username || !password) throw new Error('BRS credentials are required for warm session');

  const dateKey = targetDateKey(targetDate);

  if (
    pageIsUsable(warmPage) &&
    status.authenticated &&
    status.teeSheetLoaded &&
    status.targetDate === dateKey
  ) {
    const stillOnPreparedSheet = await targetTeeSheetSessionIsUsable(warmPage, dateKey);
    if (stillOnPreparedSheet) {
      status.contextAlive = true;
      status.pageUrl = warmPage.url();
      return warmPage;
    }
  }

  if (inflightInit) {
    await inflightInit;
    if (
      pageIsUsable(warmPage) &&
      status.authenticated &&
      status.teeSheetLoaded &&
      status.targetDate === dateKey &&
      (await targetTeeSheetSessionIsUsable(warmPage, dateKey))
    ) {
      return warmPage;
    }
  }

  inflightInit = initWarmFlow(dateKey, username, password);
  try {
    return await inflightInit;
  } finally {
    inflightInit = null;
  }
}

export async function closeWarmSession() {
  stopKeepAlive();
  inflightInit = null;
  await disposeBrokenSession();
  lastKeepAliveAt = null;
  resetStatus();
}

export function getWarmStatus() {
  const contextAlive = sessionIsUsable();
  const pageUrl = pageIsUsable(warmPage) ? warmPage.url() : null;

  return {
    warm: status.warm && contextAlive,
    authenticated: status.authenticated && contextAlive,
    teeSheetLoaded: status.teeSheetLoaded && contextAlive,
    targetDate: status.targetDate,
    lastError: status.lastError,
    lastKeepAliveAt,
    contextAlive,
    pageUrl,
  };
}

async function keepaliveTick() {
  const contextAlive = sessionIsUsable();
  if (!contextAlive) {
    status.warm = false;
    status.authenticated = false;
    status.teeSheetLoaded = false;
    status.contextAlive = false;
    status.pageUrl = null;
    return;
  }

  lastKeepAliveAt = Date.now();
  status.lastKeepAliveAt = lastKeepAliveAt;

  try {
    await warmPage.evaluate(() => document.title);
    status.contextAlive = true;
    status.pageUrl = warmPage.url();

    const preparedTargetStillUsable =
      status.targetDate &&
      status.teeSheetLoaded &&
      (await targetTeeSheetSessionIsUsable(warmPage, status.targetDate));

    if (preparedTargetStillUsable) {
      // Do not downgrade a valid pre-release tee sheet merely because it has no
      // visible Book/member-nav elements yet.
      status.authenticated = true;
      status.teeSheetLoaded = true;
    } else {
      status.authenticated = await isAuthenticated(warmPage).catch(() => false);
      if (!status.authenticated) {
        status.teeSheetLoaded = false;
      }
    }

    status.lastError = null;
    status.warm = true;
  } catch (error) {
    status.lastError = error?.message || String(error);
    status.contextAlive = false;
    status.authenticated = false;
    status.teeSheetLoaded = false;
  }
}

export function startKeepAlive(options = {}) {
  const { intervalMs = 30000 } = options;
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    keepaliveTick().catch(() => {});
  }, intervalMs);
  keepAliveTimer.unref?.();
}

export function stopKeepAlive() {
  if (!keepAliveTimer) return;
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

export async function waitForBookingReleaseObserver(page, timeoutMs = 2000) {
  return page.evaluate((timeout) => {
    return new Promise((resolve) => {
      let done = false;
      let observer = null;
      const finish = (found) => {
        if (done) return;
        done = true;
        observer?.disconnect();
        resolve({ found, time: Date.now() });
      };

      if (document.querySelector('a[href*="/bookings/book"]')) {
        finish(true);
        return;
      }

      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches?.('a[href*="/bookings/book"]')) {
              finish(true);
              return;
            }
            if (node.querySelector?.('a[href*="/bookings/book"]')) {
              finish(true);
              return;
            }
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => finish(false), timeout);
    });
  }, timeoutMs);
}
