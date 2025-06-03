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

const templates = {
  skew: require("../grafana_templates/skew_template.json"),
  errors: require("../grafana_templates/errors_template.json"),
  delay_stacking: require("../grafana_templates/delay_stacking_template.json"),
  delay_compare: require("../grafana_templates/delay_comparison_template.json"),
  slack_compare: require("../grafana_templates/slack_comparison_template.json"),
  qor_pnr: require("../grafana_templates/QOR_PNR_template.json"),
  run_compare: require("../grafana_templates/Run_comparison_template.json"),
};

const TEMPLATE_MAPPING = [
  {
    patterns: [
      /^(.*)_grafana_pd(?:_csv)?$/i,
      /^(.*)_pathgroups_pd(?:_csv)?$/i,
      /^(.*)_violations_pd(?:_csv)?$/i,
    ],
    template: templates.qor_pnr,
    type: "qor",
    priority: 0,
    getReplacements: async (client, blockName, suffix) => {
      const grafanaTable = `${blockName}_grafana_pd${suffix}`;
      const pathgroupsTable = `${blockName}_pathgroups_pd${suffix}`;
      const violationsTable = `${blockName}_violations_pd${suffix}`;

      const grafanaTableExists = await tableExists(client, grafanaTable);
      const pathgroupsTableExists = await tableExists(client, pathgroupsTable);
      const violationsTableExists = await tableExists(client, violationsTable);

      return {
        "{{RUN_TABLE}}": grafanaTableExists ? grafanaTable : "placeholder_run_table",
        "{{TIME_TABLE}}": pathgroupsTableExists ? pathgroupsTable : "placeholder_time_table",
        "{{DRC_TABLE}}": violationsTableExists ? violationsTable : "placeholder_drc_table",
        identifier: `qor-${blockName}`,
        titleSuffix: `${blockName} QoR`,
      };
    },
  },
  {
    pattern: /(early_|late_)?(.*(in2reg|in2out|reg2out|reg2mem))/i,
    template: templates.delay_stacking,
    type: "delay-stack",
    priority: 1,
    getReplacements: (tableName) => {
      const pathType = tableName.match(/(in2reg|in2out|reg2out|reg2mem)/i)[0];
      return {
        "{{TABLE_NAME}}": tableName,
        identifier: tableName,
        titleSuffix: `${pathType.toUpperCase()} Paths`,
      };
    },
  },
  {
    pattern: /error/i,
    template: templates.errors,
    type: "errors",
    priority: 2,
    getReplacements: (tableName) => ({
      "{{TABLE_NAME}}": tableName,
      identifier: `errors-${tableName}`,
      titleSuffix: `Error Analysis - ${tableName}`,
    }),
  },
  {
    pattern: /skew/i,
    template: templates.skew,
    type: "skew",
    priority: 3,
    getReplacements: (tableName) => ({
      "{{TABLE_NAME}}": tableName,
      identifier: `skew-${tableName}`,
      titleSuffix: `Clock Skew Analysis - ${tableName}`,
    }),
  },
  {
    pattern: /_(cts|route)\d+(_csv)?$/i,
    template: templates.delay_compare,
    type: "delay-compare",
    priority: 4,
    getReplacements: (tableName, ctsTable, routeTable, runNumber, prefix) => ({
      "{{RUN_NUMBER}}": runNumber,
      "{{CTS_TABLE}}": ctsTable || `placeholder_cts_table_${runNumber}`,
      "{{ROUTE_TABLE}}": routeTable || `placeholder_route_table_${runNumber}`,
      identifier: `run${runNumber}-delay-compare`,
      titleSuffix: `${prefix} Run ${runNumber}`,
    }),
  },
  {
    pattern: /_(cts|route)\d+(_csv)?$/i,
    template: templates.slack_compare,
    type: "slack-compare",
    priority: 5,
    getReplacements: (tableName, ctsTable, routeTable, runNumber, prefix) => ({
      "{{RUN_NUMBER}}": runNumber,
      "{{CTS_TABLE}}": ctsTable || `placeholder_cts_table_${runNumber}`,
      "{{ROUTE_TABLE}}": routeTable || `placeholder_route_table_${runNumber}`,
      identifier: `run${runNumber}-slack-compare`,
      titleSuffix: `${prefix} Run ${runNumber}`,
    }),
  },
  {
    pattern: /^run\d*_g\d+(?:_csv)?$/i,
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
      titleSuffix: `Run ${runNumber} vs Run ${nextRunNumber}`,
    }),
  },
].sort((a, b) => a.priority - b.priority);

