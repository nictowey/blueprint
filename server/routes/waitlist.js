const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

const REDIS_KEY = 'waitlist_emails';

router.post('/', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@') || email.length > 200) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    // Add to Redis set (deduplicates automatically)
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SADD', REDIS_KEY, email.toLowerCase().trim()]),
    });

    // Get total count
    const countRes = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SCARD', REDIS_KEY]),
    });
    const countJson = await countRes.json();
    const count = countJson.result || 0;

    res.json({ success: true, count });
  } catch (err) {
    console.error('[waitlist] Error:', err.message);
    res.status(500).json({ error: 'Failed to join waitlist' });
  }
});

module.exports = router;
