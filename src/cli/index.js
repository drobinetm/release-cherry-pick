'use strict';

const { program } = require('commander');
const pkg = require('../../package.json');

function createProgram() {
  return program
    .name('release-cherry-pick')
    .description('CLI tool for automating release cherry-pick and GitLab MR creation')
    .version(pkg.version);
}

module.exports = { createProgram };
