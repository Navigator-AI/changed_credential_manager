"use strict";

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { Client } = require("pg");
const puppeteer = require("puppeteer");
const sharp = require("sharp");
const crypto = require("crypto");
const pool = require("../config/dbConfig");
const credentialService = require("./credentialService");
const notificationService = require("./notificationService");

const templates = {
  timing: require("../grafana_templates/timing_report_template.json"),
  qor: require("../grafana_templates/qor_template.json"),
  drc: require("../grafana_templates/drc_template.json"),
  skew: require("../grafana_templates/skew_template.json"),
  errors: require("../grafana_templates/errors_template.json"),
  delay_stacking: require("../grafana_templates/delay_stacking_template.json"),
  delay_compare: require("../grafana_templates/delay_comparison_template.json"),
  slack_compare: require("../grafana_templates/slack_comparison_template.json"),
  qor_pnr: require("../grafana_templates/QOR_PNR_template.json"),
  run_compare: require("../grafana_templates/Run_comparison_template.json")
};

const TEMPLATE_MAPPING = [
  {
    pattern: /^run\d*_g(\d+)(?:_csv)?$/i,
    template: templates.qor_pnr,
    type: "qor",
    priority: 0,
    getReplacements: (tableName) => {
      const runNumber = tableName.match(/_g(\d+)/i)[1];
      const suffix = tableName.includes("_csv") ? "_csv" : "";
      return {
        "{{RUN_TABLE}}": tableName,
        "{{TIME_TABLE}}": `time${runNumber}${suffix}`,
        "{{DRC_TABLE}}": `drc${runNumber}${suffix}`,
        identifier: `qor-run${runNumber}`,
        titleSuffix: `Run ${runNumber} QoR`
      };
    }
  },
  {
    pattern: /timing_.*?(reg2reg|in2reg|in2in|clk2out|reg2out)/i,
    template: templates.delay_stacking,
    type: "delay-stack",
    priority: 1,
    getReplacements: (tableName) => {
      const pathType = tableName.match(/(reg2reg|in2reg|in2in|clk2out|reg2out)/i)[0];
      return {
        "{{TABLE_NAME}}": tableName,
        identifier: tableName,
        titleSuffix: `${pathType.toUpperCase()} Paths`
      };
    }
  },
  {
    pattern: /error/i,
    template: templates.errors,
    type: "errors",
    priority: 2,
    getReplacements: (tableName) => ({
      "{{TABLE_NAME}}": tableName,
      identifier: tableName,
      titleSuffix: "Error Analysis"
    })
  },
  {
    pattern: /skew/i,
    template: templates.skew,
    type: "skew",
    priority: 3,
    getReplacements: (tableName) => ({
      "{{TABLE_NAME}}": tableName,
      identifier: tableName,
      titleSuffix: "Clock Skew Analysis"
    })
  },
  {
    pattern: /_(cts|route)\d+(_csv)?$/i,
    template: templates.delay_compare,
    type: "delay-compare",
    priority: 4,
    getReplacements: (tableName, ctsTable, routeTable, runNumber, prefix) => ({
      "{{RUN_NUMBER}}": runNumber,
      "{{CTS_TABLE}}": ctsTable,
      "{{ROUTE_TABLE}}": routeTable,
      identifier: `run${runNumber}-delay-compare`,
      titleSuffix: `${prefix} Run ${runNumber}`
    })
  },
  {
    pattern: /_(cts|route)\d+(_csv)?$/i,
    template: templates.slack_compare,
    type: "slack-compare",
    priority: 5,
    getReplacements: (tableName, ctsTable, routeTable, runNumber, prefix) => ({
      "{{RUN_NUMBER}}": runNumber,
      "{{CTS_TABLE}}": ctsTable,
      "{{ROUTE_TABLE}}": routeTable,
      identifier: `run${runNumber}-slack-compare`,
      titleSuffix: `${prefix} Run ${runNumber}`
    })
  },
  {
    pattern: /^run\d*_g(\d+)(?:_csv)?$/i,
    template: templates.run_compare,
    type: "run-compare",
    priority: 6,
    getReplacements: (tableName, runNumber, nextRunNumber, suffix, nextSuffix) => ({
      "{{RUN_NUMBER}}": runNumber,
      "{{NEXT_RUN_NUMBER}}": nextRunNumber,
      "{{RUN_TABLE}}": `run${runNumber}_g${runNumber}${suffix}`,
      "{{NEXT_RUN_TABLE}}": `run${nextRunNumber}_g${nextRunNumber}${nextSuffix}`,
      "{{RUN_POWER_TABLE}}": `run${runNumber}_${runNumber}${suffix}`,
      "{{NEXT_RUN_POWER_TABLE}}": `run${nextRunNumber}_${nextRunNumber}${nextSuffix}`,
      "{{RUN_COMPARE_TABLE}}": `run${runNumber}_d${suffix}`,
      "{{NEXT_RUN_COMPARE_TABLE}}": `run${nextRunNumber}_d${nextSuffix}`,
      "{{DRC_TABLE}}": `drc${runNumber}${suffix}`,
      "{{NEXT_DRC_TABLE}}": `drc${nextRunNumber}${nextSuffix}`,
      identifier: `run${runNumber}-vs-run${nextRunNumber}`,
      titleSuffix: `Run ${runNumber} vs Run ${nextRunNumber}`
    })
  }
].sort((a, b) => a.priority - b.priority);

