const axios = require('axios');
const pool = require('../config/dbConfig');

class GrafanaService {
  constructor() {
    this.syncGrafanaDataSourcesForUser = this.syncGrafanaDataSourcesForUser.bind(this);
    this.checkAndCreate = this.checkAndCreate.bind(this);
    this.findDs = this.findDs.bind(this);
    this.createDs = this.createDs.bind(this);
    this.updateOrAddCredential = this.updateOrAddCredential.bind(this);
  }

  async syncGrafanaDataSourcesForUser(userId) {
    try {
      console.log('[DEBUG] Starting Grafana datasource sync for user:', userId);
      
      const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
      if (userResult.rows.length === 0) {
        throw new Error(`User not found with ID: ${userId}`);
      }
      const username = userResult.rows[0].username;
      
      const credentialService = require('./credentialService');
      const userCreds = await credentialService.getAllCredentials(userId);
      const getVal = (key) => {
        const c = userCreds.find(x => x.key_name === key);
        return c ? c.key_value : null;
      };

      const grafanaApiKey = getVal('GRAFANA_API_KEY');
      if (!grafanaApiKey) {
        console.log('[DEBUG] No Grafana API key found, skipping sync');
        return;
      }

      const grafanaUrl = getVal('GRAFANA_URL') || process.env.GRAFANA_BASE_URL;
      if (!grafanaUrl) {
        console.error('[ERROR] No Grafana URL configured');
        return;
      }

      const dbHost = getVal('DB_HOST');
      if (!dbHost) {
        console.error('[ERROR] DB_HOST is required');
        return;
      }

      const dbPort = getVal('DB_PORT') || process.env.DEFAULT_DB_PORT;
      const dbUser = getVal('DB_USER') || process.env.DEFAULT_DB_USER;
      const dbPass = getVal('DB_PASS') || process.env.DEFAULT_DB_PASS;
      const teamsWebhook = getVal('TEAMS_WEBHOOK_URL');

      if (!dbUser || !dbPass) {
        console.error('[ERROR] Database credentials (DB_USER, DB_PASS) are required');
        return;
      }

      const dbTiming = getVal('DB_NAME_TIMING_REPORT');
      const dbQor = getVal('DB_NAME_QOR');
      const dbDrc = getVal('DB_NAME_DRC');
      const dbReports = getVal('DB_NAME_REPORTS');

      console.log('[DEBUG] Configuration:', {
        host: dbHost,
        port: dbPort,
        user: dbUser ? 'SET' : 'NOT SET',
        pass: dbPass ? 'SET' : 'NOT SET',
        timing: dbTiming,
        qor: dbQor,
        drc: dbDrc,
        reports: dbReports,
        teamsWebhook: teamsWebhook ? 'SET' : 'NOT SET'
      });

      const dsTimingUid = await this.checkAndCreate(grafanaUrl, grafanaApiKey, dbTiming, dbHost, dbPort, dbUser, dbPass);
      if (dsTimingUid) {
        await this.updateOrAddCredential(userId, username, 'GRAFANA_UID_TIMING_REPORT', dsTimingUid);
      }
      
      const dsQorUid = await this.checkAndCreate(grafanaUrl, grafanaApiKey, dbQor, dbHost, dbPort, dbUser, dbPass);
      if (dsQorUid) {
        await this.updateOrAddCredential(userId, username, 'GRAFANA_UID_QOR', dsQorUid);
      }
      
      const dsDrcUid = await this.checkAndCreate(grafanaUrl, grafanaApiKey, dbDrc, dbHost, dbPort, dbUser, dbPass);
      if (dsDrcUid) {
        await this.updateOrAddCredential(userId, username, 'GRAFANA_UID_DRC', dsDrcUid);
      }
      
      const dsReportsUid = await this.checkAndCreate(grafanaUrl, grafanaApiKey, dbReports, dbHost, dbPort, dbUser, dbPass);
      if (dsReportsUid) {
        await this.updateOrAddCredential(userId, username, 'GRAFANA_UID_REPORTS', dsReportsUid);
      }

      console.log('[DEBUG] Completed Grafana datasource sync for user:', userId);
    } catch (error) {
      console.error('[DEBUG] Error in Grafana sync:', error);
      throw error;
    }
  }

