import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';

// Integration test for /api/fetch-tee-times-range using diagnostic mode.
// Assumptions: no valid credentials required for structural validation; endpoint may return empty times.
// We assert response shape and that 'days' array length matches requested days.

const AGENT_PORT = 3100;
let agentProc: ReturnType<typeof spawn> | null = null;

async function waitForHealth(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`http://localhost:${AGENT_PORT}/api/health`);
      if (resp.ok) return; // health ready
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Agent health endpoint not reachable within timeout');
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
      AGENT_DIAGNOSTIC: 'true',
      AGENT_HEADLESS: 'true',
      // Provide dummy credentials so endpoint does not 400
      BRS_USERNAME: process.env.BRS_USERNAME || 'dummy_user',
      BRS_PASSWORD: process.env.BRS_PASSWORD || 'dummy_pass',
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

test('range endpoint returns expected structure', async () => {
  const body = {
    startDate: new Date().toISOString(),
    days: 3,
    username: 'dummy_user',
    password: 'dummy_pass',
    reuseBrowser: true,
  };
  const resp = await fetch(
    `http://localhost:${AGENT_PORT}/api/fetch-tee-times-range`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  expect(resp.ok).toBeTruthy();
  const json: any = await resp.json();
  expect(json.success).toBe(true);
  expect(Array.isArray(json.days)).toBe(true);
  expect(json.days.length).toBe(3);
  for (const day of json.days) {
    expect(typeof day.date).toBe('string');
    expect(Array.isArray(day.times)).toBe(true);
    expect(Array.isArray(day.slots)).toBe(true);
    // Each time should look roughly like HH:MM
    for (const t of day.times) {
      expect(/^(\d{2}):(\d{2})$/.test(t)).toBeTruthy();
    }
  }
  expect(['single-session', 'multi-launch']).toContain(json.mode);
});