// Reusable function to replace all placeholders in a template
function replaceAllPlaceholders(obj, dataSourceUid, replacements = {}, tableName = null) {
  const newObj = JSON.parse(JSON.stringify(obj)); // Deep copy to avoid mutating original
  const placeholderPatterns = [
    /PLACEHOLDER_DATASOURCE_UID/g,
    /\${DATASOURCE_UID}/g,
    /{{DATASOURCE_UID}}/g
  ];

  const replaceInObject = (current) => {
    for (const key in current) {
      if (typeof current[key] === 'string') {
        // Replace data source UID placeholders
        placeholderPatterns.forEach(pattern => {
          current[key] = current[key].replace(pattern, dataSourceUid);
        });
        // Replace other placeholders from replacements object
        Object.entries(replacements).forEach(([placeholder, value]) => {
          current[key] = current[key].replace(new RegExp(placeholder, 'g'), value);
        });
        // Replace table name if provided
        if (tableName) {
          current[key] = current[key].replace(/PLACEHOLDER_TABLE_NAME/g, tableName);
        }
      } else if (typeof current[key] === 'object' && current[key] !== null) {
        replaceInObject(current[key]);
      }
    }
  };

  replaceInObject(newObj);
  return newObj;
}

async function verifyDatabaseSchema() {
  try {
    console.log("[DEBUG] Verifying database schema...");
    
    const usersResult = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'users'
    `);
    console.log("[DEBUG] Users table schema:", usersResult.rows);
    
    const dashboardTables = ['dashboardtiming', 'dashboardqor', 'dashboarddrc', 'dashboardreports'];
    for (const table of dashboardTables) {
      const result = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = $1
      `, [table]);
      if (result.rows.length === 0) {
        console.warn(`[DEBUG] Table ${table} does not exist`);
      } else {
        console.log(`[DEBUG] ${table} schema:`, result.rows);
      }
    }
    
  } catch (error) {
    console.error("[DEBUG] Schema verification error:", error);
  }
}

