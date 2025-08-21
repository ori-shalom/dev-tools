# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lambda Dev Tools is a lightweight AWS Lambda local development and packaging tool for TypeScript projects. It provides local API Gateway and WebSocket simulation without requiring AWS credentials.

## Key Architecture Components

### Configuration System (`src/config/`)

- **Zod Schemas**: Type-safe configuration validation using Zod v4
- **JSON Schema Generation**: Automatic generation from Zod schemas for YAML IntelliSense
- **YAML Parser**: Validates and parses `dev-tools.yaml` configuration files
- Schema reference: `# yaml-language-server: $schema=./node_modules/@ori-sh/dev-tools/schemas/config-schema.json`

### Development Server (`src/server/`)

- **HTTP Server**: Express-based API Gateway simulation with route parameter extraction
- **WebSocket Server**: Full WebSocket API Gateway simulation with connection management
- **Management Server**: REST API for sending messages to WebSocket clients during development
- **Event Transformation**: Converts Express/WebSocket events to AWS Lambda event format

### Build System (`src/bundler/`)

- **ESBuild Bundler**: TypeScript compilation and bundling for Lambda functions
- **Package System**: Creates deployment packages (currently directory-based, can be enhanced to ZIP)
- **Handler Resolution**: Resolves TypeScript/JavaScript handler files with multiple extension support

### CLI Interface (`src/cli/`)

- **Init Command**: Scaffolds new projects with example handlers and configuration
- **Dev Command**: Starts local development servers with hot reload
- **Package Command**: Builds and packages functions for deployment

### Utilities (`src/utils/`)

- **Handler Loader**: Dynamic loading of Lambda handlers with TypeScript compilation
- **File Watcher**: Hot reload functionality using chokidar

## Development Commands

```bash
# Development
pnpm run dev          # Watch and compile TypeScript
pnpm run build        # Build the project
pnpm run lint         # ESLint code checking
pnpm run format       # Prettier code formatting
pnpm run type-check   # TypeScript type checking

# Testing the CLI locally
pnpm run build && node dist/cli/index.js init
pnpm run build && node dist/cli/index.js dev
pnpm run build && node dist/cli/index.js package
```

## Important Implementation Details

### Type System

- Uses Zod for runtime validation and TypeScript type generation
- Exports comprehensive AWS Lambda event/context types
- Configuration types are generated from Zod schemas

### Hot Reload Implementation

- File watcher monitors TypeScript/JavaScript changes
- Handler cache is cleared on file changes
- Handlers are recompiled using esbuild on-demand

### WebSocket Features

- Simulates AWS API Gateway WebSocket events ($connect, $disconnect, custom routes)
- Management API allows server-to-client messaging for testing
- Connection tracking with automatic cleanup

### Handler Resolution

- Supports both TypeScript (.ts) and JavaScript (.js, .mjs) handlers
- Handler format: `path/to/file.exportName` (exportName defaults to 'handler')
- Automatic compilation of TypeScript handlers during development

## Code Patterns

### Error Handling

- Uses custom error classes (e.g., `ConfigValidationError`)
- Comprehensive CLI error reporting with helpful messages
- Graceful server shutdown handling

### Configuration Management

- Zod schemas provide single source of truth for configuration structure
- JSON schema generation enables IDE IntelliSense
- Environment variable support for build-time and runtime configuration

### Module Structure

- Each major component exports through index.ts files
- Clean separation between CLI, server, bundler, and configuration concerns
- TypeScript strict mode enabled throughout

## Testing Approach

When testing Lambda Dev Tools functionality:

1. Use the `init` command to create test projects
2. Test both HTTP and WebSocket handlers
3. Verify hot reload by modifying handler files
4. Test package command produces expected build artifacts
5. Verify YAML IntelliSense works with the generated JSON schema
