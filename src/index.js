#!/usr/bin/env node

'use strict';

const { createProgram } = require('./cli');
const { runRelease } = require('./workflow/release');
const { setupWizard } = require('./config/setup');
const { loadConfig } = require('./config/loader');
const logger = require('./utils/logger');
const { maskSecret } = require('./utils/secrets');

const program = createProgram();

program
  .command('release')
  .description('Start the release process')
  .option('-f, --file <path>', 'Path to branch list file')
  .option('-b, --branches <branches>', 'Comma-separated list of branches')
  .action(async (options) => {
    try {
      await runRelease(options);
    } catch (error) {
      logger.error(error.message);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Configure release-cherry-pick settings')
  .option('--init', 'Initialize configuration')
  .option('--show', 'Show current configuration')
  .action(async (options) => {
    try {
      if (options.init) {
        await setupWizard();
      } else if (options.show) {
        const config = loadConfig();
        if (config) {
          logger.info('Current configuration:');
          const shown = JSON.parse(JSON.stringify(config));
          shown.gitlab.token = maskSecret(shown.gitlab.token);
          console.log(JSON.stringify(shown, null, 2));
        } else {
          logger.warn('No configuration found');
        }
      } else {
        await setupWizard();
      }
    } catch (error) {
      logger.error(error.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
