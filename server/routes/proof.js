const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const REDIS_KEY = 'proof_results';
const MEMORY_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const LOCAL_CACHE_PATH = path.join(__dirname, '../.cache/proof-results.json');

let memoryCache = null;
let memoryCacheTs = 0;

async function loadFromRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const res = await fetch(`${url}/get/${REDIS_KEY}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.result) return null;
    return JSON.parse(json.result);
  } catch (err) {
    console.warn('[proof] Failed to load from Redis:', err.message);
    return null;
  }
}

function loadFromFile() {
  try {
    if (!fs.existsSync(LOCAL_CACHE_PATH)) return null;
    const raw = fs.readFileSync(LOCAL_CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[proof] Failed to load from file:', err.message);
    return null;
  }
}

router.get('/', async (_req, res) => {
  // Check memory cache first
  if (memoryCache && Date.now() - memoryCacheTs < MEMORY_CACHE_TTL) {
    return res.json(memoryCache);
  }

  // Try Redis
  let data = await loadFromRedis();

  // Fallback to local file
  if (!data) {
    data = loadFromFile();
  }

  if (!data) {
    return res.status(404).json({
      error: 'Proof data not yet generated. Run server/scripts/run-proof.js to generate.',
    });
  }

  // Cache in memory
  memoryCache = data;
  memoryCacheTs = Date.now();

  res.json(data);
});

module.exports = router;
