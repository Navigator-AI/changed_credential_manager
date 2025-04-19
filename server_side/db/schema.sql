-- server_side/schema.sql

CREATE TABLE IF NOT EXISTS users  (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  api_key_hash TEXT NOT NULL,
  api_key_plain TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credentials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  username VARCHAR(255) NOT NULL,
  key_name VARCHAR(255) NOT NULL,
  key_value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, key_name)
);

CREATE TABLE IF NOT EXISTS dashboardtiming (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  db_username VARCHAR(255) NOT NULL,
  table_name VARCHAR(255) NOT NULL,
  dashboard_url TEXT NOT NULL,
  local_snapshot_url TEXT,
  slack_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  app_user_id INTEGER,
  app_username VARCHAR(255),
  UNIQUE(user_id, table_name)
);

CREATE TABLE IF NOT EXISTS dashboardqor (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  db_username VARCHAR(255) NOT NULL,
  table_name VARCHAR(255) NOT NULL,
  dashboard_url TEXT NOT NULL,
  local_snapshot_url TEXT,
  slack_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  app_user_id INTEGER,
  app_username VARCHAR(255),
  UNIQUE(user_id, table_name)
);

CREATE TABLE IF NOT EXISTS dashboarddrc (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  db_username VARCHAR(255) NOT NULL,
  table_name VARCHAR(255) NOT NULL,
  dashboard_url TEXT NOT NULL,
  local_snapshot_url TEXT,
  slack_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  app_user_id INTEGER,
  app_username VARCHAR(255),
  UNIQUE(user_id, table_name)
);

CREATE TABLE IF NOT EXISTS dashboardreports (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    username VARCHAR(255) NOT NULL,
    table_name VARCHAR(255) NOT NULL,
    dashboard_url TEXT,
    dashboard_uid TEXT,
    local_snapshot_url TEXT,
    slack_sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source TEXT,
    app_user_id INTEGER REFERENCES users(id),
    app_username VARCHAR(255),
    UNIQUE(user_id, table_name)
); 
ALTER TABLE dashboardreports
ADD COLUMN teams_sent_at TIMESTAMP WITH TIME ZONE;