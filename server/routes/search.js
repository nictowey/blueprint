const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');

router.get('/', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 1) return res.json([]);

  // Prevent excessively long queries from being forwarded to FMP
  const query = q.trim().slice(0, 20);

  try {
    const results = await fmp.searchTickers(query);
    const filtered = results
      .filter(r => r.exchange === 'NASDAQ' || r.exchange === 'NYSE')
      .slice(0, 10)
      .map(r => ({
        symbol: r.symbol,
        name: r.name,
        exchangeShortName: r.exchange,
      }));
    res.json(filtered);
  } catch (err) {
    console.error('[search] Error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
