#!/usr/bin/env node
/**
 * Warm-Up Validation Test Script
 * Creates a sniper job scheduled 4 minutes from now to test:
 * - Railway warm-up scheduler
 * - TEST_MODE validation (no actual booking)
 * - Cold-start mitigation timing
 */

import admin from 'firebase-admin';
import { DateTime } from 'luxon';

// Initialize Firebase Admin
const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT || 
  require('fs').readFileSync('./serviceAccountKey.json', 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function createWarmUpTestJob() {
  try {
    const now = DateTime.now().setZone('Europe/London');
    const fireTime = now.plus({ minutes: 4 });
    const targetPlayDate = fireTime.plus({ days: 4 }).toISODate(); // Book 4 days ahead
    
    console.log('🧪 Creating Warm-Up Validation Test Job');
    console.log('========================================');
    console.log(`Current time: ${now.toISO()}`);
    console.log(`Fire time:    ${fireTime.toISO()} (T+4min)`);
    console.log(`Play date:    ${targetPlayDate}`);
    console.log(`Mode:         TEST_MODE enabled (no booking click)`);
    console.log('');
    
    const jobData = {
      // Basic job info
      mode: 'sniper',
      status: 'active',
      owner_uid: 'test-validation',
      
      // Credentials (use your test account)
      brs_email: process.env.BRS_USERNAME || '',
      brs_password: process.env.BRS_PASSWORD || '',
      
      // Target timing
      next_fire_time_utc: admin.firestore.Timestamp.fromDate(fireTime.toJSDate()),
      target_play_date: admin.firestore.Timestamp.fromDate(new Date(targetPlayDate)),
      
      // Preferred times (use common morning slots)
      preferred_times: ['10:10', '10:20', '10:30'],
      
      // Party size
      party_size: 2,
      players: [],
      
      // Window config (small window for fast test)
      window_minutes: 3,
      fallback_step_minutes: 5,
      
      // Metadata
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      test_run: true,
      warm_up_test: true,
      
      // Push notification token (optional)
      push_token: process.env.FCM_TOKEN || null,
    };
    
    if (!jobData.brs_email || !jobData.brs_password) {
      console.error('❌ Error: BRS_USERNAME and BRS_PASSWORD environment variables required');
      console.log('\nUsage:');
      console.log('  $env:BRS_USERNAME="your-username"; $env:BRS_PASSWORD="your-password"; node test-warm-up-validation.js');
      process.exit(1);
    }
    
    const docRef = await db.collection('jobs').add(jobData);
    console.log(`✅ Job created: ${docRef.id}`);
    console.log('');
    console.log('Expected Behavior:');
    console.log('==================');
    console.log('T+0min   - Job created (now)');
    console.log('T+1min   - Warm-up scheduler detects job (within 5min window)');
    console.log('T+1min   - Warm-up triggered (within 3min threshold)');
    console.log('           • Self-ping /api/warm');
    console.log('           • Browser preload tee sheet');
    console.log('           • warmed_at timestamp written');
    console.log('T+4min   - Sniper fires');
    console.log('           • Release watcher activates');
    console.log('           • Booking link detected');
    console.log('           • TEST_MODE: Click SUPPRESSED');
    console.log('           • Click delta logged (no actual booking)');
    console.log('');
    console.log('Watch Railway logs for:');
    console.log('  [WARM-UP] 🔥 Job detected');
    console.log('  [WARM-UP] 📡 Warm ping start');
    console.log('  [WARM-UP] ✅ Warm ping success');
    console.log('  [WARM-UP] 🌐 Browser preload start');
    console.log('  [WARM-UP] ✅ Browser preload complete');
    console.log('  [FIRE] 🎯 Target reached');
    console.log('  [TEST_MODE] ⚠️ Booking click SUPPRESSED');
    console.log('  [TEST_MODE] 📊 Click delta (simulated)');
    console.log('');
    console.log(`🔗 Railway Logs: https://railway.app/project/<your-project>/deployments`);
    console.log(`🔗 Firestore: https://console.firebase.google.com/project/<your-project>/firestore/data/jobs/${docRef.id}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating test job:', error);
    process.exit(1);
  }
}

createWarmUpTestJob();
