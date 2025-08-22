import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateJsonSchema, writeJsonSchemaToFile } from './generate-schema.js';

describe('generateJsonSchema', () => {
  it('should generate valid JSON schema from Zod schema', () => {
    const schema = generateJsonSchema();

    expect(schema).toBeDefined();
    expect(schema).toHaveProperty('type');
    expect(schema).toHaveProperty('properties');
    expect(schema.type).toBe('object');

    // Check for main properties
    expect(schema.properties).toHaveProperty('service');
    expect(schema.properties).toHaveProperty('functions');
    expect(schema.properties).toHaveProperty('server');
    expect(schema.properties).toHaveProperty('build');
    expect(schema.properties).toHaveProperty('environment');
  });

  it('should generate schema with correct service property', () => {
    const schema = generateJsonSchema();

    expect(schema.properties.service).toHaveProperty('type', 'string');
    expect(schema.properties.service).toHaveProperty('description', 'Service name');
  });

  it('should generate schema with correct functions property', () => {
    const schema = generateJsonSchema();

    expect(schema.properties.functions).toHaveProperty('type', 'object');
    expect(schema.properties.functions).toHaveProperty('description', 'Lambda functions configuration');
    expect(schema.properties.functions).toHaveProperty('additionalProperties');
  });

  it('should generate schema with correct server property', () => {
    const schema = generateJsonSchema();

    expect(schema.properties.server).toHaveProperty('type', 'object');
    expect(schema.properties.server).toHaveProperty('properties');
    expect(schema.properties.server.properties).toHaveProperty('port');
    expect(schema.properties.server.properties).toHaveProperty('host');
    expect(schema.properties.server.properties).toHaveProperty('cors');
    expect(schema.properties.server.properties).toHaveProperty('websocket');
  });

  it('should generate schema with correct build property', () => {
    const schema = generateJsonSchema();

    expect(schema.properties.build).toHaveProperty('type', 'object');
    expect(schema.properties.build).toHaveProperty('properties');
    expect(schema.properties.build.properties).toHaveProperty('outDir');
    expect(schema.properties.build.properties).toHaveProperty('target');
    expect(schema.properties.build.properties).toHaveProperty('minify');
    expect(schema.properties.build.properties).toHaveProperty('sourcemap');
    expect(schema.properties.build.properties).toHaveProperty('external');
  });

  it('should generate schema with required fields', () => {
    const schema = generateJsonSchema();

    expect(schema).toHaveProperty('required');
    expect(schema.required).toContain('service');
    expect(schema.required).toContain('functions');
  });
});

describe('writeJsonSchemaToFile', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `schema-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should write JSON schema to specified path', async () => {
    const outputPath = join(testDir, 'test-schema.json');

    const resultPath = await writeJsonSchemaToFile(outputPath);

    expect(resultPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const content = readFileSync(outputPath, 'utf-8');
    const parsedSchema = JSON.parse(content);

    expect(parsedSchema).toHaveProperty('type', 'object');
    expect(parsedSchema).toHaveProperty('properties');
  });

  it('should create directory if it does not exist', async () => {
    const outputPath = join(testDir, 'nested', 'dir', 'schema.json');

    const resultPath = await writeJsonSchemaToFile(outputPath);

    expect(resultPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);
  });

  it('should format JSON with proper indentation', async () => {
    const outputPath = join(testDir, 'formatted.json');

    await writeJsonSchemaToFile(outputPath);

    const content = readFileSync(outputPath, 'utf-8');

    // Check for proper formatting (2 space indentation)
    expect(content).toContain('  "type": "object"');
    expect(content).toContain('  "properties": {');
    expect(content).toContain('    "service": {');
  });

  it('should overwrite existing file', async () => {
    const outputPath = join(testDir, 'existing.json');

    // Write first time
    await writeJsonSchemaToFile(outputPath);
    const firstContent = readFileSync(outputPath, 'utf-8');

    // Write second time
    await writeJsonSchemaToFile(outputPath);
    const secondContent = readFileSync(outputPath, 'utf-8');

    // Content should be the same
    expect(secondContent).toBe(firstContent);
    expect(existsSync(outputPath)).toBe(true);
  });

  describe('CLI execution coverage', () => {
    it('should ensure CLI execution path is covered', async () => {
      // This test ensures the CLI execution code path exists
      // The actual CLI condition can't be easily tested in vitest,
      // but we can verify the function works correctly when called
      const schemaPath = await writeJsonSchemaToFile();

      expect(typeof schemaPath).toBe('string');
      expect(schemaPath).toContain('config-schema.json');
      expect(existsSync(schemaPath)).toBe(true);
    });
  });
});