async function tableExists(client, tableName) {
  const res = await client.query(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`,
    [tableName]
  );
  return res.rows[0].exists;
}

async function scanAndCreateDashboardsForUser(userId) {
  await verifyDatabaseSchema();
  console.log("[DEBUG] Starting scanAndCreateDashboardsForUser for user:", userId);
  
  let username;
  try {
    const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      console.error(`[DEBUG] No user found for userId: ${userId}`);
      return;
    }
    username = userResult.rows[0].username;
    console.log(`[DEBUG] Retrieved username '${username}' for userId: ${userId}`);
  } catch (error) {
    console.error("[DEBUG] Error fetching user:", error);
    return;
  }

  const creds = await credentialService.getAllCredentials(userId);
  const getVal = (k) => {
    const x = creds.find((c) => c.key_name === k);
    return x ? x.key_value : null;
  };

  const dbHost = getVal("DB_HOST");
  if (!dbHost) {
    console.error("[ERROR] DB_HOST credential is required");
    return;
  }

  const dbPort = getVal("DB_PORT") || process.env.DEFAULT_DB_PORT || 5432;
  const dbUser = getVal("DB_USER") || process.env.DEFAULT_DB_USER;
  const dbPass = getVal("DB_PASS") || process.env.DEFAULT_DB_PASS;
  const timingDb = getVal("DB_NAME_TIMING_REPORT");
  const qorDb = getVal("DB_NAME_QOR");
  const drcDb = getVal("DB_NAME_DRC");
  const reportsDb = getVal("DB_NAME_REPORTS");
  const slackToken = getVal("SLACK_BOT_TOKEN");
  const slackChan = getVal("SLACK_CHANNEL_ID");
  const teamsWebhook = getVal("TEAMS_WEBHOOK_URL");
  const grafanaKey = getVal("GRAFANA_API_KEY");
  const grafanaUrl = getVal("GRAFANA_URL") || process.env.GRAFANA_BASE_URL;
  const timingUid = getVal("GRAFANA_UID_TIMING_REPORT");
  const qorUid = getVal("GRAFANA_UID_QOR");
  const drcUid = getVal("GRAFANA_UID_DRC");
  const reportsUid = getVal("GRAFANA_UID_REPORTS");

  if (!dbUser || !dbPass) {
    console.error("[ERROR] Database credentials (DB_USER, DB_PASS) are required");
    return;
  }

  if (!grafanaUrl) {
    console.error("[ERROR] GRAFANA_URL or GRAFANA_BASE_URL must be configured");
    return;
  }

  if (!grafanaKey) {
    console.error("[ERROR] GRAFANA_API_KEY is required");
    return;
  }

  console.log("[DEBUG] slackToken:", slackToken ? "REDACTED" : "NOT SET");
  console.log("[DEBUG] slackChan:", slackChan);
  console.log("[DEBUG] teamsWebhook:", teamsWebhook ? "REDACTED" : "NOT SET");
  console.log("[DEBUG] grafanaUrl:", grafanaUrl);

  if (timingDb && timingUid) {
    console.log("[DEBUG] Processing timing DB:", timingDb);
    await processDb(
      userId,
      username,
      dbHost,
      dbPort,
      dbUser,
      dbPass,
      timingDb,
      timingUid,
      grafanaUrl,
      grafanaKey,
      slackToken,
      slackChan,
      teamsWebhook,
      "TIMING"
    );
  } else {
    console.log("[DEBUG] Skipping timing DB because creds missing or incomplete.");
  }

  if (qorDb && qorUid) {
    console.log("[DEBUG] Processing QOR DB:", qorDb);
    await processDb(
      userId,
      username,
      dbHost,
      dbPort,
      dbUser,
      dbPass,
      qorDb,
      qorUid,
      grafanaUrl,
      grafanaKey,
      slackToken,
      slackChan,
      teamsWebhook,
      "QOR"
    );
  } else {
    console.log("[DEBUG] Skipping QOR DB because creds missing or incomplete.");
  }

  if (drcDb && drcUid) {
    console.log("[DEBUG] Processing DRC DB:", drcDb);
    await processDb(
      userId,
      username,
      dbHost,
      dbPort,
      dbUser,
      dbPass,
      drcDb,
      drcUid,
      grafanaUrl,
      grafanaKey,
      slackToken,
      slackChan,
      teamsWebhook,
      "DRC"
    );
  } else {
    console.log("[DEBUG] Skipping DRC DB because creds missing or incomplete.");
  }

  if (reportsDb && reportsUid) {
    console.log("[DEBUG] Processing REPORTS DB:", reportsDb);
    await processReportsDb(
      userId,
      username,
      dbHost,
      dbPort,
      dbUser,
      dbPass,
      reportsDb,
      reportsUid,
      grafanaUrl,
      grafanaKey,
      slackToken,
      slackChan,
      teamsWebhook
    );
  } else {
    console.log("[DEBUG] Skipping REPORTS DB because creds missing or incomplete.");
  }

  console.log("[DEBUG] Finished scanAndCreateDashboardsForUser for user:", userId);
}

async function processDb(
  userId,
  username,
  dbHost,
  dbPort,
  dbUser,
  dbPass,
  dbName,
  dsUid,
  grafanaUrl,
  grafanaKey,
  slackToken,
  slackChan,
  teamsWebhook,
  reportType
) {
  const userDbConfig = {
    host: dbHost,
    port: parseInt(dbPort),
    user: dbUser,
    password: dbPass,
    database: dbName,
    connectionTimeoutMillis: parseInt(process.env.DB_POOL_TIMEOUT) || 5000,
    max: parseInt(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 10000,
    allowExitOnIdle: true,
    ssl: process.env.DB_SSL === 'true'
  };

  const client = new Client(userDbConfig);
  try {
    console.log(`[DEBUG] Connecting to database: ${dbName}`);
    await client.connect();
    console.log('[DEBUG] Successfully connected to database');

    const tableResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);

    console.log(`[DEBUG] Found ${tableResult.rows.length} tables in ${dbName}`);

    for (const row of tableResult.rows) {
      const tableName = row.table_name;
      console.log(`[DEBUG] Processing table: ${tableName} for user ${username}`);

      try {
        const existingDash = await pool.query(
          `SELECT id FROM dashboard${reportType.toLowerCase()} WHERE user_id = $1 AND table_name = $2`,
          [userId, tableName]
        );

        if (existingDash.rows.length > 0) {
          console.log(`[DEBUG] Dashboard already exists for table=${tableName}, skipping.`);
          continue;
        }

        const dashboardUrl = await createDashboardFromTemplate(
          tableName,
          dsUid,
          grafanaUrl,
          grafanaKey,
          reportType.toLowerCase()
        );

        if (!dashboardUrl) {
          throw new Error('Failed to create dashboard - no URL returned');
        }

        console.log(`[DEBUG] Created dashboard URL: ${dashboardUrl}`);

        const dashInsert = await pool.query(`
          INSERT INTO dashboard${reportType.toLowerCase()} 
          (user_id, username, table_name, dashboard_url, app_user_id, app_username)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [userId, username, tableName, dashboardUrl, userId, username]);

        let gifPath = null;
        try {
          gifPath = await captureGrafanaGIF(dashboardUrl, grafanaKey);
          console.log(`[DEBUG] Captured GIF path=${gifPath}`);
        } catch (gifError) {
          console.error(`[DEBUG] Error capturing GIF: ${gifError.message}`);
        }

        if (gifPath) {
          await pool.query(`
            UPDATE dashboard${reportType.toLowerCase()}
            SET local_snapshot_url = $1
            WHERE id = $2
          `, [gifPath, dashInsert.rows[0].id]);
        }

        if (slackToken && slackChan) {
          await notificationService.postDashboardLinkToSlack(slackToken, slackChan, dashboardUrl, tableName, username);
        }

        if (teamsWebhook) {
          await notificationService.postDashboardLinkToTeams(teamsWebhook, dashboardUrl, tableName, username);
        }

      } catch (tableError) {
        console.error(`[ERROR] Failed to process table ${tableName}:`, tableError);
      }
    }

  } catch (error) {
    console.error(`[ERROR] Error in processDb:`, error);
    throw error;
  } finally {
    try {
      await client.end();
    } catch (err) {
      console.error('[ERROR] Error closing database connection:', err);
    }
  }
}

