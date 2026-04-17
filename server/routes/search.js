const express = require('express');
const router = express.Router();
const universe = require('../services/universe');

const MAX_RESULTS = 10;
const MAX_QUERY_LENGTH = 20;

router.get('/', (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 1) return res.json([]);
  if (!universe.isReady()) return res.json([]);

  const query = q.trim().slice(0, MAX_QUERY_LENGTH).toUpperCase();
  const queryLower = query.toLowerCase();

  const prefixHits = [];
  const nameHits = [];

  for (const stock of universe.getCache().values()) {
    if (!stock.ticker) continue;
    const sym = stock.ticker;
    const name = stock.companyName || '';

    if (sym.toUpperCase().startsWith(query)) {
      prefixHits.push({ symbol: sym, name, exchangeShortName: 'US' });
      if (prefixHits.length >= MAX_RESULTS) break;
    } else if (name.toLowerCase().includes(queryLower)) {
      nameHits.push({ symbol: sym, name, exchangeShortName: 'US' });
    }
  }

  const combined = [
    ...prefixHits,
    ...nameHits.slice(0, Math.max(0, MAX_RESULTS - prefixHits.length)),
  ].slice(0, MAX_RESULTS);

  res.json(combined);
});

module.exports = router;
