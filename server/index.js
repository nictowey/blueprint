require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Trust the first proxy (Render's reverse proxy) so express-rate-limit
// correctly identifies users by their real IP via X-Forwarded-For header.
app.set('trust proxy', 1);

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
app.use('/api/blend',      apiLimiter, require('./routes/blend'));
app.use('/api/proof',      require('./routes/proof'));
app.use('/api/waitlist',   apiLimiter, require('./routes/waitlist'));


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

// Warm the catalyst snapshot cache for the top-N tickers by market cap.
// Non-blocking fire-and-forget — the HTTP server is already listening so the
// API stays responsive while signals populate in the background. Each ticker
// triggers 3 sequential FMP calls (220ms each) per the rate-limit convention,
// so a 200-ticker warm takes ~2.2 minutes.
//
// Configurable via CATALYST_WARM_TOP_N (default 200). Set to 0 to disable for
// fast local iteration; automatically skipped during tests.
function scheduleCatalystWarm() {
  if (process.env.NODE_ENV === 'test') return;

  const configured = process.env.CATALYST_WARM_TOP_N;
  const topN = configured != null && configured !== ''
    ? parseInt(configured, 10)
    : 200;
  if (!Number.isFinite(topN) || topN <= 0) {
    const display = configured && configured !== '' ? configured : 'unset';
    console.log(`[server] Catalyst warm skipped (CATALYST_WARM_TOP_N=${display})`);
    return;
  }

  const { getCache, isReady } = require('./services/universe');
  const { populateCatalystCache } = require('./services/catalystSnapshot');
  const { isInvestable } = require('./services/algorithms');

  // Universe build runs asynchronously after startCache() — wait for isReady()
  // to flip before picking the top-N tickers. Check every 5 seconds; give up
  // after 30 minutes if the build hasn't finished (something else is wrong).
  const POLL_INTERVAL_MS = 5 * 1000;
  const MAX_WAIT_MS = 30 * 60 * 1000;
  const waitStart = Date.now();

  function waitForUniverseThenWarm() {
    if (!isReady()) {
      if (Date.now() - waitStart > MAX_WAIT_MS) {
        console.warn('[server] Catalyst warm gave up — universe not ready after 30min');
        return;
      }
      // .unref() so the timer doesn't keep the event loop alive on shutdown
      setTimeout(waitForUniverseThenWarm, POLL_INTERVAL_MS).unref();
      return;
    }

    const universe = getCache();
    const tickers = Array.from(universe.values())
      .filter(isInvestable)
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
      .slice(0, topN)
      .map(s => s.ticker);

    if (tickers.length === 0) {
      console.log('[server] Catalyst warm skipped — no investable tickers in universe');
      return;
    }

    console.log(`[server] Catalyst warm starting: top ${tickers.length} tickers by market cap`);
    const startMs = Date.now();
    populateCatalystCache(tickers, {
      onProgress: (i, total, ticker, status) => {
        // Log every 25 tickers plus the final one
        if ((i + 1) % 25 === 0 || i + 1 === total) {
          const elapsedMin = ((Date.now() - startMs) / 60000).toFixed(1);
          console.log(`[server] Catalyst warm: ${i + 1}/${total} (${ticker} ${status}, ${elapsedMin}min elapsed)`);
        }
      },
    })
      .then(summary => {
        const elapsedMin = ((Date.now() - startMs) / 60000).toFixed(1);
        console.log(`[server] Catalyst warm complete in ${elapsedMin}min: ${JSON.stringify(summary)}`);
      })
      .catch(err => {
        console.error(`[server] Catalyst warm failed: ${err.message}`);
      });
  }

  waitForUniverseThenWarm();
}

if (require.main === module) {
  const { startCache } = require('./services/universe');
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Running on 0.0.0.0:${PORT}`);
    startCache();
    scheduleCatalystWarm();
  });
}

module.exports = app;
