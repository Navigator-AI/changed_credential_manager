// server_side/middlewares/authMiddleware.js

const pool = require('../config/dbConfig');
const bcrypt = require('bcrypt');

async function authMiddleware(req, res, next) {
  try {
    const providedKey = req.query.apiKey;
    if (!providedKey) {
      return res.status(401).json({ error: 'Missing apiKey param' });
    }

    // find user whose hashed key matches providedKey
    const result = await pool.query('SELECT id, api_key_hash FROM users WHERE is_active = TRUE');
    let userId = null;

    for (const row of result.rows) {
      const isMatch = await bcrypt.compare(providedKey, row.api_key_hash);
      if (isMatch) {
        userId = row.id;
        break;
      }
    }

    if (!userId) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // store userId in req so route can use it
    req.userId = userId;
    next();
  } catch (err) {
    console.error('Error in authMiddleware:', err);
    return res.status(500).json({ error: 'Server error in auth' });
  }
}

module.exports = authMiddleware;