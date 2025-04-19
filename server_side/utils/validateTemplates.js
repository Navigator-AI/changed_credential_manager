// server_side/utils/validateTemplates.js
const fs = require('fs');
const path = require('path');

const TEMPLATE_FILES = [
  'skew_template.json',
  'errors_template.json',
  'delay_stacking_template.json',
  'delay_comparison_template.json',
  'slack_comparison_template.json',
  'QOR_PNR_template.json',
  'Run_comparison_template.json',
  'timing_report_template.json',
  'qor_template.json',
  'drc_template.json'
];

function validateTemplates() {
  const templateDir = path.join(__dirname, '../grafana_templates');
  
  // Add debug logging
  console.log('[DEBUG] Checking templates in:', templateDir);
  
  for (const file of TEMPLATE_FILES) {
    const filePath = path.join(templateDir, file);
    console.log('[DEBUG] Validating template:', file);
    
    if (!fs.existsSync(filePath)) {
      console.error(`[ERROR] Template file missing: ${file}`);
      throw new Error(`Template file missing: ${file}`);
    }
    
    try {
      const templateContent = fs.readFileSync(filePath);
      JSON.parse(templateContent);
      console.log(`[DEBUG] Successfully validated ${file}`);
    } catch (err) {
      console.error(`[ERROR] Invalid JSON in template ${file}:`, err);
      throw new Error(`Invalid JSON in template ${file}: ${err.message}`);
    }
  }
  console.log('[DEBUG] All templates validated successfully');
}

module.exports = validateTemplates;