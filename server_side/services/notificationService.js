"use strict";

const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");
const pool = require('../config/dbConfig');
const path = require('path');
const qs = require('qs');

class NotificationService {
  async processUnsentDashboards() {
    try {
      console.log('[DEBUG] Starting to process all unsent dashboards');
      
      const users = await this.getUsersWithCredentials();
      
      for (const user of users) {
        await this.processUserDashboards(user);
      }
    } catch (error) {
      console.error('[NotificationService] Error processing unsent dashboards:', error);
    }
  }

  async getUsersWithCredentials() {
    const query = `
      SELECT DISTINCT 
        u.id as user_id,
        u.username,
        MAX(CASE WHEN c.key_name = 'SLACK_BOT_TOKEN' THEN c.key_value END) as slack_bot_token,
        MAX(CASE WHEN c.key_name = 'SLACK_CHANNEL_ID' THEN c.key_value END) as slack_channel_id,
        MAX(CASE WHEN c.key_name = 'TEAMS_WEBHOOK_URL' THEN c.key_value END) as teams_webhook_url
      FROM users u
      JOIN credentials c ON u.id = c.user_id
      WHERE c.key_name IN ('SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID', 'TEAMS_WEBHOOK_URL')
      GROUP BY u.id, u.username
      HAVING COUNT(DISTINCT c.key_name) >= 1
    `;
    
    const result = await pool.query(query);
    return result.rows;
  }

  async processUserDashboards(user) {
    try {
      console.log(`[DEBUG] Processing dashboards for user: ${user.username}`);
      
      await this.processDashboardType('timing', user);
      await this.processDashboardType('qor', user);
      await this.processDashboardType('drc', user);
      await this.processDashboardType('reports', user);
    } catch (error) {
      console.error(`[NotificationService] Error processing dashboards for user ${user.username}:`, error);
    }
  }

  async processDashboardType(type, user) {
    const tableName = `dashboard${type}`;
    try {
      const query = `
        SELECT 
          d.*,
          COALESCE(d.app_username, u.username) as creator_name
        FROM ${tableName} d
        LEFT JOIN users u ON d.user_id = u.id
        WHERE d.user_id = $1 
          AND d.local_snapshot_url IS NOT NULL 
          AND (d.slack_sent_at IS NULL OR d.teams_sent_at IS NULL)
        ORDER BY d.created_at DESC
      `;
      
      const dashboards = await pool.query(query, [user.user_id]);
      
      for (const dash of dashboards.rows) {
        await this.processSingleDashboard(dash, user, type);
      }
    } catch (error) {
      console.error(`[NotificationService] Error processing ${type} dashboards:`, error);
    }
  }

