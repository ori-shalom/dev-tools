import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBuildCommand } from './build.js';
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

describe('Build Command', () => {
  let testDir: string;
  let configPath: string;
  let originalCwd: () => string;
  let originalExit: typeof process.exit;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `build-command-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
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

  describe('createBuildCommand', () => {
    it('should create a Command instance with correct name', () => {
      const command = createBuildCommand();

      expect(command.name()).toBe('build');
    });

    it('should have correct description', () => {
      const command = createBuildCommand();

      expect(command.description()).toBe('Build Lambda functions without packaging');
    });

    it('should have all expected options', () => {
      const command = createBuildCommand();
      const options = command.options;

      expect(options).toHaveLength(4);

      const optionFlags = options.map((opt) => opt.flags);
      expect(optionFlags).toContain('-c, --config <path>');
      expect(optionFlags).toContain('--no-minify');
      expect(optionFlags).toContain('--sourcemap');
      expect(optionFlags).toContain('-f, --function <name>');
    });

    it('should have default config option value', () => {
      const command = createBuildCommand();
      const configOption = command.options.find((opt) => opt.flags === '-c, --config <path>');

      expect(configOption?.defaultValue).toBe('dev-tools.yaml');
    });
  });

  describe('build command execution', () => {
    it('should handle missing configuration file', async () => {
      const command = createBuildCommand();
      await command.parseAsync(['node', 'test', '--config', 'nonexistent.yaml']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration file not found'));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Create a dev-tools.yaml file or specify a different path with --config',
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should parse configuration from specified file', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');

      // Create config file
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

      const command = createBuildCommand();
      await command.parseAsync(['node', 'test', '--config', configPath]);

      expect(ConfigParser.parseFile).toHaveBeenCalledWith(configPath);
      expect(consoleLogSpy).toHaveBeenCalledWith(`Loading configuration from: ${configPath}`);
    });

    it('should override minify option when --no-minify is used', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');

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

      const command = createBuildCommand();
      await command.parseAsync(['node', 'test', '--no-minify']);

      expect(mockConfig.build.minify).toBe(false);
    });

    it('should enable sourcemap when --sourcemap is used', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');

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

      const command = createBuildCommand();
      await command.parseAsync(['node', 'test', '--sourcemap']);

      expect(mockConfig.build.sourcemap).toBe(true);
    });

    it('should build specific function when --function is used', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');

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

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => mockBundler);

      const command = createBuildCommand();
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

      const command = createBuildCommand();
      await command.parseAsync(['node', 'test', '--function', 'nonexistentFunc']);

      expect(consoleErrorSpy).toHaveBeenCalledWith("Function 'nonexistentFunc' not found in configuration");
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should display build summary with bundle results', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');

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
          size: 2048,
          outputPath: '/dist/testFunc.js',
          warnings: ['Test warning'],
        },
      ];

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => ({
        bundleAll: vi.fn().mockResolvedValue(mockBundleResults),
      }));

      const command = createBuildCommand();
      await command.parseAsync(['node', 'test']);

      // Check that important build messages were logged
      const allLogCalls = consoleLogSpy.mock.calls.map((call) => call[0]).join(' ');
      expect(allLogCalls).toContain('Build completed successfully!');
      expect(allLogCalls).toContain('testFunc:');
      expect(allLogCalls).toContain('Bundle size: 2 KB');
      expect(allLogCalls).toContain('Total bundle size: 2 KB');
      expect(allLogCalls).toContain('Build warnings (1):');
    });

    it('should handle build errors', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');

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
        bundleAll: vi.fn().mockRejectedValue(new Error('Build failed')),
      }));

      const command = createBuildCommand();
      await command.parseAsync(['node', 'test']);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to build functions: Build failed');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle non-Error exceptions', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');

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

      const command = createBuildCommand();
      await command.parseAsync(['node', 'test']);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to build functions:', 'String error');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('formatBytes utility function', () => {
    it('should format bytes in build summary output', async () => {
      // Test formatBytes indirectly through build summary
      const { ConfigParser } = await import('../../config/parser.js');
      const { ESBuildBundler } = await import('../../bundler/esbuild-bundler.js');

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
          size: 1024, // Should format as "1.0 KB"
          outputPath: '/dist/testFunc.js',
          warnings: [],
        },
      ];

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (ESBuildBundler as any).mockImplementation(() => ({
        bundleAll: vi.fn().mockResolvedValue(mockBundleResults),
      }));

      const command = createBuildCommand();
      await command.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Bundle size: 1 KB'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('📊 Total bundle size: 1 KB'));
    });
  });
});
