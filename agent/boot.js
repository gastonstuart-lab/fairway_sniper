// agent/boot.js
// ESM bootloader for Fairway Sniper Agent

console.log("FAIRWAY SNIPER BOOT: starting...");
const t0 = Date.now();

async function timedImport(name, path) {
  const start = Date.now();
  try {
    const mod = await import(path);
    const dt = Date.now() - start;
    console.log(`✔️  Imported ${name} in ${dt}ms`);
    return mod;
  } catch (e) {
    const dt = Date.now() - start;
    console.error(`❌ Failed to import ${name} after ${dt}ms:`, e);
    throw e;
  }
}

(async () => {
  try {
    await timedImport('firebase-admin', 'firebase-admin');
    await timedImport('@playwright/test', '@playwright/test');
    await timedImport('express', 'express');
    await timedImport('cors', 'cors');
    await timedImport('luxon', 'luxon');
    await timedImport('node-fetch', 'node-fetch');
    const total = Date.now() - t0;
    console.log(`All heavy modules imported in ${total}ms`);
    globalThis.__BOOT_OK__ = true;
    await import('./index.js');
  } catch (e) {
    console.error('BOOT FAILED:', e);
    process.exit(1);
  }
})();
