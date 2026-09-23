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

function parseBranchLine(line) {
  // Pattern: *TASK-ID*: Description
  // Example: *PB-I3217*: Al gestionar autos de una póliza...
  const match = line.match(/^\*?([A-Z]+-[A-Z0-9]+)\*?:\s*(.+)$/);

  if (match) {
    return {
      taskId: match[1],
      description: match[2].trim(),
      raw: line.trim()
    };
  }

  return null;
}

function getBranchNameFromTaskId(taskId, prefix = 'feature/') {
  return `${prefix}${taskId.toLowerCase()}`;
}

// Extracts the task ID from a branch name, e.g. "feature/PB-123-list-user" -> "PB-123".
// Returns null if the branch name (after stripping a known prefix) doesn't start with a task ID.
function extractTaskIdFromBranch(branchName, branchPrefix = {}) {
  let name = branchName;
  for (const prefix of Object.values(branchPrefix)) {
    if (prefix && name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }

  const match = name.match(/^([A-Z]+-[A-Z]*\d[A-Z0-9]*)(?=[-_]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

// True if the value looks like a bare task ID ("PB-I3217") rather than a branch name.
function isTaskId(value) {
  return /^[A-Z]+-[A-Z]*\d[A-Z0-9]*$/i.test(value);
}

module.exports = {
  parseBranchListFile,
  parseBranchLine,
  getBranchNameFromTaskId,
  extractTaskIdFromBranch,
  isTaskId
};