  async processSingleDashboard(dashboard, user, type) {
    const tableName = `dashboard${type}`;
    try {
      console.log(`[DEBUG] Processing dashboard: ${dashboard.table_name}`);
      console.log(`[DEBUG] Dashboard details:`, {
        id: dashboard.id,
        tableName: dashboard.table_name,
        gifPath: dashboard.local_snapshot_url,
        hasGif: !!dashboard.local_snapshot_url
      });

      const updates = {};

      // Process Slack notification
      if (user.slack_bot_token && user.slack_channel_id && !dashboard.slack_sent_at) {
        const messageResult = await this.postDashboardLinkToSlack(
          user.slack_bot_token,
          user.slack_channel_id,
          dashboard.dashboard_url,
          dashboard.table_name,
          dashboard.creator_name
        );
        
        if (!messageResult?.ok) {
          console.error(`[DEBUG] Failed to post Slack dashboard link: ${messageResult?.error || 'Unknown error'}`);
        } else {
          updates.slack_sent_at = 'NOW()';

          if (dashboard.local_snapshot_url) {
            console.log(`[DEBUG] Found GIF path: ${dashboard.local_snapshot_url}`);
            
            const possiblePaths = [
              dashboard.local_snapshot_url,
              path.join(__dirname, '..', 'gif_captures', path.basename(dashboard.local_snapshot_url)),
              path.join(process.cwd(), 'gif_captures', path.basename(dashboard.local_snapshot_url)),
              path.join('gif_captures', path.basename(dashboard.local_snapshot_url))
            ];

            console.log('[DEBUG] Trying possible GIF paths:', possiblePaths);
            
            let fileResult = null;
            for (const gifPath of possiblePaths) {
              console.log(`[DEBUG] Attempting with path: ${gifPath}`);
              if (fs.existsSync(gifPath)) {
                console.log(`[DEBUG] Found GIF at path: ${gifPath}`);
                fileResult = await this.uploadGifToSlack(
                  user.slack_bot_token,
                  gifPath,
                  user.slack_channel_id
                );
                if (fileResult) {
                  console.log('[DEBUG] Successfully uploaded GIF to Slack');
                  break;
                }
              }
            }
            
            if (fileResult) {
              console.log(`[DEBUG] GIF uploaded successfully, posting to Slack channel...`);
              await this.postImageToSlack(
                user.slack_bot_token,
                user.slack_channel_id,
                fileResult,
                dashboard.table_name
              );
            } else {
              console.error(`[DEBUG] Failed to upload GIF to Slack for ${dashboard.table_name} after trying all paths`);
            }
          }
        }
      }

      // Process Teams notification
      if (user.teams_webhook_url && !dashboard.teams_sent_at) {
        const teamsResult = await this.postDashboardLinkToTeams(
          user.teams_webhook_url,
          dashboard.dashboard_url,
          dashboard.table_name,
          dashboard.creator_name
        );

        if (!teamsResult.success) {
          console.error(`[DEBUG] Failed to post Teams dashboard link: ${teamsResult.error || 'Unknown error'}`);
        } else {
          updates.teams_sent_at = 'NOW()';
        }
      }

      // Update the dashboard with sent timestamps
      if (Object.keys(updates).length > 0) {
        const setClause = Object.keys(updates).map((key, index) => `${key} = $${index + 1}`).join(', ');
        const values = Object.values(updates).map(val => val === 'NOW()' ? val : val);
        values.push(dashboard.id);

        await pool.query(
          `UPDATE ${tableName} SET ${setClause} WHERE id = $${values.length}`,
          values
        );
        
        console.log(`[DEBUG] Successfully processed dashboard ${dashboard.table_name} for notifications`);
      } else {
        console.log(`[DEBUG] No notifications sent for dashboard ${dashboard.table_name}`);
      }
    } catch (error) {
      console.error(`[NotificationService] Error processing dashboard ${dashboard.id}:`, error);
    }
  }

