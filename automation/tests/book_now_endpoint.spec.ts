import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { parse } from 'dotenv';

const AGENT_PORT = 3101;
let agentProc: ReturnType<typeof spawn> | null = null;

async function waitForHealth(timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`http://localhost:${AGENT_PORT}/api/health`);
      if (resp.ok) return;
    } catch {
      // ignore until server comes up
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Agent health endpoint not reachable within timeout');
}

function getRepoCredentials() {
  const envUsername = process.env.BRS_USERNAME || process.env.FS_USERNAME;
  const envPassword = process.env.BRS_PASSWORD || process.env.FS_PASSWORD;
  if (envUsername && envPassword) {
    return { username: envUsername, password: envPassword };
  }

  const agentEnvPath = path.resolve(process.cwd(), '..', 'agent', '.env');
  if (!fs.existsSync(agentEnvPath)) {
    return { username: '', password: '' };
  }

  const raw = fs.readFileSync(agentEnvPath, 'utf8');
  const parsed = parse(raw);
  return {
    username: parsed.BRS_USERNAME || parsed.FS_USERNAME || '',
    password: parsed.BRS_PASSWORD || parsed.FS_PASSWORD || '',
  };
}

test.beforeAll(async () => {
  const path = await import('path');
  const agentDir = path.resolve(process.cwd(), '..', 'agent');

  agentProc = spawn(process.execPath, ['index.js'], {
    cwd: agentDir,
    env: {
      ...process.env,
      PORT: String(AGENT_PORT),
      AGENT_RUN_MAIN: 'false',
      AGENT_HEADLESS: 'true',
      SAFE_MODE: 'true',
    },
    stdio: 'inherit',
  });

  await waitForHealth();
});

test.afterAll(async () => {
  if (agentProc) {
    agentProc.kill('SIGTERM');
    agentProc = null;
  }
});

test('book-now handles non-warm path without undefined page crash', async () => {
  const { username, password } = getRepoCredentials();

  test.skip(!username || !password, 'Requires BRS credentials in env');

  const targetDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const payload = {
    username,
    password,
    targetDate,
    preferredTimes: ['23:59'],
    players: [685],
  };

  const resp = await fetch(`http://localhost:${AGENT_PORT}/api/book-now`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  expect(resp.ok).toBeTruthy();
  const json: any = await resp.json();

  const combinedErrorText = `${json?.error || ''} ${json?.notes || ''}`;
  expect(combinedErrorText).not.toContain("Cannot read properties of undefined (reading 'waitForLoadState')");
  expect(combinedErrorText).not.toContain("Cannot read properties of undefined (reading 'getByRole')");
  expect(combinedErrorText).not.toContain("Cannot read properties of undefined (reading 'waitForFunction')");

  expect(Array.isArray(json.playersRequested)).toBeTruthy();
  expect(json.playersRequested).toContain(685);
  expect(typeof json.result).toBe('string');
});
