import fs from 'fs';
import path from 'path';

export async function appendNdjson(filePath, obj) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
  const line = JSON.stringify(obj) + '\n';
  await fs.promises.appendFile(filePath, line, 'utf8');
}