async function processReportsDb(
  userId,
  username,
  dbHost,
  dbPort,
  dbUser,
  dbPass,
  dbName,
  dsUid,
  grafanaUrl,
  grafanaKey,
  slackToken,
  slackChan,
  teamsWebhook
) {
  const userDbConfig = {
    host: dbHost,
    port: parseInt(dbPort),
    user: dbUser,
    password: dbPass,
    database: dbName,
    connectionTimeoutMillis: parseInt(process.env.DB_POOL_TIMEOUT) || 5000,
    max: parseInt(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 10000,
    allowExitOnIdle: true,
    ssl: process.env.DB_SSL === 'true'
  };

  const client = new Client(userDbConfig);
  try {
    await client.connect();
    console.log('[DEBUG] Successfully connected to reports database');

    await processSingleTableDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook);
    await processComparisonDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook);
    await processRunCompareDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook);

  } catch (error) {
    console.error(`[ERROR] Error in processReportsDb:`, error);
    throw error;
  } finally {
    try {
      await client.end();
    } catch (err) {
      console.error('[ERROR] Error closing database connection:', err);
    }
  }
}

async function processSingleTableDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook) {
  const tableResult = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
  `);

  console.log(`[DEBUG] Found ${tableResult.rows.length} tables in ${dbName}`);

  for (const row of tableResult.rows) {
    const tableName = row.table_name;
    console.log(`[DEBUG] Processing table: ${tableName} for user ${username}`);

    const existingDash = await pool.query(
      `SELECT id FROM dashboardreports WHERE user_id = $1 AND table_name = $2`,
      [userId, tableName]
    );

    if (existingDash.rows.length > 0) {
      console.log(`[DEBUG] Dashboard already exists for table=${tableName}, skipping.`);
      continue;
    }

    const templateConfig = TEMPLATE_MAPPING.find(({ pattern, type }) => 
      pattern.test(tableName) && ['qor', 'delay-stack', 'errors', 'skew'].includes(type)
    );

    if (!templateConfig) {
      console.log(`[DEBUG] No single-table template found for table=${tableName}, skipping.`);
      continue;
    }

    try {
      const replacements = templateConfig.getReplacements(tableName);

      if (templateConfig.type === 'qor') {
        const runNumber = tableName.match(/_g(\d+)/i)[1];
        const suffix = tableName.includes('_csv') ? '_csv' : '';
        const timeTable = `time${runNumber}${suffix}`;
        const drcTable = `drc${runNumber}${suffix}`;

        if (!(await tableExists(client, timeTable)) || !(await tableExists(client, drcTable))) {
          console.log(`[DEBUG] Missing required tables for ${tableName}, skipping.`);
          continue;
        }
      }

      const dashboardUrl = await createDynamicDashboardFromTemplate(
        tableName,
        dsUid,
        grafanaUrl,
        grafanaKey,
        templateConfig,
        replacements
      );

      if (!dashboardUrl) {
        throw new Error('Failed to create dashboard - no URL returned');
      }

      console.log(`[DEBUG] Created dashboard URL: ${dashboardUrl}`);

      const dashInsert = await pool.query(`
        INSERT INTO dashboardreports 
        (user_id, username, table_name, dashboard_url, app_user_id, app_username)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [userId, username, tableName, dashboardUrl, userId, username]);

      let gifPath = null;
      try {
        gifPath = await captureGrafanaGIF(dashboardUrl, grafanaKey);
        console.log(`[DEBUG] Captured GIF path=${gifPath}`);
      } catch (gifError) {
        console.error(`[DEBUG] Error capturing GIF: ${gifError.message}`);
      }

      if (gifPath) {
        await pool.query(`
          UPDATE dashboardreports
          SET local_snapshot_url = $1
          WHERE id = $2
        `, [gifPath, dashInsert.rows[0].id]);
      }

      if (slackToken && slackChan) {
        await notificationService.postDashboardLinkToSlack(slackToken, slackChan, dashboardUrl, tableName, username);
      }

      if (teamsWebhook) {
        await notificationService.postDashboardLinkToTeams(teamsWebhook, dashboardUrl, tableName, username);
      }

    } catch (tableError) {
      console.error(`[ERROR] Failed to process table ${tableName}:`, tableError);
    }
  }
}

