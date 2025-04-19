// server_side/config/adminDbConfig.js
require('dotenv').config();
const { Pool } = require('pg');

const adminDbConfig = {
  host: process.env.ADMIN_DB_HOST,
  port: parseInt(process.env.ADMIN_DB_PORT),
  user: process.env.ADMIN_DB_USER,
  password: process.env.ADMIN_DB_PASS,
  database: process.env.ADMIN_DB_NAME,
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_TIMEOUT),
  max: parseInt(process.env.DB_POOL_MAX),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT),
  allowExitOnIdle: true,
  ssl: process.env.DB_SSL === 'true'
};

const adminPool = new Pool(adminDbConfig);

// Add error handling for the pool
adminPool.on('error', (err) => {
  console.error('Unexpected error on admin client', err);
  process.exit(-1);
});

module.exports = adminPool;