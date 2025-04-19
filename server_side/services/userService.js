// server_side/services/userService.js

require('dotenv').config();

const pool = require('../config/dbConfig');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const credentialService = require('./credentialService');

class UserService {
  async createUser(username) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create user record
      const apiKeyPlain = crypto.randomBytes(20).toString('hex');
      const apiKeyHash = await bcrypt.hash(apiKeyPlain, 10);
      const r = await client.query(`
        INSERT INTO users (username, api_key_hash, api_key_plain)
        VALUES ($1, $2, $3) RETURNING id
      `, [username, apiKeyHash, apiKeyPlain]);
      const newUserId = r.rows[0].id;

      // Set up default credentials
      const dbHost = process.env.DEFAULT_DB_HOST;
      const dbPort = process.env.DEFAULT_DB_PORT;
      const dbUser = process.env.DEFAULT_DB_USER;
      const dbPass = process.env.DEFAULT_DB_PASS;
      const grafanaUrl = process.env.GRAFANA_BASE_URL;

      if (!dbHost || !dbPort || !dbUser || !dbPass || !grafanaUrl) {
        throw new Error('Required environment variables for default credentials are missing');
      }

      // Insert credentials directly to avoid circular dependency
      const credentials = [
        { key: 'DB_HOST', value: dbHost },
        { key: 'DB_PORT', value: dbPort },
        { key: 'DB_USER', value: dbUser },
        { key: 'DB_PASS', value: dbPass },
        { key: 'DB_NAME_TIMING_REPORT', value: `${username}-timing_report` },
        { key: 'DB_NAME_QOR', value: `${username}-QOR` },
        { key: 'DB_NAME_DRC', value: `${username}-drc` },
        { key: 'DB_NAME_REPORTS', value: `${username}_reports` },
        { key: 'GRAFANA_URL', value: grafanaUrl },
        { key: 'GRAFANA_API_KEY', value: process.env.GRAFANA_API_KEY }
      ];

      for (const cred of credentials) {
        await client.query(
          'INSERT INTO credentials (user_id, username, key_name, key_value) VALUES ($1, $2, $3, $4)',
          [newUserId, username, cred.key, cred.value]
        );
      }

      await client.query('COMMIT');
      console.log('[DEBUG] Successfully created user and credentials:', { userId: newUserId, username });
      return { userId: newUserId, username, apiKey: apiKeyPlain };
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[UserService] Error creating user:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async getUserById(userId) {
    const x = await pool.query(`SELECT id, username FROM users WHERE id = $1`, [userId]);
    return x.rows[0];
  }

  async deleteUser(userId) {
    try {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      return true;
    } catch (error) {
      console.error('[UserService] Error deleting user:', error);
      throw error;
    }
  }
}

module.exports = new UserService();