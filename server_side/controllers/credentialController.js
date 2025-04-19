// server_side/controllers/credentialController.js

const credentialService = require('../services/credentialService');
const userService = require('../services/userService');
const grafanaService = require('../services/grafanaService');
const usernameSyncService = require('../services/usernameSyncService');
const pool = require('../config/dbConfig');

async function listCredentials(req, res) {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    console.log('[DEBUG] Listing credentials for user:', userId);
    const credentials = await credentialService.getAllCredentials(userId);
    console.log('[DEBUG] Found credentials:', credentials);
    return res.json(credentials);
  } catch (error) {
    console.error('[DEBUG] Error listing credentials:', error);
    return res.status(500).json({ error: 'Server error listing credentials' });
  }
}

async function getCredential(req, res) {
  try {
    const userId = parseInt(req.params.userId);
    const { keyName } = req.params;

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    if (!keyName) {
      return res.status(400).json({ error: 'Key name is required' });
    }

    console.log('[DEBUG] Getting credential:', { userId, keyName });
    const credential = await credentialService.getCredential(userId, keyName);
    if (!credential) {
      return res.status(404).json({ error: 'Credential not found' });
    }
    return res.json(credential);
  } catch (error) {
    console.error('[DEBUG] Error getting credential:', error);
    return res.status(500).json({ error: 'Server error getting credential' });
  }
}

async function addCredential(req, res) {
  const client = await pool.connect();
  try {
    const userId = parseInt(req.params.userId);
    const { keyName, keyValue } = req.body;

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    if (!keyName || !keyValue) {
      return res.status(400).json({ error: 'Both keyName and keyValue are required' });
    }

    await client.query('BEGIN');

    // Get username first
    const userResult = await client.query(
      'SELECT username FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const username = userResult.rows[0].username;
    console.log('[DEBUG] Adding credential for user:', { userId, username, keyName });

    // Check if credential exists
    const existing = await client.query(
      'SELECT id FROM credentials WHERE user_id = $1 AND key_name = $2 FOR UPDATE',
      [userId, keyName]
    );

    if (existing.rows.length > 0) {
      // Update existing credential
      await client.query(
        'UPDATE credentials SET key_value = $3, username = $4 WHERE user_id = $1 AND key_name = $2',
        [userId, keyName, keyValue, username]
      );
      console.log('[DEBUG] Updated existing credential');
    } else {
      // Insert new credential
      await client.query(
        'INSERT INTO credentials (user_id, username, key_name, key_value) VALUES ($1, $2, $3, $4)',
        [userId, username, keyName, keyValue]
      );
      console.log('[DEBUG] Inserted new credential');
    }

    await client.query('COMMIT');

    // Trigger username sync in the background
    usernameSyncService.syncUsernameForUser(userId).catch(error => {
      console.error('[ERROR] Background username sync failed:', error);
    });

    // If this was a Grafana API key, trigger a sync
    if (keyName === 'GRAFANA_API_KEY') {
      console.log('[DEBUG] Grafana API key added, triggering sync');
      try {
        await grafanaService.syncGrafanaDataSourcesForUser(userId);
      } catch (syncError) {
        console.error('[DEBUG] Error in Grafana sync:', syncError);
        // Don't fail the request if sync fails
      }
    }

    return res.status(201).json({ 
      message: 'Credential added successfully',
      userId,
      username,
      keyName
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DEBUG] Error adding credential:', error);
    return res.status(500).json({ 
      error: 'Server error adding credential',
      details: error.message 
    });
  } finally {
    client.release();
  }
}

async function updateCredential(req, res) {
  const client = await pool.connect();
  try {
    const userId = parseInt(req.params.userId);
    const { keyName } = req.params;
    const { keyValue } = req.body;

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    if (!keyName || !keyValue) {
      return res.status(400).json({ error: 'Both keyName and keyValue are required' });
    }

    await client.query('BEGIN');

    // Get username first
    const userResult = await client.query(
      'SELECT username FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }

    const username = userResult.rows[0].username;
    console.log('[DEBUG] Updating credential:', { userId, username, keyName });

    const result = await client.query(
      'UPDATE credentials SET key_value = $3, username = $4 WHERE user_id = $1 AND key_name = $2',
      [userId, keyName, keyValue, username]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Credential not found' });
    }

    await client.query('COMMIT');

    // If this was a Grafana API key, trigger a sync
    if (keyName === 'GRAFANA_API_KEY') {
      console.log('[DEBUG] Grafana API key updated, triggering sync');
      try {
        await grafanaService.syncGrafanaDataSourcesForUser(userId);
      } catch (syncError) {
        console.error('[DEBUG] Error in Grafana sync:', syncError);
        // Don't fail the request if sync fails
      }
    }

    return res.json({ 
      message: 'Credential updated successfully',
      userId,
      username,
      keyName
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DEBUG] Error updating credential:', error);
    return res.status(500).json({ 
      error: 'Server error updating credential',
      details: error.message 
    });
  } finally {
    client.release();
  }
}

async function deleteCredential(req, res) {
  const client = await pool.connect();
  try {
    const userId = parseInt(req.params.userId);
    const { keyName } = req.params;

    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    if (!keyName) {
      return res.status(400).json({ error: 'Key name is required' });
    }

    await client.query('BEGIN');

    const result = await client.query(
      'DELETE FROM credentials WHERE user_id = $1 AND key_name = $2',
      [userId, keyName]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Credential not found' });
    }

    await client.query('COMMIT');
    return res.json({ message: 'Credential deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[DEBUG] Error deleting credential:', error);
    return res.status(500).json({ 
      error: 'Server error deleting credential',
      details: error.message 
    });
  } finally {
    client.release();
  }
}

async function getGrafanaCredentials(req, res) {
  try {
    const { userId } = req.params;
    const credentials = await credentialService.getGrafanaCredentials(userId);
    
    return res.json({
      message: 'Grafana credentials retrieved successfully',
      credentials
    });
  } catch (error) {
    console.error('Error getting Grafana credentials:', error);
    return res.status(500).json({ 
      error: 'Server error getting Grafana credentials',
      details: error.message
    });
  }
}

// Add new endpoint to manually trigger username sync
async function syncUsernames(req, res) {
  try {
    const updatedCount = await usernameSyncService.syncUsernames();
    return res.json({
      message: 'Username sync completed successfully',
      updatedCount
    });
  } catch (error) {
    console.error('[ERROR] Username sync failed:', error);
    return res.status(500).json({
      error: 'Server error syncing usernames',
      details: error.message
    });
  }
}

module.exports = {
  listCredentials,
  getCredential,
  addCredential,
  updateCredential,
  deleteCredential,
  getGrafanaCredentials,
  syncUsernames
};