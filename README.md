# Blueprint

Blueprint is a stock analysis tool that lets investors pick a historical stock and date, see a fundamental and technical snapshot of that company at that moment, and then find current stocks that match the same profile. The core insight: if NVDA looked a certain way before it 10x'd, find stocks that look the same way today.

## How to Run Locally

**Prerequisites:** Node.js 18+, a Financial Modeling Prep API key (Starter plan or above)

```bash
# 1. Clone and install
git clone <repo-url>
cd blueprint
cp .env.example .env
# Edit .env and add your FMP_API_KEY

npm install       # installs root, client, and server deps via postinstall

# 2. Start development servers
npm run dev       # starts Express on :3001 and Vite on :5173
```

Open http://localhost:5173

> **Note:** The stock universe cache takes ~3 minutes to warm up on first start. The match results page will show a 503 error until it's ready. Check `/api/status` to see cache state.

## Get an FMP API Key

Sign up at financialmodelingprep.com and grab a Starter plan key (~$14.99/mo). The free tier limits you to 250 requests/day, which will be exhausted by the universe cache build.

## Architecture

- **Frontend:** React 18 + Vite + Tailwind CSS, served on port 5173 in dev
- **Backend:** Node.js + Express on port 3001, proxied by Vite in dev
- **Data:** All FMP API calls go through the Express backend — the API key is never exposed to the browser
- **Matching:** Server maintains an in-memory cache of ~300 stocks refreshed every 24h; match queries are instant. The matching layer is a pluggable engine registry — four engines are registered:
  - `templateMatch` — cosine-distance comparison against a historical template snapshot (requires ticker + date)
  - `momentumBreakout` — template-free 5-signal technical scanner (RSI, 52-week breakout, MA crossover, volume, trend)
  - `catalystDriven` — template-free 3-signal fundamental scanner (earnings surprise, analyst revisions, insider buying)
  - `ensembleConsensus` — merges all other engines via Reciprocal Rank Fusion; template is optional (joins if provided)
  
  Template-free engines can be invoked directly via `/api/matches?algo=<key>` or selected from the homepage "browse by lens" buttons. Engine metadata is exposed at `/api/algorithms`.

## Monetization

Pro tier and Lemon Squeezy payment integration to be added in V2.
