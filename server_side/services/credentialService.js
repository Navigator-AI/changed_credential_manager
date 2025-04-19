const pool = require('../config/dbConfig');

class CredentialService {
  /**
   * Get all credentials for a user
   */
  async getAllCredentials(userId) {
    try {
      console.log('[DEBUG] Getting all credentials for user:', userId);
      const result = await pool.query(
        'SELECT key_name, key_value FROM credentials WHERE user_id = $1',
        [userId]
      );
      console.log('[DEBUG] Found credentials:', result.rows);
      return result.rows;
    } catch (error) {
      console.error('[DEBUG] Error getting credentials:', error);
      throw error;
    }
  }

  /**
   * Get a specific credential by key name
   */
  async getCredential(userId, keyName) {
    try {
      console.log('[DEBUG] Getting credential:', { userId, keyName });
      const result = await pool.query(
        'SELECT key_value FROM credentials WHERE user_id = $1 AND key_name = $2',
        [userId, keyName]
      );
      console.log('[DEBUG] Found credential:', result.rows[0]);
      return result.rows[0];
    } catch (error) {
      console.error('[DEBUG] Error getting credential:', error);
      throw error;
    }
  }

  async getUsernameById(userId) {
    try {
      const result = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
      if (result.rows.length === 0) {
        throw new Error(`User not found with ID: ${userId}`);
      }
      return result.rows[0].username;
    } catch (error) {
      console.error('[DEBUG] Error getting username:', error);
      throw error;
    }
  }

  async addOrUpdateCredential(userId, keyName, keyValue) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get username first
      const username = await this.getUsernameById(userId);

      // Check if credential exists
      const existing = await client.query(
        'SELECT id FROM credentials WHERE user_id = $1 AND key_name = $2',
        [userId, keyName]
      );

      if (existing.rows.length > 0) {
        // Update existing credential
        await client.query(
          'UPDATE credentials SET key_value = $3, username = $4 WHERE user_id = $1 AND key_name = $2',
          [userId, keyName, keyValue, username]
        );
        console.log('[DEBUG] Updated credential:', { userId, keyName, username });
      } else {
        // Insert new credential
        await client.query(
          'INSERT INTO credentials (user_id, username, key_name, key_value) VALUES ($1, $2, $3, $4)',
          [userId, username, keyName, keyValue]
        );
        console.log('[DEBUG] Inserted new credential:', { userId, keyName, username });
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[DEBUG] Error in addOrUpdateCredential:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async addCredential(userId, keyName, keyValue) {
    return this.addOrUpdateCredential(userId, keyName, keyValue);
  }

  /**
   * Update an existing credential
   */
  async updateCredential(userId, keyName, keyValue) {
    return this.addOrUpdateCredential(userId, keyName, keyValue);
  }

  /**
   * Delete a credential
   */
  async deleteCredential(userId, keyName) {
    try {
      console.log('[DEBUG] Deleting credential:', { userId, keyName });
      const result = await pool.query(
        'DELETE FROM credentials WHERE user_id = $1 AND key_name = $2',
        [userId, keyName]
      );
      if (result.rowCount === 0) {
        throw new Error('Credential not found');
      }
      console.log('[DEBUG] Successfully deleted credential');
    } catch (error) {
      console.error('[DEBUG] Error deleting credential:', error);
      throw error;
    }
  }

  /**
   * Delete all credentials for a user
   */
  async deleteAllCredentials(userId) {
    try {
      const result = await pool.query(
        'DELETE FROM credentials WHERE user_id = $1 RETURNING id, key_name',
        [userId]
      );
      return result.rows;
    } catch (error) {
      console.error('[CredentialService] Error deleting all credentials:', error);
      throw error;
    }
  }
}

// Export a singleton instance
const credentialService = new CredentialService();
module.exports = credentialService;