'use strict';

const fs = require('fs');
const logger = require('../utils/logger');

function generateSummary(releaseStatus, outputPath = null) {
  const summary = releaseStatus.getSummary();

  const summaryContent = {
    timestamp: new Date().toISOString(),
    summary: {
      total: summary.total,
      procede: summary.procede,
      noProcede: summary.noProcede,
      conflict: summary.conflict,
      skipped: summary.skipped
    },
    results: summary.results.map(r => ({
      taskId: r.taskId,
      branch: r.branch,
      status: r.status,
      mrLink: r.mrLink,
      conflicts: r.conflicts,
      reason: r.reason,
      notes: r.notes
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
  markdown += `| NO PROCEDE | ${summary.noProcede} |\n`;
  markdown += `| CONFLICT | ${summary.conflict} |\n`;
  markdown += `| SKIPPED | ${summary.skipped} |\n\n`;

  markdown += `## Results\n\n`;

  for (const result of summary.results) {
    const statusIcon = result.status === 'PROCEDE' ? '✅' : (result.status === 'CONFLICT' ? '⚠️' : (result.status === 'SKIPPED' ? 'ℹ️' : '❌'));
    markdown += `### ${statusIcon} ${result.taskId}\n\n`;
    markdown += `- **Branch:** ${result.branch}\n`;
    markdown += `- **Status:** ${result.status}\n`;

    if (result.mrLink) {
      markdown += `- **MR:** [View MR](${result.mrLink})\n`;
    }

    if (result.status === 'CONFLICT') {
      markdown += `- **Needs manual resolution by the user.**\n`;
      markdown += `- **Conflicting files:** ${result.conflicts.join(', ')}\n`;
    } else if (result.status === 'SKIPPED') {
      markdown += `- **${result.reason || 'Nothing to release — no action needed.'}**\n`;
    } else if (result.status === 'NO PROCEDE' && result.reason) {
      markdown += `- **Reason:** ${result.reason}\n`;
    }

    for (const note of result.notes || []) {
      markdown += `- ⚠️ ${note}\n`;
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
