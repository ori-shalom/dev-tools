import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDevCommand } from './dev.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';

// Mock dependencies
vi.mock('../../config/parser.js', () => ({
  ConfigParser: {
    parseFile: vi.fn(),
  },
}));

vi.mock('../../server/http-server.js', () => ({
  HttpServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../server/websocket-server.js', () => ({
  LambdaWebSocketServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../server/management-server.js', () => ({
  ManagementServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../utils/handler-loader.js', () => ({
  HandlerLoader: vi.fn().mockImplementation(() => ({
    loadHandler: vi.fn().mockResolvedValue(() => Promise.resolve({ statusCode: 200 })),
    clearCache: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('../../utils/file-watcher.js', () => ({
  FileWatcher: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

describe('Dev Command', () => {
  let testDir: string;
  let configPath: string;
  let originalCwd: () => string;
  let originalExit: typeof process.exit;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `dev-command-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
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

  describe('createDevCommand', () => {
    it('should create a Command instance with correct name', () => {
      const command = createDevCommand();

      expect(command.name()).toBe('dev');
    });

    it('should have correct description', () => {
      const command = createDevCommand();

      expect(command.description()).toBe('Start local development server');
    });

    it('should have all expected options', () => {
      const command = createDevCommand();
      const options = command.options;

      expect(options).toHaveLength(4);

      const optionFlags = options.map((opt) => opt.flags);
      expect(optionFlags).toContain('-c, --config <path>');
      expect(optionFlags).toContain('-p, --port <port>');
      expect(optionFlags).toContain('-w, --websocket-port <port>');
      expect(optionFlags).toContain('--no-watch');
    });

    it('should have default option values', () => {
      const command = createDevCommand();
      const configOption = command.options.find((opt) => opt.flags === '-c, --config <path>');
      const portOption = command.options.find((opt) => opt.flags === '-p, --port <port>');
      const wsPortOption = command.options.find((opt) => opt.flags === '-w, --websocket-port <port>');

      expect(configOption?.defaultValue).toBe('dev-tools.yaml');
      expect(portOption?.defaultValue).toBe('3000');
      expect(wsPortOption?.defaultValue).toBe('3001');
    });
  });

  describe('dev command execution', () => {
    it('should handle missing configuration file', async () => {
      const command = createDevCommand();
      await command.parseAsync(['node', 'test', '--config', 'nonexistent.yaml']);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Configuration file not found'));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Create a dev-tools.yaml file or specify a different path with --config',
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should start development servers with default configuration', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { HttpServer } = await import('../../server/http-server.js');
      const { LambdaWebSocketServer } = await import('../../server/websocket-server.js');
      const { ManagementServer } = await import('../../server/management-server.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          hello: {
            handler: 'src/handlers/hello.handler',
            events: [{ type: 'http', method: 'GET', path: '/hello', cors: true }],
            memorySize: 128,
            timeout: 30,
          },
          websocket: {
            handler: 'src/handlers/ws.handler',
            events: [{ type: 'websocket', route: '$connect' }],
            memorySize: 128,
            timeout: 30,
          },
        },
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
          websocket: {
            port: 3001,
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

      const command = createDevCommand();
      await command.parseAsync(['node', 'test', '--config', configPath]);

      expect(ConfigParser.parseFile).toHaveBeenCalledWith(configPath);
      expect(HttpServer).toHaveBeenCalled();
      expect(LambdaWebSocketServer).toHaveBeenCalled();
      expect(ManagementServer).toHaveBeenCalled();

      const allLogCalls = consoleLogSpy.mock.calls.map((call) => call[0]).join(' ');
      expect(allLogCalls).toContain(`Loading configuration from: ${configPath}`);
      expect(allLogCalls).toContain('Starting development server for service: test-service');
      expect(allLogCalls).toContain('🚀 Development server is running!');
    });

    it('should override ports from CLI options', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { HttpServer } = await import('../../server/http-server.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {},
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
          websocket: {
            port: 3001,
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

      const command = createDevCommand();
      await command.parseAsync(['node', 'test', '--port', '8080', '--websocket-port', '8081']);

      expect(mockConfig.server.port).toBe(8080);
      expect(mockConfig.server.websocket.port).toBe(8081);
    });

    it('should create websocket config when not present and websocket-port is specified', async () => {
      const { ConfigParser } = await import('../../config/parser.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {},
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
          // No websocket config initially
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);

      const command = createDevCommand();
      await command.parseAsync(['node', 'test', '--websocket-port', '9001']);

      expect(mockConfig.server.websocket).toEqual({ port: 9001 });
    });

    it('should setup file watching when --no-watch is not used', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { FileWatcher } = await import('../../utils/file-watcher.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {},
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      const mockFileWatcher = {
        on: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (FileWatcher as any).mockImplementation(() => mockFileWatcher);

      const command = createDevCommand();
      await command.parseAsync(['node', 'test']);

      expect(FileWatcher).toHaveBeenCalled();
      expect(mockFileWatcher.on).toHaveBeenCalledWith('file-change', expect.any(Function));
      expect(mockFileWatcher.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockFileWatcher.start).toHaveBeenCalledWith(['src/**/*', configPath]);
      expect(consoleLogSpy).toHaveBeenCalledWith('File watching enabled for hot reload');
    });

    it('should skip file watching when --no-watch is used', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { FileWatcher } = await import('../../utils/file-watcher.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {},
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);

      const command = createDevCommand();
      await command.parseAsync(['node', 'test', '--no-watch']);

      expect(FileWatcher).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith('🔄 Hot reload: disabled');
    });

    it('should display function information with HTTP events', async () => {
      const { ConfigParser } = await import('../../config/parser.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          'api-function': {
            handler: 'src/handlers/api.handler',
            events: [
              { type: 'http', method: 'GET', path: '/api/test', cors: true },
              { type: 'http', method: 'POST', path: '/api/test', cors: false },
            ],
            memorySize: 128,
            timeout: 30,
          },
        },
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);

      const command = createDevCommand();
      await command.parseAsync(['node', 'test']);

      const allLogCalls = consoleLogSpy.mock.calls.map((call) => call[0]).join(' ');
      expect(allLogCalls).toContain('Lambda functions:');
      expect(allLogCalls).toContain('📦 api-function: src/handlers/api.handler');
      expect(allLogCalls).toContain('- HTTP GET /api/test');
      expect(allLogCalls).toContain('- HTTP POST /api/test');
    });

    it('should display function information with WebSocket events', async () => {
      const { ConfigParser } = await import('../../config/parser.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          'ws-function': {
            handler: 'src/handlers/websocket.handler',
            events: [
              { type: 'websocket', route: '$connect' },
              { type: 'websocket', route: '$disconnect' },
              { type: 'websocket', route: 'message' },
            ],
            memorySize: 128,
            timeout: 30,
          },
        },
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);

      const command = createDevCommand();
      await command.parseAsync(['node', 'test']);

      const allLogCalls = consoleLogSpy.mock.calls.map((call) => call[0]).join(' ');
      expect(allLogCalls).toContain('Lambda functions:');
      expect(allLogCalls).toContain('📦 ws-function: src/handlers/websocket.handler');
      expect(allLogCalls).toContain('- WebSocket $connect');
      expect(allLogCalls).toContain('- WebSocket $disconnect');
      expect(allLogCalls).toContain('- WebSocket message');
    });

    it('should display message for functions with no events', async () => {
      const { ConfigParser } = await import('../../config/parser.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {
          'worker-function': {
            handler: 'src/handlers/worker.handler',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);

      const command = createDevCommand();
      await command.parseAsync(['node', 'test']);

      expect(consoleLogSpy).toHaveBeenCalledWith('  📦 worker-function: src/handlers/worker.handler');
      expect(consoleLogSpy).toHaveBeenCalledWith('    - No events (programmatically invoked)');
    });

    it('should display server URLs with default ports when no CLI options provided', async () => {
      const { ConfigParser } = await import('../../config/parser.js');

      writeFileSync(configPath, 'service: test');

      (ConfigParser.parseFile as any).mockImplementation(() => ({
        service: 'test-service',
        functions: {},
        server: {
          port: 4000,
          host: '0.0.0.0',
          cors: true,
          websocket: {
            port: 4001,
          },
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      }));

      const command = createDevCommand();
      await command.parseAsync(['node', 'test']);

      const allLogCalls = consoleLogSpy.mock.calls.map((call) => call[0]).join(' ');
      expect(allLogCalls).toContain('🌐 HTTP server: http://0.0.0.0:3000');
      expect(allLogCalls).toContain('🔌 WebSocket server: ws://0.0.0.0:3001');
      expect(allLogCalls).toContain('⚙️  Management API: http://0.0.0.0:3002');
    });

    it('should use CLI default ports even with different config values', async () => {
      const { ConfigParser } = await import('../../config/parser.js');

      writeFileSync(configPath, 'service: test');

      (ConfigParser.parseFile as any).mockImplementation(() => ({
        service: 'test-service',
        functions: {},
        server: {
          port: 5000,
          host: 'localhost',
          cors: true,
          // No websocket config
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      }));

      const command = createDevCommand();
      await command.parseAsync(['node', 'test']);

      const allLogCalls = consoleLogSpy.mock.calls.map((call) => call[0]).join(' ');
      expect(allLogCalls).toContain('🔌 WebSocket server: ws://localhost:3001');
      expect(allLogCalls).toContain('⚙️  Management API: http://localhost:3002');
    });

    it('should handle server startup errors', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { HttpServer } = await import('../../server/http-server.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {},
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (HttpServer as any).mockImplementation(() => ({
        start: vi.fn().mockRejectedValue(new Error('Port already in use')),
        stop: vi.fn().mockResolvedValue(undefined),
      }));

      const command = createDevCommand();
      await command.parseAsync(['node', 'test']);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to start development server: Port already in use');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle non-Error exceptions', async () => {
      const { ConfigParser } = await import('../../config/parser.js');
      const { HttpServer } = await import('../../server/http-server.js');

      writeFileSync(configPath, 'service: test');

      const mockConfig = {
        service: 'test-service',
        functions: {},
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      };

      (ConfigParser.parseFile as any).mockReturnValue(mockConfig);
      (HttpServer as any).mockImplementation(() => ({
        start: vi.fn().mockRejectedValue('String error'),
        stop: vi.fn().mockResolvedValue(undefined),
      }));

      const command = createDevCommand();
      await command.parseAsync(['node', 'test']);

      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to start development server:', 'String error');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should complete dev server setup successfully', async () => {
      const { ConfigParser } = await import('../../config/parser.js');

      writeFileSync(configPath, 'service: test');

      (ConfigParser.parseFile as any).mockImplementation(() => ({
        service: 'test-service',
        functions: {},
        server: {
          port: 3000,
          host: 'localhost',
          cors: true,
        },
        build: {
          outDir: './dist',
          target: 'node18',
          minify: true,
          sourcemap: false,
        },
      }));

      const command = createDevCommand();

      // This should complete successfully without throwing
      await expect(command.parseAsync(['node', 'test'])).resolves.not.toThrow();

      // Verify that the dev server initialization started properly
      const allLogCalls = consoleLogSpy.mock.calls.map((call) => call[0]).join(' ');
      expect(allLogCalls).toContain('Loading configuration from:');
      expect(allLogCalls).toContain('Starting development server for service: test-service');
    });
  });
});
