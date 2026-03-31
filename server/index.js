require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Routes registered in Task 11 after all routes exist
// Placeholder health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/snapshot', require('./routes/snapshot'));

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  app.listen(PORT, () => console.log(`[server] Running on port ${PORT}`));
}

module.exports = app;
