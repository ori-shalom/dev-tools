import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NativeHttpServer } from './native-http-server.js';
import { Config } from '../config/schema.js';
import request from 'supertest';
import { createServer } from 'http';

// Mock dependencies
vi.mock('./event-transformer.js', () => ({
  EventTransformer: {
    toNativeHttpEvent: vi.fn().mockReturnValue({
      httpMethod: 'GET',
      path: '/test',
      resource: '/test',
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

describe('NativeHttpServer', () => {
  let httpServer: NativeHttpServer;
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

    httpServer = new NativeHttpServer({
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
    it('should create a native HTTP server instance', () => {
      expect(httpServer).toBeDefined();
      expect(httpServer).toBeInstanceOf(NativeHttpServer);
    });

    it('should register routes during construction', () => {
      expect(consoleLogSpy).toHaveBeenCalledWith('Registered GET /api/test -> src/handlers/test.handler');
    });
  });

  describe('HTTP routes', () => {
    it('should handle GET requests successfully', async () => {
      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      const response = await request(server).get('/api/test').expect(200);

      expect(response.body).toEqual({ message: 'success' });
      expect(mockLoadHandler).toHaveBeenCalledWith('src/handlers/test.handler');
    });

    it('should handle health check endpoint', async () => {
      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      const response = await request(server).get('/health').expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should handle 404 for unregistered routes', async () => {
      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      const response = await request(server).get('/nonexistent').expect(404);

      expect(response.body).toHaveProperty('message', 'Route GET /nonexistent not found');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should handle CORS preflight requests', async () => {
      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      const response = await request(server).options('/api/test').expect(200);

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-methods']).toContain('GET');
    });
  });

  describe('proxy routes', () => {
    beforeEach(() => {
      mockConfig.functions['proxy-function'] = {
        handler: 'src/handlers/proxy.handler',
        events: [
          {
            type: 'http',
            path: '/api/{proxy+}',
            method: 'ANY',
          },
        ],
        memorySize: 128,
        timeout: 30,
      };

      httpServer = new NativeHttpServer({
        config: mockConfig,
        loadHandler: mockLoadHandler,
      });
    });

    it('should handle simple proxy routes', async () => {
      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      const response = await request(server).get('/api/accounts').expect(200);

      expect(response.body).toEqual({ message: 'success' });
      expect(mockLoadHandler).toHaveBeenCalledWith('src/handlers/proxy.handler');
    });

    it('should handle nested proxy routes', async () => {
      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      const response = await request(server).get('/api/v1/accounts/123/details').expect(200);

      expect(response.body).toEqual({ message: 'success' });
    });

    it('should handle POST requests to proxy routes', async () => {
      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      const response = await request(server).post('/api/users/create').expect(200);

      expect(response.body).toEqual({ message: 'success' });
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

      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      await request(server).get('/api/test').expect(200);

      expect(mockLoadHandler).toHaveBeenCalled();
    });

    it('should restore original environment after request', async () => {
      process.env.ORIGINAL_VAR = 'original';

      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      await request(server).get('/api/test').expect(200);

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

      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      const response = await request(server).get('/api/test').expect(200);

      expect(response.body).toEqual({ data: 'test' });
    });

    it('should handle text response body', async () => {
      mockLoadHandler.mockResolvedValue(() => ({
        statusCode: 200,
        body: 'plain text response',
      }));

      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      const response = await request(server).get('/api/test').expect(200);

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

      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      const response = await request(server).get('/api/test').expect(200);

      // For binary responses, supertest converts the Buffer to text if possible
      expect(response.text).toBe(originalData);
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

      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      const response = await request(server).get('/api/test').expect(200);

      expect(response.headers['x-custom-header']).toBe('custom-value');
      expect(response.body).toEqual({ message: 'with headers' });
    });
  });

  describe('error handling', () => {
    it('should handle handler errors gracefully', async () => {
      mockLoadHandler.mockRejectedValue(new Error('Handler failed'));

      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      const response = await request(server).get('/api/test').expect(500);

      expect(response.body).toHaveProperty('message', 'Internal Server Error');
      expect(response.body).toHaveProperty('timestamp');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle handler function throwing error', async () => {
      mockLoadHandler.mockResolvedValue(() => {
        throw new Error('Handler execution failed');
      });

      const server = (httpServer as unknown as { server: ReturnType<typeof createServer> }).server;
      const response = await request(server).get('/api/test').expect(500);

      expect(response.body).toHaveProperty('message', 'Internal Server Error');
      expect(response.body).toHaveProperty('timestamp');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('server lifecycle', () => {
    let testServer: NativeHttpServer;

    beforeEach(() => {
      testServer = new NativeHttpServer({
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

    it('should stop server gracefully', async () => {
      await testServer.start(0, '127.0.0.1');
      await expect(testServer.stop()).resolves.toBeUndefined();
    });

    it('should handle stop when server is not started', async () => {
      await expect(testServer.stop()).resolves.toBeUndefined();
    });
  });
});
