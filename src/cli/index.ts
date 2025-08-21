#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createDevCommand } from './commands/dev.js';
import { createPackageCommand } from './commands/package.js';
import { createInitCommand } from './commands/init.js';

// Get package.json for version info
const packageJsonPath = resolve(__dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

const program = new Command();

program
  .name('lambda-dev')
  .description('Lightweight AWS Lambda local development and packaging tool')
  .version(packageJson.version);

// Add commands
program.addCommand(createInitCommand());
program.addCommand(createDevCommand());
program.addCommand(createPackageCommand());

// Add global error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

// Parse command line arguments
program.parse();
