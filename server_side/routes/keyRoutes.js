// server_side/routes/keyRoutes.js

const express = require('express');
const router = express.Router();
const pool = require('../config/dbConfig');
const bcrypt = require('bcrypt');

router.get('/validate', async (req, res) => {
  try {
    const providedKey = req.query.apiKey;
    if (!providedKey) {
      return res.status(400).json({ error: 'Missing apiKey' });
    }
    const result = await pool.query(`
      SELECT api_key_hash FROM users WHERE is_active = TRUE
    `);
    let valid = false;
    for (const row of result.rows) {
      const match = await bcrypt.compare(providedKey, row.api_key_hash);
      if (match) {
        valid = true;
        break;
      }
    }
    if (!valid) {
      return res.status(401).json({ error: 'Invalid API key' });
    }
    return res.json({ message: 'Key is valid!' });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;