// server_side/utils/validateConfig.js

function validateConfig() {
  const requiredEnvVars = [
    'PORT',
    'FRONTEND_URL',
    'MASTER_DB_HOST',
    'MASTER_DB_PORT',
    'MASTER_DB_USER',
    'MASTER_DB_PASS',
    'MASTER_DB_NAME',
    'ADMIN_DB_HOST',
    'ADMIN_DB_PORT',
    'ADMIN_DB_USER',
    'ADMIN_DB_PASS',
    'ADMIN_DB_NAME',
    'GRAFANA_BASE_URL',
    'GRAFANA_USER',
    'GRAFANA_PASSWORD',
    'DEFAULT_DB_HOST',
    'DEFAULT_DB_PORT',
    'DEFAULT_DB_USER',
    'DEFAULT_DB_PASS',
    'GIF_CAPTURE_DIR', // Added for clarity
    'DASHBOARD_SCAN_INTERVAL' // Added for periodic tasks
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  // Validate numeric values
  const numericVars = [
    'PORT',
    'MASTER_DB_PORT',
    'ADMIN_DB_PORT',
    'DEFAULT_DB_PORT',
    'DB_POOL_MAX',
    'DB_POOL_TIMEOUT',
    'DB_POOL_IDLE_TIMEOUT',
    'DASHBOARD_SCAN_INTERVAL',
    'CAPTURE_WIDTH',
    'CAPTURE_HEIGHT',
    'CAPTURE_FRAMES',
    'CAPTURE_FRAME_DELAY',
    'CAPTURE_TIMEOUT'
  ];

  for (const varName of numericVars) {
    if (process.env[varName] && isNaN(parseInt(process.env[varName]))) {
      throw new Error(`Environment variable ${varName} must be a valid number`);
    }
  }

  // Validate directory existence
  const gifDir = process.env.GIF_CAPTURE_DIR;
  const fs = require('fs');
  if (!fs.existsSync(gifDir)) {
    fs.mkdirSync(gifDir, { recursive: true });
    console.log(`[DEBUG] Created GIF capture directory: ${gifDir}`);
  }
}

module.exports = validateConfig;