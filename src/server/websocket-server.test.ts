import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { ConfigInput } from '../config/schema.js';
import { LambdaWebSocketServer } from './websocket-server.js';

// Mock dependencies
vi.mock('./event-transformer.js', () => ({
  EventTransformer: {
    toWebSocketEvent: vi.fn().mockReturnValue({
      requestContext: {
        requestId: 'test-request-id',
        routeKey: '$connect',
        connectionId: 'test-connection-id',
      },
      body: '',
      isBase64Encoded: false,
    }),
  },
}));

vi.mock('./lambda-context.js', () => ({
  createLambdaContext: vi.fn().mockReturnValue({
    callbackWaitsForEmptyEventLoop: true,
    functionName: 'test-function',
    getRemainingTimeInMillis: () => 30000,
  }),
}));

describe('LambdaWebSocketServer', () => {
  let wsServer: LambdaWebSocketServer;
  let mockConfig: ConfigInput;
  let mockLoadHandler: ReturnType<typeof vi.fn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockConfig = {
      service: 'test-service',
      functions: {
        'connect-function': {
          handler: 'src/handlers/connect.handler',
          events: [
            {
              type: 'websocket',
              route: '$connect',
            },
          ],
          memorySize: 128,
          timeout: 30,
          environment: {
            FUNCTION_ENV: 'test',
          },
        },
        'disconnect-function': {
          handler: 'src/handlers/disconnect.handler',
          events: [
            {
              type: 'websocket',
              route: '$disconnect',
            },
          ],
          memorySize: 128,
          timeout: 30,
        },
        'message-function': {
          handler: 'src/handlers/message.handler',
          events: [
            {
              type: 'websocket',
              route: 'message',
            },
          ],
          memorySize: 128,
          timeout: 30,
        },
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
        cors: false,
        websocket: {
          port: 3001,
          pingInterval: 30000,
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
        GLOBAL_ENV: 'test',
      },
    };

    mockLoadHandler = vi.fn().mockResolvedValue(() => ({
      statusCode: 200,
    }));

    wsServer = new LambdaWebSocketServer({
      config: mockConfig,
      loadHandler: mockLoadHandler,
    });
  });

  afterEach(async () => {
    await wsServer.stop();
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a WebSocket server instance', () => {
      expect(wsServer).toBeDefined();
      expect(wsServer).toBeInstanceOf(LambdaWebSocketServer);
    });
  });

  describe('server lifecycle', () => {
    it('should start server successfully', async () => {
      await expect(wsServer.start(0, '127.0.0.1')).resolves.toBeUndefined();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('WebSocket server listening on ws://127.0.0.1:'),
      );
    });

    it('should handle port in use error', async () => {
      await wsServer.start(0, '127.0.0.1');

      const secondServer = new LambdaWebSocketServer({
        config: mockConfig,
        loadHandler: mockLoadHandler,
      });

      const port = (wsServer as any).wss.address().port;

      await expect(secondServer.start(port, '127.0.0.1')).rejects.toThrow('already in use');
      await secondServer.stop();
    });

    it('should handle permission denied error', async () => {
      const privilegedPort = 80;

      try {
        await expect(wsServer.start(privilegedPort, '127.0.0.1')).rejects.toThrow('Permission denied');
      } catch (error) {
        if ((error as Error).message?.includes('Permission denied')) {
          expect((error as Error).message).toContain('Try using a port number above 1024');
        }
      }
    });

    it('should stop server gracefully', async () => {
      await wsServer.start(0, '127.0.0.1');
      await expect(wsServer.stop()).resolves.toBeUndefined();
    });

    it('should handle stop when server is not started', async () => {
      await expect(wsServer.stop()).resolves.toBeUndefined();
    });
  });

  describe('WebSocket connections', () => {
    let port: number;

    beforeEach(async () => {
      await wsServer.start(0, '127.0.0.1');
      port = (wsServer as any).wss.address().port;
    });

    it('should handle WebSocket connection', async () => {
      const testClient = new WebSocket(`ws://127.0.0.1:${port}`);

      await new Promise<void>((resolve, reject) => {
        testClient.on('open', () => {
          expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringMatching(/^WebSocket connection established: local_/),
          );
          expect(mockLoadHandler).toHaveBeenCalledWith('src/handlers/connect.handler');
          testClient.close();
          resolve();
        });
        testClient.on('error', reject);
      });
    });

    it('should handle WebSocket messages', async () => {
      const testClient = new WebSocket(`ws://127.0.0.1:${port}`);

      await new Promise<void>((resolve, reject) => {
        testClient.on('open', () => {
          testClient.send('test message');

          setTimeout(() => {
            expect(mockLoadHandler).toHaveBeenCalledWith('src/handlers/message.handler');
            testClient.close();
            resolve();
          }, 100);
        });
        testClient.on('error', reject);
      });
    });

    it('should handle WebSocket disconnection', async () => {
      const testClient = new WebSocket(`ws://127.0.0.1:${port}`);

      await new Promise<void>((resolve, reject) => {
        let connected = false;

        testClient.on('open', () => {
          connected = true;
          testClient.close();
        });

        testClient.on('close', () => {
          if (connected) {
            setTimeout(() => {
              expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/^WebSocket connection closed: local_/));
              expect(mockLoadHandler).toHaveBeenCalledWith('src/handlers/disconnect.handler');
              resolve();
            }, 100);
          }
        });

        testClient.on('error', reject);
      });
    });
  });

  describe('message handling', () => {
    let port: number;

    beforeEach(async () => {
      await wsServer.start(0, '127.0.0.1');
      port = (wsServer as any).wss.address().port;
    });

    it('should handle handler execution errors', async () => {
      mockLoadHandler.mockRejectedValue(new Error('Handler failed'));

      const testClient = new WebSocket(`ws://127.0.0.1:${port}`);

      await new Promise<void>((resolve, reject) => {
        testClient.on('open', () => {
          testClient.send('test message');

          setTimeout(() => {
            expect(consoleErrorSpy).toHaveBeenCalledWith(
              expect.stringMatching(/^Error executing WebSocket handler for route/),
              expect.any(Error),
            );
            testClient.close();
            resolve();
          }, 100);
        });
        testClient.on('error', reject);
      });
    });

    it('should warn when no handler is found for route', async () => {
      const testClient = new WebSocket(`ws://127.0.0.1:${port}`);

      await new Promise<void>((resolve, reject) => {
        testClient.on('open', () => {
          testClient.send(JSON.stringify({ action: 'unknownRoute', data: 'test' }));

          setTimeout(() => {
            expect(consoleWarnSpy).toHaveBeenCalledWith('No handler found for WebSocket route: unknownRoute');
            testClient.close();
            resolve();
          }, 100);
        });
        testClient.on('error', reject);
      });
    });

    it('should warn when handler returns non-200 status', async () => {
      mockLoadHandler.mockResolvedValue(() => ({
        statusCode: 400,
        body: 'Bad request',
      }));

      const testClient = new WebSocket(`ws://127.0.0.1:${port}`);

      await new Promise<void>((resolve, reject) => {
        testClient.on('open', () => {
          testClient.send('test message');

          setTimeout(() => {
            expect(consoleWarnSpy).toHaveBeenCalledWith('WebSocket handler returned non-200 status: 400');
            testClient.close();
            resolve();
          }, 100);
        });
        testClient.on('error', reject);
      });
    });
  });

  describe('environment variable handling', () => {
    let originalEnv: NodeJS.ProcessEnv;
    let port: number;

    beforeEach(async () => {
      originalEnv = { ...process.env };
      await wsServer.start(0, '127.0.0.1');
      port = (wsServer as any).wss.address().port;
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should merge global and function environment variables', async () => {
      mockLoadHandler.mockResolvedValue(() => {
        expect(process.env.GLOBAL_ENV).toBe('test');
        expect(process.env.FUNCTION_ENV).toBe('test');
        return { statusCode: 200 };
      });

      const testClient = new WebSocket(`ws://127.0.0.1:${port}`);

      await new Promise<void>((resolve, reject) => {
        testClient.on('open', () => {
          setTimeout(() => {
            testClient.close();
            resolve();
          }, 100);
        });
        testClient.on('error', reject);
      });
    });
  });

  describe('utility methods', () => {
    let port: number;

    beforeEach(async () => {
      await wsServer.start(0, '127.0.0.1');
      port = (wsServer as any).wss.address().port;
    });

    it('should send message to specific connection', async () => {
      const testClient = new WebSocket(`ws://127.0.0.1:${port}`);

      await new Promise<void>((resolve, reject) => {
        testClient.on('open', () => {
          setTimeout(() => {
            const connections = wsServer.getConnections();
            expect(connections).toHaveLength(1);

            const connectionId = connections[0].connectionId;
            const sent = wsServer.sendToConnection(connectionId, 'Hello specific client');
            expect(sent).toBe(true);
          }, 100);
        });

        testClient.on('message', (data) => {
          expect(data.toString()).toBe('Hello specific client');
          testClient.close();
          resolve();
        });

        testClient.on('error', reject);
      });
    });

    it('should return false when sending to non-existent connection', () => {
      const result = wsServer.sendToConnection('nonexistent-id', 'test message');
      expect(result).toBe(false);
    });

    it('should broadcast message to all connections', async () => {
      const testClient1 = new WebSocket(`ws://127.0.0.1:${port}`);
      const testClient2 = new WebSocket(`ws://127.0.0.1:${port}`);

      await new Promise<void>((resolve, reject) => {
        let messagesReceived = 0;

        const handleMessage = (data: any) => {
          expect(data.toString()).toBe('Broadcast message');
          messagesReceived++;
          if (messagesReceived === 2) {
            testClient1.close();
            testClient2.close();
            resolve();
          }
        };

        let connectionsReady = 0;
        const checkReady = () => {
          connectionsReady++;
          if (connectionsReady === 2) {
            setTimeout(() => {
              const sent = wsServer.broadcast('Broadcast message');
              expect(sent).toBe(2);
            }, 100);
          }
        };

        testClient1.on('open', checkReady);
        testClient2.on('open', checkReady);
        testClient1.on('message', handleMessage);
        testClient2.on('message', handleMessage);
        testClient1.on('error', reject);
        testClient2.on('error', reject);
      });
    });

    it('should get list of active connections', async () => {
      const testClient1 = new WebSocket(`ws://127.0.0.1:${port}`);
      const testClient2 = new WebSocket(`ws://127.0.0.1:${port}`);

      await new Promise<void>((resolve, reject) => {
        let connectionsReady = 0;
        const checkReady = () => {
          connectionsReady++;
          if (connectionsReady === 2) {
            setTimeout(() => {
              const connections = wsServer.getConnections();
              expect(connections).toHaveLength(2);
              expect(connections[0]).toHaveProperty('connectionId');
              expect(connections[0]).toHaveProperty('connectedAt');
              expect(connections[1]).toHaveProperty('connectionId');
              expect(connections[1]).toHaveProperty('connectedAt');
              testClient1.close();
              testClient2.close();
              resolve();
            }, 100);
          }
        };

        testClient1.on('open', checkReady);
        testClient2.on('open', checkReady);
        testClient1.on('error', reject);
        testClient2.on('error', reject);
      });
    });
  });

  describe('ping interval', () => {
    it('should start ping interval with default settings', async () => {
      const configWithoutPingInterval: ConfigInput = {
        ...mockConfig,
        server: {
          ...mockConfig.server,
          websocket: {},
        },
      };

      const serverWithDefaults = new LambdaWebSocketServer({
        config: configWithoutPingInterval,
        loadHandler: mockLoadHandler,
      });

      await serverWithDefaults.start(0, '127.0.0.1');
      expect((serverWithDefaults as any).pingInterval).toBeDefined();
      await serverWithDefaults.stop();
    });

    it('should start ping interval with custom interval', async () => {
      const configWithCustomInterval = {
        ...mockConfig,
        server: {
          ...mockConfig.server,
          websocket: {
            port: 3001,
            pingInterval: 10000,
          },
        },
      };

      const serverWithCustom = new LambdaWebSocketServer({
        config: configWithCustomInterval,
        loadHandler: mockLoadHandler,
      });

      await serverWithCustom.start(0, '127.0.0.1');
      expect((serverWithCustom as any).pingInterval).toBeDefined();
      await serverWithCustom.stop();
    });

    it('should clear ping interval on stop', async () => {
      await wsServer.start(0, '127.0.0.1');
      expect((wsServer as any).pingInterval).toBeDefined();

      await wsServer.stop();
      expect((wsServer as any).pingInterval).toBeUndefined();
    });
  });
});
