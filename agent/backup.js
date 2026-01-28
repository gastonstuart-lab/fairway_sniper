import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Creates a backup of state.json with timestamp
 * @param {string} stateFilePath - Path to state.json
 * @returns {string|null} - Path to backup file or null if failed
 */
export function backupStateFile(stateFilePath) {
  try {
    if (!fs.existsSync(stateFilePath)) {
      return null;
    }

    const backupDir = path.join(__dirname, '../automation/backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date()
      .toISOString()
      .replace(/:/g, '-')
      .replace(/\..+/, '');
    const backupPath = path.join(backupDir, `state-${timestamp}.json`);

    fs.copyFileSync(stateFilePath, backupPath);

    // Keep only last 10 backups
    cleanOldBackups(backupDir, 10);

    return backupPath;
  } catch (error) {
    console.error('[backup] Failed to backup state.json:', error.message);
    return null;
  }
}

/**
 * Removes old backup files, keeping only the most recent N files
 * @param {string} backupDir - Directory containing backups
 * @param {number} keepCount - Number of recent backups to keep
 */
function cleanOldBackups(backupDir, keepCount = 10) {
  try {
    const files = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith('state-') && f.endsWith('.json'))
      .map((f) => ({
        name: f,
        path: path.join(backupDir, f),
        time: fs.statSync(path.join(backupDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time); // Sort newest first

    // Delete files beyond keepCount
    files.slice(keepCount).forEach((file) => {
      fs.unlinkSync(file.path);
    });
  } catch (error) {
    console.error('[backup] Failed to clean old backups:', error.message);
  }
}

/**
 * Schedules automatic backups at regular intervals
 * @param {string} stateFilePath - Path to state.json
 * @param {number} intervalHours - Hours between backups (default: 12)
 * @returns {NodeJS.Timeout} - Interval handle
 */
export function scheduleAutoBackup(stateFilePath, intervalHours = 12) {
  const intervalMs = intervalHours * 60 * 60 * 1000;

  // Run initial backup
  backupStateFile(stateFilePath);

  return setInterval(() => {
    const backupPath = backupStateFile(stateFilePath);
    if (backupPath) {
      console.log(
        `[backup] Automatic backup created: ${path.basename(backupPath)}`,
      );
    }
  }, intervalMs);
}

export default { backupStateFile, scheduleAutoBackup };
