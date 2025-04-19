-- Add columns for Slack tracking
ALTER TABLE dashboardtiming 
ADD COLUMN IF NOT EXISTS local_snapshot_url TEXT,
ADD COLUMN IF NOT EXISTS slack_sent_at TIMESTAMP;

ALTER TABLE dashboardqor 
ADD COLUMN IF NOT EXISTS local_snapshot_url TEXT,
ADD COLUMN IF NOT EXISTS slack_sent_at TIMESTAMP;

ALTER TABLE dashboarddrc 
ADD COLUMN IF NOT EXISTS local_snapshot_url TEXT,
ADD COLUMN IF NOT EXISTS slack_sent_at TIMESTAMP; 