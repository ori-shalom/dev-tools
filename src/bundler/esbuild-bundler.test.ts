import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ESBuildBundler } from './esbuild-bundler.js';
import { BuildConfig, Config, LambdaFunction } from '../config/schema.js';

// Mock esbuild
vi.mock('esbuild', () => ({
  build: vi.fn(),
}));

describe('ESBuildBundler', () => {
  let testDir: string;
  let bundler: ESBuildBundler;
  let mockBuildConfig: BuildConfig;

  beforeEach(async () => {
    // Create unique test directory
    testDir = join(tmpdir(), `esbuild-bundler-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    mkdirSync(testDir, { recursive: true });

    // Create test build config
    mockBuildConfig = {
      outDir: './dist',
      target: 'node18',
      minify: true,
      sourcemap: false,
      external: [],
    };

    bundler = new ESBuildBundler(mockBuildConfig);

    // Create test handler files
    const srcDir = join(testDir, 'src', 'handlers');
    mkdirSync(srcDir, { recursive: true });

    // TypeScript handler
    writeFileSync(
      join(srcDir, 'hello.ts'),
      `
export async function handler(event: any, context: any) {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Hello from TypeScript!' }),
  };
}
`,
    );

    // JavaScript handler
    writeFileSync(
      join(srcDir, 'api.js'),
      `
exports.handler = async (event, context) => {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Hello from JavaScript!' }),
  };
};
`,
    );

    // Handler with export name
    writeFileSync(
      join(srcDir, 'custom.ts'),
      `
export async function customHandler(event: any, context: any) {
  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Custom handler!' }),
  };
}
`,
    );
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create bundler with build config', () => {
      const config: BuildConfig = {
        outDir: './custom-dist',
        target: 'node20',
        minify: false,
        sourcemap: true,
        external: ['aws-sdk'],
      };

      const customBundler = new ESBuildBundler(config);
      expect(customBundler).toBeInstanceOf(ESBuildBundler);
    });
  });

  describe('bundleFunction', () => {
    it('should bundle TypeScript function successfully', async () => {
      const { build } = await import('esbuild');
      const mockBuild = vi.mocked(build);

      mockBuild.mockResolvedValue({
        warnings: [],
        errors: [],
        metafile: {},
        outputFiles: [],
        mangleCache: {},
      });

      // Create expected output file for size calculation
      const outputDir = join(testDir, 'dist', 'hello');
      const outputFile = join(outputDir, 'index.js');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(outputFile, 'console.log("bundled code");');

      const functionConfig: LambdaFunction = {
        handler: 'src/handlers/hello.handler',
        events: [],
        timeout: 30,
        memorySize: 1024,
      };

      const result = await bundler.bundleFunction({
        config: {} as Config,
        functionName: 'hello',
        functionConfig,
        workingDir: testDir,
      });

      expect(result.functionName).toBe('hello');
      expect(result.outputPath).toBe(outputDir);
      expect(result.size).toBeGreaterThan(0);
      expect(result.dependencies).toBeInstanceOf(Array);
      expect(result.warnings).toEqual([]);
      expect(mockBuild).toHaveBeenCalledOnce();
    });

    it('should bundle JavaScript function successfully', async () => {
      const { build } = await import('esbuild');
      const mockBuild = vi.mocked(build);

      mockBuild.mockResolvedValue({
        warnings: [],
        errors: [],
        metafile: {},
        outputFiles: [],
        mangleCache: {},
      });

      const outputDir = join(testDir, 'dist', 'api');
      const outputFile = join(outputDir, 'index.js');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(outputFile, 'exports.handler = () => {};');

      const functionConfig: LambdaFunction = {
        handler: 'src/handlers/api.handler',
        events: [],
        timeout: 30,
        memorySize: 1024,
      };

      const result = await bundler.bundleFunction({
        config: {} as Config,
        functionName: 'api',
        functionConfig,
        workingDir: testDir,
      });

      expect(result.functionName).toBe('api');
      expect(mockBuild).toHaveBeenCalledOnce();
    });

    it('should handle esbuild warnings', async () => {
      const { build } = await import('esbuild');
      const mockBuild = vi.mocked(build);

      mockBuild.mockResolvedValue({
        warnings: [
          {
            text: 'unused import',
            location: {
              file: 'src/handlers/hello.ts',
              line: 1,
              column: 10,
            },
          },
        ],
        errors: [],
        metafile: {},
        outputFiles: [],
        mangleCache: {},
      });

      const outputDir = join(testDir, 'dist', 'hello');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, 'index.js'), 'test');

      const functionConfig: LambdaFunction = {
        handler: 'src/handlers/hello.handler',
        events: [],
        timeout: 30,
        memorySize: 1024,
      };

      const result = await bundler.bundleFunction({
        config: {} as Config,
        functionName: 'hello',
        functionConfig,
        workingDir: testDir,
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('unused import');
      expect(result.warnings[0]).toContain('src/handlers/hello.ts:1:10');
    });

    it('should throw error for non-existent handler', async () => {
      const functionConfig: LambdaFunction = {
        handler: 'src/handlers/nonexistent.handler',
        events: [],
        timeout: 30,
        memorySize: 1024,
      };

      await expect(
        bundler.bundleFunction({
          config: {} as Config,
          functionName: 'nonexistent',
          functionConfig,
          workingDir: testDir,
        }),
      ).rejects.toThrow(/Handler file not found/);
    });

    it('should handle esbuild build errors', async () => {
      const { build } = await import('esbuild');
      const mockBuild = vi.mocked(build);

      mockBuild.mockRejectedValue(new Error('TypeScript compilation error'));

      const functionConfig: LambdaFunction = {
        handler: 'src/handlers/hello.handler',
        events: [],
        timeout: 30,
        memorySize: 1024,
      };

      await expect(
        bundler.bundleFunction({
          config: {} as Config,
          functionName: 'hello',
          functionConfig,
          workingDir: testDir,
        }),
      ).rejects.toThrow(/ESBuild failed: TypeScript compilation error/);
    });

    it('should handle non-Error exceptions from esbuild', async () => {
      const { build } = await import('esbuild');
      const mockBuild = vi.mocked(build);

      // Simulate non-Error object being thrown
      mockBuild.mockRejectedValue('string error');

      const functionConfig: LambdaFunction = {
        handler: 'src/handlers/hello.handler',
        events: [],
        timeout: 30,
        memorySize: 1024,
      };

      await expect(
        bundler.bundleFunction({
          config: {} as Config,
          functionName: 'hello',
          functionConfig,
          workingDir: testDir,
        }),
      ).rejects.toBe('string error');
    });

    it('should resolve handler with different extensions', async () => {
      const { build } = await import('esbuild');
      const mockBuild = vi.mocked(build);

      mockBuild.mockResolvedValue({
        warnings: [],
        errors: [],
        metafile: {},
        outputFiles: [],
        mangleCache: {},
      });

      // Create handlers with different extensions
      const srcDir = join(testDir, 'src', 'handlers');
      writeFileSync(join(srcDir, 'mjs-handler.mjs'), 'export const handler = () => {};');
      writeFileSync(join(srcDir, 'mts-handler.mts'), 'export const handler = () => {};');

      const outputDir = join(testDir, 'dist', 'mjs-test');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, 'index.js'), 'test');

      const functionConfig: LambdaFunction = {
        handler: 'src/handlers/mjs-handler.handler',
        events: [],
        timeout: 30,
        memorySize: 1024,
      };

      const result = await bundler.bundleFunction({
        config: {} as Config,
        functionName: 'mjs-test',
        functionConfig,
        workingDir: testDir,
      });

      expect(result.functionName).toBe('mjs-test');
      expect(mockBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          entryPoints: [expect.stringContaining('mjs-handler.mjs')],
        }),
      );
    });
  });

  describe('bundleAll', () => {
    it('should bundle all functions in config', async () => {
      const { build } = await import('esbuild');
      const mockBuild = vi.mocked(build);

      mockBuild.mockResolvedValue({
        warnings: [],
        errors: [],
        metafile: {},
        outputFiles: [],
        mangleCache: {},
      });

      // Create output files
      const helloDir = join(testDir, 'dist', 'hello');
      const apiDir = join(testDir, 'dist', 'api');
      mkdirSync(helloDir, { recursive: true });
      mkdirSync(apiDir, { recursive: true });
      writeFileSync(join(helloDir, 'index.js'), 'hello code');
      writeFileSync(join(apiDir, 'index.js'), 'api code');

      const config: Config = {
        service: 'test-service',
        functions: {
          hello: {
            handler: 'src/handlers/hello.handler',
            events: [],
            timeout: 30,
            memorySize: 1024,
          },
          api: {
            handler: 'src/handlers/api.handler',
            events: [],
            timeout: 30,
            memorySize: 1024,
          },
        },
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
          websocket: {
            port: 3001,
            pingInterval: 30000,
          },
        },
        build: mockBuildConfig,
      };

      const results = await bundler.bundleAll(config, testDir);

      expect(results).toHaveLength(2);
      expect(results[0].functionName).toBe('hello');
      expect(results[1].functionName).toBe('api');
      expect(mockBuild).toHaveBeenCalledTimes(2);
    });

    it('should handle bundle errors in bundleAll', async () => {
      const { build } = await import('esbuild');
      const mockBuild = vi.mocked(build);

      mockBuild.mockRejectedValueOnce(new Error('Build failed'));

      const config: Config = {
        service: 'test-service',
        functions: {
          failing: {
            handler: 'src/handlers/hello.handler',
            events: [],
            timeout: 30,
            memorySize: 1024,
          },
        },
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
          websocket: {
            port: 3001,
            pingInterval: 30000,
          },
        },
        build: mockBuildConfig,
      };

      await expect(bundler.bundleAll(config, testDir)).rejects.toThrow(/ESBuild failed: Build failed/);
    });

    it('should log warnings when bundle has warnings', async () => {
      const { build } = await import('esbuild');
      const mockBuild = vi.mocked(build);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockBuild.mockResolvedValue({
        warnings: [
          {
            text: 'Unused variable',
            location: {
              file: 'src/test.ts',
              line: 10,
              column: 5,
            },
          },
        ],
        errors: [],
        metafile: {},
        outputFiles: [],
        mangleCache: {},
      });

      const outputDir = join(testDir, 'dist', 'warned');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, 'index.js'), 'warned code');

      const config: Config = {
        service: 'test-service',
        functions: {
          warned: {
            handler: 'src/handlers/hello.handler',
            events: [],
            timeout: 30,
            memorySize: 1024,
          },
        },
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
          websocket: {
            port: 3001,
            pingInterval: 30000,
          },
        },
        build: mockBuildConfig,
      };

      await bundler.bundleAll(config, testDir);

      expect(consoleSpy).toHaveBeenCalledWith('Warnings for warned:');
      expect(consoleSpy).toHaveBeenCalledWith('  src/test.ts:10:5: Unused variable');

      consoleSpy.mockRestore();
    });

    it('should handle non-Error exceptions in bundleAll', async () => {
      const { build } = await import('esbuild');
      const mockBuild = vi.mocked(build);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockBuild.mockRejectedValueOnce('non-error failure');

      const config: Config = {
        service: 'test-service',
        functions: {
          failing: {
            handler: 'src/handlers/hello.handler',
            events: [],
            timeout: 30,
            memorySize: 1024,
          },
        },
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
          websocket: {
            port: 3001,
            pingInterval: 30000,
          },
        },
        build: mockBuildConfig,
      };

      await expect(bundler.bundleAll(config, testDir)).rejects.toBe('non-error failure');

      expect(consoleSpy).toHaveBeenCalledWith('✗ Failed to bundle failing:', 'non-error failure');

      consoleSpy.mockRestore();
    });
  });

  describe('dependency extraction', () => {
    it('should extract dependencies from bundled code', async () => {
      const { build } = await import('esbuild');
      const mockBuild = vi.mocked(build);

      mockBuild.mockResolvedValue({
        warnings: [],
        errors: [],
        metafile: {},
        outputFiles: [],
        mangleCache: {},
      });

      const outputDir = join(testDir, 'dist', 'deps-test');
      const outputFile = join(outputDir, 'index.js');
      mkdirSync(outputDir, { recursive: true });

      // Write bundled code with require statements
      writeFileSync(
        outputFile,
        `
const aws = require('aws-sdk');
const lodash = require('lodash');
const local = require('./local-module');
const path = require('/absolute/path');
module.exports = { handler: () => {} };
`,
      );

      const functionConfig: LambdaFunction = {
        handler: 'src/handlers/hello.handler',
        events: [],
        timeout: 30,
        memorySize: 1024,
      };

      const result = await bundler.bundleFunction({
        config: {} as Config,
        functionName: 'deps-test',
        functionConfig,
        workingDir: testDir,
      });

      expect(result.dependencies).toContain('aws-sdk');
      expect(result.dependencies).toContain('lodash');
      expect(result.dependencies).not.toContain('./local-module');
      expect(result.dependencies).not.toContain('/absolute/path');
    });

    it('should handle dependency extraction errors gracefully', async () => {
      const { build } = await import('esbuild');
      const mockBuild = vi.mocked(build);

      mockBuild.mockResolvedValue({
        warnings: [],
        errors: [],
        metafile: {},
        outputFiles: [],
        mangleCache: {},
      });

      // Don't create the output file to trigger dependency extraction error
      const outputDir = join(testDir, 'dist', 'no-deps');
      mkdirSync(outputDir, { recursive: true });

      const functionConfig: LambdaFunction = {
        handler: 'src/handlers/hello.handler',
        events: [],
        timeout: 30,
        memorySize: 1024,
      };

      const result = await bundler.bundleFunction({
        config: {} as Config,
        functionName: 'no-deps',
        functionConfig,
        workingDir: testDir,
      });

      expect(result.dependencies).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('should throw error when handler file does not exist', async () => {
      const functionConfig: LambdaFunction = {
        handler: 'src/handlers/nonexistent.handler',
        events: [],
        timeout: 30,
        memorySize: 1024,
      };

      await expect(
        bundler.bundleFunction({
          config: {} as Config,
          functionName: 'missing',
          functionConfig,
          workingDir: testDir,
        }),
      ).rejects.toThrow('Handler file not found');
    });
  });

  describe('utility methods', () => {
    it('should format bytes correctly', () => {
      // Access private method through type assertion for testing
      const bundlerWithPrivates = bundler as ESBuildBundler & {
        formatBytes(bytes: number): string;
      };

      expect(bundlerWithPrivates.formatBytes(0)).toBe('0 B');
      expect(bundlerWithPrivates.formatBytes(1024)).toBe('1 KB');
      expect(bundlerWithPrivates.formatBytes(1536)).toBe('1.5 KB');
      expect(bundlerWithPrivates.formatBytes(1048576)).toBe('1 MB');
      expect(bundlerWithPrivates.formatBytes(1572864)).toBe('1.5 MB');
    });

    it('should resolve handler paths with different formats', () => {
      const bundlerWithPrivates = bundler as ESBuildBundler & {
        resolveHandlerPath(handler: string, workingDir: string): string;
      };

      // Create test file structure
      const handlersDir = join(testDir, 'lib', 'handlers');
      mkdirSync(handlersDir, { recursive: true });
      writeFileSync(join(handlersDir, 'test.ts'), 'export const handler = () => {};');

      const resolved = bundlerWithPrivates.resolveHandlerPath('lib/handlers/test.handler', testDir);
      expect(resolved).toBe(join(testDir, 'lib', 'handlers', 'test.ts'));
    });

    it('should throw error when handler path cannot be resolved', () => {
      const bundlerWithPrivates = bundler as ESBuildBundler & {
        resolveHandlerPath(handler: string, workingDir: string): string;
      };

      expect(() => {
        bundlerWithPrivates.resolveHandlerPath('nonexistent/handler.handler', testDir);
      }).toThrow(/Handler file not found/);
    });

    it('should handle handler path without extension', () => {
      const bundlerWithPrivates = bundler as ESBuildBundler & {
        resolveHandlerPath(handler: string, workingDir: string): string;
      };

      // Create exact file without extension
      const handlersDir = join(testDir, 'exact');
      mkdirSync(handlersDir, { recursive: true });
      writeFileSync(join(handlersDir, 'handler'), 'module.exports = {};');

      const resolved = bundlerWithPrivates.resolveHandlerPath('exact/handler.main', testDir);
      expect(resolved).toBe(join(testDir, 'exact', 'handler'));
    });
  });

  describe('build options', () => {
    it('should use correct build options for different configurations', async () => {
      const { build } = await import('esbuild');
      const mockBuild = vi.mocked(build);

      mockBuild.mockResolvedValue({
        warnings: [],
        errors: [],
        metafile: {},
        outputFiles: [],
        mangleCache: {},
      });

      const customConfig: BuildConfig = {
        outDir: './custom-out',
        target: 'node20',
        minify: false,
        sourcemap: true,
        external: ['aws-sdk', 'lodash'],
      };

      const customBundler = new ESBuildBundler(customConfig);

      const outputDir = join(testDir, 'custom-out', 'test');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, 'index.js'), 'test');

      const functionConfig: LambdaFunction = {
        handler: 'src/handlers/hello.handler',
        events: [],
        timeout: 30,
        memorySize: 1024,
      };

      await customBundler.bundleFunction({
        config: {} as Config,
        functionName: 'test',
        functionConfig,
        workingDir: testDir,
      });

      expect(mockBuild).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'node20',
          minify: false,
          sourcemap: true,
          external: ['aws-sdk', 'lodash'],
          platform: 'node',
          format: 'esm',
          bundle: true,
        }),
      );
    });
  });
});