async function processComparisonDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook) {
  const tableResult = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    AND table_name ~* '_(cts|route)\\d+(_csv)?$'
  `);

  const runMap = new Map();
  tableResult.rows.forEach(row => {
    const match = row.table_name.match(/(.*)_(cts|route)(\d+)(?:_csv)?$/i);
    if (match) {
      const [_, prefix, type, run] = match;
      const key = `run${run}`;
      if (!runMap.has(key)) runMap.set(key, { cts: null, route: null, prefix });
      runMap.get(key)[type.toLowerCase()] = row.table_name;
    }
  });

  for (const [runKey, { cts, route, prefix }] of runMap) {
    if (cts && route) {
      const tableName = `${runKey}-compare`;
      const existingDash = await pool.query(
        `SELECT id FROM dashboardreports WHERE user_id = $1 AND table_name = $2`,
        [userId, tableName]
      );

      if (existingDash.rows.length > 0) {
        console.log(`[DEBUG] Comparison dashboard already exists for ${runKey}, skipping.`);
        continue;
      }

      try {
        // Process delay-compare
        const delayConfig = TEMPLATE_MAPPING.find(t => t.type === 'delay-compare');
        const delayReplacements = delayConfig.getReplacements(null, cts, route, runKey.replace('run', ''), prefix);
        const delayDashboardUrl = await createDynamicDashboardFromTemplate(
          tableName,
          dsUid,
          grafanaUrl,
          grafanaKey,
          delayConfig,
          delayReplacements
        );

        const delayInsert = await pool.query(`
          INSERT INTO dashboardreports 
          (user_id, username, table_name, dashboard_url, app_user_id, app_username)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [userId, username, `${tableName}-delay`, delayDashboardUrl, userId, username]);

        let delayGifPath = null;
        try {
          delayGifPath = await captureGrafanaGIF(delayDashboardUrl, grafanaKey);
          console.log(`[DEBUG] Captured delay-compare GIF path=${delayGifPath}`);
        } catch (gifError) {
          console.error(`[DEBUG] Error capturing delay-compare GIF: ${gifError.message}`);
        }

        if (delayGifPath) {
          await pool.query(`
            UPDATE dashboardreports
            SET local_snapshot_url = $1
            WHERE id = $2
          `, [delayGifPath, delayInsert.rows[0].id]);
        }

        if (slackToken && slackChan) {
          await notificationService.postDashboardLinkToSlack(slackToken, slackChan, delayDashboardUrl, `${tableName}-delay`, username);
        }

        if (teamsWebhook) {
          await notificationService.postDashboardLinkToTeams(teamsWebhook, delayDashboardUrl, `${tableName}-delay`, username);
        }

        // Process slack-compare
        const slackConfig = TEMPLATE_MAPPING.find(t => t.type === 'slack-compare');
        const slackReplacements = slackConfig.getReplacements(null, cts, route, runKey.replace('run', ''), prefix);
        const slackDashboardUrl = await createDynamicDashboardFromTemplate(
          tableName,
          dsUid,
          grafanaUrl,
          grafanaKey,
          slackConfig,
          slackReplacements
        );

        const slackInsert = await pool.query(`
          INSERT INTO dashboardreports 
          (user_id, username, table_name, dashboard_url, app_user_id, app_username)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [userId, username, `${tableName}-slack`, slackDashboardUrl, userId, username]);

        let slackGifPath = null;
        try {
          slackGifPath = await captureGrafanaGIF(slackDashboardUrl, grafanaKey);
          console.log(`[DEBUG] Captured slack-compare GIF path=${slackGifPath}`);
        } catch (gifError) {
          console.error(`[DEBUG] Error capturing slack-compare GIF: ${gifError.message}`);
        }

        if (slackGifPath) {
          await pool.query(`
            UPDATE dashboardreports
            SET local_snapshot_url = $1
            WHERE id = $2
          `, [slackGifPath, slackInsert.rows[0].id]);
        }

        if (slackToken && slackChan) {
          await notificationService.postDashboardLinkToSlack(slackToken, slackChan, slackDashboardUrl, `${tableName}-slack`, username);
        }

        if (teamsWebhook) {
          await notificationService.postDashboardLinkToTeams(teamsWebhook, slackDashboardUrl, `${tableName}-slack`, username);
        }

      } catch (error) {
        console.error(`[ERROR] Failed to process comparison for ${runKey}:`, error);
      }
    }
  }
}

async function processRunCompareDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook) {
  const tableResult = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    AND table_name ~* '^run\\d+_g\\d+(?:_csv)?$'
  `);

  const runs = tableResult.rows
    .map(r => {
      const match = r.table_name.match(/^run(\d+)_g\1(?:_csv)?$/i);
      return match ? { run: match[1], suffix: r.table_name.includes('_csv') ? '_csv' : '' } : null;
    })
    .filter(Boolean)
    .sort((a, b) => parseInt(a.run) - parseInt(b.run));

  const pairs = [];
  for (let i = 0; i < runs.length - 1; i++) {
    const pairKey = `run${runs[i].run}-vs-run${runs[i + 1].run}`;
    const existingDash = await pool.query(
      `SELECT id FROM dashboardreports WHERE user_id = $1 AND table_name = $2`,
      [userId, pairKey]
    );

    if (existingDash.rows.length === 0) {
      pairs.push([runs[i], runs[i + 1]]);
    } else {
      console.log(`[DEBUG] Run comparison dashboard already exists for ${pairKey}, skipping.`);
    }
  }

  for (const pair of pairs) {
    const [runA, runB] = pair;
    const { run: r1, suffix: s1 } = runA;
    const { run: r2, suffix: s2 } = runB;
    const pairKey = `run${r1}-vs-run${r2}`;

    console.log(`[DEBUG] Processing run comparison: ${pairKey}`);

    const templateConfig = TEMPLATE_MAPPING.find(t => t.type === 'run-compare');
    const replacements = templateConfig.getReplacements(null, r1, r2, s1, s2);

    const requiredTables = [
      replacements['{{RUN_TABLE}}'],
      replacements['{{NEXT_RUN_TABLE}}'],
      replacements['{{RUN_POWER_TABLE}}'],
      replacements['{{NEXT_RUN_POWER_TABLE}}'],
      replacements['{{RUN_COMPARE_TABLE}}'],
      replacements['{{NEXT_RUN_COMPARE_TABLE}}'],
      replacements['{{DRC_TABLE}}'],
      replacements['{{NEXT_DRC_TABLE}}']
    ];

    let allTablesExist = true;
    for (const table of requiredTables) {
      if (!(await tableExists(client, table))) {
        console.log(`[DEBUG] Missing table ${table} for run comparison ${pairKey}, skipping.`);
        allTablesExist = false;
        break;
      }
    }

    if (!allTablesExist) {
      continue;
    }

    try {
      const dashboardUrl = await createDynamicDashboardFromTemplate(
        pairKey,
        dsUid,
        grafanaUrl,
        grafanaKey,
        templateConfig,
        replacements
      );

      if (!dashboardUrl) {
        throw new Error('Failed to create run-compare dashboard - no URL returned');
      }

      console.log(`[DEBUG] Created run-compare dashboard URL: ${dashboardUrl}`);

      const dashInsert = await pool.query(`
        INSERT INTO dashboardreports 
        (user_id, username, table_name, dashboard_url, app_user_id, app_username)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [userId, username, pairKey, dashboardUrl, userId, username]);

      let gifPath = null;
      try {
        gifPath = await captureGrafanaGIF(dashboardUrl, grafanaKey);
        console.log(`[DEBUG] Captured run-compare GIF path=${gifPath}`);
      } catch (gifError) {
        console.error(`[DEBUG] Error capturing run-compare GIF: ${gifError.message}`);
      }

      if (gifPath) {
        await pool.query(`
          UPDATE dashboardreports
          SET local_snapshot_url = $1
          WHERE id = $2
        `, [gifPath, dashInsert.rows[0].id]);
      }

      if (slackToken && slackChan) {
        await notificationService.postDashboardLinkToSlack(slackToken, slackChan, dashboardUrl, `Run Comparison: ${pairKey}`, username);
      }

      if (teamsWebhook) {
        await notificationService.postDashboardLinkToTeams(teamsWebhook, dashboardUrl, `Run Comparison: ${pairKey}`, username);
      }

    } catch (error) {
      console.error(`[ERROR] Failed to process run comparison ${pairKey}:`, error);
    }
  }
}

async function createDashboardFromTemplate(tableName, dataSourceUid, grafanaUrl, grafanaKey, reportType) {
  try {
    console.log('[DEBUG] Creating dashboard from template:', {
      tableName,
      dataSourceUid,
      grafanaUrl,
      reportType
    });

    let template;
    if (reportType === 'timing') {
      template = templates.timing;
    } else if (reportType === 'qor') {
      template = templates.qor;
    } else if (reportType === 'drc') {
      template = templates.drc;
    } else {
      throw new Error('Invalid report type');
    }

    const dashboard = replaceAllPlaceholders(template, dataSourceUid, {}, tableName);
    dashboard.uid = randomUid();
    dashboard.id = null;
    dashboard.title = `${reportType.toUpperCase()} Dashboard: ${tableName} (${Date.now()})`;
    const payload = { dashboard, overwrite: true, folderId: 0 };
    
    console.log('[DEBUG] Sending dashboard creation request to Grafana');
    const headers = { 
      "Content-Type": "application/json", 
      Authorization: `Bearer ${grafanaKey}` 
    };
    
    const resp = await axios.post(`${grafanaUrl}/api/dashboards/db`, payload, { headers });
    
    if (!resp.data || !resp.data.url) {
      console.error('[DEBUG] Grafana response missing URL:', resp.data);
      throw new Error('Grafana dashboard creation failed - no URL returned');
    }

    const fullUrl = grafanaUrl + resp.data.url;
    console.log('[DEBUG] Dashboard created successfully:', fullUrl);
    return fullUrl;
  } catch (err) {
    console.error("[DEBUG] Error creating dashboard from template:", err);
    throw err;
  }
}

async function createDynamicDashboardFromTemplate(tableName, dataSourceUid, grafanaUrl, grafanaKey, templateConfig, replacements) {
  try {
    console.log('[DEBUG] Creating dynamic dashboard from template:', {
      tableName,
      dataSourceUid,
      grafanaUrl,
      templateType: templateConfig.type
    });

    const dashboard = replaceAllPlaceholders(templateConfig.template, dataSourceUid, replacements);
    dashboard.uid = `${templateConfig.type}-${crypto.createHash('sha256')
      .update(replacements.identifier)
      .digest('hex')
      .substring(0, 10)}`;
    dashboard.title = `${templateConfig.type.toUpperCase()} Dashboard: ${replacements.titleSuffix}`;

    const payload = { dashboard, overwrite: true, folderId: 0 };
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${grafanaKey}`
    };

    const resp = await axios.post(`${grafanaUrl}/api/dashboards/db`, payload, { headers });

    if (!resp.data || !resp.data.url) {
      console.error('[DEBUG] Grafana response missing URL:', resp.data);
      throw new Error('Grafana dashboard creation failed - no URL returned');
    }

    const fullUrl = grafanaUrl + resp.data.url;
    console.log('[DEBUG] Dynamic dashboard created successfully:', fullUrl);
    return fullUrl;
  } catch (err) {
    console.error("[DEBUG] Error creating dynamic dashboard:", err);
    throw err;
  }
}

