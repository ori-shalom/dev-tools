import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPackageCommand } from './package.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';

// Mock dependencies
vi.mock('../../config/parser.js', () => ({
  ConfigParser: {
    parseFile: vi.fn(),
  },
}));

vi.mock('../../bundler/esbuild-bundler.js', () => ({
  ESBuildBundler: vi.fn().mockImplementation(() => ({
    bundleAll: vi.fn(),
  })),
}));

vi.mock('../../bundler/zip-packager.js', () => ({
  ZipPackager: vi.fn().mockImplementation(() => ({
    packageAll: vi.fn(),
  })),
}));

describe('Package Command', () => {
  let testDir: string;
  let configPath: string;
  let originalCwd: () => string;
  let originalExit: typeof process.exit;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `package-command-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    mkdirSync(testDir, { recursive: true });
    configPath = join(testDir, 'dev-tools.yaml');

    originalCwd = process.cwd;
    originalExit = process.exit;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    process.cwd = vi.fn(() => testDir);
  });

  afterEach(() => {
    process.cwd = originalCwd;
    process.exit = originalExit;

    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }

    vi.clearAllMocks();
  });

  describe('createPackageCommand', () => {
    it('should create a Command instance with correct name', () => {
      const command = createPackageCommand();

      expect(command.name()).toBe('package');
    });

    it('should have correct description', () => {
      const command = createPackageCommand();

      expect(command.description()).toBe('Build and package Lambda functions');
    });

    it('should have all expected options', () => {
      const command = createPackageCommand();
      const options = command.options;

      expect(options).toHaveLength(5);

      const optionFlags = options.map((opt) => opt.flags);
      expect(optionFlags).toContain('-c, --config <path>');
      expect(optionFlags).toContain('-o, --output <dir>');
      expect(optionFlags).toContain('--no-minify');
      expect(optionFlags).toContain('--sourcemap');
      expect(optionFlags).toContain('-f, --function <name>');
    });

    it('should have default option values', () => {
      const command = createPackageCommand();
      const configOption = command.options.find((opt) => opt.flags === '-c, --config <path>');
      const outputOption = command.options.find((opt) => opt.flags === '-o, --output <dir>');

      expect(configOption?.defaultValue).toBe('dev-tools.yaml');
      expect(outputOption?.defaultValue).toBe('lambda-packages');
    });
  });

  describe('package command execution', () => {
    it('should handle missing configuration file', async () => {
      const command = createPackageCommand();
      await command.parseAsync(['node', 'test', '--config', 'nonexistent.yaml']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration file not found'));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Create a dev-tools.yaml file or specify a different path with --config',
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should parse configuration and execute packaging pipeline', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');
      const { ZipPackager } = await import('../../bundler/zip-packager.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          testFunc: {
            handler: 'src/handler.test',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      const mockBundleResults = [
        {
          functionName: 'testFunc',
          size: 1024,
          outputPath: '/dist/testFunc.js',
          warnings: [],
        },
      ];

      const mockPackageResults = [
        {
          functionName: 'testFunc',
          size: 2048,
          zipPath: '/packages/testFunc.zip',
        },
      ];

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => ({
        bundleAll: vi.fn().mockResolvedValue(mockBundleResults),
      }));
      (ZipPackager as any).mockImplementation(() => ({
        packageAll: vi.fn().mockResolvedValue(mockPackageResults),
      }));

      const command = createPackageCommand();
      await command.parseAsync(['node', 'test', '--config', configPath]);

      expect(ConfigParser.parseFile).toHaveBeenCalledWith(configPath);
      expect(consoleLogSpy).toHaveBeenCalledWith(`Loading configuration from: ${configPath}`);
    });

    it('should override minify option when --no-minify is used', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');
      const { ZipPackager } = await import('../../bundler/zip-packager.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          testFunc: {
            handler: 'src/handler.test',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => ({
        bundleAll: vi.fn().mockResolvedValue([]),
      }));
      (ZipPackager as any).mockImplementation(() => ({
        packageAll: vi.fn().mockResolvedValue([]),
      }));

      const command = createPackageCommand();
      await command.parseAsync(['node', 'test', '--no-minify']);

      expect(mockConfig.build.minify).toBe(false);
    });

    it('should enable sourcemap when --sourcemap is used', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');
      const { ZipPackager } = await import('../../bundler/zip-packager.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          testFunc: {
            handler: 'src/handler.test',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => ({
        bundleAll: vi.fn().mockResolvedValue([]),
      }));
      (ZipPackager as any).mockImplementation(() => ({
        packageAll: vi.fn().mockResolvedValue([]),
      }));

      const command = createPackageCommand();
      await command.parseAsync(['node', 'test', '--sourcemap']);

      expect(mockConfig.build.sourcemap).toBe(true);
    });

    it('should package specific function when --function is used', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');
      const { ZipPackager } = await import('../../bundler/zip-packager.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          func1: {
            handler: 'src/func1.handler',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
          func2: {
            handler: 'src/func2.handler',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      const mockBundler = {
        bundleAll: vi.fn().mockResolvedValue([
          {
            functionName: 'func1',
            size: 1024,
            outputPath: '/dist/func1.js',
            warnings: [],
          },
        ]),
      };

      const mockPackager = {
        packageAll: vi.fn().mockResolvedValue([
          {
            functionName: 'func1',
            size: 2048,
            zipPath: '/packages/func1.zip',
          },
        ]),
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => mockBundler);
      (ZipPackager as any).mockImplementation(() => mockPackager);

      const command = createPackageCommand();
      await command.parseAsync(['node', 'test', '--function', 'func1']);

      expect(mockBundler.bundleAll).toHaveBeenCalledWith(
        expect.objectContaining({
          functions: { func1: mockConfig.functions.func1 },
        }),
        testDir,
      );
    });

    it('should error when specified function does not exist', async () => {
      const { ConfigParser } = await import('../../config/parser.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          existingFunc: {
            handler: 'src/handler.test',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);

      const command = createPackageCommand();
      await command.parseAsync(['node', 'test', '--function', 'nonexistentFunc']);

      expect(consoleErrorSpy).toHaveBeenCalledWith("Function 'nonexistentFunc' not found in configuration");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should use custom output directory when --output is specified', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');
      const { ZipPackager } = await import('../../bundler/zip-packager.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          testFunc: {
            handler: 'src/handler.test',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      const mockBundleResults = [
        {
          functionName: 'testFunc',
          size: 1024,
          outputPath: '/dist/testFunc.js',
          warnings: [],
        },
      ];

      const mockPackager = {
        packageAll: vi.fn().mockResolvedValue([
          {
            functionName: 'testFunc',
            size: 2048,
            zipPath: '/custom-output/testFunc.zip',
          },
        ]),
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => ({
        bundleAll: vi.fn().mockResolvedValue(mockBundleResults),
      }));
      (ZipPackager as any).mockImplementation(() => mockPackager);

      const command = createPackageCommand();
      await command.parseAsync(['node', 'test', '--output', 'custom-output']);

      expect(mockPackager.packageAll).toHaveBeenCalledWith(mockBundleResults, testDir, 'custom-output');
    });

    it('should display package summary with bundle and package results', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');
      const { ZipPackager } = await import('../../bundler/zip-packager.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          testFunc: {
            handler: 'src/handler.test',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      const mockBundleResults = [
        {
          functionName: 'testFunc',
          size: 1024,
          outputPath: '/dist/testFunc.js',
          warnings: ['Test warning'],
        },
      ];

      const mockPackageResults = [
        {
          functionName: 'testFunc',
          size: 2048,
          zipPath: '/packages/testFunc.zip',
        },
      ];

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => ({
        bundleAll: vi.fn().mockResolvedValue(mockBundleResults),
      }));
      (ZipPackager as any).mockImplementation(() => ({
        packageAll: vi.fn().mockResolvedValue(mockPackageResults),
      }));

      const command = createPackageCommand();
      await command.parseAsync(['node', 'test']);

      const allLogCalls = consoleLogSpy.mock.calls.map((call) => call[0]).join(' ');
      expect(allLogCalls).toContain('Packaging completed successfully!');
      expect(allLogCalls).toContain('testFunc:');
      expect(allLogCalls).toContain('Bundle size: 1 KB');
      expect(allLogCalls).toContain('Package size: 2 KB');
      expect(allLogCalls).toContain('Total bundle size: 1 KB');
      expect(allLogCalls).toContain('Total package size: 2 KB');
      expect(allLogCalls).toContain('Build warnings (1):');
      expect(allLogCalls).toContain('Ready for deployment!');
    });

    it('should handle bundling errors', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');
      const { ZipPackager } = await import('../../bundler/zip-packager.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          testFunc: {
            handler: 'src/handler.test',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => ({
        bundleAll: vi.fn().mockRejectedValue(new Error('Bundle failed')),
      }));
      (ZipPackager as any).mockImplementation(() => ({
        packageAll: vi.fn(),
      }));

      const command = createPackageCommand();
      await command.parseAsync(['node', 'test']);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to package functions: Bundle failed');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle packaging errors', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');
      const { ZipPackager } = await import('../../bundler/zip-packager.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          testFunc: {
            handler: 'src/handler.test',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      const mockBundleResults = [
        {
          functionName: 'testFunc',
          size: 1024,
          outputPath: '/dist/testFunc.js',
          warnings: [],
        },
      ];

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => ({
        bundleAll: vi.fn().mockResolvedValue(mockBundleResults),
      }));
      (ZipPackager as any).mockImplementation(() => ({
        packageAll: vi.fn().mockRejectedValue(new Error('Package failed')),
      }));

      const command = createPackageCommand();
      await command.parseAsync(['node', 'test']);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to package functions: Package failed');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle non-Error exceptions', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');
      const { ZipPackager } = await import('../../bundler/zip-packager.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          testFunc: {
            handler: 'src/handler.test',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => ({
        bundleAll: vi.fn().mockRejectedValue('String error'),
      }));
      (ZipPackager as any).mockImplementation(() => ({
        packageAll: vi.fn(),
      }));

      const command = createPackageCommand();
      await command.parseAsync(['node', 'test']);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to package functions:', 'String error');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle missing bundle result in package results', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');
      const { ZipPackager } = await import('../../bundler/zip-packager.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          testFunc: {
            handler: 'src/handler.test',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      const mockBundleResults = [
        {
          functionName: 'differentFunc',
          size: 1024,
          outputPath: '/dist/differentFunc.js',
          warnings: [],
        },
      ];

      const mockPackageResults = [
        {
          functionName: 'testFunc',
          size: 2048,
          zipPath: '/packages/testFunc.zip',
        },
      ];

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => ({
        bundleAll: vi.fn().mockResolvedValue(mockBundleResults),
      }));
      (ZipPackager as any).mockImplementation(() => ({
        packageAll: vi.fn().mockResolvedValue(mockPackageResults),
      }));

      const command = createPackageCommand();
      await command.parseAsync(['node', 'test']);

      // Should complete without errors even when bundle result is missing
      const allLogCalls = consoleLogSpy.mock.calls.map((call) => call[0]).join(' ');
      expect(allLogCalls).toContain('Packaging completed successfully!');
    });
  });

  describe('formatBytes utility function', () => {
    it('should format bytes in package summary output', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');
      const { ZipPackager } = await import('../../bundler/zip-packager.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          testFunc: {
            handler: 'src/handler.test',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      const mockBundleResults = [
        {
          functionName: 'testFunc',
          size: 1024, // Should format as "1 KB"
          outputPath: '/dist/testFunc.js',
          warnings: [],
        },
      ];

      const mockPackageResults = [
        {
          functionName: 'testFunc',
          size: 2048, // Should format as "2 KB"
          zipPath: '/packages/testFunc.zip',
        },
      ];

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => ({
        bundleAll: vi.fn().mockResolvedValue(mockBundleResults),
      }));
      (ZipPackager as any).mockImplementation(() => ({
        packageAll: vi.fn().mockResolvedValue(mockPackageResults),
      }));

      const command = createPackageCommand();
      await command.parseAsync(['node', 'test']);

      const allLogCalls = consoleLogSpy.mock.calls.map((call) => call[0]).join(' ');
      expect(allLogCalls).toContain('Bundle size: 1 KB');
      expect(allLogCalls).toContain('Package size: 2 KB');
      expect(allLogCalls).toContain('Total bundle size: 1 KB');
      expect(allLogCalls).toContain('Total package size: 2 KB');
    });
  });
});
