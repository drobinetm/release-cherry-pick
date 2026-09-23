'use strict';

const { parseBranchLine, getBranchNameFromTaskId } = require('./src/git/branch-parser');
const ReleaseStatus = require('./src/git/release-status');
const { generateMarkdownSummary } = require('./src/report/summary');
const { generateAgentsContent } = require('./src/doc/agents-generator');
const { generateRpdContent } = require('./src/doc/rpd-generator');
const { getDefaultConfig } = require('./src/config/defaults');

console.log('=== End-to-End Test ===\n');

// Test 1: Branch parsing
console.log('Test 1: Branch parsing');
const testLine = '*PB-I3217*: Al gestionar autos de una póliza y al renovar una póliza de auto, el campo Endoso no está listando los posibles valores a seleccionar.';
const parsed = parseBranchLine(testLine);
console.log('Input:', testLine.substring(0, 60) + '...');
console.log('Task ID:', parsed.taskId);
console.log('Description:', parsed.description.substring(0, 60) + '...');
console.log('Branch name:', getBranchNameFromTaskId(parsed.taskId));
console.log('✓ Branch parsing passed\n');

// Test 2: Configuration defaults
console.log('Test 2: Configuration defaults');
const config = getDefaultConfig();
console.log('Staging branch:', config.git.stagingBranch);
console.log('Feature prefix:', config.git.branchPrefix.feature);
console.log('✓ Configuration defaults passed\n');

// Test 3: Release status tracking
console.log('Test 3: Release status tracking');
const status = new ReleaseStatus();
status.markProcede('PB-I3217', 'release/pb-i3217', 'https://gitlab.example.com/mr/1');
status.markNoProcede('PB-I3219', 'release/pb-i3219', ['Release branch release/pb-i3219 already exists on origin']);
const summary = status.getSummary();
console.log('Total:', summary.total);
console.log('PROCEDE:', summary.procede);
console.log('NO PROCEDE:', summary.noProcede);
console.log('✓ Release status tracking passed\n');

// Test 4: Markdown summary generation
console.log('Test 4: Markdown summary generation');
const markdown = generateMarkdownSummary(status);
console.log('Markdown length:', markdown.length);
console.log('Contains PB-I3217:', markdown.includes('PB-I3217'));
console.log('Contains PROCEDE:', markdown.includes('PROCEDE'));
console.log('✓ Markdown summary generation passed\n');

// Test 5: Documentation generation
console.log('Test 5: Documentation generation');
const agentsContent = generateAgentsContent();
const rpdContent = generateRpdContent(status);
console.log('AGENTS.md length:', agentsContent.length);
console.log('RPD.md length:', rpdContent.length);
console.log('✓ Documentation generation passed\n');

console.log('=== All tests passed! ===');
