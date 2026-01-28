#!/usr/bin/env node

/**
 * TEST SCRIPT: Normal Mode Immediate Booking
 *
 * This script tests the /api/book-now endpoint with player selection
 *
 * Usage: node test-book-now.js [username] [password] [targetDate]
 *
 * Example:
 *   node test-book-now.js 12390624 cantona7777 2025-12-10
 */

import fetch from 'node-fetch';

const args = process.argv.slice(2);
const username = args[0] || '12390624';
const password = args[1] || 'cantona7777';
const targetDate = args[2] || '2025-12-10';

const BASE_URL = 'http://localhost:3000';

async function testBooking() {
  console.log('\n🧪 TESTING: Normal Mode Immediate Booking\n');
  console.log(`📋 Test Parameters:`);
  console.log(`   Username: ${username}`);
  console.log(`   Target Date: ${targetDate}`);
  console.log(`   API URL: ${BASE_URL}/api/book-now\n`);

  const payload = {
    username,
    password,
    targetDate,
    preferredTimes: ['08:30', '09:00', '09:30'],
    players: [685], // Sharpe, Mal
    pushToken: null,
  };

  console.log('📤 Request Payload:');
  console.log(JSON.stringify(payload, null, 2));
  console.log();

  try {
    console.log('🚀 Sending request...\n');
    const response = await fetch(`${BASE_URL}/api/book-now`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await response.json();

    console.log('📥 Response:');
    console.log(JSON.stringify(responseBody, null, 2));
    console.log();

    if (response.ok) {
      if (responseBody.success) {
        console.log('✅ Booking successful!');
        console.log(`   Result: ${responseBody.result}`);
        console.log(`   Timestamp: ${responseBody.timestamp}`);
      } else {
        console.log('⚠️ Booking failed or error occurred');
        console.log(`   Error: ${responseBody.error}`);
      }
    } else {
      console.log(`❌ HTTP Error: ${response.status}`);
      console.log(`   Message: ${responseBody.error}`);
    }
  } catch (error) {
    console.error('❌ Request Error:', error.message);
    console.log('\n⚠️ Make sure the agent server is running:');
    console.log('   $env:PORT="3000"; node agent/index.js');
  }

  console.log();
}

async function testWithMultiplePlayers() {
  console.log('🧪 TESTING: Multiple Players\n');

  const payload = {
    username,
    password,
    targetDate,
    preferredTimes: ['08:30', '09:00'],
    players: [685, 16660, 15221], // Sharpe + 2 others
  };

  console.log('📤 Request with 3 players:');
  console.log(JSON.stringify(payload, null, 2));
  console.log();

  try {
    console.log('🚀 Sending request...\n');
    const response = await fetch(`${BASE_URL}/api/book-now`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await response.json();

    console.log('📥 Response:');
    console.log(JSON.stringify(responseBody, null, 2));
    console.log();

    if (response.ok && responseBody.success) {
      console.log('✅ Multi-player booking successful!');
    } else {
      console.log('⚠️ Booking did not succeed');
    }
  } catch (error) {
    console.error('❌ Request Error:', error.message);
  }

  console.log();
}

async function main() {
  await testBooking();

  console.log('─'.repeat(60));
  console.log();

  // Optionally test with multiple players
  // await testWithMultiplePlayers();
}

main();
