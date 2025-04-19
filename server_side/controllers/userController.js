// server_side/controllers/userController.js

const pool = require('../config/dbConfig');
const userService = require('../services/userService');
const grafanaService = require('../services/grafanaService');
const { createUserDatabases, dropUserDatabases } = require('../services/dbCreationService');

async function addUser(req, res) {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // First create the user in master_db
    const newUser = await userService.createUser(username);

    // Then create the three databases for this user
    await createUserDatabases(username);

    // Finally set up Grafana data sources
    await grafanaService.syncGrafanaDataSourcesForUser(newUser.userId);

    return res.status(201).json({
      message: 'User created successfully',
      user: {
        id: newUser.userId,
        username: newUser.username,
        apiKey: newUser.apiKey
      }
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    console.error('Error creating user:', error);
    return res.status(500).json({ error: 'Server error creating user' });
  }
}

async function listUsers(req, res) {
  try {
    const result = await pool.query(`
      SELECT id, username, created_at, is_active
      FROM users
      ORDER BY id
    `);
    return res.json(result.rows);
  } catch (error) {
    console.error('Error listing users:', error);
    return res.status(500).json({ error: 'Server error listing users' });
  }
}

async function getUserById(req, res) {
  try {
    const userId = req.params.id;
    const userResult = await pool.query(`
      SELECT id, username, api_key_plain, created_at, is_active
      FROM users
      WHERE id = $1
    `, [userId]);
    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userResult.rows[0];
    const credResult = await pool.query(`
      SELECT id, username, key_name, key_value, created_at
      FROM credentials
      WHERE user_id = $1
      ORDER BY id
    `, [userId]);
    user.credentials = credResult.rows;
    return res.json(user);
  } catch (error) {
    console.error('Error fetching user by ID:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}

async function ensureTableExists(tableName) {
  try {
    // Check if table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      )
    `, [tableName]);

    if (!tableCheck.rows[0].exists) {
      console.log(`[DEBUG] Creating table ${tableName}`);
      await pool.query(`
        CREATE TABLE ${tableName} (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          username VARCHAR(255) NOT NULL,
          table_name VARCHAR(255) NOT NULL,
          dashboard_url TEXT NOT NULL,
          local_snapshot_url TEXT,
          source VARCHAR(50) DEFAULT 'grafana',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          app_user_id INTEGER,
          app_username VARCHAR(255),
          slack_sent_at TIMESTAMP WITH TIME ZONE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
    }
  } catch (err) {
    console.error(`Error ensuring table ${tableName} exists:`, err);
    throw err;
  }
}

async function deleteUser(req, res) {
  const client = await pool.connect();
  try {
    // Start transaction
    await client.query('BEGIN');

    const userId = req.params.id;
    
    // 1. Get and verify username
    const userRes = await client.query(
      `SELECT username FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );
    if (userRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    const { username } = userRes.rows[0];
    console.log(`[DEBUG] Starting deletion process for user ${username} (${userId})`);

    // 2. Delete all dashboard records
    console.log(`[DEBUG] Deleting dashboard records...`);
    const deletedDashboards = {
      timing: await client.query(
        `DELETE FROM dashboardtiming WHERE user_id = $1 OR app_user_id = $1 RETURNING id, table_name`,
        [userId]
      ),
      qor: await client.query(
        `DELETE FROM dashboardqor WHERE user_id = $1 OR app_user_id = $1 RETURNING id, table_name`,
        [userId]
      ),
      drc: await client.query(
        `DELETE FROM dashboarddrc WHERE user_id = $1 OR app_user_id = $1 RETURNING id, table_name`,
        [userId]
      )
    };

    // 3. Delete all credentials
    console.log(`[DEBUG] Deleting credentials...`);
    const deletedCreds = await client.query(
      `DELETE FROM credentials WHERE user_id = $1 RETURNING key_name`,
      [userId]
    );

    // 4. Drop user databases
    console.log(`[DEBUG] Dropping user databases...`);
    await dropUserDatabases(username);

    // 5. Delete user record
    console.log(`[DEBUG] Deleting user record...`);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    // Commit transaction
    await client.query('COMMIT');
    
    // Prepare detailed response
    return res.json({
      message: 'User deleted successfully',
      details: {
        username,
        userId,
        deletedData: {
          dashboards: {
            timing: {
              count: deletedDashboards.timing.rowCount,
              tables: deletedDashboards.timing.rows.map(r => r.table_name)
            },
            qor: {
              count: deletedDashboards.qor.rowCount,
              tables: deletedDashboards.qor.rows.map(r => r.table_name)
            },
            drc: {
              count: deletedDashboards.drc.rowCount,
              tables: deletedDashboards.drc.rows.map(r => r.table_name)
            }
          },
          credentials: {
            count: deletedCreds.rowCount,
            keys: deletedCreds.rows.map(r => r.key_name)
          },
          databases: [
            `${username}-timing_report`,
            `${username}-QOR`,
            `${username}-drc`
          ]
        }
      }
    });

  } catch (err) {
    // Rollback transaction on error
    await client.query('ROLLBACK');
    console.error('Error deleting user:', err);
    return res.status(500).json({ 
      error: 'Server error deleting user',
      details: err.message
    });
  } finally {
    // Always release the client
    client.release();
  }
}

module.exports = {
  addUser,
  listUsers,
  getUserById,
  deleteUser
};