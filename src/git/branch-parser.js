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

module.exports = {
  parseBranchListFile,
  parseBranchLine,
  getBranchNameFromTaskId
};
