# Render Deployment Design

**Date:** 2026-04-07  
**Status:** Approved

## Goal

Deploy Blueprint to Render.com as a single long-running web service so the in-memory stock universe cache stays warm between user sessions, eliminating the ~30-minute cold-start on local dev.

## Architecture

One Render **Web Service** (Node.js runtime). On deploy, Render runs the build command which installs all dependencies and runs `vite build` to produce `client/dist`. At runtime, Express serves that dist folder as static assets and handles all `/api/*` routes as before. The React app loads in the browser and hits `/api/*` on the same origin — no proxy, no CORS configuration needed.

## Changes

### 1. `server/index.js`
Add static file serving in production after all API routes:
```js
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) =>
    res.sendFile(path.join(__dirname, '../client/dist/index.html'))
  );
}
```

### 2. Root `package.json`
Add `build` and `start` scripts:
```json
"build": "npm run build --prefix client",
"start": "node server/index.js"
```

### 3. `render.yaml` (new file at repo root)
Render Blueprint IaC config:
```yaml
services:
  - type: web
    name: blueprint
    runtime: node
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: FMP_API_KEY
        sync: false
```

## What stays the same

- `process.env.PORT || 3001` already handles Render's dynamic port assignment
- Cache build logic in `universe.js` unchanged — starts on boot, stays warm
- All client `fetch('/api/...')` calls use relative paths — work natively against same origin in production
- `.env` is not deployed; `FMP_API_KEY` is set in the Render dashboard

## Deployment Steps (manual, post-merge)

1. Connect GitHub repo to Render (New Web Service → GitHub → `nictowey/blueprint`)
2. Render auto-detects `render.yaml` and pre-fills build/start commands
3. Set `FMP_API_KEY` in Render dashboard environment variables
4. Deploy — cache warms up once on first boot and refreshes every 24h
