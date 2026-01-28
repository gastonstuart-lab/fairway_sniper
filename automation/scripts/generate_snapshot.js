#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// support running as ESM (package.json has "type":"module")
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const autoDir = path.resolve(__dirname, '..');
const outPath = path.join(autoDir, 'snapshot.json');

// Files to capture relative to automation/
const files = [
  'package.json',
  'tsconfig.json',
  'playwright.config.ts',
  'tests/login.spec.ts',
  'tests/book_slot.spec.ts',
  'tests/sniper.spec.ts',
  'types/date-fns-tz.d.ts',
];

// Load .env if present and scrub
const envFile = path.join(autoDir, '.env');
let env = {};
if (fs.existsSync(envFile)) {
  const parsed = dotenv.parse(fs.readFileSync(envFile, 'utf8'));
  const secretKeys = [
    'FS_PASSWORD',
    'API_KEY',
    'SECRET',
    'TOKEN',
    'GITHUB_TOKEN',
  ];
  for (const k of Object.keys(parsed)) {
    env[k] = secretKeys.includes(k.toUpperCase()) ? '<REDACTED>' : parsed[k];
  }
}

// Read files
const fileContents = {};
for (const f of files) {
  const p = path.join(autoDir, f);
  try {
    fileContents[f] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  } catch (e) {
    fileContents[f] = `__ERROR__ ${String(e)}`;
  }
}

// state.json presence
const statePath = path.join(autoDir, 'state.json');
const stateExists = fs.existsSync(statePath);

// Optionally run tests and capture output
const runTests = process.argv.includes('--run-tests');
let testReport = null;
if (runTests) {
  console.log('Running Playwright tests (fast mode) ...');
  const res = spawnSync('npx', ['playwright', 'test', '--reporter=json'], {
    cwd: autoDir,
    shell: true,
    env: { ...process.env, PW_FAST: '1' },
    encoding: 'utf8',
  });
  testReport = {
    status: res.status,
    stdout: res.stdout ? res.stdout.slice(0, 200000) : null,
    stderr: res.stderr ? res.stderr.slice(0, 200000) : null,
  };
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  automationPath: autoDir,
  env,
  stateJson: { exists: stateExists },
  files: fileContents,
  testReport,
};

fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
console.log('Wrote', outPath);
