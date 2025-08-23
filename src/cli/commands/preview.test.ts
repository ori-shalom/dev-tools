import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPreviewCommand } from './preview.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';

// Mock dependencies
vi.mock('../../config/parser.js', () => ({
  ConfigParser: {
    parseFile: vi.fn(),
  },
}));

vi.mock('../../server/native-unified-server.js', () => ({
  NativeUnifiedServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../utils/console.js', () => ({
  ConsoleMessages: {
    printStartupMessage: vi.fn(),
  },
}));

describe('Preview Command', () => {
  let testDir: string;
  let configPath: string;
  let buildDir: string;
  let originalCwd: () => string;
  let originalExit: typeof process.exit;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `preview-command-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    mkdirSync(testDir, { recursive: true });
    configPath = join(testDir, 'dev-tools.yaml');
    buildDir = join(testDir, 'lambda-build');

    originalCwd = process.cwd;
    originalExit = process.exit;

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`Process exit called with code ${code}`);
    });

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
  describe('createPreviewCommand', () => {
    it('should create a Command instance with correct name', () => {
      const command = createPreviewCommand();

      expect(command.name()).toBe('preview');
    });

    it('should have correct description', () => {
      const command = createPreviewCommand();

      expect(command.description()).toBe('Preview built Lambda functions without hot reload');
    });

    it('should have all expected options', () => {
      const command = createPreviewCommand();
      const options = command.options;

      expect(options).toHaveLength(5);

      const optionFlags = options.map((opt) => opt.flags);
      expect(optionFlags).toContain('-c, --config <path>');
      expect(optionFlags).toContain('-p, --port <number>');
      expect(optionFlags).toContain('-w, --ws-port <number>');
      expect(optionFlags).toContain('-m, --mgmt-port <number>');
      expect(optionFlags).toContain('-d, --build-dir <path>');
    });

    it('should have default option values', () => {
      const command = createPreviewCommand();
      const configOption = command.options.find((opt) => opt.flags === '-c, --config <path>');
      const portOption = command.options.find((opt) => opt.flags === '-p, --port <number>');
      const wsPortOption = command.options.find((opt) => opt.flags === '-w, --ws-port <number>');
      const mgmtPortOption = command.options.find((opt) => opt.flags === '-m, --mgmt-port <number>');
      const buildDirOption = command.options.find((opt) => opt.flags === '-d, --build-dir <path>');

      expect(configOption?.defaultValue).toBe('dev-tools.yaml');
      expect(portOption?.defaultValue).toBe('3000');
      expect(wsPortOption?.defaultValue).toBe('3001');
      expect(mgmtPortOption?.defaultValue).toBe('3002');
      expect(buildDirOption?.defaultValue).toBe('lambda-build');
    });

    it('should have action function defined', () => {
      const command = createPreviewCommand();

      // Verify the action callback is set up
      expect(command.action).toBeDefined();
      expect(typeof command.action).toBe('function');
    });

    it('should handle command structure validation', () => {
      const command = createPreviewCommand();

      // Test command structure
      expect(command.commands).toBeDefined();
      expect(Array.isArray(command.commands)).toBe(true);

      // Test options structure
      expect(command.options).toBeDefined();
      expect(Array.isArray(command.options)).toBe(true);
      expect(command.options).toHaveLength(5);
    });

    it('should validate option types and flags', () => {
      const command = createPreviewCommand();

      command.options.forEach((option) => {
        expect(option.flags).toBeDefined();
        expect(typeof option.flags).toBe('string');
        expect(option.flags.length).toBeGreaterThan(0);
      });
    });

    it('should have proper option configurations', () => {
      const command = createPreviewCommand();

      // Check that all options have proper configuration
      const configOption = command.options.find((opt) => opt.flags === '-c, --config <path>');
      const portOption = command.options.find((opt) => opt.flags === '-p, --port <number>');

      expect(configOption).toBeDefined();
      expect(portOption).toBeDefined();

      // Verify default values are strings as expected by commander
      expect(typeof configOption?.defaultValue).toBe('string');
      expect(typeof portOption?.defaultValue).toBe('string');
    });
  });

  describe('preview command execution', () => {
    it('should handle missing configuration file', async () => {
      const command = createPreviewCommand();

      await expect(command.parseAsync(['node', 'test', '--config', 'nonexistent.yaml'])).rejects.toThrow(
        'Process exit called with code 1',
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration file not found'));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Create a dev-tools.yaml file or specify a different path with --config',
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle missing build directory', async () => {
      const { ConfigParser } = await import('../../config/parser.js');

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
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);

      const command = createPreviewCommand();

      await expect(
        command.parseAsync(['node', 'test', '--config', configPath, '--build-dir', 'nonexistent-build']),
      ).rejects.toThrow('Process exit called with code 1');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Build directory not found'));
      expect(consoleLogSpy).toHaveBeenCalledWith('Run "dt build" first to create the build artifacts');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle configuration parsing errors', async () => {
      const { ConfigParser } = await import('../../config/parser.js');

      // Create config file
      writeFileSync(configPath, 'service: test');

      (ConfigParser.parseFile as any).mockImplementation(() => {
        throw new Error('Invalid configuration');
      });

      const command = createPreviewCommand();

      await expect(command.parseAsync(['node', 'test', '--config', configPath])).rejects.toThrow(
        'Process exit called with code 1',
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to start preview server: Invalid configuration');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle non-Error exceptions', async () => {
      const { ConfigParser } = await import('../../config/parser.js');

      // Create config file
      writeFileSync(configPath, 'service: test');

      (ConfigParser.parseFile as any).mockImplementation(() => {
        throw 'String error';
      });

      const command = createPreviewCommand();

      await expect(command.parseAsync(['node', 'test', '--config', configPath])).rejects.toThrow(
        'Process exit called with code 1',
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to start preview server:', 'String error');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should parse configuration and check build directory', async () => {
      const { ConfigParser } = await import('../../config/parser.js');

      // Create config file
      writeFileSync(configPath, 'service: test');

      // Create build directory
      mkdirSync(buildDir, { recursive: true });

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
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);

      const command = createPreviewCommand();

      // This test will get to the server initialization but will be stopped by the infinite promise
      // We'll use a timeout to prevent the test from hanging
      const promise = command.parseAsync(['node', 'test', '--config', configPath, '--build-dir', buildDir]);

      // Wait a short time to let the initialization run
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(ConfigParser.parseFile).toHaveBeenCalledWith(configPath);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('📦 Preview Mode: Serving built artifacts from'),
        expect.any(String),
      );
    });

    it('should initialize servers with correct configuration', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { NativeUnifiedServer } = await import('../../server/native-unified-server.js');

      // Create config file and build directory
      writeFileSync(configPath, 'service: test');
      mkdirSync(buildDir, { recursive: true });

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
      };

      const mockUnifiedServer = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (NativeUnifiedServer as any).mockImplementation(() => mockUnifiedServer);

      const command = createPreviewCommand();

      // Start the command and wait briefly for server initialization
      const promise = command.parseAsync([
        'node',
        'test',
        '--config',
        configPath,
        '--build-dir',
        buildDir,
        '--port',
        '4000',
      ]);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockUnifiedServer.start).toHaveBeenCalledWith(4000, '0.0.0.0');
    });

    it('should handle server initialization failure', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { NativeUnifiedServer } = await import('../../server/native-unified-server.js');

      // Create config file and build directory
      writeFileSync(configPath, 'service: test');
      mkdirSync(buildDir, { recursive: true });

      const mockConfig = {
        service: 'test-service',
        functions: {},
      };

      const mockUnifiedServer = {
        start: vi.fn().mockRejectedValue(new Error('Port already in use')),
        stop: vi.fn().mockResolvedValue(undefined),
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (NativeUnifiedServer as any).mockImplementation(() => mockUnifiedServer);

      const command = createPreviewCommand();

      await expect(
        command.parseAsync(['node', 'test', '--config', configPath, '--build-dir', buildDir]),
      ).rejects.toThrow('Process exit called with code 1');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to start preview server: Port already in use');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });
  });
});
