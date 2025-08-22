import { describe, it, expect } from 'vitest';
import { ConfigSchema } from './schema.js';
import { z } from 'zod/v4';

const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'ANY']);

describe('ConfigSchema', () => {
  describe('valid configuration', () => {
    it('should validate minimal valid configuration', () => {
      const config = {
        service: 'test-service',
        functions: {
          hello: {
            handler: 'src/handlers/hello.handler',
          },
        },
      };

      const result = ConfigSchema.parse(config);
      expect(result).toEqual({
        service: 'test-service',
        functions: {
          hello: {
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
        build: {
          outDir: './dist',
          target: 'node22',
          minify: true,
          sourcemap: false,
          external: [],
        },
      });
    });

    it('should validate configuration with HTTP events', () => {
      const config = {
        service: 'api-service',
        functions: {
          api: {
            handler: 'src/handlers/api.handler',
            events: [
              {
                type: 'http',
                method: 'GET',
                path: '/users',
                cors: true,
              },
              {
                type: 'http',
                method: 'POST',
                path: '/users/{id}',
                cors: false,
              },
            ],
          },
        },
      };

      const result = ConfigSchema.parse(config);
      expect(result.functions.api.events).toHaveLength(2);
      expect(result.functions.api.events[0]).toEqual({
        type: 'http',
        method: 'GET',
        path: '/users',
        cors: true,
      });
      expect(result.functions.api.events[1]).toEqual({
        type: 'http',
        method: 'POST',
        path: '/users/{id}',
        cors: false,
      });
    });

    it('should validate configuration with WebSocket events', () => {
      const config = {
        service: 'ws-service',
        functions: {
          websocket: {
            handler: 'src/handlers/ws.handler',
            events: [
              {
                type: 'websocket',
                route: '$connect',
              },
              {
                type: 'websocket',
                route: '$disconnect',
              },
              {
                type: 'websocket',
                route: 'message',
              },
            ],
          },
        },
      };

      const result = ConfigSchema.parse(config);
      expect(result.functions.websocket.events).toHaveLength(3);
      expect(result.functions.websocket.events[0]).toEqual({
        type: 'websocket',
        route: '$connect',
      });
    });

    it('should validate configuration with environment variables', () => {
      const config = {
        service: 'env-service',
        environment: {
          NODE_ENV: 'production',
          API_KEY: 'secret',
        },
        functions: {
          api: {
            handler: 'src/handlers/api.handler',
            environment: {
              FUNCTION_VAR: 'value',
            },
          },
        },
      };

      const result = ConfigSchema.parse(config);
      expect(result.environment).toEqual({
        NODE_ENV: 'production',
        API_KEY: 'secret',
      });
      expect(result.functions.api.environment).toEqual({
        FUNCTION_VAR: 'value',
      });
    });

    it('should validate configuration with custom server settings', () => {
      const config = {
        service: 'custom-service',
        functions: {
          hello: {
            handler: 'src/handlers/hello.handler',
          },
        },
        server: {
          port: 4000,
          host: '0.0.0.0',
          cors: false,
          websocket: {
            port: 4001,
            pingInterval: 60000,
          },
        },
      };

      const result = ConfigSchema.parse(config);
      expect(result.server).toEqual({
        port: 4000,
        host: '0.0.0.0',
        cors: false,
        websocket: {
          port: 4001,
          pingInterval: 60000,
        },
      });
    });

    it('should validate configuration with custom build settings', () => {
      const config = {
        service: 'build-service',
        functions: {
          hello: {
            handler: 'src/handlers/hello.handler',
          },
        },
        build: {
          outDir: './custom-dist',
          target: 'node20',
          minify: false,
          sourcemap: true,
          external: ['aws-sdk', 'lodash'],
        },
      };

      const result = ConfigSchema.parse(config);
      expect(result.build).toEqual({
        outDir: './custom-dist',
        target: 'node20',
        minify: false,
        sourcemap: true,
        external: ['aws-sdk', 'lodash'],
      });
    });

    it('should validate function with custom timeout and memory', () => {
      const config = {
        service: 'memory-service',
        functions: {
          heavyTask: {
            handler: 'src/handlers/heavy.handler',
            timeout: 900,
            memorySize: 10240,
          },
        },
      };

      const result = ConfigSchema.parse(config);
      expect(result.functions.heavyTask.timeout).toBe(900);
      expect(result.functions.heavyTask.memorySize).toBe(10240);
    });
  });

  describe('invalid configuration', () => {
    it('should reject configuration without service', () => {
      const config = {
        functions: {
          hello: {
            handler: 'src/handlers/hello.handler',
          },
        },
      };

      expect(() => ConfigSchema.parse(config)).toThrow();
    });

    it('should reject configuration without functions', () => {
      const config = {
        service: 'test-service',
      };

      expect(() => ConfigSchema.parse(config)).toThrow();
    });

    it('should reject function without handler', () => {
      const config = {
        service: 'test-service',
        functions: {
          invalid: {},
        },
      };

      expect(() => ConfigSchema.parse(config)).toThrow();
    });

    it('should reject invalid HTTP method', () => {
      const config = {
        service: 'test-service',
        functions: {
          api: {
            handler: 'src/handlers/api.handler',
            events: [
              {
                type: 'http',
                method: 'INVALID',
                path: '/test',
              },
            ],
          },
        },
      };

      expect(() => ConfigSchema.parse(config)).toThrow();
    });

    it('should reject HTTP event without path', () => {
      const config = {
        service: 'test-service',
        functions: {
          api: {
            handler: 'src/handlers/api.handler',
            events: [
              {
                type: 'http',
                method: 'GET',
              },
            ],
          },
        },
      };

      expect(() => ConfigSchema.parse(config)).toThrow();
    });

    it('should reject WebSocket event without route', () => {
      const config = {
        service: 'test-service',
        functions: {
          ws: {
            handler: 'src/handlers/ws.handler',
            events: [
              {
                type: 'websocket',
              },
            ],
          },
        },
      };

      expect(() => ConfigSchema.parse(config)).toThrow();
    });

    it('should reject invalid timeout values', () => {
      const config = {
        service: 'test-service',
        functions: {
          invalid: {
            handler: 'src/handlers/invalid.handler',
            timeout: 0, // Too low
          },
        },
      };

      expect(() => ConfigSchema.parse(config)).toThrow();

      const config2 = {
        service: 'test-service',
        functions: {
          invalid: {
            handler: 'src/handlers/invalid.handler',
            timeout: 1000, // Too high
          },
        },
      };

      expect(() => ConfigSchema.parse(config2)).toThrow();
    });

    it('should reject invalid memory sizes', () => {
      const config = {
        service: 'test-service',
        functions: {
          invalid: {
            handler: 'src/handlers/invalid.handler',
            memorySize: 64, // Too low
          },
        },
      };

      expect(() => ConfigSchema.parse(config)).toThrow();

      const config2 = {
        service: 'test-service',
        functions: {
          invalid: {
            handler: 'src/handlers/invalid.handler',
            memorySize: 20480, // Too high
          },
        },
      };

      expect(() => ConfigSchema.parse(config2)).toThrow();
    });

    it('should reject invalid server ports', () => {
      const config = {
        service: 'test-service',
        functions: {
          hello: {
            handler: 'src/handlers/hello.handler',
          },
        },
        server: {
          port: 999, // Too low
        },
      };

      expect(() => ConfigSchema.parse(config)).toThrow();

      const config2 = {
        service: 'test-service',
        functions: {
          hello: {
            handler: 'src/handlers/hello.handler',
          },
        },
        server: {
          port: 70000, // Too high
        },
      };

      expect(() => ConfigSchema.parse(config2)).toThrow();
    });

    it('should reject invalid WebSocket ping interval', () => {
      const config = {
        service: 'test-service',
        functions: {
          hello: {
            handler: 'src/handlers/hello.handler',
          },
        },
        server: {
          websocket: {
            pingInterval: 500, // Too low
          },
        },
      };

      expect(() => ConfigSchema.parse(config)).toThrow();
    });
  });

  describe('HTTP methods', () => {
    it('should accept all valid HTTP methods', () => {
      const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'ANY'] as const;

      for (const method of validMethods) {
        expect(() => HttpMethodSchema.parse(method)).not.toThrow();
      }
    });

    it('should reject invalid HTTP methods', () => {
      const invalidMethods = ['get', 'INVALID', 'TRACE', ''];

      for (const method of invalidMethods) {
        expect(() => HttpMethodSchema.parse(method)).toThrow();
      }
    });
  });
});
