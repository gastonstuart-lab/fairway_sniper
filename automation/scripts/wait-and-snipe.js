#!/usr/bin/env node
/**
 * Release-Time Sniper Scheduler
 * Waits until scheduled release time, then triggers auto-booking
 * 
 * Usage: npm run release
 * 
 * Environment Variables:
 * - FS_RELEASE_TIME: Time to trigger (HH:MM format, e.g., "19:20" for 7:20 PM)
 * - FS_RELEASE_DAY: Day of week (Monday-Sunday, default: Tuesday for golf slots)
 * - FS_TARGET_DATE: Date to book (YYYY-MM-DD)
 */

import 'dotenv/config';
import { execSync } from 'child_process';

const RELEASE_TIME = process.env.FS_RELEASE_TIME || '19:20'; // Default: 7:20 PM
const RELEASE_DAY = process.env.FS_RELEASE_DAY || 'Tuesday'; // Default: Tuesday
const TARGET_DATE = process.env.FS_TARGET_DATE;

console.log('\n🚀 FAIRWAY SNIPER — RELEASE-TIME SCHEDULER\n');
console.log(`📅 Release Day: ${RELEASE_DAY}`);
console.log(`⏰ Release Time: ${RELEASE_TIME}`);
console.log(`📍 Target Date: ${TARGET_DATE || 'Next available'}`);

// Validate release time format
const timeMatch = RELEASE_TIME.match(/^(\d{1,2}):(\d{2})$/);
if (!timeMatch) {
  console.error('\n❌ Invalid FS_RELEASE_TIME format. Use HH:MM (e.g., 19:20)');
  process.exit(1);
}

const [_, hourStr, minStr] = timeMatch;
const hour = parseInt(hourStr, 10);
const min = parseInt(minStr, 10);

if (hour < 0 || hour > 23 || min < 0 || min > 59) {
  console.error('\n❌ Invalid time values. Hours: 0-23, Minutes: 0-59');
  process.exit(1);
}

// Map day names to day of week numbers (0 = Sunday, 1 = Monday, etc.)
const dayMap = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

const targetDayNum = dayMap[RELEASE_DAY];
if (targetDayNum === undefined) {
  console.error(`\n❌ Invalid day: ${RELEASE_DAY}`);
  console.error('Valid days: Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday');
  process.exit(1);
}

// Calculate next release datetime
function getNextReleaseTime() {
  const now = new Date();
  const nextRelease = new Date(now);

  // Find next occurrence of target day
  while (nextRelease.getDay() !== targetDayNum) {
    nextRelease.setDate(nextRelease.getDate() + 1);
  }

  // Set to release time
  nextRelease.setHours(hour, min, 0, 0);

  // If this time has passed today (on the right day), move to next week
  if (nextRelease <= now) {
    nextRelease.setDate(nextRelease.getDate() + 7);
  }

  return nextRelease;
}

const releaseTime = getNextReleaseTime();
const msUntilRelease = releaseTime.getTime() - Date.now();
const minUntilRelease = Math.ceil(msUntilRelease / 60000);

console.log(`\n⏳ Next release: ${releaseTime.toLocaleString()}`);
console.log(`⏱️  Waiting: ${minUntilRelease} minutes\n`);

// Wait and trigger snipe
setTimeout(() => {
  console.log('\n🎯 RELEASE TIME REACHED - TRIGGERING SNIPER\n');
  
  try {
    // Set environment for snipe mode
    process.env.FS_MODE = 'snipe';
    process.env.FS_DRY_RUN = 'false'; // Live booking
    
    // Execute sniper
    execSync('npm run snipe', { stdio: 'inherit' });
  } catch (error) {
    console.error('\n❌ Sniper execution failed:', error);
    process.exit(1);
  }
}, msUntilRelease);

// Graceful shutdown handler
process.on('SIGINT', () => {
  console.log('\n\n⏹️  Scheduler cancelled by user');
  process.exit(0);
});
