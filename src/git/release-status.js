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
      status, // 'PROCEDE' | 'NO PROCEDE' | 'CONFLICT' | 'SKIPPED'
      mrLink: details.mrLink || null,
      conflicts: details.conflicts || [],
      reason: details.reason || null,
      timestamp: new Date().toISOString()
    });
  }

  markProcede(taskId, branch, mrLink = null) {
    this.addResult(taskId, branch, 'PROCEDE', { mrLink });
  }

  markNoProcede(taskId, branch, conflicts = []) {
    this.addResult(taskId, branch, 'NO PROCEDE', { conflicts });
  }

  markConflict(taskId, branch, conflicts = []) {
    this.addResult(taskId, branch, 'CONFLICT', { conflicts });
  }

  markSkipped(taskId, branch, reason = null) {
    this.addResult(taskId, branch, 'SKIPPED', { reason });
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

  getConflictCount() {
    return this.results.filter(r => r.status === 'CONFLICT').length;
  }

  getSkippedCount() {
    return this.results.filter(r => r.status === 'SKIPPED').length;
  }

  getSummary() {
    return {
      total: this.results.length,
      procede: this.getProcedeCount(),
      noProcede: this.getNoProcedeCount(),
      conflict: this.getConflictCount(),
      skipped: this.getSkippedCount(),
      results: this.results
    };
  }

  displaySummary() {
    logger.header('Release Summary');

    console.log('\nResults:');
    console.log('─'.repeat(80));

    for (const result of this.results) {
      const icon = result.status === 'PROCEDE' ? '✓' : (result.status === 'CONFLICT' ? '⚠' : (result.status === 'SKIPPED' ? '·' : '✖'));
      console.log(`${icon} [${result.taskId}] ${result.branch} — ${result.status}`);

      if (result.mrLink) {
        console.log(`  MR: ${result.mrLink}`);
      }

      if (result.status === 'CONFLICT') {
        console.log(`  Needs manual resolution. Conflicting files: ${result.conflicts.join(', ')}`);
      } else if (result.status === 'SKIPPED') {
        console.log(`  ${result.reason || 'Nothing to release — no action needed.'}`);
      } else if (result.conflicts.length > 0) {
        console.log(`  Conflicts: ${result.conflicts.join(', ')}`);
      }
    }

    console.log('─'.repeat(80));
    console.log(`\nTotal: ${this.results.length} | PROCEDE: ${this.getProcedeCount()} | NO PROCEDE: ${this.getNoProcedeCount()} | CONFLICT: ${this.getConflictCount()} | SKIPPED: ${this.getSkippedCount()}`);
  }
}

module.exports = ReleaseStatus;
