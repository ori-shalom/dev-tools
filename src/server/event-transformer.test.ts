import { describe, it, expect } from 'vitest';
import { EventTransformer } from './event-transformer.js';
import { IncomingMessage } from 'http';
import { HttpEvent } from '../config/schema.js';

// Mock Node.js IncomingMessage
const createMockIncomingMessage = (options: {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[]>;
}): IncomingMessage =>
  ({
    method: options.method || 'GET',
    url: options.url || '/',
    headers: options.headers || {},
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage;

describe('EventTransformer', () => {
  describe('toNativeHttpEvent', () => {
    it('should transform basic GET request', () => {
      const req = createMockIncomingMessage({
        method: 'GET',
        url: '/users?page=1&limit=10',
        headers: { 'content-type': 'application/json' },
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/users',
        cors: true,
      };

      const result = EventTransformer.toNativeHttpEvent(req, event, {});

      expect(result.httpMethod).toBe('GET');
      expect(result.path).toBe('/users');
      expect(result.headers['content-type']).toBe('application/json');
      expect(result.queryStringParameters).toEqual({ page: '1', limit: '10' });
    });

    it('should transform POST request with body', () => {
      const req = createMockIncomingMessage({
        method: 'POST',
        url: '/users',
        headers: { 'content-type': 'application/json' },
      });

      const body = Buffer.from(JSON.stringify({ name: 'John', age: 30 }));

      const event: HttpEvent = {
        type: 'http',
        method: 'POST',
        path: '/users',
        cors: false,
      };

      const result = EventTransformer.toNativeHttpEvent(req, event, {}, body);

      expect(result.httpMethod).toBe('POST');
      expect(result.path).toBe('/users');
      expect(result.body).toBe('{"name":"John","age":30}');
      expect(result.isBase64Encoded).toBe(false);
    });

    it('should handle path parameters', () => {
      const req = createMockIncomingMessage({
        method: 'GET',
        url: '/users/123',
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/users/{id}',
        cors: true,
      };

      const pathParameters = { id: '123' };

      const result = EventTransformer.toNativeHttpEvent(req, event, pathParameters);

      expect(result.pathParameters).toEqual({ id: '123' });
      expect(result.resource).toBe('/users/{id}');
    });

    it('should handle multiple query parameters with same key', () => {
      const req = createMockIncomingMessage({
        method: 'GET',
        url: '/items?tag=red&tag=blue&tag=green',
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/items',
        cors: true,
      };

      const result = EventTransformer.toNativeHttpEvent(req, event, {});

      expect(result.queryStringParameters?.tag).toBe('red');
      expect(result.multiValueQueryStringParameters?.tag).toEqual(['red', 'blue', 'green']);
    });

    it('should handle missing query parameters', () => {
      const req = createMockIncomingMessage({
        method: 'GET',
        url: '/users',
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/users',
        cors: true,
      };

      const result = EventTransformer.toNativeHttpEvent(req, event, {});

      expect(result.queryStringParameters).toBeNull();
      expect(result.multiValueQueryStringParameters).toBeNull();
    });

    it('should handle array headers', () => {
      const req = createMockIncomingMessage({
        method: 'GET',
        url: '/users',
        headers: {
          accept: ['application/json', 'text/html'],
          'x-custom': 'value',
        },
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/users',
        cors: true,
      };

      const result = EventTransformer.toNativeHttpEvent(req, event, {});

      expect(result.headers.accept).toBe('application/json');
      expect(result.multiValueHeaders.accept).toEqual(['application/json', 'text/html']);
      expect(result.headers['x-custom']).toBe('value');
      expect(result.multiValueHeaders['x-custom']).toEqual(['value']);
    });

    it('should lowercase header keys', () => {
      const req = createMockIncomingMessage({
        method: 'GET',
        url: '/users',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': 'secret',
        },
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/users',
        cors: true,
      };

      const result = EventTransformer.toNativeHttpEvent(req, event, {});

      expect(result.headers['content-type']).toBe('application/json');
      expect(result.headers['x-api-key']).toBe('secret');
    });

    it('should handle empty body', () => {
      const req = createMockIncomingMessage({
        method: 'POST',
        url: '/users',
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'POST',
        path: '/users',
        cors: false,
      };

      const result = EventTransformer.toNativeHttpEvent(req, event, {});

      expect(result.body).toBeNull();
    });

    it('should populate request context', () => {
      const req = createMockIncomingMessage({
        method: 'GET',
        url: '/users',
        headers: { 'user-agent': 'Mozilla/5.0' },
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/users',
        cors: true,
      };

      const result = EventTransformer.toNativeHttpEvent(req, event, {});

      expect(result.requestContext.accountId).toBe('123456789012');
      expect(result.requestContext.apiId).toBe('local-api');
      expect(result.requestContext.httpMethod).toBe('GET');
      expect(result.requestContext.stage).toBe('local');
      expect(result.requestContext.identity.sourceIp).toBe('127.0.0.1');
      expect(result.requestContext.identity.userAgent).toBe('Mozilla/5.0');
      expect(result.requestContext.requestId).toMatch(/^[a-z0-9]+$/);
    });

    it('should handle special characters in query parameters', () => {
      const req = createMockIncomingMessage({
        method: 'GET',
        url: '/search?q=hello%20world&filter=%3Cscript%3E',
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/search',
        cors: true,
      };

      const result = EventTransformer.toNativeHttpEvent(req, event, {});

      expect(result.queryStringParameters).toEqual({
        q: 'hello world',
        filter: '<script>',
      });
    });
  });

  describe('toWebSocketEvent', () => {
    it('should transform CONNECT event', () => {
      const result = EventTransformer.toWebSocketEvent('connection data', 'connection-123', '$connect', 'CONNECT');

      expect(result.requestContext.routeKey).toBe('$connect');
      expect(result.requestContext.connectionId).toBe('connection-123');
      expect(result.requestContext.eventType).toBe('CONNECT');
      expect(result.body).toBe('connection data');
    });

    it('should transform MESSAGE event', () => {
      const result = EventTransformer.toWebSocketEvent('{"action":"ping"}', 'connection-456', 'message', 'MESSAGE');

      expect(result.requestContext.routeKey).toBe('message');
      expect(result.requestContext.connectionId).toBe('connection-456');
      expect(result.requestContext.eventType).toBe('MESSAGE');
      expect(result.requestContext.messageId).toBeDefined();
      expect(result.body).toBe('{"action":"ping"}');
    });

    it('should transform DISCONNECT event', () => {
      const result = EventTransformer.toWebSocketEvent('', 'connection-789', '$disconnect', 'DISCONNECT');

      expect(result.requestContext.routeKey).toBe('$disconnect');
      expect(result.requestContext.connectionId).toBe('connection-789');
      expect(result.requestContext.eventType).toBe('DISCONNECT');
      expect(result.requestContext.messageId).toBeUndefined();
    });

    it('should handle Buffer input', () => {
      const buffer = Buffer.from('binary data');
      const result = EventTransformer.toWebSocketEvent(buffer, 'connection-000', 'message', 'MESSAGE');

      expect(result.body).toBe('binary data');
      expect(result.isBase64Encoded).toBe(false);
    });

    it('should populate WebSocket request context', () => {
      const result = EventTransformer.toWebSocketEvent('test', 'conn-123', 'route', 'MESSAGE');

      expect(result.requestContext.apiId).toBe('local-websocket');
      expect(result.requestContext.stage).toBe('local');
      expect(result.requestContext.domainName).toBe('localhost');
      expect(result.requestContext.messageDirection).toBe('IN');
      expect(result.requestContext.requestId).toMatch(/^[a-z0-9]+$/);
      expect(result.requestContext.requestTime).toBeDefined();
      expect(result.requestContext.requestTimeEpoch).toBeDefined();
      expect(result.requestContext.connectedAt).toBeDefined();
    });

    it('should use request info when provided', () => {
      const mockRequest = {
        socket: { remoteAddress: '192.168.1.100' },
      } as unknown as IncomingMessage;

      const result = EventTransformer.toWebSocketEvent('test', 'conn-123', 'route', 'MESSAGE', mockRequest);

      expect(result.requestContext.identity.sourceIp).toBe('192.168.1.100');
    });
  });

  describe('generateRequestId', () => {
    it('should generate unique request IDs', () => {
      const req1 = createMockIncomingMessage({ method: 'GET', url: '/' });
      const req2 = createMockIncomingMessage({ method: 'GET', url: '/' });
      const event: HttpEvent = { type: 'http', method: 'GET', path: '/', cors: false };

      const result1 = EventTransformer.toNativeHttpEvent(req1, event, {});
      const result2 = EventTransformer.toNativeHttpEvent(req2, event, {});

      expect(result1.requestContext.requestId).not.toBe(result2.requestContext.requestId);
      expect(result1.requestContext.requestId).toMatch(/^[a-z0-9]+$/);
      expect(result2.requestContext.requestId).toMatch(/^[a-z0-9]+$/);
    });

    it('should generate consistent length request IDs', () => {
      const results: string[] = [];
      const event: HttpEvent = { type: 'http', method: 'GET', path: '/', cors: false };

      for (let i = 0; i < 100; i++) {
        const req = createMockIncomingMessage({ method: 'GET', url: '/' });
        const result = EventTransformer.toNativeHttpEvent(req, event, {});
        results.push(result.requestContext.requestId);
      }

      // All IDs should be exactly 32 characters (16 bytes as hex)
      results.forEach((id) => {
        expect(id.length).toBe(32);
      });

      // All IDs should be unique
      const uniqueIds = new Set(results);
      expect(uniqueIds.size).toBe(results.length);
    });
  });

  describe('edge cases', () => {
    it('should handle missing method', () => {
      const req = {
        url: '/test',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as IncomingMessage;

      const event: HttpEvent = { type: 'http', method: 'GET', path: '/test', cors: false };
      const result = EventTransformer.toNativeHttpEvent(req, event, {});

      expect(result.httpMethod).toBe('GET');
    });

    it('should handle missing URL', () => {
      const req = {
        method: 'GET',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as IncomingMessage;

      const event: HttpEvent = { type: 'http', method: 'GET', path: '/', cors: false };
      const result = EventTransformer.toNativeHttpEvent(req, event, {});

      expect(result.path).toBe('/');
    });

    it('should handle missing socket', () => {
      const req = {
        method: 'GET',
        url: '/test',
        headers: {},
      } as unknown as IncomingMessage;

      const event: HttpEvent = { type: 'http', method: 'GET', path: '/test', cors: false };
      const result = EventTransformer.toNativeHttpEvent(req, event, {});

      expect(result.requestContext.identity.sourceIp).toBe('127.0.0.1');
    });
  });
});