// Reusable function to replace all placeholders in a template
function replaceAllPlaceholders(obj, dataSourceUid, replacements = {}, tableName = null) {
  const newObj = JSON.parse(JSON.stringify(obj)); // Deep copy to avoid mutating original
  const placeholderPatterns = [
    /PLACEHOLDER_DATASOURCE_UID/g,
    /\${DATASOURCE_UID}/g,
    /{{DATASOURCE_UID}}/g,
  ];

  const replaceInObject = (current) => {
    for (const key in current) {
      if (typeof current[key] === "string") {
        // Replace data source UID placeholders
        placeholderPatterns.forEach((pattern) => {
          current[key] = current[key].replace(pattern, dataSourceUid);
        });
        // Replace other placeholders from replacements object
        Object.entries(replacements).forEach(([placeholder, value]) => {
          current[key] = current[key].replace(new RegExp(placeholder, "g"), value);
        });
        // Replace table name if provided
        if (tableName) {
          current[key] = current[key].replace(/PLACEHOLDER_TABLE_NAME/g, tableName);
        }
        // Handle placeholder tables for all templates
        const placeholderTables = [
          "placeholder_run_table",
          "placeholder_time_table",
          "placeholder_drc_table",
          "placeholder_cts_table",
          "placeholder_route_table",
          "placeholder_run_compare_table",
          "placeholder_next_run_table",
          "placeholder_run_power_table",
          "placeholder_next_run_power_table",
          "placeholder_next_run_compare_table",
          "placeholder_next_drc_table",
        ];
        for (const placeholder of placeholderTables) {
          if (current[key].includes(placeholder)) {
            current[key] = current[key].replace(
              new RegExp(`FROM\\s+${placeholder}\\b`, "g"),
              `FROM (SELECT 1 WHERE FALSE) AS ${placeholder}`
            );
          }
        }
      } else if (typeof current[key] === "object" && current[key] !== null) {
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

    const dashboardTables = ["dashboardtiming", "dashboardqor", "dashboarddrc", "dashboardreports"];
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
  // Acquire advisory lock to prevent concurrent executions
  const lockKey = `lock:dashboard:${userId}`;
  const isLocked = await pool.query(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [userId]
  );
  if (!isLocked.rows[0].locked) {
    console.log(`[DEBUG] User ${userId} is already being processed, skipping.`);
    return;
  }

  try {
    await verifyDatabaseSchema();
    console.log("[DEBUG] Starting scanAndCreateDashboardsForUser for user:", userId);

    let username;
    try {
      const userResult = await pool.query("SELECT username FROM users WHERE id = $1", [userId]);
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
    const timingReportDb = getVal("DB_NAME_TIMING_REPORT");
    const qorDb = getVal("DB_NAME_QOR");
    const drcDb = getVal("DB_NAME_DRC");
    const reportsDb = getVal("DB_NAME_REPORTS");
    const slackToken = getVal("SLACK_BOT_TOKEN");
    const slackChan = getVal("SLACK_CHANNEL_ID");
    const teamsWebhook = getVal("TEAMS_WEBHOOK_URL");
    const grafanaKey = getVal("GRAFANA_API_KEY") || process.env.GRAFANA_API_KEY;
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
      console.error("[ERROR] GRAFANA_API_KEY is required in credentials or environment variables");
      return;
    }

    console.log("[DEBUG] slackToken:", slackToken ? "REDACTED" : "NOT SET");
    console.log("[DEBUG] slackChan:", slackChan);
    console.log("[DEBUG] teamsWebhook:", teamsWebhook ? "REDACTED" : "NOT SET");
    console.log("[DEBUG] grafanaUrl:", grafanaUrl);

    const dashboardUrls = [];

    if (timingReportDb && timingUid) {
      console.log("[DEBUG] Processing timing-report DB:", timingReportDb);
      const urls = await processTimingReportDb(
        userId,
        username,
        dbHost,
        dbPort,
        dbUser,
        dbPass,
        timingReportDb,
        timingUid,
        grafanaUrl,
        grafanaKey,
        slackToken,
        slackChan,
        teamsWebhook
      );
      dashboardUrls.push(...urls);
    } else {
      console.log("[DEBUG] Skipping timing-report DB because creds missing or incomplete.");
    }

    if (qorDb && qorUid) {
      console.log("[DEBUG] Processing QOR DB:", qorDb);
      const urls = await processDb(
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
      dashboardUrls.push(...urls);
    } else {
      console.log("[DEBUG] Skipping QOR DB because creds missing or incomplete.");
    }

    if (drcDb && drcUid) {
      console.log("[DEBUG] Processing DRC DB:", drcDb);
      const urls = await processDb(
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
      dashboardUrls.push(...urls);
    } else {
      console.log("[DEBUG] Skipping DRC DB because creds missing or incomplete.");
    }

    if (reportsDb && reportsUid) {
      console.log("[DEBUG] Processing REPORTS DB:", reportsDb);
      const urls = await processReportsDb(
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
      dashboardUrls.push(...urls);
    } else {
      console.log("[DEBUG] Skipping REPORTS DB because creds missing or incomplete.");
    }

    console.log("[DEBUG] Finished scanAndCreateDashboardsForUser for user:", userId);
  } finally {
    // Release the advisory lock
    await pool.query(`SELECT pg_advisory_unlock($1)`, [userId]);
  }
}

async function processTimingReportDb(
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
    ssl: process.env.DB_SSL === "true",
  };

  const client = new Client(userDbConfig);
  const dashboardUrls = [];
  try {
    console.log(`[DEBUG] Connecting to timing-report database: ${dbName} for user ${username}`);
    await client.connect();
    console.log("[DEBUG] Successfully connected to database");

    const singleUrls = await processSingleTableTimingDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook);
    const compareUrls = await processComparisonTimingDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook);
    dashboardUrls.push(...singleUrls.map(url => ({ ...url, type: 'timing' })), ...compareUrls.map(url => ({ ...url, type: 'timing' })));
  } catch (error) {
    console.error(`[ERROR] Error in processTimingReportDb:`, error);
    throw error;
  } finally {
    try {
      await client.end();
    } catch (err) {
      console.error("[ERROR] Error closing database connection:", err);
    }
  }
  return dashboardUrls;
}

async function processSingleTableTimingDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook) {
  const tableResult = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
  `);

  console.log(`[DEBUG] Found ${tableResult.rows.length} tables in ${dbName}`);
  const dashboardUrls = [];

  for (const row of tableResult.rows) {
    const tableName = row.table_name;
    console.log(`[DEBUG] Processing table: ${tableName} for user ${username}`);

    const existingDash = await pool.query(
      `SELECT id, dashboard_url FROM dashboardtiming WHERE user_id = $1 AND table_name = $2`,
      [userId, tableName]
    );

    if (existingDash.rows.length > 0) {
      console.log(`[DEBUG] Dashboard already exists for table=${tableName}, skipping.`);
      dashboardUrls.push({ url: existingDash.rows[0].dashboard_url, tableName, type: 'timing' });
      continue;
    }

    const templateConfig = TEMPLATE_MAPPING.find(({ pattern, type }) =>
      pattern?.test(tableName) && ["delay-stack", "errors", "skew"].includes(type)
    );

    if (!templateConfig) {
      console.log(`[DEBUG] No single-table template found for table=${tableName}, skipping.`);
      continue;
    }

    try {
      const replacements = templateConfig.getReplacements(tableName);

      const dashboardUrl = await createDynamicDashboardFromTemplate(
        tableName,
        dsUid,
        grafanaUrl,
        grafanaKey,
        templateConfig,
        replacements,
        slackToken,
        slackChan,
        teamsWebhook
      );

      if (!dashboardUrl) {
        throw new Error("Failed to create dashboard - no URL returned");
      }

      console.log(`[DEBUG] Created dashboard URL: ${dashboardUrl}`);

      const dashInsert = await pool.query(`
        INSERT INTO dashboardtiming 
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
          UPDATE dashboardtiming
          SET local_snapshot_url = $1
          WHERE id = $2
        `, [gifPath, dashInsert.rows[0].id]);
      }

      dashboardUrls.push({ url: dashboardUrl, tableName, type: 'timing' });
    } catch (tableError) {
      console.error(`[ERROR] Failed to process table ${tableName}:`, tableError);
    }
  }
  return dashboardUrls;
}

async function processComparisonTimingDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook) {
  const tableResult = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    AND table_name ~* '_(cts|route)\\d+(_csv)?$'
  `);

  const runMap = new Map();
  tableResult.rows.forEach((row) => {
    const match = row.table_name.match(/(.*)_(cts|route)(\d+)(?:_csv)?$/i);
    if (match) {
      const [_, prefix, type, run] = match;
      const key = `run${run}`;
      if (!runMap.has(key)) runMap.set(key, { cts: null, route: null, prefix });
      runMap.get(key)[type.toLowerCase()] = row.table_name;
    }
  });

  const dashboardUrls = [];

  for (const [runKey, { cts, route, prefix }] of runMap) {
    if (!cts && !route) {
      console.log(`[DEBUG] Skipping ${runKey} as no cts or route table found`);
      continue;
    }
    const tableName = `${runKey}-compare`;
    console.log(`[DEBUG] Processing comparison for ${runKey}`);

    // Process delay-compare
    const delayConfig = TEMPLATE_MAPPING.find((t) => t.type === "delay-compare");
    const delayTableName = `${tableName}-delay`;
    const delayReplacements = delayConfig.getReplacements(null, cts, route, runKey.replace("run", ""), prefix);

    try {
      const existingDelayDash = await pool.query(
        `SELECT id, dashboard_url FROM dashboardtiming WHERE user_id = $1 AND table_name = $2`,
        [userId, delayTableName]
      );

      let delayDashboardUrl;
      let delayInsert;

      if (existingDelayDash.rows.length > 0) {
        // Check if dashboard needs updating due to new or changed tables
        const ctsTableExists = cts ? await tableExists(client, cts) : false;
        const routeTableExists = route ? await tableExists(client, route) : false;

        const needsUpdate =
          (ctsTableExists && delayReplacements["{{CTS_TABLE}}"] === cts && !(await tableExists(client, delayReplacements["{{CTS_TABLE}}"]))) ||
          (routeTableExists && delayReplacements["{{ROUTE_TABLE}}"] === route && !(await tableExists(client, delayReplacements["{{ROUTE_TABLE}}"]))) ||
          (delayReplacements["{{CTS_TABLE}}"].startsWith("placeholder") && ctsTableExists) ||
          (delayReplacements["{{ROUTE_TABLE}}"].startsWith("placeholder") && routeTableExists);

        if (needsUpdate) {
          console.log(`[DEBUG] Updating existing delay-compare dashboard for ${runKey}`);
          delayDashboardUrl = await createDynamicDashboardFromTemplate(
            delayTableName,
            dsUid,
            grafanaUrl,
            grafanaKey,
            delayConfig,
            delayReplacements,
            slackToken,
            slackChan,
            teamsWebhook
          );

          if (!delayDashboardUrl) {
            throw new Error("Failed to update delay-compare dashboard - no URL returned");
          }

          await pool.query(`
            UPDATE dashboardtiming
            SET dashboard_url = $1
            WHERE id = $2
          `, [delayDashboardUrl, existingDelayDash.rows[0].id]);
        } else {
          console.log(`[DEBUG] No update needed for delay-compare ${runKey}, skipping.`);
          dashboardUrls.push({ url: existingDelayDash.rows[0].dashboard_url, tableName: delayTableName, type: 'timing' });
          continue;
        }
      } else {
        // Create new dashboard
        delayDashboardUrl = await createDynamicDashboardFromTemplate(
          delayTableName,
          dsUid,
          grafanaUrl,
          grafanaKey,
          delayConfig,
          delayReplacements,
          slackToken,
          slackChan,
          teamsWebhook
        );

        if (!delayDashboardUrl) {
          throw new Error("Failed to create delay-compare dashboard - no URL returned");
        }

        console.log(`[DEBUG] Created delay-compare dashboard URL: ${delayDashboardUrl}`);

        delayInsert = await pool.query(`
          INSERT INTO dashboardtiming 
          (user_id, username, table_name, dashboard_url, app_user_id, app_username)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [userId, username, delayTableName, delayDashboardUrl, userId, username]);
      }

      let delayGifPath = null;
      try {
        delayGifPath = await captureGrafanaGIF(dashboardUrl, grafanaKey);
        console.log(`[DEBUG] Captured delay-compare GIF path=${delayGifPath}`);
      } catch (gifError) {
        console.error(`[DEBUG] Error capturing delay-compare GIF: ${gifError.message}`);
      }

      if (delayGifPath && delayInsert) {
        await pool.query(`
          UPDATE dashboardtiming
          SET local_snapshot_url = $1
          WHERE id = $2
        `, [delayGifPath, delayInsert.rows[0].id]);
      }

      dashboardUrls.push({ url: delayDashboardUrl, tableName: delayTableName, type: 'timing' });
    } catch (error) {
      console.error(`[ERROR] Failed to process delay-compare for ${runKey}:`, error);
      continue;
    }

    // Process slack-compare
    const slackConfig = TEMPLATE_MAPPING.find((t) => t.type === "slack-compare");
    const slackTableName = `${tableName}-slack`;
    const slackReplacements = slackConfig.getReplacements(null, cts, route, runKey.replace("run", ""), prefix);

    try {
      const existingSlackDash = await pool.query(
        `SELECT id, dashboard_url FROM dashboardtiming WHERE user_id = $1 AND table_name = $2`,
        [userId, slackTableName]
      );

      let slackDashboardUrl;
      let slackInsert;

      if (existingSlackDash.rows.length > 0) {
        // Check if dashboard needs updating due to new or changed tables
        const ctsTableExists = cts ? await tableExists(client, cts) : false;
        const routeTableExists = route ? await tableExists(client, route) : false;

        const needsUpdate =
          (ctsTableExists && slackReplacements["{{CTS_TABLE}}"] === cts && !(await tableExists(client, slackReplacements["{{CTS_TABLE}}"]))) ||
          (routeTableExists && slackReplacements["{{ROUTE_TABLE}}"] === route && !(await tableExists(client, slackReplacements["{{ROUTE_TABLE}}"]))) ||
          (slackReplacements["{{CTS_TABLE}}"].startsWith("placeholder") && ctsTableExists) ||
          (slackReplacements["{{ROUTE_TABLE}}"].startsWith("placeholder") && routeTableExists);

        if (needsUpdate) {
          console.log(`[DEBUG] Updating existing slack-compare dashboard for ${runKey}`);
          slackDashboardUrl = await createDynamicDashboardFromTemplate(
            slackTableName,
            dsUid,
            grafanaUrl,
            grafanaKey,
            slackConfig,
            slackReplacements,
            slackToken,
            slackChan,
            teamsWebhook
          );

          if (!slackDashboardUrl) {
            throw new Error("Failed to update slack-compare dashboard - no URL returned");
          }

          await pool.query(`
            UPDATE dashboardtiming
            SET dashboard_url = $1
            WHERE id = $2
          `, [slackDashboardUrl, existingSlackDash.rows[0].id]);
        } else {
          console.log(`[DEBUG] No update needed for slack-compare ${runKey}, skipping.`);
          dashboardUrls.push({ url: existingSlackDash.rows[0].dashboard_url, tableName: slackTableName, type: 'timing' });
          continue;
        }
      } else {
        // Create new dashboard
        slackDashboardUrl = await createDynamicDashboardFromTemplate(
          slackTableName,
          dsUid,
          grafanaUrl,
          grafanaKey,
          slackConfig,
          slackReplacements,
          slackToken,
          slackChan,
          teamsWebhook
        );

        if (!slackDashboardUrl) {
          throw new Error("Failed to create slack-compare dashboard - no URL returned");
        }

        console.log(`[DEBUG] Created slack-compare dashboard URL: ${slackDashboardUrl}`);

        slackInsert = await pool.query(`
          INSERT INTO dashboardtiming 
          (user_id, username, table_name, dashboard_url, app_user_id, app_username)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [userId, username, slackTableName, slackDashboardUrl, userId, username]);
      }

      let slackGifPath = null;
      try {
        slackGifPath = await captureGrafanaGIF(slackDashboardUrl, grafanaKey);
        console.log(`[DEBUG] Captured slack-compare GIF path=${slackGifPath}`);
      } catch (gifError) {
        console.error(`[DEBUG] Error capturing slack-compare GIF: ${gifError.message}`);
      }

      if (slackGifPath && slackInsert) {
        await pool.query(`
          UPDATE dashboardtiming
          SET local_snapshot_url = $1
          WHERE id = $2
        `, [slackGifPath, slackInsert.rows[0].id]);
      }

      dashboardUrls.push({ url: slackDashboardUrl, tableName: slackTableName, type: 'timing' });
    } catch (error) {
      console.error(`[ERROR] Failed to process slack-compare for ${runKey}:`, error);
    }
  }
  return dashboardUrls;
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
    ssl: process.env.DB_SSL === "true",
  };

  const client = new Client(userDbConfig);
  const dashboardUrls = [];
  try {
    console.log(`[DEBUG] Connecting to ${reportType} database: ${dbName} for user ${username}`);
    await client.connect();
    console.log("[DEBUG] Successfully connected to database");

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
          `SELECT id, dashboard_url FROM dashboard${reportType.toLowerCase()} WHERE user_id = $1 AND table_name = $2`,
          [userId, tableName]
        );

        if (existingDash.rows.length > 0) {
          console.log(`[DEBUG] Dashboard already exists for table=${tableName}, skipping.`);
          dashboardUrls.push({ url: existingDash.rows[0].dashboard_url, tableName, type: reportType.toLowerCase() });
          continue;
        }

        const dashboardUrl = await createDashboardFromTemplate(
          tableName,
          dsUid,
          grafanaUrl,
          grafanaKey,
          reportType.toLowerCase(),
          slackToken,
          slackChan,
          teamsWebhook
        );

        if (!dashboardUrl) {
          throw new Error("Failed to create dashboard - no URL returned");
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

        dashboardUrls.push({ url: dashboardUrl, tableName, type: reportType.toLowerCase() });
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
      console.error("[ERROR] Error closing database connection:", err);
    }
  }
  return dashboardUrls;
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
    ssl: process.env.DB_SSL === "true",
  };

  const client = new Client(userDbConfig);
  const dashboardUrls = [];
  try {
    console.log(`[DEBUG] Connecting to reports database: ${dbName} for user ${username}`);
    await client.connect();
    console.log("[DEBUG] Successfully connected to reports database");

    const singleUrls = await processSingleTableReportsDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook);
    const compareUrls = await processComparisonReportsDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook);
    const runCompareUrls = await processRunCompareDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook);
    dashboardUrls.push(
      ...singleUrls.map(url => ({ ...url, type: 'reports' })),
      ...compareUrls.map(url => ({ ...url, type: 'reports' })),
      ...runCompareUrls.map(url => ({ ...url, type: 'reports' }))
    );
  } catch (error) {
    console.error(`[ERROR] Error in processReportsDb:`, error);
    throw error;
  } finally {
    try {
      await client.end();
    } catch (err) {
      console.error("[ERROR] Error closing database connection:", err);
    }
  }
  return dashboardUrls;
}

