// server_side/services/dbCreationService.js

const { Client } = require('pg');
require('dotenv').config();

/**
 * Creates a new database for a user
 */
async function createDatabase(dbName) {
  const requiredVars = ['MASTER_DB_HOST', 'MASTER_DB_USER', 'MASTER_DB_PASS'];
  for (const envVar of requiredVars) {
    if (!process.env[envVar]) {
      throw new Error(`Required environment variable ${envVar} is not set`);
    }
  }

  const client = new Client({
    host: process.env.MASTER_DB_HOST,
    port: parseInt(process.env.MASTER_DB_PORT || '5432'),
    user: process.env.MASTER_DB_USER,
    password: process.env.MASTER_DB_PASS,
    database: 'postgres',
    ssl: process.env.DB_SSL === 'true'
  });

  try {
    await client.connect();
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Created database: ${dbName}`);
  } catch (err) {
    if (err.code === '42P04') {
      console.log(`Database ${dbName} already exists, skipping`);
    } else {
      console.error(`Error creating database ${dbName}:`, err);
      throw err;
    }
  } finally {
    await client.end();
  }
}

/**
 * Creates the four required databases for a user:
 * - <username>-timing_report
 * - <username>-QOR
 * - <username>-drc
 * - <username>_reports
 */
async function createUserDatabases(username) {
  const databases = [
    `${username}-timing_report`,
    `${username}-QOR`,
    `${username}-drc`,
    `${username}_reports`
  ];

  for (const dbName of databases) {
    await createDatabase(dbName);
  }
}

/**
 * Drops a database if it exists
 */
async function dropDatabase(dbName) {
  const requiredVars = ['MASTER_DB_HOST', 'MASTER_DB_USER', 'MASTER_DB_PASS'];
  for (const envVar of requiredVars) {
    if (!process.env[envVar]) {
      throw new Error(`Required environment variable ${envVar} is not set`);
    }
  }

  const client = new Client({
    host: process.env.MASTER_DB_HOST,
    port: parseInt(process.env.MASTER_DB_PORT || '5432'),
    user: process.env.MASTER_DB_USER,
    password: process.env.MASTER_DB_PASS,
    database: 'postgres',
    ssl: process.env.DB_SSL === 'true'
  });

  try {
    await client.connect();
    await client.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1
      AND pid <> pg_backend_pid()
    `, [dbName]);
    await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    console.log(`Dropped database: ${dbName}`);
  } catch (err) {
    console.error(`Error dropping database ${dbName}:`, err);
  } finally {
    await client.end();
  }
}

/**
 * Drops all databases for a user
 */
async function dropUserDatabases(username) {
  const databases = [
    `${username}-timing_report`,
    `${username}-QOR`,
    `${username}-drc`,
    `${username}_reports`
  ];

  for (const dbName of databases) {
    await dropDatabase(dbName);
  }
}

module.exports = {
  createUserDatabases,
  dropUserDatabases
};