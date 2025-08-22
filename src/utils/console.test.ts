import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConsoleMessages } from './console.js';
import { Config } from '../config/schema.js';

describe('ConsoleMessages', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockConfig: Config;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockConfig = {
      service: 'test-service',
      functions: {
        'api-function': {
          handler: 'src/handlers/api.handler',
          events: [
            {
              type: 'http',
              path: '/api/users',
              method: 'GET',
            },
            {
              type: 'http',
              path: '/api/users',
              method: 'POST',
            },
          ],
          memorySize: 128,
          timeout: 30,
        },
        'ws-function': {
          handler: 'src/handlers/websocket.handler',
          events: [
            {
              type: 'websocket',
              route: '$connect',
            },
            {
              type: 'websocket',
              route: '$disconnect',
            },
          ],
          memorySize: 256,
          timeout: 30,
        },
        'mixed-function': {
          handler: 'src/handlers/mixed.handler',
          events: [
            {
              type: 'http',
              path: '/api/mixed',
              method: 'PUT',
            },
            {
              type: 'websocket',
              route: 'custom',
            },
          ],
          memorySize: 512,
          timeout: 60,
        },
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
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
        external: [],
      },
      environment: {
        NODE_ENV: 'development',
      },
    };
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('printStartupMessage', () => {
    it('should print complete startup message with all sections', () => {
      ConsoleMessages.printStartupMessage(mockConfig, 3000, 3001, 3002);

      // Verify header section
      expect(consoleLogSpy).toHaveBeenCalledWith('\n====================================');
      expect(consoleLogSpy).toHaveBeenCalledWith('🚀 Lambda Dev Tools Started');
      expect(consoleLogSpy).toHaveBeenCalledWith('====================================');

      // Verify service info
      expect(consoleLogSpy).toHaveBeenCalledWith('Service: test-service');
      expect(consoleLogSpy).toHaveBeenCalledWith('Functions: 3');

      // Verify servers section
      expect(consoleLogSpy).toHaveBeenCalledWith('\nServers:');
      expect(consoleLogSpy).toHaveBeenCalledWith('  HTTP:       http://localhost:3000');
      expect(consoleLogSpy).toHaveBeenCalledWith('  WebSocket:  ws://localhost:3001');
      expect(consoleLogSpy).toHaveBeenCalledWith('  Management: http://localhost:3002');

      // Verify endpoints section
      expect(consoleLogSpy).toHaveBeenCalledWith('\nEndpoints:');

      // Verify footer
      expect(consoleLogSpy).toHaveBeenCalledWith('\n📝 Watching for file changes...');
      expect(consoleLogSpy).toHaveBeenCalledWith('Press Ctrl+C to stop\n');
    });

    it('should print HTTP endpoints with correct formatting', () => {
      ConsoleMessages.printStartupMessage(mockConfig, 3000, 3001, 3002);

      // Check HTTP endpoints are formatted correctly
      expect(consoleLogSpy).toHaveBeenCalledWith('  GET     http://localhost:3000/api/users -> api-function');
      expect(consoleLogSpy).toHaveBeenCalledWith('  POST    http://localhost:3000/api/users -> api-function');
      expect(consoleLogSpy).toHaveBeenCalledWith('  PUT     http://localhost:3000/api/mixed -> mixed-function');
    });

    it('should print WebSocket endpoints with correct formatting', () => {
      ConsoleMessages.printStartupMessage(mockConfig, 3000, 3001, 3002);

      // Check WebSocket endpoints are formatted correctly
      expect(consoleLogSpy).toHaveBeenCalledWith('  WS      ws://localhost:3001/$connect -> ws-function');
      expect(consoleLogSpy).toHaveBeenCalledWith('  WS      ws://localhost:3001/$disconnect -> ws-function');
      expect(consoleLogSpy).toHaveBeenCalledWith('  WS      ws://localhost:3001/custom -> mixed-function');
    });

    it('should handle service with no functions', () => {
      const emptyConfig = {
        ...mockConfig,
        functions: {},
      };

      ConsoleMessages.printStartupMessage(emptyConfig, 3000, 3001, 3002);

      expect(consoleLogSpy).toHaveBeenCalledWith('Functions: 0');
      expect(consoleLogSpy).toHaveBeenCalledWith('\nEndpoints:');
      // Should not print any endpoint lines
    });

    it('should handle functions with no events', () => {
      const configWithNoEvents = {
        ...mockConfig,
        functions: {
          'no-events-function': {
            handler: 'src/handlers/empty.handler',
            events: [],
            memorySize: 128,
            timeout: 30,
          },
        },
      };

      ConsoleMessages.printStartupMessage(configWithNoEvents, 3000, 3001, 3002);

      expect(consoleLogSpy).toHaveBeenCalledWith('Functions: 1');
      expect(consoleLogSpy).toHaveBeenCalledWith('\nEndpoints:');
      // Should not print any endpoint lines for functions with no events
    });

    it('should handle functions with only HTTP events', () => {
      const httpOnlyConfig = {
        ...mockConfig,
        functions: {
          'http-only': {
            handler: 'src/handlers/http.handler',
            events: [
              {
                type: 'http' as const,
                path: '/api/test',
                method: 'DELETE' as const,
              },
            ],
            memorySize: 128,
            timeout: 30,
          },
        },
      };

      ConsoleMessages.printStartupMessage(httpOnlyConfig, 3000, 3001, 3002);

      expect(consoleLogSpy).toHaveBeenCalledWith('  DELETE  http://localhost:3000/api/test -> http-only');
      // Should not have any WS lines
    });

    it('should handle functions with only WebSocket events', () => {
      const wsOnlyConfig = {
        ...mockConfig,
        functions: {
          'ws-only': {
            handler: 'src/handlers/ws.handler',
            events: [
              {
                type: 'websocket' as const,
                route: 'message',
              },
            ],
            memorySize: 128,
            timeout: 30,
          },
        },
      };

      ConsoleMessages.printStartupMessage(wsOnlyConfig, 3001, 3001, 3002);

      expect(consoleLogSpy).toHaveBeenCalledWith('  WS      ws://localhost:3001/message -> ws-only');
      // Should not have any HTTP lines
    });

    it('should use different port numbers correctly', () => {
      ConsoleMessages.printStartupMessage(mockConfig, 8080, 8081, 8082);

      expect(consoleLogSpy).toHaveBeenCalledWith('  HTTP:       http://localhost:8080');
      expect(consoleLogSpy).toHaveBeenCalledWith('  WebSocket:  ws://localhost:8081');
      expect(consoleLogSpy).toHaveBeenCalledWith('  Management: http://localhost:8082');
      expect(consoleLogSpy).toHaveBeenCalledWith('  GET     http://localhost:8080/api/users -> api-function');
      expect(consoleLogSpy).toHaveBeenCalledWith('  WS      ws://localhost:8081/$connect -> ws-function');
    });

    it('should handle HTTP method padding correctly', () => {
      const configWithLongMethod = {
        ...mockConfig,
        functions: {
          'test-function': {
            handler: 'src/handlers/test.handler',
            events: [
              {
                type: 'http' as const,
                path: '/test',
                method: 'OPTIONS' as const, // 7 characters, should not need padding
              },
            ],
            memorySize: 128,
            timeout: 30,
          },
        },
      };

      ConsoleMessages.printStartupMessage(configWithLongMethod, 3000, 3001, 3002);

      expect(consoleLogSpy).toHaveBeenCalledWith('  OPTIONS http://localhost:3000/test -> test-function');
    });

    it('should count total number of calls correctly', () => {
      ConsoleMessages.printStartupMessage(mockConfig, 3000, 3001, 3002);

      // Should have made multiple console.log calls
      expect(consoleLogSpy.mock.calls.length).toBeGreaterThan(10);
    });

    it('should display service name from config', () => {
      const customServiceConfig = {
        ...mockConfig,
        service: 'my-awesome-service',
      };

      ConsoleMessages.printStartupMessage(customServiceConfig, 3000, 3001, 3002);

      expect(consoleLogSpy).toHaveBeenCalledWith('Service: my-awesome-service');
    });

    it('should format complex paths correctly', () => {
      const complexPathConfig = {
        ...mockConfig,
        functions: {
          'complex-function': {
            handler: 'src/handlers/complex.handler',
            events: [
              {
                type: 'http' as const,
                path: '/api/v1/users/{id}/posts/{postId}',
                method: 'PATCH' as const,
              },
            ],
            memorySize: 128,
            timeout: 30,
          },
        },
      };

      ConsoleMessages.printStartupMessage(complexPathConfig, 3000, 3001, 3002);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '  PATCH   http://localhost:3000/api/v1/users/{id}/posts/{postId} -> complex-function',
      );
    });
  });
});
