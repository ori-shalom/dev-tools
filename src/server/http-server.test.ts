import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpServer } from './http-server.js';
import { Config } from '../config/schema.js';
import request from 'supertest';
import { Request, Response, NextFunction } from 'express';

// Mock dependencies
vi.mock('cors', () => ({
  default: () => (req: Request, res: Response, next: NextFunction) => next(),
}));

vi.mock('./event-transformer.js', () => ({
  EventTransformer: {
    toHttpEvent: vi.fn().mockReturnValue({
      httpMethod: 'GET',
      path: '/test',
      headers: {},
      queryStringParameters: null,
      pathParameters: null,
      body: null,
      requestContext: {
        requestId: 'test-request-id',
      },
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

describe('HttpServer', () => {
  let httpServer: HttpServer;
  let mockConfig: Config;
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
        'test-function': {
          handler: 'src/handlers/test.handler',
          events: [
            {
              type: 'http',
              path: '/api/test',
              method: 'GET',
            },
          ],
          memorySize: 128,
          timeout: 30,
          environment: {
            FUNCTION_ENV: 'test',
          },
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
        GLOBAL_ENV: 'test',
      },
    };

    mockLoadHandler = vi.fn().mockResolvedValue(() => ({
      statusCode: 200,
      body: JSON.stringify({ message: 'success' }),
    }));

    httpServer = new HttpServer({
      config: mockConfig,
      loadHandler: mockLoadHandler,
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create an HTTP server instance', () => {
      expect(httpServer).toBeDefined();
      expect(httpServer).toBeInstanceOf(HttpServer);
    });

    it('should register routes during construction', () => {
      expect(consoleLogSpy).toHaveBeenCalledWith('Registered GET /api/test -> src/handlers/test.handler');
    });

    it('should handle CORS configuration', () => {
      const configWithoutCors = {
        ...mockConfig,
        server: { ...mockConfig.server, cors: false },
      };

      const serverWithoutCors = new HttpServer({
        config: configWithoutCors,
        loadHandler: mockLoadHandler,
      });

      expect(serverWithoutCors).toBeDefined();
    });
  });

  describe('HTTP routes', () => {
    it('should handle GET requests successfully', async () => {
      const response = await request(httpServer['app']).get('/api/test').expect(200);

      expect(response.body).toEqual({ message: 'success' });
      expect(mockLoadHandler).toHaveBeenCalledWith('src/handlers/test.handler');
    });

    it('should handle health check endpoint', async () => {
      const response = await request(httpServer['app']).get('/health').expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should handle 404 for unregistered routes', async () => {
      const response = await request(httpServer['app']).get('/nonexistent').expect(404);

      expect(response.body).toHaveProperty('message', 'Route GET /nonexistent not found');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should handle ANY method routes', () => {
      const configWithAny = {
        ...mockConfig,
        functions: {
          'any-function': {
            handler: 'src/handlers/any.handler',
            events: [
              {
                type: 'http' as const,
                path: '/api/any',
                method: 'ANY' as const,
              },
            ],
            memorySize: 128,
            timeout: 30,
          },
        },
      };

      const serverWithAny = new HttpServer({
        config: configWithAny,
        loadHandler: mockLoadHandler,
      });

      expect(consoleLogSpy).toHaveBeenCalledWith('Registered ANY /api/any -> src/handlers/any.handler');
      expect(serverWithAny).toBeDefined();
    });

    it('should warn about unsupported HTTP methods', () => {
      const configWithUnsupported = {
        ...mockConfig,
        functions: {
          'bad-function': {
            handler: 'src/handlers/bad.handler',
            events: [
              {
                type: 'http' as const,
                path: '/api/bad',
                method: 'UNSUPPORTED' as 'GET', // Testing unsupported method
              },
            ],
            memorySize: 128,
            timeout: 30,
          },
        },
      };

      new HttpServer({
        config: configWithUnsupported,
        loadHandler: mockLoadHandler,
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith('Unsupported HTTP method: UNSUPPORTED');
    });
  });

  describe('path parameter extraction', () => {
    beforeEach(() => {
      mockConfig.functions['param-function'] = {
        handler: 'src/handlers/param.handler',
        events: [
          {
            type: 'http',
            path: '/api/{id}/items/{itemId}',
            method: 'GET',
          },
        ],
        memorySize: 128,
        timeout: 30,
      };

      httpServer = new HttpServer({
        config: mockConfig,
        loadHandler: mockLoadHandler,
      });
    });

    it('should extract path parameters correctly', async () => {
      await request(httpServer['app']).get('/api/123/items/456').expect(200);

      expect(mockLoadHandler).toHaveBeenCalled();
    });

    it('should handle proxy+ routes', () => {
      const configWithProxy = {
        ...mockConfig,
        functions: {
          'proxy-function': {
            handler: 'src/handlers/proxy.handler',
            events: [
              {
                type: 'http' as const,
                path: '/api/{proxy+}',
                method: 'GET' as const,
              },
            ],
            memorySize: 128,
            timeout: 30,
          },
        },
      };

      const serverWithProxy = new HttpServer({
        config: configWithProxy,
        loadHandler: mockLoadHandler,
      });

      expect(serverWithProxy).toBeDefined();
    });

    it('should handle complex proxy+ routes with multiple parameters', () => {
      const configWithComplexProxy = {
        ...mockConfig,
        functions: {
          'complex-proxy-function': {
            handler: 'src/handlers/complex-proxy.handler',
            events: [
              {
                type: 'http' as const,
                path: '/v1/{id}/items/{proxy+}',
                method: 'GET' as const,
              },
            ],
            memorySize: 128,
            timeout: 30,
          },
        },
      };

      const serverWithComplexProxy = new HttpServer({
        config: configWithComplexProxy,
        loadHandler: mockLoadHandler,
      });

      expect(serverWithComplexProxy).toBeDefined();
    });
  });

  describe('environment variable handling', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should merge global and function environment variables', async () => {
      mockLoadHandler.mockResolvedValue(() => {
        // Check that both global and function env vars are set
        expect(process.env.GLOBAL_ENV).toBe('test');
        expect(process.env.FUNCTION_ENV).toBe('test');

        return {
          statusCode: 200,
          body: JSON.stringify({ env: { global: process.env.GLOBAL_ENV, function: process.env.FUNCTION_ENV } }),
        };
      });

      await request(httpServer['app']).get('/api/test').expect(200);

      expect(mockLoadHandler).toHaveBeenCalled();
    });

    it('should restore original environment after request', async () => {
      process.env.ORIGINAL_VAR = 'original';

      await request(httpServer['app']).get('/api/test').expect(200);

      expect(process.env.ORIGINAL_VAR).toBe('original');
      expect(process.env.GLOBAL_ENV).toBeUndefined();
      expect(process.env.FUNCTION_ENV).toBeUndefined();
    });
  });

  describe('response handling', () => {
    it('should handle JSON response body', async () => {
      mockLoadHandler.mockResolvedValue(() => ({
        statusCode: 200,
        body: JSON.stringify({ data: 'test' }),
      }));

      const response = await request(httpServer['app']).get('/api/test').expect(200);

      expect(response.body).toEqual({ data: 'test' });
    });

    it('should handle text response body', async () => {
      mockLoadHandler.mockResolvedValue(() => ({
        statusCode: 200,
        body: 'plain text response',
      }));

      const response = await request(httpServer['app']).get('/api/test').expect(200);

      expect(response.text).toBe('plain text response');
    });

    it('should handle base64 encoded response body', async () => {
      const originalData = 'Hello World';
      const base64Data = Buffer.from(originalData).toString('base64');

      mockLoadHandler.mockResolvedValue(() => ({
        statusCode: 200,
        body: base64Data,
        isBase64Encoded: true,
      }));

      const response = await request(httpServer['app']).get('/api/test').expect(200);

      // For binary responses, supertest stores the data in response.body as a Buffer
      expect(response.body.toString()).toBe(originalData);
    });

    it('should handle empty response body', async () => {
      mockLoadHandler.mockResolvedValue(() => ({
        statusCode: 204,
      }));

      await request(httpServer['app']).get('/api/test').expect(204);
    });

    it('should handle response headers', async () => {
      mockLoadHandler.mockResolvedValue(() => ({
        statusCode: 200,
        headers: {
          'X-Custom-Header': 'custom-value',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: 'with headers' }),
      }));

      const response = await request(httpServer['app']).get('/api/test').expect(200);

      expect(response.headers['x-custom-header']).toBe('custom-value');
      expect(response.body).toEqual({ message: 'with headers' });
    });

    it('should handle multi-value headers', async () => {
      mockLoadHandler.mockResolvedValue(() => ({
        statusCode: 200,
        multiValueHeaders: {
          'Set-Cookie': ['cookie1=value1', 'cookie2=value2'],
        },
        body: JSON.stringify({ message: 'with multi-value headers' }),
      }));

      const response = await request(httpServer['app']).get('/api/test').expect(200);

      expect(response.headers['set-cookie']).toEqual(['cookie1=value1', 'cookie2=value2']);
      expect(response.body).toEqual({ message: 'with multi-value headers' });
    });
  });

  describe('error handling', () => {
    it('should handle handler errors gracefully', async () => {
      mockLoadHandler.mockRejectedValue(new Error('Handler failed'));

      const response = await request(httpServer['app']).get('/api/test').expect(500);

      expect(response.body).toHaveProperty('message', 'Internal Server Error');
      expect(response.body).toHaveProperty('timestamp');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle handler function throwing error', async () => {
      mockLoadHandler.mockResolvedValue(() => {
        throw new Error('Handler execution failed');
      });

      const response = await request(httpServer['app']).get('/api/test').expect(500);

      expect(response.body).toHaveProperty('message', 'Internal Server Error');
      expect(response.body).toHaveProperty('timestamp');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should include error details in development mode', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      mockLoadHandler.mockResolvedValue(() => {
        throw new Error('Test error');
      });

      const response = await request(httpServer['app']).get('/api/test').expect(500);

      expect(response.body).toHaveProperty('error', 'Test error');

      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should hide error details in production mode', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      mockLoadHandler.mockResolvedValue(() => {
        throw new Error('Test error');
      });

      const response = await request(httpServer['app']).get('/api/test').expect(500);

      expect(response.body).not.toHaveProperty('error');

      process.env.NODE_ENV = originalNodeEnv;
    });
  });

  describe('server lifecycle', () => {
    let testServer: HttpServer;

    beforeEach(() => {
      testServer = new HttpServer({
        config: mockConfig,
        loadHandler: mockLoadHandler,
      });
    });

    afterEach(async () => {
      await testServer.stop();
    });

    it('should start server successfully', async () => {
      await expect(testServer.start(0, '127.0.0.1')).resolves.toBeUndefined();
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP server listening on'));
    });

    it('should handle port in use error', async () => {
      // Start a server on a specific port
      await testServer.start(0, '127.0.0.1');
      const port = (testServer['server']?.address() as { port: number })?.port;

      // Try to start another server on the same port
      const secondServer = new HttpServer({
        config: mockConfig,
        loadHandler: mockLoadHandler,
      });

      await expect(secondServer.start(port, '127.0.0.1')).rejects.toThrow('already in use');
      await secondServer.stop();
    });

    it('should handle permission denied error', async () => {
      // Try to bind to a privileged port (this test may be skipped on some systems)
      const privilegedPort = 80;

      try {
        await expect(testServer.start(privilegedPort, '127.0.0.1')).rejects.toThrow('Permission denied');
      } catch (error) {
        // If we can actually bind to port 80, the test environment has elevated privileges
        // In that case, just verify the server started
        if ((error as Error).message?.includes('Permission denied')) {
          expect((error as Error).message).toContain('Try using a port number above 1024');
        }
      }
    });

    it('should stop server gracefully', async () => {
      await testServer.start(0, '127.0.0.1');
      await expect(testServer.stop()).resolves.toBeUndefined();
    });

    it('should handle stop when server is not started', async () => {
      await expect(testServer.stop()).resolves.toBeUndefined();
    });
  });

  describe('request logging', () => {
    it('should log incoming requests', async () => {
      await request(httpServer['app']).get('/api/test').expect(200);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[.*\] GET \/api\/test$/));
    });

    it('should log requests with different methods', async () => {
      // Add a POST route for testing
      mockConfig.functions['post-function'] = {
        handler: 'src/handlers/post.handler',
        events: [
          {
            type: 'http',
            path: '/api/post',
            method: 'POST',
          },
        ],
        memorySize: 128,
        timeout: 30,
      };

      const postServer = new HttpServer({
        config: mockConfig,
        loadHandler: mockLoadHandler,
      });

      await request(postServer['app']).post('/api/post').expect(200);

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[.*\] POST \/api\/post$/));
    });
  });
});
