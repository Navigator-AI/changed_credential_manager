const pool = require('../config/dbConfig');

class UsernameSyncService {
  async syncUsernames() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get all credentials with missing or outdated usernames
      const credentialsToUpdate = await client.query(`
        SELECT DISTINCT c.user_id, c.username as cred_username, u.username as user_username
        FROM credentials c
        JOIN users u ON c.user_id = u.id
        WHERE c.username IS NULL OR c.username != u.username
      `);

      console.log('[DEBUG] Found credentials to update:', credentialsToUpdate.rows.length);

      // Update credentials with correct usernames
      for (const row of credentialsToUpdate.rows) {
        await client.query(
          'UPDATE credentials SET username = $1 WHERE user_id = $2',
          [row.user_username, row.user_id]
        );
        console.log(`[DEBUG] Updated username for user_id ${row.user_id} from ${row.cred_username} to ${row.user_username}`);
      }

      await client.query('COMMIT');
      console.log('[DEBUG] Username sync completed successfully');
      return credentialsToUpdate.rows.length;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[ERROR] Username sync failed:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async syncUsernameForUser(userId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get user's current username
      const userResult = await client.query(
        'SELECT username FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new Error(`User not found with ID: ${userId}`);
      }

      const username = userResult.rows[0].username;

      // Update all credentials for this user
      const result = await client.query(
        'UPDATE credentials SET username = $1 WHERE user_id = $2',
        [username, userId]
      );

      await client.query('COMMIT');
      console.log(`[DEBUG] Updated ${result.rowCount} credentials for user ${userId} with username ${username}`);
      return result.rowCount;
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`[ERROR] Username sync failed for user ${userId}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }
}

const usernameSyncService = new UsernameSyncService();
module.exports = usernameSyncService; 