'use strict';

const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const logger = require('../utils/logger');

async function generateRpdMd(projectPath, releaseStatus, forceOverwrite = false) {
  const outputPath = path.join(projectPath, 'RPD.md');

  if (fs.existsSync(outputPath) && !forceOverwrite) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'RPD.md already exists. Overwrite?',
        default: false
      }
    ]);

    if (!overwrite) {
      logger.info('Skipping RPD.md generation');
      return false;
    }
  }

  const content = generateRpdContent(releaseStatus);
  fs.writeFileSync(outputPath, content, 'utf8');
  logger.success('RPD.md generated successfully');
  return true;
}

function generateRpdContent(releaseStatus) {
  const summary = releaseStatus.getSummary();

  let content = `# RPD - Release Process Document\n\n`;
  content += `**Date:** ${new Date().toLocaleString('es-ES')}\n\n`;

  content += `## Summary\n\n`;
  content += `| Metric | Value |\n`;
  content += `|--------|-------|\n`;
  content += `| Total Branches | ${summary.total} |\n`;
  content += `| Successful (PROCEDE) | ${summary.procede} |\n`;
  content += `| Failed (NO PROCEDE) | ${summary.noProcede} |\n\n`;

  content += `## Release Details\n\n`;

  for (const result of summary.results) {
    content += `### ${result.taskId}\n\n`;
    content += `- **Branch:** \`${result.branch}\`\n`;
    content += `- **Status:** ${result.status}\n`;
    content += `- **Timestamp:** ${result.timestamp}\n`;

    if (result.mrLink) {
      content += `- **MR:** [View Merge Request](${result.mrLink})\n`;
    }

    if (result.conflicts.length > 0) {
      content += `- **Conflicting Files:**\n`;
      for (const file of result.conflicts) {
        content += `  - \`${file}\`\n`;
      }
    }

    content += `\n`;
  }

  content += `## Process Steps\n\n`;
  content += `1. Branch selection (manual or from file)\n`;
  content += `2. Release branch creation from staging\n`;
  content += `3. Cherry-pick commits from source branches\n`;
  content += `4. Conflict detection and resolution\n`;
  content += `5. GitLab MR creation\n`;
  content += `6. Summary generation\n\n`;

  content += `## Notes\n\n`;
  content += `- All PROCEDE branches have been merged to staging\n`;
  content += `- NO PROCEDE branches require manual conflict resolution\n`;
  content += `- Review MRs before final merge\n`;

  return content;
}

module.exports = {
  generateRpdMd,
  generateRpdContent
};