  async postDashboardLinkToSlack(botToken, channelId, dashboardUrl, tableName, creatorName) {
    const message = {
      channel: channelId,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `New Dashboard Created by ${creatorName}`,
            emoji: true
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "A new dashboard has been created!"
          }
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Creator:* ${creatorName}`
            },
            {
              type: "mrkdwn",
              text: `*Table Name:* ${tableName}`
            }
          ]
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "This dashboard provides in-depth analysis and visualizations for your data."
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Dashboard Link:*\n${dashboardUrl}`
          }
        }
      ]
    };

    const response = await axios.post('https://slack.com/api/chat.postMessage', message, {
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  }

  async uploadGifToSlack(botToken, filePath, channelId) {
    try {
      console.log('[DEBUG] Attempting to upload GIF to Slack:', {
        filePath,
        channelId
      });

      const normalizedPath = filePath.replace(/\\/g, '/');
      console.log('[DEBUG] Normalized file path:', normalizedPath);

      const stats = fs.statSync(normalizedPath);
      console.log('[DEBUG] File stats:', {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime
      });

      if (stats.size === 0) {
        throw new Error('File is empty');
      }

      console.log('[DEBUG] Getting upload URL from Slack...');
      const step1 = await axios.post(
        "https://slack.com/api/files.getUploadURLExternal",
        qs.stringify({
          filename: "dashboard.gif",
          length: stats.size
        }),
        {
          headers: {
            Authorization: `Bearer ${botToken}`,
            "Content-Type": "application/x-www-form-urlencoded"
          }
        }
      );

      if (!step1.data.ok) {
        throw new Error(`Failed to get upload URL: ${step1.data.error}`);
      }

      const { upload_url, file_id } = step1.data;
      console.log('[DEBUG] Got upload URL and file ID:', { file_id });

      console.log('[DEBUG] Uploading file to Slack...');
      const form = new FormData();
      form.append("file", fs.createReadStream(normalizedPath), {
        filename: "dashboard.gif",
        knownLength: stats.size
      });

      await axios.post(upload_url, form, {
        headers: {
          ...form.getHeaders(),
          "Content-Length": form.getLengthSync()
        }
      });

      console.log('[DEBUG] Completing upload to Slack...');
      const step3 = await axios.post(
        "https://slack.com/api/files.completeUploadExternal",
        {
          files: [{ id: file_id, title: "Dashboard GIF" }],
          channel_id: channelId
        },
        {
          headers: {
            Authorization: `Bearer ${botToken}`,
            "Content-Type": "application/json"
          }
        }
      );

      if (!step3.data.ok || !step3.data.files?.length) {
        throw new Error("Upload completion failed");
      }

      console.log('[DEBUG] Slack upload completed successfully');
      return step3.data.files[0];
    } catch (error) {
      console.error('[NotificationService] uploadGifToSlack error:', error.response?.data || error.message);
      return null;
    }
  }

  async postImageToSlack(botToken, channelId, fileObj, tableName) {
    try {
      console.log('[DEBUG] Posting image to Slack channel:', { channelId, tableName });
      const imageUrl = fileObj.url_private || fileObj.url_private_download;
      
      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📊 *Dashboard Preview for ${tableName}*`
          }
        },
        {
          type: "image",
          title: {
            type: "plain_text",
            text: `Dashboard Preview for ${tableName}`
          },
          image_url: imageUrl,
          alt_text: "Dashboard Preview"
        }
      ];

      const resp = await axios.post(
        "https://slack.com/api/chat.postMessage",
        { 
          channel: channelId, 
          text: `Dashboard preview for ${tableName}`, 
          blocks 
        },
        { 
          headers: { 
            Authorization: `Bearer ${botToken}`, 
            "Content-Type": "application/json" 
          } 
        }
      );

      console.log('[DEBUG] Slack image posted successfully');
      return resp.data;
    } catch (error) {
      console.error("[NotificationService] postImageToSlack error:", error.response?.data || error.message);
      return null;
    }
  }

  async postDashboardLinkToTeams(webhookUrl, dashboardUrl, tableName, creatorName) {
    try {
      console.log('[DEBUG] Posting dashboard link to Teams:', { webhookUrl, tableName });

      const teamsMessage = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "summary": "New Grafana Dashboard Entry",
        "themeColor": "0078D7",
        "sections": [
          {
            "activityTitle": "📢 **New Grafana Dashboard Entry**",
            "facts": [
              { "name": "👤 User", "value": creatorName || "N/A" },
              { "name": "📁 Table Name", "value": tableName || "N/A" },
              { "name": "🕒 Timestamp", "value": new Date().toISOString() }
            ],
            "markdown": true
          }
        ],
        "potentialAction": [
          {
            "@type": "OpenUri",
            "name": "🔗 Open Dashboard",
            "targets": [{ "os": "default", "uri": dashboardUrl || "#" }]
          }
        ]
      };

      const response = await axios.post(webhookUrl, teamsMessage, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 200) {
        console.log('[DEBUG] Successfully posted to Teams');
        return { success: true };
      } else {
        console.error('[DEBUG] Failed to post to Teams:', response.status, response.data);
        return { success: false, error: `Status Code: ${response.status}` };
      }
    } catch (error) {
      console.error("[NotificationService] postDashboardLinkToTeams error:", error.response?.data || error.message);
      return { success: false, error: error.message };
    }
  }
}

const notificationService = new NotificationService();
module.exports = notificationService;