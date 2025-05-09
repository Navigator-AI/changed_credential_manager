"use strict";

require('dotenv').config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const userRoutes = require("./routes/userRoutes");
const credentialRoutes = require("./routes/credentialRoutes");
const keyRoutes = require("./routes/keyRoutes");
const { syncGrafanaDataSourcesForUser } = require("./services/grafanaService");
const { scanAndCreateDashboardsForUser } = require("./services/dashboardCreationService");
const slackService = require("./services/notificationService");
const pool = require("./config/dbConfig");
const validateConfig = require('./utils/validateConfig');
const validateTemplates = require('./utils/validateTemplates');

// Validate templates on startup
validateTemplates();
const app = express();

// Middleware
app.use(express.json());
app.use(cors({
    origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : ['http://localhost:8050'],
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

// Serve static files from React build
app.use(express.static(path.join(__dirname, '../frontend/build')));

// API Routes
app.use("/api/v1/users", userRoutes);
app.use("/api/v1", credentialRoutes);
app.use("/api/v1", keyRoutes);

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
        await syncGrafanaDataSourcesForUser(uid);
        await scanAndCreateDashboardsForUser(uid);
        await slackService.processUnsentDashboards(uid);
        console.log(`[DEBUG] Completed all steps for user ${uid}`);
    } catch (error) {
        console.error(`[ERROR] Failed to process user ${uid}:`, error);
        throw error;
    }
}

// Serve React app for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
});

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

async function startServer() {
    try {
        await validateConfig();
        
        app.listen(PORT, HOST, () => {
            console.log(`Server is running on http://${HOST}:${PORT}`);
        });

        // Start periodic tasks
        const dashboardScanInterval = parseInt(process.env.DASHBOARD_SCAN_INTERVAL);
        setInterval(async () => {
            try {
                console.log('[DEBUG] Starting periodic tasks...');
                const userIds = await getAllUserIds();
                for (const uid of userIds) {
                    await processSingleUser(uid).catch(error => {
                        console.error(`[ERROR] Failed to process user ${uid}:`, error);
                    });
                }
            } catch (err) {
                console.error("[ERROR] Error in periodic tasks:", err);
            }
        }, dashboardScanInterval);

    } catch (error) {
        console.error('[ERROR] Server initialization failed:', error);
        process.exit(1);
    }
}

startServer();