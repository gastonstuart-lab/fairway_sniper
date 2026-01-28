#!/usr/bin/env node
/**
 * Minimal Test Server - Debug version
 * Tests if Express can stay running
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

console.log('🔍 Starting minimal test server...');
console.log('📂 CWD:', process.cwd());
console.log('🔧 Node:', process.version);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  console.log('✅ Health check received');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;

console.log(`🚀 Attempting to listen on port ${PORT}...`);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server ACTUALLY listening on http://0.0.0.0:${PORT}`);
  console.log(`   Test: http://localhost:${PORT}/api/health`);
  console.log('');
  console.log('💡 Server is running. Press Ctrl+C to stop.');
});

server.on('listening', () => {
  console.log('📡 Server listening event fired');
});

server.on('error', (err) => {
  console.error('❌ Server error:', err);
  process.exit(1);
});

server.on('close', () => {
  console.log('📪 Server closed');
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});

process.on('exit', (code) => {
  console.log(`🔚 Process exiting with code: ${code}`);
});

// Keep process alive
setInterval(() => {
  // Heartbeat
}, 60000);

console.log('📝 End of script reached, waiting for events...');
