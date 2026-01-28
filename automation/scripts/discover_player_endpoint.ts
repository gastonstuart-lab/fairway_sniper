/*
  discover_player_endpoint.ts

  Purpose:
  Launch a Playwright session, login (using state.json if present or env credentials),
  navigate to today's tee sheet, click the first Book button, and capture all network
  requests & responses to identify the player list source. Any response that looks like
  a player directory (array of names/objects) is saved to automation/players.json
  with structure { scrapedAt, source, players: [ { id, name } ] }.

  Run:
    npx ts-node automation/scripts/discover_player_endpoint.ts
  Or (if ts-node not installed):
    npx playwright test --config=playwright.config.ts automation/scripts/discover_player_endpoint.ts

  Environment (optional):
    BRS_USERNAME, BRS_PASSWORD for login if storage state not available.

  Output:
    automation/players.json (only written if players discovered)
    automation/player-network-log.json (full request metadata)
*/

import { chromium, Browser, Page, APIResponse } from 'playwright';
import fs from 'fs';
import path from 'path';

interface CapturedRequest {
  url: string;
  method: string;
  status?: number;
  contentType?: string;
  bodySnippet?: string;
  responseSnippet?: string;
}

function looksLikePlayerArray(obj: any): string[] | null {
  if (!obj) return null;
  // Case 1: Array of strings (names)
  if (
    Array.isArray(obj) &&
    obj.length &&
    obj.every((v) => typeof v === 'string' && v.length < 120)
  ) {
    return obj as string[];
  }
  // Case 2: Array of objects containing name fields
  if (
    Array.isArray(obj) &&
    obj.length &&
    obj.every((v) => typeof v === 'object')
  ) {
    const names: string[] = [];
    for (const item of obj) {
      const nameField =
        item.name || item.fullName || item.display || item.player || null;
      if (nameField && typeof nameField === 'string') {
        names.push(nameField.trim());
      }
    }
    if (names.length > 0) return names;
  }
  return null;
}

async function main() {
  const outDir = path.join(process.cwd(), 'automation');
  const playersOut = path.join(outDir, 'players.json');
  const netLogOut = path.join(outDir, 'player-network-log.json');

  const username = process.env.BRS_USERNAME || '';
  const password = process.env.BRS_PASSWORD || '';
  const club = 'galgorm';

  let browser: Browser | null = null;
  let page: Page | null = null;
  const requests: CapturedRequest[] = [];
  const foundCandidateSets: { url: string; names: string[] }[] = [];

  try {
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
    });

    // Try loading existing state.json from automation
    const statePath = path.join(outDir, 'state.json');
    if (fs.existsSync(statePath)) {
      try {
        const storageState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        await context.addCookies(storageState.cookies || []);
        console.log('[discover] Reused cookies from state.json');
      } catch (e) {
        console.log('[discover] Failed to reuse state.json cookies:', e);
      }
    }

    page = await context.newPage();

    // Capture all requests + responses
    context.on('request', async (req) => {
      requests.push({
        url: req.url(),
        method: req.method(),
        bodySnippet: req.postData()?.substring(0, 200) || undefined,
      });
    });

    context.on('response', async (res) => {
      try {
        const ct = res.headers()['content-type'] || '';
        const status = res.status();
        const url = res.url();
        let responseSnippet: string | undefined;
        if (/json/i.test(ct)) {
          const bodyText = await res.text();
          responseSnippet = bodyText.substring(0, 300);
          try {
            const parsed = JSON.parse(bodyText);
            const playerNames = looksLikePlayerArray(parsed);
            if (playerNames && playerNames.length) {
              foundCandidateSets.push({ url, names: playerNames });
              console.log(
                `[discover] Candidate player list from ${url} -> ${playerNames.length} names`,
              );
            }
          } catch (_) {}
        }
        const reqEntry = requests.find((r) => r.url === url);
        if (reqEntry) {
          reqEntry.status = status;
          reqEntry.contentType = ct;
          reqEntry.responseSnippet = responseSnippet;
        } else {
          requests.push({
            url,
            method: 'UNKNOWN',
            status,
            contentType: ct,
            responseSnippet,
          });
        }
      } catch (e) {
        console.log('[discover] Response handling error:', e);
      }
    });

    // Navigate/login if needed
    const loginUrl = `https://members.brsgolf.com/${club}/login`;
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    // If logged out and we have creds, perform login
    if (username && password && /login/i.test(page.url())) {
      const userInput = page
        .locator(
          'input[name="username"], input[placeholder*="GUI"], input[placeholder*="username"], input[placeholder*="ILGU"]',
        )
        .first();
      if (await userInput.isVisible().catch(() => false)) {
        await userInput.fill(username);
        const passInput = page
          .locator('input[type="password"], input[placeholder*="password"]')
          .first();
        if (await passInput.isVisible().catch(() => false)) {
          await passInput.fill(password);
        }
        const submit = page
          .locator(
            'button:has-text("Login"), button:has-text("Sign in"), button[type="submit"]',
          )
          .first();
        if (await submit.isVisible().catch(() => false)) {
          await Promise.all([
            page
              .waitForNavigation({
                waitUntil: 'domcontentloaded',
                timeout: 15000,
              })
              .catch(() => {}),
            submit.click(),
          ]);
        }
        await page.waitForTimeout(1500);
        console.log('[discover] Login flow attempted');
      }
    }

    // Navigate to today's tee sheet
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const teeUrl = `https://members.brsgolf.com/${club}/tee-sheet/1/${y}/${m}/${d}`;
    await page.goto(teeUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Click first Book button
    const bookBtn = page
      .locator(':is(button,a,[role="button"]):has-text(/\\bBook\\b/i)')
      .first();
    if (!(await bookBtn.isVisible().catch(() => false))) {
      console.log('[discover] No Book button found');
    } else {
      await Promise.all([
        page.waitForTimeout(1000), // allow any navigation or dynamic loads
        bookBtn.click().catch(() => {}),
      ]);
      console.log('[discover] Clicked Book button, waiting for network churn');
      await page.waitForTimeout(4000); // Wait for requests to settle
    }

    // Persist network log
    fs.writeFileSync(
      netLogOut,
      JSON.stringify(
        { capturedAt: new Date().toISOString(), requests },
        null,
        2,
      ),
    );
    console.log(`[discover] Network log written: ${netLogOut}`);

    // Choose best candidate set (prefer longest list)
    let finalNames: string[] = [];
    if (foundCandidateSets.length) {
      foundCandidateSets.sort((a, b) => b.names.length - a.names.length);
      finalNames = foundCandidateSets[0].names;
    }

    if (finalNames.length) {
      // Assign synthetic IDs (can refine once real ID field known)
      const players = finalNames.map((name) => ({ id: name, name }));
      const payload = {
        scrapedAt: new Date().toISOString(),
        source: 'network-discovery',
        endpoint: foundCandidateSets[0].url,
        count: players.length,
        players,
      };
      fs.writeFileSync(playersOut, JSON.stringify(payload, null, 2));
      console.log(
        `[discover] Player list written (${players.length}) to ${playersOut}`,
      );
    } else {
      console.log('[discover] No player arrays detected in network traffic');
    }

    await browser.close();
  } catch (e) {
    console.error('[discover] Fatal error:', e);
    if (browser) await browser.close().catch(() => {});
    process.exit(1);
  }
}

main();
