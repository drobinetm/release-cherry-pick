'use strict';

const fs = require('fs');
const path = require('path');
const { AppError } = require('../utils/errors');

function parseBranchListFile(filePath) {
  const fullPath = path.resolve(filePath);

  if (!fs.existsSync(fullPath)) {
    throw new AppError(`Branch list file not found: ${fullPath}`);
  }

  const content = fs.readFileSync(fullPath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());

  const branches = [];

  for (const line of lines) {
    const parsed = parseBranchLine(line);
    if (parsed) {
      branches.push(parsed);
    }
  }

  return branches;
}

// A commit hash as users type it: 4 to 40 hex characters (short or full)
const HASH = /^[0-9a-f]{4,40}$/i;

// Optional trailing list of extra commits to cherry-pick: "... [+abc1234, +def5678]". Only a list
// made entirely of +hashes counts, so a description that just ends in brackets is left alone.
const EXTRA_COMMITS = /\s*\[\s*(\+[0-9a-f]{4,40}(?:\s*,\s*\+[0-9a-f]{4,40})*)\s*\]\s*$/i;

function parseBranchLine(line) {
  // Pattern: *TASK-ID*: Description [+hash, +hash]
  // Example: *PB-I3217*: Al gestionar autos de una póliza... [+3f2a9c1]
  const match = line.match(/^\*?([A-Z]+-[A-Z0-9]+)\*?:\s*(.+)$/);

  if (match) {
    let description = match[2].trim();
    let extraCommits = [];
    const extra = description.match(EXTRA_COMMITS);
    if (extra && extra.index > 0) {
      description = description.slice(0, extra.index).trim();
      extraCommits = extra[1].split(',').map(hash => hash.trim().replace(/^\+/, ''));
    }
    return {
      taskId: match[1],
      description,
      extraCommits,
      raw: line.trim()
    };
  }

  return null;
}

// Parses --commits values ("PB-123=abc1234,def5678", repeatable) into a Map of task ID -> hashes.
// Throws one error listing every malformed value.
function parseCommitSpecs(specs = []) {
  const byTask = new Map();
  const errors = [];

  for (const spec of specs) {
    const match = String(spec).match(/^\s*([^=\s]+)\s*=\s*(.*)$/);
    const hashes = match ? match[2].split(',').map(hash => hash.trim()).filter(Boolean) : [];
    if (!match || !isTaskId(match[1]) || hashes.length === 0) {
      errors.push(`"${spec}" (expected TASK-ID=hash[,hash...], e.g. PB-123=abc1234)`);
      continue;
    }
    const bad = hashes.filter(hash => !HASH.test(hash));
    if (bad.length > 0) {
      errors.push(`"${spec}" (not commit hashes: ${bad.join(', ')})`);
      continue;
    }
    const taskId = match[1].toUpperCase();
    byTask.set(taskId, [...new Set([...(byTask.get(taskId) || []), ...hashes])]);
  }

  if (errors.length > 0) {
    throw new AppError(`Invalid --commits value(s): ${errors.join('; ')}`);
  }
  return byTask;
}

function isCommitHash(value) {
  return HASH.test(String(value).trim());
}

function getBranchNameFromTaskId(taskId, prefix = 'feature/') {
  return `${prefix}${taskId.toLowerCase()}`;
}

function stripKnownPrefix(branchName, branchPrefix = {}) {
  for (const prefix of Object.values(branchPrefix)) {
    if (prefix && branchName.startsWith(prefix)) {
      return branchName.slice(prefix.length);
    }
  }
  return branchName;
}

// Extracts the task ID from a branch name, e.g. "feature/PB-123-list-user" -> "PB-123".
// Returns null if the branch name (after stripping a known prefix) doesn't start with a task ID.
function extractTaskIdFromBranch(branchName, branchPrefix = {}) {
  const match = stripKnownPrefix(branchName, branchPrefix).match(/^([A-Z]+-[A-Z]*\d[A-Z0-9]*)(?=[-_]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

// Human-readable description from the part of the branch name after the task ID, e.g.
// "feature/PB-123-list-user" -> "List user". Falls back to the branch name if nothing follows the ID.
function describeBranch(branchName, branchPrefix = {}) {
  const words = stripKnownPrefix(branchName, branchPrefix)
    .replace(/^[A-Z]+-[A-Z]*\d[A-Z0-9]*(?=[-_]|$)/i, '')
    .split(/[-_]+/)
    .filter(Boolean)
    .join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : branchName;
}

// True if the value looks like a bare task ID ("PB-I3217") rather than a branch name.
function isTaskId(value) {
  return /^[A-Z]+-[A-Z]*\d[A-Z0-9]*$/i.test(value);
}

module.exports = {
  parseBranchListFile,
  parseBranchLine,
  parseCommitSpecs,
  isCommitHash,
  getBranchNameFromTaskId,
  extractTaskIdFromBranch,
  describeBranch,
  isTaskId
};