async function processSingleTableReportsDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook) {
  const tableResult = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
  `);

  console.log(`[DEBUG] Found ${tableResult.rows.length} tables in ${dbName}`);
  const dashboardUrls = [];
  const processedTables = new Set();

  // Process QoR dashboards for grouped tables
  const blockMap = new Map();
  tableResult.rows.forEach((row) => {
    const tableName = row.table_name;
    let match;
    if ((match = tableName.match(/^(.*)_grafana_pd(?:_csv)?$/i)) ||
        (match = tableName.match(/^(.*)_pathgroups_pd(?:_csv)?$/i)) ||
        (match = tableName.match(/^(.*)_violations_pd(?:_csv)?$/i))) {
      const blockName = match[1];
      const suffix = tableName.includes("_csv") ? "_csv" : "";
      if (!blockMap.has(blockName)) {
        blockMap.set(blockName, { tables: new Set(), suffix });
      }
      blockMap.get(blockName).tables.add(tableName);
    }
  });

  const qorConfig = TEMPLATE_MAPPING.find((t) => t.type === "qor");
  for (const [blockName, { tables, suffix }] of blockMap) {
    const canonicalTableName = `${blockName}_grafana_pd${suffix}`;
    console.log(`[DEBUG] Processing block ${blockName} with tables: ${[...tables].join(", ")}`);

    try {
      const replacements = await qorConfig.getReplacements(client, blockName, suffix);

      const existingDash = await pool.query(
        `SELECT id, dashboard_url FROM dashboardreports WHERE user_id = $1 AND table_name = $2`,
        [userId, canonicalTableName]
      );

      let dashboardUrl;
      let dashInsert;

      if (existingDash.rows.length > 0) {
        // Check if dashboard needs updating due to new or changed tables
        const grafanaTable = `${blockName}_grafana_pd${suffix}`;
        const pathgroupsTable = `${blockName}_pathgroups_pd${suffix}`;
        const violationsTable = `${blockName}_violations_pd${suffix}`;

        const grafanaTableExists = await tableExists(client, grafanaTable);
        const pathgroupsTableExists = await tableExists(client, pathgroupsTable);
        const violationsTableExists = await tableExists(client, violationsTable);

        const needsUpdate =
          (grafanaTableExists && replacements["{{RUN_TABLE}}"] === grafanaTable && !(await tableExists(client, replacements["{{RUN_TABLE}}"]))) ||
          (pathgroupsTableExists && replacements["{{TIME_TABLE}}"] === pathgroupsTable && !(await tableExists(client, replacements["{{TIME_TABLE}}"]))) ||
          (violationsTableExists && replacements["{{DRC_TABLE}}"] === violationsTable && !(await tableExists(client, replacements["{{DRC_TABLE}}"]))) ||
          (replacements["{{RUN_TABLE}}"].startsWith("placeholder") && grafanaTableExists) ||
          (replacements["{{TIME_TABLE}}"].startsWith("placeholder") && pathgroupsTableExists) ||
          (replacements["{{DRC_TABLE}}"].startsWith("placeholder") && violationsTableExists);

        if (needsUpdate) {
          console.log(`[DEBUG] Updating existing dashboard for block=${blockName}`);
          dashboardUrl = await createDynamicDashboardFromTemplate(
            canonicalTableName,
            dsUid,
            grafanaUrl,
            grafanaKey,
            qorConfig,
            replacements,
            slackToken,
            slackChan,
            teamsWebhook
          );

          if (!dashboardUrl) {
            throw new Error("Failed to update dashboard - no URL returned");
          }

          await pool.query(`
            UPDATE dashboardreports
            SET dashboard_url = $1
            WHERE id = $2
          `, [dashboardUrl, existingDash.rows[0].id]);
        } else {
          console.log(`[DEBUG] No update needed for block=${blockName}, skipping.`);
          dashboardUrls.push({ url: existingDash.rows[0].dashboard_url, tableName: canonicalTableName, type: 'reports' });
          tables.forEach((t) => processedTables.add(t));
          continue;
        }
      } else {
        // Create new dashboard
        dashboardUrl = await createDynamicDashboardFromTemplate(
          canonicalTableName,
          dsUid,
          grafanaUrl,
          grafanaKey,
          qorConfig,
          replacements,
          slackToken,
          slackChan,
          teamsWebhook
        );

        if (!dashboardUrl) {
          throw new Error("Failed to create dashboard - no URL returned");
        }

        console.log(`[DEBUG] Created dashboard URL: ${dashboardUrl}`);

        dashInsert = await pool.query(`
          INSERT INTO dashboardreports 
          (user_id, username, table_name, dashboard_url, app_user_id, app_username)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [userId, username, canonicalTableName, dashboardUrl, userId, username]);
      }

      let gifPath = null;
      try {
        gifPath = await captureGrafanaGIF(dashboardUrl, grafanaKey);
        console.log(`[DEBUG] Captured GIF path=${gifPath}`);
      } catch (gifError) {
        console.error(`[DEBUG] Error capturing GIF: ${gifError.message}`);
      }

      if (gifPath && dashInsert) {
        await pool.query(`
          UPDATE dashboardreports
          SET local_snapshot_url = $1
          WHERE id = $2
        `, [gifPath, dashInsert.rows[0].id]);
      }

      dashboardUrls.push({ url: dashboardUrl, tableName: canonicalTableName, type: 'reports' });
      tables.forEach((t) => processedTables.add(t));
    } catch (blockError) {
      console.error(`[ERROR] Failed to process block ${blockName}:`, blockError);
    }
  }

  // Process non-QoR single-table dashboards
  for (const row of tableResult.rows) {
    const tableName = row.table_name;
    if (processedTables.has(tableName)) {
      console.log(`[DEBUG] Table ${tableName} already processed, skipping.`);
      continue;
    }

    console.log(`[DEBUG] Processing table: ${tableName} for user ${username}`);

    const existingDash = await pool.query(
      `SELECT id, dashboard_url FROM dashboardreports WHERE user_id = $1 AND table_name = $2`,
      [userId, tableName]
    );

    if (existingDash.rows.length > 0) {
      console.log(`[DEBUG] Dashboard already exists for table=${tableName}, skipping.`);
      dashboardUrls.push({ url: existingDash.rows[0].dashboard_url, tableName, type: 'reports' });
      continue;
    }

    const templateConfig = TEMPLATE_MAPPING.find(({ pattern, type }) =>
      pattern?.test(tableName) && ["delay-stack", "errors", "skew"].includes(type)
    );

    if (!templateConfig) {
      console.log(`[DEBUG] No single-table template found for table=${tableName}, skipping.`);
      continue;
    }

    try {
      const replacements = templateConfig.getReplacements(tableName);

      const dashboardUrl = await createDynamicDashboardFromTemplate(
        tableName,
        dsUid,
        grafanaUrl,
        grafanaKey,
        templateConfig,
        replacements,
        slackToken,
        slackChan,
        teamsWebhook
      );

      if (!dashboardUrl) {
        throw new Error("Failed to create dashboard - no URL returned");
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

      dashboardUrls.push({ url: dashboardUrl, tableName, type: 'reports' });
    } catch (tableError) {
      console.error(`[ERROR] Failed to process table ${tableName}:`, tableError);
    }
  }
  return dashboardUrls;
}

