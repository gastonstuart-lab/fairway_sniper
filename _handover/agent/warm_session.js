import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const agentDir = path.dirname(__filename);
const profileDir = path.join(agentDir, '.session', 'profile');

let warmContext = null;
let warmPage = null;
let inflightInit = null;
let lastTargetDate = null;
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
const TEE_SHEET_URL = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `https://members.brsgolf.com/galgorm/tee-sheet/1/${y}/${m}/${dd}`;
};

function log(msg) {
  // keep logs lightweight; upstream logger timestamps
  console.log(`[WARM] ${msg}`);
}

async function ensureProfileDir() {
  await fs.promises.mkdir(profileDir, { recursive: true }).catch(() => {});
}

async function ensureContext() {
  if (warmContext && !warmContext.isClosed?.()) return warmContext;

  await ensureProfileDir();
  log('session starting (persistent context)');
  warmContext = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  // Use first page; persistent context opens a blank page
  [warmPage] = warmContext.pages();
  if (!warmPage) {
    warmPage = await warmContext.newPage();
  }
  status.warm = true;
  status.authenticated = false;
  status.teeSheetLoaded = false;
  status.lastError = null;
  return warmContext;
}

async function isAuthenticated(page) {
  // Heuristic: presence of tee sheet nav or logout link
  const logout = await page
    .locator('a[href*="logout"], button:has-text("Logout")')
    .first()
    .isVisible()
    .catch(() => false);
  if (logout) return true;
  const tee = await page
    .locator(
      'a[href*="tee-sheet"], a:has-text("Tee Sheet"), button:has-text("Book")',
    )
    .first()
    .isVisible()
    .catch(() => false);
  return tee;
}

async function robustFill(page, locator, value, label) {
  const el = page.locator(locator).first();
  await el.waitFor({ state: 'visible', timeout: 15000 });
  await el.click({ timeout: 5000 }).catch(() => {});
  await el.fill(value, { timeout: 8000 });
  log(`filled ${label}`);
}

async function performLogin(page, loginUrl, username, password) {
  log('navigating to login page');
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Retry strategy over multiple selector variants
  const userSelectors = [
    'input[name="username"]',
    'input[type="text"][name*="username"]',
    'input[placeholder*="GUI"]',
    'input[placeholder*="username"]',
    'input[placeholder*="Email"]',
  ];
  const passSelectors = [
    'input[type="password"]',
    'input[placeholder*="password"]',
  ];

  let userSel = userSelectors[0];
  for (const sel of userSelectors) {
    if ((await page.locator(sel).first().count()) > 0) {
      userSel = sel;
      break;
    }
  }

  let passSel = passSelectors[0];
  for (const sel of passSelectors) {
    if ((await page.locator(sel).first().count()) > 0) {
      passSel = sel;
      break;
    }
  }

  await robustFill(page, userSel, username, 'username');
  await robustFill(page, passSel, password, 'password');

  const loginButton = page
    .getByRole('button', { name: /login|log in|sign in/i })
    .first();
  await loginButton.click({ timeout: 10000 }).catch(() => {});

  await page.waitForURL(/(?!.*\/login)/, { timeout: 20000 }).catch(() => {});

  // Final auth check
  const authed = await isAuthenticated(page);
  if (!authed) {
    throw new Error('Login did not complete; auth signal not detected');
  }
  log('authenticated');
  status.authenticated = true;
}

async function ensureLoggedIn(
  username,
  password,
  loginUrl = DEFAULT_LOGIN_URL,
) {
  await ensureContext();
  const page = warmPage;

  const authed = await isAuthenticated(page).catch(() => false);
  if (authed) {
    log('already authenticated');
    status.authenticated = true;
    return page;
  }

  await performLogin(page, loginUrl, username, password);
  return page;
}

async function waitForTeeSheet(page, timeout = 25000) {
  const timePattern = /\b(?:0?\d|1\d|2[0-3]):[0-5]\d\b/;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    // Any tee sheet row
    if (
      (await page
        .locator('tr')
        .count()
        .catch(() => 0)) > 0
    )
      return true;
    // Any visible time
    if (
      (await page
        .locator('text=/\\b(?:0?\\d|1\\d|2[0-3]):[0-5]\\d\\b/')
        .count()
        .catch(() => 0)) > 0
    )
      return true;
    // Any tee-sheet container
    const teeSheetShell = page.locator(
      '[data-tee-sheet], .tee-sheet, #tee-sheet, [aria-label*="tee sheet" i], section:has-text("tee sheet"), div:has-text("Booking")',
    );
    if (await teeSheetShell.isVisible().catch(() => false)) return true;
    await page.waitForTimeout(100);
  }
  throw new Error('Tee sheet not detected after preload wait');
}

// --- Release watcher using MutationObserver ---
export async function waitForBookingReleaseObserver(page, timeoutMs = 2000) {
  return await page.evaluate((timeout) => {
    return new Promise((resolve) => {
      let done = false;
      const finish = (el) => {
        if (!done) {
