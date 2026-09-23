'use strict';

const logger = require('../utils/logger');

class ReleaseStatus {
  constructor() {
    this.results = [];
    // Warnings recorded while a task is processed, attached to its result when it's marked
    this.pendingNotes = new Map();
  }

  // e.g. commits that mention the task ID without following the "[TASK-ID] ..." convention
  addNote(taskId, note) {
    if (!this.pendingNotes.has(taskId)) {
      this.pendingNotes.set(taskId, []);
    }
    this.pendingNotes.get(taskId).push(note);
  }

  addResult(taskId, branch, status, details = {}) {
    this.results.push({
      taskId,
      branch,
      status, // 'PROCEDE' | 'NO PROCEDE' | 'CONFLICT' | 'SKIPPED'
      mrLink: details.mrLink || null,
      conflicts: details.conflicts || [],
      reason: details.reason || null,
      notes: this.pendingNotes.get(taskId) || [],
      timestamp: new Date().toISOString()
    });
    this.pendingNotes.delete(taskId);
  }

  markProcede(taskId, branch, mrLink = null) {
    this.addResult(taskId, branch, 'PROCEDE', { mrLink });
  }

  // reasons: why the branch couldn't be processed (e.g. release branch already exists, git error)
  markNoProcede(taskId, branch, reasons = []) {
    this.addResult(taskId, branch, 'NO PROCEDE', { reason: reasons.join('; ') || null });
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
      } else if (result.status === 'NO PROCEDE' && result.reason) {
        console.log(`  Reason: ${result.reason}`);
      }

      for (const note of result.notes) {
        console.log(`  ⚠ ${note}`);
      }
    }

    console.log('─'.repeat(80));
    console.log(`\nTotal: ${this.results.length} | PROCEDE: ${this.getProcedeCount()} | NO PROCEDE: ${this.getNoProcedeCount()} | CONFLICT: ${this.getConflictCount()} | SKIPPED: ${this.getSkippedCount()}`);
  }
}

module.exports = ReleaseStatus;
