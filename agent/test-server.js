import express from 'express';

const app = express();
const PORT = 3000;

app.get('/test', (req, res) => {
  res.json({ status: 'ok', message: 'Test server is working' });
});

const server = app.listen(PORT, () => {
  console.log(`Test server listening on port ${PORT}`);
  console.log('Try: curl http://localhost:3000/test');
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

// Keep the process alive
setInterval(() => {
  console.log('Server still running...');
}, 10000);
