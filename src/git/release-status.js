'use strict';

const logger = require('../utils/logger');

class ReleaseStatus {
  constructor() {
    this.results = [];
  }

  addResult(taskId, branch, status, details = {}) {
    this.results.push({
      taskId,
      branch,
      status, // 'PROCEDE' or 'NO PROCEDE'
      mrLink: details.mrLink || null,
      conflicts: details.conflicts || [],
      timestamp: new Date().toISOString()
    });
  }

  markProcede(taskId, branch, mrLink = null) {
    this.addResult(taskId, branch, 'PROCEDE', { mrLink });
  }

  markNoProcede(taskId, branch, conflicts = []) {
    this.addResult(taskId, branch, 'NO PROCEDE', { conflicts });
  }

  getResults() {
    return this.results;
  }

  getProcedeCount() {
    return this.results.filter(r => r.status === 'PROCEDE').length;
  }

  getNoProcedeCount() {
    return this.results.filter(r => r.status === 'NO PROCEDE').length;
  }

  getSummary() {
    return {
      total: this.results.length,
      procede: this.getProcedeCount(),
      noProcede: this.getNoProcedeCount(),
      results: this.results
    };
  }

  displaySummary() {
    logger.header('Release Summary');

    console.log('\nResults:');
    console.log('─'.repeat(80));

    for (const result of this.results) {
      const statusColor = result.status === 'PROCEDE' ? '✓' : '✖';
      console.log(`${statusColor} [${result.taskId}] ${result.branch}`);

      if (result.mrLink) {
        console.log(`  MR: ${result.mrLink}`);
      }

      if (result.conflicts.length > 0) {
        console.log(`  Conflicts: ${result.conflicts.join(', ')}`);
      }
    }

    console.log('─'.repeat(80));
    console.log(`\nTotal: ${this.results.length} | PROCEDE: ${this.getProcedeCount()} | NO PROCEDE: ${this.getNoProcedeCount()}`);
  }
}

module.exports = ReleaseStatus;