async function processComparisonReportsDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook) {
  const tableResult = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    AND table_name ~* '_(cts|route)\\d+(_csv)?$'
  `);

  const runMap = new Map();
  tableResult.rows.forEach((row) => {
    const match = row.table_name.match(/(.*)_(cts|route)(\d+)(?:_csv)?$/i);
    if (match) {
      const [_, prefix, type, run] = match;
      const key = `run${run}`;
      if (!runMap.has(key)) runMap.set(key, { cts: null, route: null, prefix });
      runMap.get(key)[type.toLowerCase()] = row.table_name;
    }
  });

  const dashboardUrls = [];

  for (const [runKey, { cts, route, prefix }] of runMap) {
    if (!cts && !route) {
      console.log(`[DEBUG] Skipping ${runKey} as no cts or route table found`);
      continue;
    }
    const tableName = `${runKey}-compare`;
    console.log(`[DEBUG] Processing comparison for ${runKey}`);

    // Process delay-compare
    const delayConfig = TEMPLATE_MAPPING.find((t) => t.type === "delay-compare");
    const delayTableName = `${tableName}-delay`;
    const delayReplacements = delayConfig.getReplacements(null, cts, route, runKey.replace("run", ""), prefix);

    try {
      const existingDelayDash = await pool.query(
        `SELECT id, dashboard_url FROM dashboardreports WHERE user_id = $1 AND table_name = $2`,
        [userId, delayTableName]
      );

      let delayDashboardUrl;
      let delayInsert;

      if (existingDelayDash.rows.length > 0) {
        // Check if dashboard needs updating due to new or changed tables
        const ctsTableExists = cts ? await tableExists(client, cts) : false;
        const routeTableExists = route ? await tableExists(client, route) : false;

        const needsUpdate =
          (ctsTableExists && delayReplacements["{{CTS_TABLE}}"] === cts && !(await tableExists(client, delayReplacements["{{CTS_TABLE}}"]))) ||
          (routeTableExists && delayReplacements["{{ROUTE_TABLE}}"] === route && !(await tableExists(client, delayReplacements["{{ROUTE_TABLE}}"]))) ||
          (delayReplacements["{{CTS_TABLE}}"].startsWith("placeholder") && ctsTableExists) ||
          (delayReplacements["{{ROUTE_TABLE}}"].startsWith("placeholder") && routeTableExists);

        if (needsUpdate) {
          console.log(`[DEBUG] Updating existing delay-compare dashboard for ${runKey}`);
          delayDashboardUrl = await createDynamicDashboardFromTemplate(
            delayTableName,
            dsUid,
            grafanaUrl,
            grafanaKey,
            delayConfig,
            delayReplacements,
            slackToken,
            slackChan,
            teamsWebhook
          );

          if (!delayDashboardUrl) {
            throw new Error("Failed to update delay-compare dashboard - no URL returned");
          }

          await pool.query(`
            UPDATE dashboardreports
            SET dashboard_url = $1
            WHERE id = $2
          `, [delayDashboardUrl, existingDelayDash.rows[0].id]);
        } else {
          console.log(`[DEBUG] No update needed for delay-compare ${runKey}, skipping.`);
          dashboardUrls.push({ url: existingDelayDash.rows[0].dashboard_url, tableName: delayTableName, type: 'reports' });
          continue;
        }
      } else {
        // Create new dashboard
        delayDashboardUrl = await createDynamicDashboardFromTemplate(
          delayTableName,
          dsUid,
          grafanaUrl,
          grafanaKey,
          delayConfig,
          delayReplacements,
          slackToken,
          slackChan,
          teamsWebhook
        );

        if (!delayDashboardUrl) {
          throw new Error("Failed to create delay-compare dashboard - no URL returned");
        }

        console.log(`[DEBUG] Created delay-compare dashboard URL: ${delayDashboardUrl}`);

        delayInsert = await pool.query(`
          INSERT INTO dashboardreports 
          (user_id, username, table_name, dashboard_url, app_user_id, app_username)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [userId, username, delayTableName, delayDashboardUrl, userId, username]);
      }

      let delayGifPath = null;
      try {
        delayGifPath = await captureGrafanaGIF(dashboardUrl, grafanaKey);
        console.log(`[DEBUG] Captured delay-compare GIF path=${delayGifPath}`);
      } catch (gifError) {
        console.error(`[DEBUG] Error capturing delay-compare GIF: ${gifError.message}`);
      }

      if (delayGifPath && delayInsert) {
        await pool.query(`
          UPDATE dashboardreports
          SET local_snapshot_url = $1
          WHERE id = $2
        `, [delayGifPath, delayInsert.rows[0].id]);
      }

      dashboardUrls.push({ url: delayDashboardUrl, tableName: delayTableName, type: 'reports' });
    } catch (error) {
      console.error(`[ERROR] Failed to process delay-compare for ${runKey}:`, error);
      continue;
    }

    // Process slack-compare
    const slackConfig = TEMPLATE_MAPPING.find((t) => t.type === "slack-compare");
    const slackTableName = `${tableName}-slack`;
    const slackReplacements = slackConfig.getReplacements(null, cts, route, runKey.replace("run", ""), prefix);

    try {
      const existingSlackDash = await pool.query(
        `SELECT id, dashboard_url FROM dashboardreports WHERE user_id = $1 AND table_name = $2`,
        [userId, slackTableName]
      );

      let slackDashboardUrl;
      let slackInsert;

      if (existingSlackDash.rows.length > 0) {
        // Check if dashboard needs updating due to new or changed tables
        const ctsTableExists = cts ? await tableExists(client, cts) : false;
        const routeTableExists = route ? await tableExists(client, route) : false;

        const needsUpdate =
          (ctsTableExists && slackReplacements["{{CTS_TABLE}}"] === cts && !(await tableExists(client, slackReplacements["{{CTS_TABLE}}"]))) ||
          (routeTableExists && slackReplacements["{{ROUTE_TABLE}}"] === route && !(await tableExists(client, slackReplacements["{{ROUTE_TABLE}}"]))) ||
          (slackReplacements["{{CTS_TABLE}}"].startsWith("placeholder") && ctsTableExists) ||
          (slackReplacements["{{ROUTE_TABLE}}"].startsWith("placeholder") && routeTableExists);

        if (needsUpdate) {
          console.log(`[DEBUG] Updating existing slack-compare dashboard for ${runKey}`);
          slackDashboardUrl = await createDynamicDashboardFromTemplate(
            slackTableName,
            dsUid,
            grafanaUrl,
            grafanaKey,
            slackConfig,
            slackReplacements,
            slackToken,
            slackChan,
            teamsWebhook
          );

          if (!slackDashboardUrl) {
            throw new Error("Failed to update slack-compare dashboard - no URL returned");
          }

          await pool.query(`
            UPDATE dashboardreports
            SET dashboard_url = $1
            WHERE id = $2
          `, [slackDashboardUrl, existingSlackDash.rows[0].id]);
        } else {
          console.log(`[DEBUG] No update needed for slack-compare ${runKey}, skipping.`);
          dashboardUrls.push({ url: existingSlackDash.rows[0].dashboard_url, tableName: slackTableName, type: 'reports' });
          continue;
        }
      } else {
        // Create new dashboard
        slackDashboardUrl = await createDynamicDashboardFromTemplate(
          slackTableName,
          dsUid,
          grafanaUrl,
          grafanaKey,
          slackConfig,
          slackReplacements,
          slackToken,
          slackChan,
          teamsWebhook
        );

        if (!slackDashboardUrl) {
          throw new Error("Failed to create slack-compare dashboard - no URL returned");
        }

        console.log(`[DEBUG] Created slack-compare dashboard URL: ${slackDashboardUrl}`);

        slackInsert = await pool.query(`
          INSERT INTO dashboardreports 
          (user_id, username, table_name, dashboard_url, app_user_id, app_username)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [userId, username, slackTableName, slackDashboardUrl, userId, username]);
      }

      let slackGifPath = null;
      try {
        slackGifPath = await captureGrafanaGIF(slackDashboardUrl, grafanaKey);
        console.log(`[DEBUG] Captured slack-compare GIF path=${slackGifPath}`);
      } catch (gifError) {
        console.error(`[DEBUG] Error capturing slack-compare GIF: ${gifError.message}`);
      }

      if (slackGifPath && slackInsert) {
        await pool.query(`
          UPDATE dashboardreports
          SET local_snapshot_url = $1
          WHERE id = $2
        `, [slackGifPath, slackInsert.rows[0].id]);
      }

      dashboardUrls.push({ url: slackDashboardUrl, tableName: slackTableName, type: 'reports' });
    } catch (error) {
      console.error(`[ERROR] Failed to process slack-compare for ${runKey}:`, error);
    }
  }
  return dashboardUrls;
}

async function processRunCompareDashboards(client, userId, username, dbName, dsUid, grafanaUrl, grafanaKey, slackToken, slackChan, teamsWebhook) {
  const tableResult = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    AND table_name ~* '^run\\d+_g\\d+(?:_csv)?$'
  `);

  const runs = tableResult.rows
    .map((r) => {
      const match = r.table_name.match(/^run(\d+)_g\1(?:_csv)?$/i);
      return match ? { run: match[1], suffix: r.table_name.includes("_csv") ? "_csv" : "" } : null;
    })
    .filter(Boolean)
    .sort((a, b) => parseInt(a.run) - parseInt(b.run));

  const pairs = [];
  const dashboardUrls = [];

  for (let i = 0; i < runs.length - 1; i++) {
    const pairKey = `run${runs[i].run}-vs-run${runs[i + 1].run}`;
    pairs.push([runs[i], runs[i + 1]]);
  }

  for (const pair of pairs) {
    const [runA, runB] = pair;
    const { run: r1, suffix: s1 } = runA;
    const { run: r2, suffix: s2 } = runB;
    const pairKey = `run${r1}-vs-run${r2}`;

    console.log(`[DEBUG] Processing run comparison: ${pairKey}`);

    const templateConfig = TEMPLATE_MAPPING.find((t) => t.type === "run-compare");
    const replacements = templateConfig.getReplacements(null, r1, r2, s1, s2);

    const requiredTables = [
      { key: "{{RUN_TABLE}}", placeholder: `placeholder_run_table_${r1}` },
      { key: "{{NEXT_RUN_TABLE}}", placeholder: `placeholder_next_run_table_${r2}` },
      { key: "{{RUN_POWER_TABLE}}", placeholder: `placeholder_run_power_table_${r1}` },
      { key: "{{NEXT_RUN_POWER_TABLE}}", placeholder: `placeholder_next_run_power_table_${r2}` },
      { key: "{{RUN_COMPARE_TABLE}}", placeholder: `placeholder_run_compare_table_${r1}` },
      { key: "{{NEXT_RUN_COMPARE_TABLE}}", placeholder: `placeholder_next_run_compare_table_${r2}` },
      { key: "{{DRC_TABLE}}", placeholder: `placeholder_drc_table_${r1}` },
      { key: "{{NEXT_DRC_TABLE}}", placeholder: `placeholder_next_drc_table_${r2}` },
    ];

    let anyTableExists = false;
    for (const { key } of requiredTables) {
      const tableName = replacements[key];
      if (!tableName.startsWith("placeholder") && (await tableExists(client, tableName))) {
        anyTableExists = true;
        break;
      }
    }

    if (!anyTableExists) {
      console.log(`[DEBUG] No tables exist for run comparison ${pairKey}, skipping.`);
      continue;
    }

    try {
      const existingDash = await pool.query(
        `SELECT id, dashboard_url FROM dashboardreports WHERE user_id = $1 AND table_name = $2`,
        [userId, pairKey]
      );

      let dashboardUrl;
      let dashInsert;

      if (existingDash.rows.length > 0) {
        // Check if dashboard needs updating due to new or changed tables
        let needsUpdate = false;
        for (const { key } of requiredTables) {
          const tableName = replacements[key];
          const tableExists = !tableName.startsWith("placeholder") && (await tableExists(client, tableName));
          if (tableExists && !(await tableExists(client, tableName))) {
            needsUpdate = true;
            break;
          }
        }

        if (needsUpdate) {
          console.log(`[DEBUG] Updating existing run-compare dashboard for ${pairKey}`);
          dashboardUrl = await createDynamicDashboardFromTemplate(
            pairKey,
            dsUid,
            grafanaUrl,
            grafanaKey,
            templateConfig,
            replacements,
            slackToken,
            slackChan,
            teamsWebhook
          );

          if (!dashboardUrl) {
            throw new Error("Failed to update run-compare dashboard - no URL returned");
          }

          await pool.query(`
            UPDATE dashboardreports
            SET dashboard_url = $1
            WHERE id = $2
          `, [dashboardUrl, existingDash.rows[0].id]);
        } else {
          console.log(`[DEBUG] No update needed for run-compare ${pairKey}, skipping.`);
          dashboardUrls.push({ url: existingDash.rows[0].dashboard_url, tableName: pairKey, type: 'reports' });
          continue;
        }
      } else {
        // Create new dashboard
        dashboardUrl = await createDynamicDashboardFromTemplate(
          pairKey,
          dsUid,
          grafanaUrl,
          grafanaKey,
          templateConfig,
          replacements,
          slackToken,
          slackChan,
          teamsWebhook
        );

        if (!dashboardUrl) {
          throw new Error("Failed to create run-compare dashboard - no URL returned");
        }

        console.log(`[DEBUG] Created run-compare dashboard URL: ${dashboardUrl}`);

        dashInsert = await pool.query(`
          INSERT INTO dashboardreports 
          (user_id, username, table_name, dashboard_url, app_user_id, app_username)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [userId, username, pairKey, dashboardUrl, userId, username]);
      }

      let gifPath = null;
      try {
        gifPath = await captureGrafanaGIF(dashboardUrl, grafanaKey);
        console.log(`[DEBUG] Captured run-compare GIF path=${gifPath}`);
      } catch (gifError) {
        console.error(`[DEBUG] Error capturing run-compare GIF: ${gifError.message}`);
      }

      if (gifPath && dashInsert) {
        await pool.query(`
          UPDATE dashboardreports
          SET local_snapshot_url = $1
          WHERE id = $2
        `, [gifPath, dashInsert.rows[0].id]);
      }

      dashboardUrls.push({ url: dashboardUrl, tableName: `Run Comparison: ${pairKey}`, type: 'reports' });
    } catch (error) {
      console.error(`[ERROR] Failed to process run comparison ${pairKey}:`, error);
    }
  }
  return dashboardUrls;
}

async function createDashboardFromTemplate(tableName, dataSourceUid, grafanaUrl, grafanaKey, reportType, slackToken, slackChan, teamsWebhook) {
  try {
    console.log("[DEBUG] Creating dashboard from template:", {
      tableName,
      dataSourceUid,
      grafanaUrl,
      reportType,
    });

    let template;
    if (reportType === "timing") {
      template = templates.timing;
    } else if (reportType === "qor") {
      template = templates.qor;
    } else if (reportType === "drc") {
      template = templates.drc;
    } else {
      throw new Error("Invalid report type");
    }

    if (!template) {
      throw new Error(`Template for ${reportType} is not available`);
    }

    const dashboard = replaceAllPlaceholders(template, dataSourceUid, {}, tableName);
    dashboard.uid = randomUid();
    dashboard.id = null;
    dashboard.title = `${reportType.toUpperCase()} Dashboard: ${tableName} (${Date.now()})`;
    const payload = { dashboard, overwrite: true, folderId: 0 };

    console.log("[DEBUG] Sending dashboard creation request to Grafana");
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${grafanaKey}`,
    };

    const resp = await axios.post(`${grafanaUrl}/api/dashboards/db`, payload, { headers });

    if (!resp.data || !resp.data.url) {
      console.error("[DEBUG] Grafana response missing URL:", resp.data);
      throw new Error("Grafana dashboard creation failed - no URL returned");
    }

    const fullUrl = grafanaUrl + resp.data.url;
    console.log("[DEBUG] Dashboard created successfully:", fullUrl);
    return fullUrl;
  } catch (err) {
    console.error("[DEBUG] Error creating dashboard from template:", err);
    throw err;
  }
}

async function createDynamicDashboardFromTemplate(tableName, dataSourceUid, grafanaUrl, grafanaKey, templateConfig, replacements, slackToken, slackChan, teamsWebhook) {
  try {
    console.log("[DEBUG] Creating dynamic dashboard from template:", {
      tableName,
      dataSourceUid,
      grafanaUrl,
      templateType: templateConfig.type,
    });

    const dashboard = replaceAllPlaceholders(templateConfig.template, dataSourceUid, replacements);
    dashboard.uid = `${templateConfig.type}-${crypto
      .createHash("sha256")
      .update(replacements.identifier)
      .digest("hex")
      .substring(0, 10)}`;
    dashboard.title = `${templateConfig.type.toUpperCase()} Dashboard: ${replacements.titleSuffix} (${Date.now()})`;

    const payload = { dashboard, overwrite: true, folderId: 0 };
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${grafanaKey}`,
    };

    const resp = await axios.post(`${grafanaUrl}/api/dashboards/db`, payload, { headers });

    if (!resp.data || !resp.data.url) {
      console.error("[DEBUG] Grafana response missing URL:", resp.data);
      throw new Error("Grafana dashboard creation failed - no URL returned");
    }

    const fullUrl = grafanaUrl + resp.data.url;
    console.log("[DEBUG] Dynamic dashboard created successfully:", fullUrl);
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
  timeout: parseInt(process.env.CAPTURE_TIMEOUT) || 120000,
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
      throw new Error("GRAFANA_API_KEY not provided for GIF capture");
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
        height: GIF_CONFIG.height,
      },
      ignoreHTTPSErrors: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-web-security",
        "--disable-features=IsolateOrigins",
        "--disable-site-isolation-trials",
        "--disable-features=BlockInsecurePrivateNetworkRequests",
        "--disable-dev-shm-usage",
      ],
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
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
    }

    console.log("[DEBUG] Creating GIF from frames...");
    await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
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