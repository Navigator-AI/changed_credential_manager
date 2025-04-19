"use strict";

require('dotenv').config();
const express = require("express");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");
const credentialRoutes = require("./routes/credentialRoutes");
const keyRoutes = require("./routes/keyRoutes");
const { syncGrafanaDataSourcesForUser } = require("./services/grafanaService");
const { scanAndCreateDashboardsForUser } = require("./services/dashboardCreationService");
const slackService = require("./services/notificationService");
const pool = require("./config/dbConfig");
const validateConfig = require('./utils/validateConfig');
const validateTemplates = require('./utils/validateTemplates');
validateTemplates();
const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : ['http://localhost:3000'],
  credentials: true
}));

// Request logging middleware
app.use((req, res, next) => {
  console.log('[DEBUG] Incoming request:', {
    method: req.method,
    path: req.path,
    query: req.query,
    params: req.params
  });
  next();
});

// Mount routes
app.use("/api/v1/users", userRoutes);
app.use("/api/v1", credentialRoutes);
app.use("/api/v1", keyRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

const PORT = process.env.PORT || 8050;
const HOST = process.env.HOST || '0.0.0.0';

async function getAllUserIds() {
  try {
    const result = await pool.query("SELECT id FROM users WHERE is_active = true");
    return result.rows.map((x) => x.id);
  } catch (error) {
    console.error("[ERROR] Failed to get user IDs:", error);
    return [];
  }
}
async function processSingleUser(uid) {
  console.log(`[DEBUG] Processing user ${uid}`);
  
  try {
    // Step 1: Sync Grafana data sources
    console.log(`[DEBUG] Step 1: Syncing Grafana data sources for user ${uid}`);
    await syncGrafanaDataSourcesForUser(uid);
    
    // Step 2: Scan and create dashboards
    console.log(`[DEBUG] Step 2: Creating dashboards for user ${uid}`);
    await scanAndCreateDashboardsForUser(uid);
    
    // Step 3: Process Slack notifications
    console.log(`[DEBUG] Step 3: Processing Slack notifications for user ${uid}`);
    await slackService.processUnsentDashboards(uid);
    
    console.log(`[DEBUG] Completed all steps for user ${uid}`);
  } catch (error) {
    console.error(`[ERROR] Failed to process user ${uid}:`, error);
    throw error;
  }
}

try {
  validateConfig();
  app.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
  });

  // Periodic tasks
  const dashboardScanInterval = parseInt(process.env.DASHBOARD_SCAN_INTERVAL);
  setInterval(async () => {
    try {
      console.log('[DEBUG] Starting periodic tasks...');
      
      const userIds = await getAllUserIds();
      console.log(`[DEBUG] Found ${userIds.length} users to process`);
      
      for (const uid of userIds) {
        try {
          await processSingleUser(uid);
        } catch (userError) {
          console.error(`[ERROR] Failed to process user ${uid}:`, userError);
        }
      }
      
      console.log('[DEBUG] Completed all periodic tasks');
      
    } catch (err) {
      console.error("[ERROR] Error in periodic tasks:", err);
    }
  }, dashboardScanInterval);

} catch (error) {
  console.error('Configuration Error:', error.message);
  process.exit(1);
}