import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'agent', 'warm_session.js'), 'utf8');

function asyncFunctionBody(name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} not found`);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('pre-release tee-sheet preload does not use visible booking links as the auth gate', () => {
  const body = asyncFunctionBody('preloadTeeSheet');
  assert(body.includes('loginFormVisible(warmPage)'));
  assert(body.includes('targetTeeSheetSessionIsUsable(warmPage, dateKey)'));
  assert.equal(body.includes('if (!(await isAuthenticated(warmPage)'), false);
});

test('pre-release prepared tee sheet remains authenticated during keepalive', () => {
  const body = asyncFunctionBody('keepaliveTick');
  assert(body.includes('targetTeeSheetSessionIsUsable(warmPage, status.targetDate)'));
  assert(body.includes('status.authenticated = true'));
  assert(body.includes('status.teeSheetLoaded = true'));
});

test('pre-fire reuse verifies the exact prepared target tee-sheet page', () => {
  const body = asyncFunctionBody('getWarmPage');
  assert(body.includes('targetTeeSheetSessionIsUsable(warmPage, dateKey)'));
  assert(body.includes('status.targetDate === dateKey'));
});

test('actual login redirect still forces re-authentication', () => {
  const body = asyncFunctionBody('preloadTeeSheet');
  assert(body.includes("await performLogin(warmPage, DEFAULT_LOGIN_URL, username, password)"));
  assert(body.includes("throw new Error('BRS session lost authentication while loading tee sheet')"));
});