function randomUid() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let u = "";
  for (let i = 0; i < 8; i++) {
    u += chars[Math.floor(Math.random() * chars.length)];
  }
  return u;
}

const GIF_CONFIG = {
  frameDelay: parseInt(process.env.CAPTURE_FRAME_DELAY) || 500,
  scrollDistance: 100,
  width: parseInt(process.env.CAPTURE_WIDTH) || 1920,
  height: parseInt(process.env.CAPTURE_HEIGHT) || 1080,
  frames: parseInt(process.env.CAPTURE_FRAMES) || 10,
  timeout: parseInt(process.env.CAPTURE_TIMEOUT) || 120000
};

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
    });
  });
}

async function captureGrafanaGIF(dashboardUrl, grafanaKey) {
  try {
    console.log("[DEBUG] Starting GIF capture for URL:", dashboardUrl);
    
    if (!grafanaKey) {
      throw new Error('GRAFANA_API_KEY not provided for GIF capture');
    }
    
    const gifDir = path.join(__dirname, "..", process.env.GIF_CAPTURE_DIR || "gif_captures");
    if (!fs.existsSync(gifDir)) {
      fs.mkdirSync(gifDir, { recursive: true });
    }
    const gifPath = path.join(gifDir, `dashboard_${Date.now()}.gif`);

    console.log("[DEBUG] Launching Puppeteer...");
    const browser = await puppeteer.launch({
      headless: true,
      defaultViewport: { 
        width: GIF_CONFIG.width,
        height: GIF_CONFIG.height
      },
      ignoreHTTPSErrors: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-web-security",
        "--disable-features=IsolateOrigins",
        "--disable-site-isolation-trials",
        "--disable-features=BlockInsecurePrivateNetworkRequests",
        "--disable-dev-shm-usage"
      ]
    });

    const page = await browser.newPage();
    
    await page.setExtraHTTPHeaders({ Authorization: `Bearer ${grafanaKey}` });
    await page.setDefaultNavigationTimeout(GIF_CONFIG.timeout);

    console.log("[DEBUG] Navigating to dashboard URL:", dashboardUrl);
    await page.goto(dashboardUrl, { waitUntil: "networkidle0" });

    console.log("[DEBUG] Auto-scrolling to load all panels...");
    await autoScroll(page);

    console.log("[DEBUG] Taking multiple screenshots to create GIF...");
    const firstScreenshot = await page.screenshot();
    const { width, height } = await sharp(firstScreenshot).metadata();
    
    const frames = [];
    const numFrames = GIF_CONFIG.frames;
    const frameDelay = GIF_CONFIG.frameDelay;

    for (let i = 0; i < numFrames; i++) {
      console.log(`[DEBUG] Capturing frame ${i + 1}/${numFrames}`);
      const buffer = await page.screenshot();
      const resized = await sharp(buffer).resize(width, height).toBuffer();
      frames.push({ input: resized, delay: frameDelay });
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
    }

    console.log("[DEBUG] Creating GIF from frames...");
    await sharp({
      create: { 
        width, 
        height, 
        channels: 4, 
        background: { r: 255, g: 255, b: 255, alpha: 1 } 
      }
    })
      .gif({ delay: frameDelay, loop: 0 })
      .composite(frames)
      .toFile(gifPath);

    await browser.close();
    console.log("[DEBUG] GIF created successfully:", gifPath);
    return gifPath;
  } catch (error) {
    console.error("[DEBUG] Error capturing Grafana GIF:", error);
    return null;
  }
}

module.exports = { scanAndCreateDashboardsForUser };