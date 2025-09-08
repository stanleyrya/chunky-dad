const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy for Replit
app.set('trust proxy', true);

// Disable caching to ensure updates are visible
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Serve static files from the root directory
app.use(express.static('.', {
  maxAge: 0,
  etag: false,
  fallthrough: true
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});