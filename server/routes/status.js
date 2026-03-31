const express = require('express');
const router = express.Router();
const { getStatus } = require('../services/universe');

router.get('/', (_req, res) => {
  res.json(getStatus());
});

module.exports = router;
