'use strict';

const chalk = require('chalk');

const logger = {
  info(message) {
    console.log(chalk.green('✓'), message);
  },

  warn(message) {
    console.log(chalk.yellow('⚠'), message);
  },

  error(message) {
    console.log(chalk.red('✖'), message);
  },

  success(message) {
    console.log(chalk.green.bold('✓'), message);
  },

  log(message) {
    console.log(message);
  },

  header(message) {
    console.log(chalk.bold.cyan('\n' + message));
    console.log(chalk.cyan('─'.repeat(50)));
  },

  table(data) {
    console.table(data);
  }
};

module.exports = logger;
