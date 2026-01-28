#!/usr/bin/env node
/**
 * Fairway Sniper Agent - HTTP API Wrapper
 *
 * Simple HTTP server that wraps Playwright automation tests
 * Uses proven working state.json for authenticated session
 * NO Firebase, NO complex initialization - just HTTP endpoints
 */

import express from 'express';
import cors from 'cors';
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Load authenticated session from state.json
const STATE_FILE = path.join(__dirname, '../automation/state.json');

function getStorageState() {
  if (!fs.existsSync(STATE_FILE)) {
    console.warn('⚠️ state.json not found - authentication will be required');
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {
    console.error('Error loading state.json:', e.message);
    return null;
  }
}

/**
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  const stateExists = fs.existsSync(STATE_FILE);
  res.json({
    status: 'ok',
    service: 'fairway-sniper-agent',
    authenticated: stateExists,
    state_file: stateExists ? 'loaded' : 'missing',
  });
});

/**
 * Fetch available tee times for a specific date
 */
app.post('/api/fetch-tee-times', async (req, res) => {
  let browser;
  try {
    const { date, club = 'galgorm' } = req.body;

    if (!date) {
      return res
        .status(400)
        .json({ error: 'Date parameter required (YYYY-MM-DD)' });
    }

    console.log(`[fetch-tee-times] Fetching times for ${date} at ${club}`);

    const storageState = getStorageState();
    if (!storageState) {
      return res
        .status(401)
        .json({ error: 'Not authenticated - no state.json found' });
    }

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({
      storageState,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });

    const page = await context.newPage();

    // Navigate to tee sheet for the date
    const [y, m, d] = date.split('-');
    const teeUrl = `https://members.brsgolf.com/${club}/tee-sheet/1/${y}/${m}/${d}`;
    console.log(`Navigating to: ${teeUrl}`);

    await page.goto(teeUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Find tee time slots - look for time pattern HH:MM
    const timeElements = await page
      .locator('text=/\\b\\d{1,2}:\\d{2}\\b/')
      .all();
    const times = [];

    for (const el of timeElements) {
      const text = await el.textContent();
      const match = text.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        const time = `${String(match[1]).padStart(2, '0')}:${match[2]}`;
        if (!times.includes(time)) {
          times.push(time);
        }
      }
    }

    // Sort times
    times.sort((a, b) => {
      const [ah, am] = a.split(':').map(Number);
      const [bh, bm] = b.split(':').map(Number);
      return ah * 60 + am - (bh * 60 + bm);
    });

    await context.close();
    await browser.close();

    console.log(`✅ Found ${times.length} available tee times`);
    res.json({ success: true, date, times, count: times.length });
  } catch (error) {
    console.error('[fetch-tee-times] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

/**
 * Fetch tee times for multiple days (range)
 */
app.post('/api/fetch-tee-times-range', async (req, res) => {
  let browser;
  try {
    const {
      startDate,
      days = 5,
      club = 'galgorm',
      reuseBrowser = true,
    } = req.body;

    console.log(
      `[fetch-tee-times-range] Fetching ${days} days starting from ${startDate}`,
    );

    const storageState = getStorageState();
    if (!storageState) {
      return res
        .status(401)
        .json({ error: 'Not authenticated - no state.json found' });
    }

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({
      storageState,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });

    const page = await context.newPage();

    // Calculate dates
    const start = new Date(startDate || Date.now());
    const daysData = [];

    for (let i = 0; i < days; i++) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);

      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;

      const teeUrl = `https://members.brsgolf.com/${club}/tee-sheet/1/${y}/${m}/${d}`;
      console.log(`  Day ${i + 1}: ${dateStr} - ${teeUrl}`);

      try {
        await page.goto(teeUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await page.waitForTimeout(2000);

        // Find tee time slots
        const timeElements = await page
          .locator('text=/\\b\\d{1,2}:\\d{2}\\b/')
          .all();
        const times = [];

        for (const el of timeElements) {
          const text = await el.textContent();
          const match = text.match(/(\d{1,2}):(\d{2})/);
          if (match) {
            const time = `${String(match[1]).padStart(2, '0')}:${match[2]}`;
            if (!times.includes(time)) {
              times.push(time);
            }
          }
        }

        // Sort times
        times.sort((a, b) => {
          const [ah, am] = a.split(':').map(Number);
          const [bh, bm] = b.split(':').map(Number);
          return ah * 60 + am - (bh * 60 + bm);
        });

        daysData.push({
          date: dateStr,
          times,
          count: times.length,
        });

        console.log(`    ✅ Found ${times.length} times`);
      } catch (dayError) {
        console.error(`    ❌ Error fetching ${dateStr}:`, dayError.message);
        daysData.push({
          date: dateStr,
          times: [],
          count: 0,
          error: dayError.message,
        });
      }
    }

    await context.close();
    await browser.close();

    console.log(`✅ Completed range fetch: ${daysData.length} days`);
    res.json({
      success: true,
      days: daysData,
      totalDays: daysData.length,
      totalSlots: daysData.reduce((sum, day) => sum + day.count, 0),
    });
  } catch (error) {
    console.error('[fetch-tee-times-range] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

/**
 * Fetch player directory
 */
app.post('/api/fetch-players', async (req, res) => {
  try {
    const { club = 'galgorm' } = req.body;

    console.log(`[fetch-players] Fetching player directory for ${club}`);

    // Load cached players from automation/players.json
    const playersFile = path.join(__dirname, '../automation/players.json');
    if (!fs.existsSync(playersFile)) {
      return res.status(404).json({
        error: 'Players cache not found. Run scraper first.',
        file: playersFile,
      });
    }

    const playerData = JSON.parse(fs.readFileSync(playersFile, 'utf8'));
    const { players, count, scrapedAt } = playerData;

    if (!players || players.length === 0) {
      return res.status(400).json({ error: 'No players in cache' });
    }

    // Filter out entries that aren't actual player names
    const cleanPlayers = players.filter(
      (p) =>
        p &&
        typeof p === 'string' &&
        !p.startsWith('18') &&
        !p.includes('£') &&
        p.length > 2 &&
        p.includes(','), // Names have "Last, First" format
    );

    console.log(
      `✅ Loaded ${cleanPlayers.length} players from cache (scraped: ${scrapedAt})`,
    );

    res.json({
      success: true,
      players: cleanPlayers,
      count: cleanPlayers.length,
      source: 'cached',
      scrapedAt,
    });
  } catch (error) {
    console.error('[fetch-players] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Book a tee time
 *
 * For MVP: Returns success if we can reach the tee sheet and find the time
 * Full booking modal interaction would be added in phase 2
 */
app.post('/api/book-tee-time', async (req, res) => {
  let browser;
  try {
    const { date, time, players, club = 'galgorm' } = req.body;

    if (!date || !time || !players || players.length === 0) {
      return res.status(400).json({
        error: 'Required fields: date, time, players (array)',
      });
    }

    console.log(
      `[book-tee-time] Booking ${time} on ${date} for player: ${players[0]}`,
    );

    const storageState = getStorageState();
    if (!storageState) {
      return res
        .status(401)
        .json({ error: 'Not authenticated - no state.json found' });
    }

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const context = await browser.newContext({
      storageState,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });

    const page = await context.newPage();

    // Navigate to tee sheet for the date
    const [y, m, d] = date.split('-');
    const teeUrl = `https://members.brsgolf.com/${club}/tee-sheet/1/${y}/${m}/${d}`;

    console.log(`  Navigating to: ${teeUrl}`);
    await page.goto(teeUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Verify the time slot exists
    const timeRegex = new RegExp(`\\b${time.replace(':', '\\:')}\\b`);
    const timeCell = page.locator(`text=${timeRegex}`).first();

    const timeFound = await timeCell
      .isVisible({ timeout: 5000 })
      .catch(() => false);
    if (!timeFound) {
      throw new Error(`Time slot ${time} not available or not found`);
    }

    // For MVP, just verify we can see the time and reach the booking page
    // Full booking automation would click the row, fill player select, click confirm
    // This is sufficient to validate the API works end-to-end

    console.log(`✅ Time ${time} is available for booking`);

    await context.close();
    await browser.close();

    // Return success - Flutter app can show "Ready to Book" message
    res.json({
      success: true,
      message: `Time ${time} is available - booking logic ready to implement`,
      date,
      time,
      player: players[0],
      status: 'ready_to_book',
      note: 'Full booking modal interaction implemented in phase 2',
    });
  } catch (error) {
    console.error('[book-tee-time] Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('🚀 Fairway Sniper Agent Started');
  console.log(`   Port: ${PORT}`);
  console.log(`   State file: ${STATE_FILE}`);
  console.log(`   State loaded: ${fs.existsSync(STATE_FILE) ? '✅' : '❌'}`);
  console.log('');
  console.log('📍 Available Endpoints:');
  console.log(`   GET  /api/health`);
  console.log(`   POST /api/fetch-tee-times`);
  console.log(`   POST /api/fetch-players`);
  console.log(`   POST /api/book-tee-time`);
  console.log('');
});

server.on('error', (err) => {
  console.error('❌ Server error:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
  }
  process.exit(1);
});

// Log errors but DON'T exit immediately
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err.message);
  console.error(err.stack);
  // Don't exit - let the server continue running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection:', reason);
  // Don't exit - let the server continue running
});

// Keep process alive - ref() ensures it keeps the event loop open
const keepAlive = setInterval(() => {
  // Server heartbeat
}, 60000);
keepAlive.ref();
