require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/search',     require('./routes/search'));
app.use('/api/snapshot',   require('./routes/snapshot'));
app.use('/api/matches',    require('./routes/matches'));
app.use('/api/comparison', require('./routes/comparison'));
app.use('/api/status',     require('./routes/status'));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (_req, res) =>
    res.sendFile(path.join(__dirname, '../client/dist/index.html'))
  );
}

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  const { startCache } = require('./services/universe');
  app.listen(PORT, () => {
    console.log(`[server] Running on port ${PORT}`);
    startCache();
  });
}

module.exports = app;
