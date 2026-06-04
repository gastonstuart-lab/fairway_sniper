import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

test('release DOM watcher is detection-only before server-side slot policy gate', () => {
  const watcherCall = indexSource.match(
    /releaseResult\s*=\s*await\s+waitForBookingRelease\([\s\S]*?\n\s*\);/,
  )?.[0];

  assert.ok(watcherCall, 'waitForBookingRelease call should exist');
  assert.match(
    watcherCall,
    /watchMs,\s*\n\s*true,\s*\n\s*\{/,
    'DOM watcher must pass skipClick=true so page context cannot click before policy approval',
  );
});

test('DOM watcher candidate is evaluated before any booking navigation or confirmation', () => {
  const domBranch = indexSource.slice(
    indexSource.indexOf('if (!bookingSuccess && releaseResult && releaseResult.found)'),
    indexSource.indexOf("} else if (!bookingSuccess) {\n        console.log('[SNIPER] Release watcher timeout"),
  );

  assert.ok(domBranch.length > 0, 'DOM watcher branch should be found');
  const evaluateIndex = domBranch.indexOf('const releaseEvaluation = evaluateSlotCandidate');
  const rejectIndex = domBranch.indexOf('if (!releaseEvaluation.accepted)');
  const bookingIndex = domBranch.indexOf('const clickResult = await tryDirectBookingHref');
  const oldExecuteIndex = domBranch.indexOf('executeReleaseBooking');

  assert.ok(evaluateIndex >= 0, 'DOM watcher branch must evaluate slot policy');
  assert.ok(rejectIndex > evaluateIndex, 'DOM watcher branch must reject failed policy candidates');
  assert.ok(bookingIndex > rejectIndex, 'booking navigation must happen after policy rejection gate');
  assert.equal(oldExecuteIndex, -1, 'DOM watcher branch must not use pre-click execution path');
});
