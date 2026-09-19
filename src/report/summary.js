'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

function generateSummary(releaseStatus, outputPath = null) {
  const summary = releaseStatus.getSummary();

  const summaryContent = {
    timestamp: new Date().toISOString(),
    summary: {
      total: summary.total,
      procede: summary.procede,
      noProcede: summary.noProcede
    },
    results: summary.results.map(r => ({
      taskId: r.taskId,
      branch: r.branch,
      status: r.status,
      mrLink: r.mrLink,
      conflicts: r.conflicts
    }))
  };

  if (outputPath) {
    saveSummaryToFile(summaryContent, outputPath);
  }

  return summaryContent;
}

function saveSummaryToFile(summary, outputPath) {
  const content = JSON.stringify(summary, null, 2);
  fs.writeFileSync(outputPath, content, 'utf8');
  logger.info(`Summary saved to: ${outputPath}`);
}

function generateMarkdownSummary(releaseStatus) {
  const summary = releaseStatus.getSummary();

  let markdown = `# Release Summary\n\n`;
  markdown += `**Date:** ${new Date().toLocaleString('es-ES')}\n\n`;
  markdown += `## Statistics\n\n`;
  markdown += `| Metric | Value |\n`;
  markdown += `|--------|-------|\n`;
  markdown += `| Total | ${summary.total} |\n`;
  markdown += `| PROCEDE | ${summary.procede} |\n`;
  markdown += `| NO PROCEDE | ${summary.noProcede} |\n\n`;

  markdown += `## Results\n\n`;

  for (const result of summary.results) {
    const statusIcon = result.status === 'PROCEDE' ? '✅' : '❌';
    markdown += `### ${statusIcon} ${result.taskId}\n\n`;
    markdown += `- **Branch:** ${result.branch}\n`;
    markdown += `- **Status:** ${result.status}\n`;

    if (result.mrLink) {
      markdown += `- **MR:** [View MR](${result.mrLink})\n`;
    }

    if (result.conflicts.length > 0) {
      markdown += `- **Conflicts:** ${result.conflicts.join(', ')}\n`;
    }

    markdown += `\n`;
  }

  return markdown;
}

module.exports = {
  generateSummary,
  generateMarkdownSummary,
  saveSummaryToFile
};