  async updateOrAddCredential(userId, username, keyName, keyValue) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT id FROM credentials WHERE user_id = $1 AND key_name = $2',
        [userId, keyName]
      );

      if (existing.rows.length > 0) {
        await client.query(
          'UPDATE credentials SET key_value = $3, username = $4 WHERE user_id = $1 AND key_name = $2',
          [userId, keyName, keyValue, username]
        );
        console.log(`[DEBUG] Updated credential ${keyName} for user ${username}`);
      } else {
        await client.query(
          'INSERT INTO credentials (user_id, username, key_name, key_value) VALUES ($1, $2, $3, $4)',
          [userId, username, keyName, keyValue]
        );
        console.log(`[DEBUG] Added new credential ${keyName} for user ${username}`);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`[DEBUG] Error saving credential ${keyName}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async checkAndCreate(grafanaUrl, grafanaApiKey, dataSourceName, dbHost, dbPort, dbUser, dbPass) {
    if (!dataSourceName) {
      console.log('[DEBUG] No datasource name provided, skipping');
      return null;
    }

    console.log('[DEBUG] Checking datasource:', dataSourceName);
    const existing = await this.findDs(grafanaUrl, grafanaApiKey, dataSourceName);
    
    if (existing) {
      console.log('[DEBUG] Found existing datasource:', dataSourceName, 'UID:', existing.uid);
      return existing.uid;
    }

    console.log('[DEBUG] Creating new datasource:', dataSourceName);
    return await this.createDs(grafanaUrl, grafanaApiKey, dataSourceName, dbHost, dbPort, dbUser, dbPass);
  }

  async findDs(gurl, gkey, name) {
    try {
      console.log('[DEBUG] Searching for datasource:', name);
      const headers = { Authorization: `Bearer ${gkey}` };
      const response = await axios.get(`${gurl}/api/datasources`, { headers });
      return response.data.find(ds => ds.name === name) || null;
    } catch (error) {
      console.error('[DEBUG] Error finding datasource:', error.message);
      return null;
    }
  }

  async createDs(gurl, gkey, dsName, host, port, user, pass) {
    try {
      if (!gurl || !gkey || !dsName || !host || !user || !pass) {
        console.error('[DEBUG] Missing required parameters for datasource creation');
        return null;
      }

      console.log('[DEBUG] Creating datasource:', dsName);
      const url = `${gurl}/api/datasources`;
      const payload = {
        name: dsName,
        type: 'postgres',
        access: 'proxy',
        url: `${host}:${port || process.env.DEFAULT_DB_PORT}`,
        user,
        database: dsName,
        secureJsonData: { password: String(pass) },
        jsonData: { 
          sslmode: process.env.DB_SSL === 'true' ? 'require' : 'disable',
          maxOpenConnections: parseInt(process.env.DB_POOL_MAX || '20'),
          maxIdleConnections: parseInt(process.env.DB_POOL_MAX || '20'),
          maxConnectionLifetime: parseInt(process.env.DB_POOL_TIMEOUT || '14400')
        },
        basicAuth: false,
        isDefault: false
      };
      const headers = { 
        'Content-Type': 'application/json', 
        Authorization: `Bearer ${gkey}` 
      };
      const response = await axios.post(url, payload, { headers });
      const uid = response.data.datasource?.uid;
      if (uid) {
        console.log('[DEBUG] Successfully created datasource:', dsName, 'UID:', uid);
        return uid;
      }
      console.log('[DEBUG] Created datasource but no UID returned');
      return null;
    } catch (error) {
      console.error('[DEBUG] Error creating datasource:', error.message);
      return null;
    }
  }

  async createDashboard(username, tableName, dbName) {
    try {
      console.log(`[DEBUG] Creating dashboard for user: ${username}, table: ${tableName}`);
      
      const dashboardData = {
        dashboard: {
          id: null,
          uid: generateUid(),
          title: `${tableName}-${Date.now()}`,
          tags: [username, tableName],
          timezone: 'browser',
          schemaVersion: 36,
          version: 0,
          refresh: '5s',
          meta: {
            createdBy: username,
            createdAt: new Date().toISOString()
          },
        },
        message: `Dashboard created by ${username}`,
        overwrite: false
      };

      const response = await this.grafanaApi.post('/api/dashboards/db', dashboardData);
      
      await this.storeDashboardInfo(username, tableName, response.data.uid);

      return response.data;
    } catch (error) {
      console.error('[GrafanaService] Error creating dashboard:', error);
      throw error;
    }
  }

  async storeDashboardInfo(username, tableName, dashboardUid) {
    try {
      const query = `
        INSERT INTO dashboards (username, table_name, dashboard_uid, created_at)
        VALUES ($1, $2, $3, NOW())
      `;
      await pool.query(query, [username, tableName, dashboardUid]);
    } catch (error) {
      console.error('[GrafanaService] Error storing dashboard info:', error);
      throw error;
    }
  }
}

function generateUid() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let u = "";
  for (let i = 0; i < 8; i++) {
    u += chars[Math.floor(Math.random() * chars.length)];
  }
  return u;
}

const grafanaService = new GrafanaService();
module.exports = grafanaService;