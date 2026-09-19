'use strict';

const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const logger = require('../utils/logger');

async function generateAgentsMd(projectPath, forceOverwrite = false) {
  const outputPath = path.join(projectPath, 'AGENTS.md');

  if (fs.existsSync(outputPath) && !forceOverwrite) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'AGENTS.md already exists. Overwrite?',
        default: false
      }
    ]);

    if (!overwrite) {
      logger.info('Skipping AGENTS.md generation');
      return false;
    }
  }

  const content = generateAgentsContent();
  fs.writeFileSync(outputPath, content, 'utf8');
  logger.success('AGENTS.md generated successfully');
  return true;
}

function generateAgentsContent() {
  return `# AGENTS.md - Project Guidelines

## Project Overview

This project uses release-cherry-pick CLI tool for automating release processes.

## Architecture

- \`src/cli/\` - CLI entry points and commands
- \`src/config/\` - Configuration management
- \`src/git/\` - Git operations (branching, cherry-pick)
- \`src/gitlab/\` - GitLab API integration
- \`src/utils/\` - Utility functions and helpers
- \`src/report/\` - Report generation
- \`src/doc/\` - Documentation generation

## Development Guidelines

### Code Style
- Use CommonJS modules (require/module.exports)
- Follow ESLint recommended rules
- Use async/await for asynchronous operations
- Handle errors gracefully with custom error classes

### Git Workflow
- Feature branches: \`feature/*\`
- Hotfix branches: \`hotfix/*\`
- Release branches: \`release/*\`

### Testing
- Run tests with \`npm test\`
- Test configuration changes in isolation

## Configuration

The tool uses \`.release-cherry-pick.json\` for configuration.
See \`src/config/defaults.js\` for default values.

## Commands

- \`release-cherry-pick release\` - Start release process
- \`release-cherry-pick config\` - Configure settings
- \`release-cherry-pick --help\` - Show help
`;
}

module.exports = {
  generateAgentsMd,
  generateAgentsContent
};
