require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Security headers — helmet sets sensible defaults (X-Content-Type-Options,
// X-Frame-Options, Strict-Transport-Security, etc.)
// Relaxed CSP for the SPA frontend to work with inline styles (Tailwind)
app.use(helmet({
  contentSecurityPolicy: false, // SPA handles its own CSP needs
}));

app.use(cors());
app.use(express.json());

// Rate limiting — protects FMP API budget and prevents abuse
// General API: 100 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
});
// Search endpoint: tighter limit since it hits FMP directly per keystroke
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many search requests. Please slow down.' },
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/search',     searchLimiter, require('./routes/search'));
app.use('/api/snapshot',   apiLimiter, require('./routes/snapshot'));
app.use('/api/matches',    apiLimiter, require('./routes/matches'));
app.use('/api/comparison', apiLimiter, require('./routes/comparison'));
app.use('/api/status',     require('./routes/status'));
app.use('/api/top-pairs',  apiLimiter, require('./routes/top-pairs'));
app.use('/api/backtest',   apiLimiter, require('./routes/backtest'));

// Profiles endpoint — returns list of available match profiles for the UI
const { listProfiles } = require('./services/matchProfiles');
app.get('/api/profiles', (_req, res) => res.json(listProfiles()));

// API 404 — catch unmatched /api/* routes before the SPA catch-all
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (_req, res) =>
    res.sendFile(path.join(__dirname, '../client/dist/index.html'))
  );
}

// Global error handler — catches unhandled errors in route handlers
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled error:', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  const { startCache } = require('./services/universe');
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Running on 0.0.0.0:${PORT}`);
    startCache();
  });
}

module.exports = app;
