import fs from 'fs';
import path from 'path';

const logDir = path.join(process.cwd(), 'logs');
const logFile = path.join(logDir, 'release-snipe.ndjson');
let warned = false;

export async function appendAudit(event) {
  try {
    await fs.promises.mkdir(logDir, { recursive: true });
    const line = JSON.stringify(event) + '\n';
    await fs.promises.appendFile(logFile, line, 'utf8');
  } catch (err) {
    if (!warned) {
      console.warn('audit append failed', err?.message || err);
      warned = true;
    }
  }
}
