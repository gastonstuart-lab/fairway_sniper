/**
 * Dynamic booking configuration for Fairway Sniper
 * Supports environment-driven date selection and safe modes
 */

import 'dotenv/config';

export interface BookingConfig {
  // Credentials
  username: string;
  password: string;

  // Date selection (mutually exclusive)
  dateMode: 'next-saturday' | 'days-ahead' | 'specific-date';
  daysAhead?: number; // if dateMode === 'days-ahead'
  specificDate?: string; // YYYY-MM-DD, if dateMode === 'specific-date'

  // Tee time preferences
  targetTimes: string[]; // e.g., ['07:56', '08:04']
  searchDays: number; // how many days to scan if target date has no availability

  // Booking behavior
  dryRun: boolean; // if true, never clicks final confirmation
  clickWaitlist: boolean; // if true, book waitlist slots too
  timezone: string; // e.g., 'Europe/London'

  // Course info
  courseId: string; // usually '1'
  clubUrl: string; // base URL, e.g., 'https://members.brsgolf.com/galgorm'
}

/**
 * Parse environment variables and return a BookingConfig
 */
export function parseConfig(): BookingConfig {
  const username =
    process.env.FS_USERNAME || process.env.FS_EMAIL || 'default_user';
  const password = process.env.FS_PASSWORD || 'default_pass';

  // Date mode logic
  let dateMode: 'next-saturday' | 'days-ahead' | 'specific-date' = 'next-saturday';
  let daysAhead: number | undefined;
  let specificDate: string | undefined;

  // Check for explicit date mode env var
  const dateModeEnv = (process.env.FS_DATE_MODE || '').toLowerCase();
  if (dateModeEnv === 'days-ahead') {
    dateMode = 'days-ahead';
    daysAhead = Number(process.env.FS_DAYS_AHEAD || 7);
  } else if (dateModeEnv === 'specific-date') {
    dateMode = 'specific-date';
    specificDate = process.env.FS_TARGET_DATE; // YYYY-MM-DD format
    if (!specificDate) {
      console.warn(
        '⚠️  FS_DATE_MODE=specific-date but FS_TARGET_DATE not set, falling back to next-saturday',
      );
      dateMode = 'next-saturday';
    }
  } else {
    dateMode = 'next-saturday'; // default
  }

  const targetTimes = (process.env.FS_TARGET_TIMES || '07:56,08:04')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const config: BookingConfig = {
    username,
    password,
    dateMode,
    daysAhead,
    specificDate,
    targetTimes,
    searchDays: Number(process.env.FS_SEARCH_DAYS || 14),
    dryRun: (process.env.FS_DRY_RUN ?? 'true').toLowerCase() === 'true',
    clickWaitlist:
      (process.env.FS_CLICK_WAITLIST ?? 'false').toLowerCase() === 'true',
    timezone: process.env.FS_TZ || 'Europe/London',
    courseId: process.env.FS_COURSE_ID || '1',
    clubUrl: process.env.FS_CLUB_URL || 'https://members.brsgolf.com/galgorm',
  };

  return config;
}

/**
 * Calculate the target booking date based on config
 */
export function calculateTargetDate(config: BookingConfig): Date {
  const now = new Date();

  switch (config.dateMode) {
    case 'next-saturday': {
      // Find next Saturday (or today if today is Saturday)
      const dayOfWeek = now.getDay();
      const daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
      const nextSaturday = new Date(now);
      nextSaturday.setDate(nextSaturday.getDate() + daysUntilSaturday);
      console.log(
        `📅 Date mode: next-saturday → ${nextSaturday.toISOString().split('T')[0]}`,
      );
      return nextSaturday;
    }

    case 'days-ahead': {
      const target = new Date(now);
      target.setDate(target.getDate() + (config.daysAhead || 7));
      console.log(
        `📅 Date mode: days-ahead (+${config.daysAhead} days) → ${target.toISOString().split('T')[0]}`,
      );
      return target;
    }

    case 'specific-date': {
      if (!config.specificDate) {
        throw new Error('specific-date mode requires FS_TARGET_DATE');
      }
      const target = new Date(config.specificDate);
      if (Number.isNaN(target.getTime())) {
        throw new Error(
          `Invalid date format: ${config.specificDate} (use YYYY-MM-DD)`,
        );
      }
      console.log(
        `📅 Date mode: specific-date → ${target.toISOString().split('T')[0]}`,
      );
      return target;
    }

    default:
      throw new Error(`Unknown date mode: ${config.dateMode}`);
  }
}

/**
 * Format a Date as YYYY-MM-DD
 */
export function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Format a Date as day of month (1, 2, ..., 31)
 */
export function formatDay(date: Date): string {
  return String(date.getDate());
}

/**
 * Log config summary (safe to display)
 */
export function logConfigSummary(config: BookingConfig): void {
  const targetDate = calculateTargetDate(config);
  console.log('🎯 Booking Configuration:');
  console.log(`  Username: ${config.username}`);
  console.log(`  Date Mode: ${config.dateMode}`);
  console.log(`  Target Date: ${formatDateISO(targetDate)}`);
  console.log(`  Target Times: ${config.targetTimes.join(', ')}`);
  console.log(`  Search Days: ${config.searchDays}`);
  console.log(`  Dry Run: ${config.dryRun}`);
  console.log(`  Click Waitlist: ${config.clickWaitlist}`);
  console.log(`  Timezone: ${config.timezone}`);
}
