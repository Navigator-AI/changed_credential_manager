// server_side/config/dbConfig.js
require('dotenv').config();
const { Pool } = require('pg');

// Validate required sensitive environment variables
const requiredEnvVars = [
  'MASTER_DB_HOST',
  'MASTER_DB_USER',
  'MASTER_DB_PASS',
  'MASTER_DB_NAME'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required sensitive environment variable: ${envVar}`);
  }
}

// Default configuration for non-sensitive settings
const DEFAULT_CONFIG = {
  port: 5432,
  max_connections: 20,
  connection_timeout: 5000,
  idle_timeout: 30000,
  refresh_interval: 300000  // 5 minutes
};

function getDbConfig() {
  return {
    // Sensitive information from environment variables
    host: process.env.MASTER_DB_HOST,
    user: process.env.MASTER_DB_USER,
    password: process.env.MASTER_DB_PASS,
    database: process.env.MASTER_DB_NAME,
    
    // Non-sensitive settings with defaults
    port: parseInt(process.env.MASTER_DB_PORT || DEFAULT_CONFIG.port),
    max: parseInt(process.env.DB_POOL_MAX || DEFAULT_CONFIG.max_connections),
    connectionTimeoutMillis: parseInt(process.env.DB_POOL_TIMEOUT || DEFAULT_CONFIG.connection_timeout),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || DEFAULT_CONFIG.idle_timeout),
    allowExitOnIdle: true,
    ssl: process.env.DB_SSL === 'true'
  };
}

// Create pool with initial config
let pool = new Pool(getDbConfig());

// Add error handling for the pool
pool.on('error', (err) => {
  console.error('[ERROR] Unexpected error on idle client:', err);
});

// Add connection validation
pool.on('connect', (client) => {
  console.log('[DEBUG] New database connection established');
});

// Refresh function to update pool settings
async function refreshPool() {
  try {
    const newConfig = getDbConfig();
    const oldPool = pool;
    
    // Create new pool with updated config
    pool = new Pool(newConfig);
    
    // Add event handlers to new pool
    pool.on('error', (err) => {
      console.error('[ERROR] Unexpected error on idle client:', err);
    });
    
    pool.on('connect', (client) => {
      console.log('[DEBUG] New database connection established');
    });

    // Test new pool with a simple query
    await pool.query('SELECT 1');
    
    // If test successful, end old pool gracefully
    try {
      await oldPool.end();
    } catch (endError) {
      console.warn('[WARN] Error ending old pool:', endError.message);
    }
    
    console.log('[DEBUG] Database pool configuration refreshed successfully');
  } catch (error) {
    console.error('[ERROR] Failed to refresh database pool:', error);
    // If refresh fails, keep using the old pool
    pool = oldPool;
  }
}

// Refresh pool config using interval from env or default
const refreshInterval = parseInt(process.env.DB_POOL_REFRESH_INTERVAL || DEFAULT_CONFIG.refresh_interval);
setInterval(refreshPool, refreshInterval);

module.exports = {
  query: (...args) => pool.query(...args),
  connect: () => pool.connect(),
  end: () => pool.end(),
  refreshPool
};