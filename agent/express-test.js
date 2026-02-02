import express from 'express';
const app = express();
const PORT = 5000;
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'express-test' });
});
app.listen(PORT, () => {
  console.log(`Express test server listening on http://localhost:${PORT}`);
});
