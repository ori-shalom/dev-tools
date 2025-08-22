import { describe, it, expect, vi } from 'vitest';
import { EventTransformer } from './event-transformer.js';
import { Request } from 'express';
import { IncomingMessage } from 'http';
import { HttpEvent } from '../config/schema.js';

// Mock Express Request
const createMockRequest = (options: {
  method?: string;
  path?: string;
  headers?: Record<string, string | string[]>;
  query?: Record<string, string | string[]>;
  body?: unknown;
  ip?: string;
}): Request =>
  ({
    method: options.method || 'GET',
    path: options.path || '/',
    headers: options.headers || {},
    query: options.query || {},
    body: options.body,
    ip: options.ip || '127.0.0.1',
    get: vi.fn((header: string) => {
      if (header === 'User-Agent') {
        return options.headers?.['user-agent'] || options.headers?.['User-Agent'];
      }
      return options.headers?.[header] || options.headers?.[header.toLowerCase()];
    }),
  }) as unknown as Request;

describe('EventTransformer', () => {
  describe('toHttpEvent', () => {
    it('should transform basic GET request', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/users',
        headers: { 'content-type': 'application/json' },
        query: { page: '1', limit: '10' },
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/users',
        cors: true,
      };

      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.httpMethod).toBe('GET');
      expect(result.path).toBe('/users');
      expect(result.resource).toBe('/users');
      expect(result.headers).toEqual({ 'content-type': 'application/json' });
      expect(result.multiValueHeaders).toEqual({ 'content-type': ['application/json'] });
      expect(result.queryStringParameters).toEqual({ page: '1', limit: '10' });
      expect(result.multiValueQueryStringParameters).toEqual({ page: ['1'], limit: ['10'] });
      expect(result.pathParameters).toBe(null);
    });

    it('should handle POST request with JSON body', () => {
      const req = createMockRequest({
        method: 'POST',
        path: '/users',
        headers: { 'content-type': 'application/json' },
        body: { name: 'John Doe', email: 'john@example.com' },
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'POST',
        path: '/users',
        cors: true,
      };

      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.httpMethod).toBe('POST');
      expect(result.body).toBe('{"name":"John Doe","email":"john@example.com"}');
      expect(result.isBase64Encoded).toBe(false);
    });

    it('should handle request with string body', () => {
      const req = createMockRequest({
        method: 'POST',
        path: '/webhook',
        headers: { 'content-type': 'text/plain' },
        body: 'plain text data',
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'POST',
        path: '/webhook',
        cors: true,
      };

      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.body).toBe('plain text data');
    });

    it('should handle request with no body', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/health',
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/health',
        cors: true,
      };

      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.body).toBe(null);
    });

    it('should handle path parameters', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/users/123',
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/users/{id}',
        cors: true,
      };

      const pathParameters = { id: '123' };

      const result = EventTransformer.toHttpEvent(req, event, pathParameters);

      expect(result.pathParameters).toEqual({ id: '123' });
      expect(result.resource).toBe('/users/{id}');
      expect(result.path).toBe('/users/123');
    });

    it('should handle multiple query parameter values', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/search',
        query: { tags: ['javascript', 'typescript'], sort: 'date' },
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/search',
        cors: true,
      };

      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.queryStringParameters).toEqual({
        tags: 'javascript',
        sort: 'date',
      });
      expect(result.multiValueQueryStringParameters).toEqual({
        tags: ['javascript', 'typescript'],
        sort: ['date'],
      });
    });

    it('should handle multiple header values', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/api',
        headers: {
          accept: ['application/json', 'text/html'],
          'x-custom-header': 'single-value',
        },
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/api',
        cors: true,
      };

      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.headers).toEqual({
        accept: 'application/json',
        'x-custom-header': 'single-value',
      });
      expect(result.multiValueHeaders).toEqual({
        accept: ['application/json', 'text/html'],
        'x-custom-header': ['single-value'],
      });
    });

    it('should handle empty query parameters and headers', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/simple',
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/simple',
        cors: true,
      };

      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.queryStringParameters).toBe(null);
      expect(result.multiValueQueryStringParameters).toBe(null);
      expect(result.pathParameters).toBe(null);
    });

    it('should generate valid request context', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/test',
        headers: { 'user-agent': 'TestAgent/1.0' },
        ip: '192.168.1.100',
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/test',
        cors: true,
      };

      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.requestContext.accountId).toBe('123456789012');
      expect(result.requestContext.apiId).toBe('local-api');
      expect(result.requestContext.httpMethod).toBe('GET');
      expect(result.requestContext.resourcePath).toBe('/test');
      expect(result.requestContext.stage).toBe('local');
      expect(result.requestContext.identity.sourceIp).toBe('192.168.1.100');
      expect(result.requestContext.identity.userAgent).toBe('TestAgent/1.0');
      expect(result.requestContext.requestId).toMatch(/^[a-z0-9]+$/);
    });

    it('should handle undefined header values', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/test',
        headers: { 'x-undefined': undefined as unknown as string },
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/test',
        cors: true,
      };

      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.headers).not.toHaveProperty('x-undefined');
      expect(result.multiValueHeaders).not.toHaveProperty('x-undefined');
    });

    it('should handle undefined query parameter values', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/test',
        query: { valid: 'value', invalid: undefined as unknown as string },
      });

      const event: HttpEvent = {
        type: 'http',
        method: 'GET',
        path: '/test',
        cors: true,
      };

      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.queryStringParameters).toEqual({ valid: 'value' });
      expect(result.multiValueQueryStringParameters).toEqual({ valid: ['value'] });
    });
  });

  describe('toWebSocketEvent', () => {
    it('should transform connect event', () => {
      const connectionId = 'abc123';
      const route = '$connect';
      const message = '';

      const result = EventTransformer.toWebSocketEvent(message, connectionId, route, 'CONNECT');

      expect(result.requestContext.routeKey).toBe('$connect');
      expect(result.requestContext.eventType).toBe('CONNECT');
      expect(result.requestContext.connectionId).toBe('abc123');
      expect(result.requestContext.messageId).toBeUndefined();
      expect(result.requestContext.stage).toBe('local');
      expect(result.requestContext.apiId).toBe('local-websocket');
      expect(result.body).toBe('');
      expect(result.isBase64Encoded).toBe(false);
    });

    it('should transform message event', () => {
      const connectionId = 'abc123';
      const route = 'message';
      const message = '{"action":"ping"}';

      const result = EventTransformer.toWebSocketEvent(message, connectionId, route, 'MESSAGE');

      expect(result.requestContext.routeKey).toBe('message');
      expect(result.requestContext.eventType).toBe('MESSAGE');
      expect(result.requestContext.connectionId).toBe('abc123');
      expect(result.requestContext.messageId).toBeDefined();
      expect(result.requestContext.messageDirection).toBe('IN');
      expect(result.body).toBe('{"action":"ping"}');
    });

    it('should transform disconnect event', () => {
      const connectionId = 'abc123';
      const route = '$disconnect';
      const message = '';

      const result = EventTransformer.toWebSocketEvent(message, connectionId, route, 'DISCONNECT');

      expect(result.requestContext.routeKey).toBe('$disconnect');
      expect(result.requestContext.eventType).toBe('DISCONNECT');
      expect(result.requestContext.connectionId).toBe('abc123');
      expect(result.requestContext.messageId).toBeUndefined();
      expect(result.body).toBe('');
    });

    it('should handle buffer message', () => {
      const connectionId = 'abc123';
      const route = 'data';
      const message = Buffer.from('binary data');

      const result = EventTransformer.toWebSocketEvent(message, connectionId, route, 'MESSAGE');

      expect(result.body).toBe('binary data');
      expect(result.isBase64Encoded).toBe(false);
    });

    it('should default to MESSAGE event type', () => {
      const connectionId = 'abc123';
      const route = 'default';
      const message = 'test message';

      const result = EventTransformer.toWebSocketEvent(message, connectionId, route);

      expect(result.requestContext.eventType).toBe('MESSAGE');
      expect(result.requestContext.messageId).toBeDefined();
    });

    it('should include request information when provided', () => {
      const connectionId = 'abc123';
      const route = 'test';
      const message = 'test';

      const mockRequest = {
        socket: {
          remoteAddress: '192.168.1.50',
        },
      } as IncomingMessage;

      const result = EventTransformer.toWebSocketEvent(message, connectionId, route, 'MESSAGE', mockRequest);

      expect(result.requestContext.identity.sourceIp).toBe('192.168.1.50');
    });

    it('should use default IP when no request provided', () => {
      const connectionId = 'abc123';
      const route = 'test';
      const message = 'test';

      const result = EventTransformer.toWebSocketEvent(message, connectionId, route, 'MESSAGE');

      expect(result.requestContext.identity.sourceIp).toBe('127.0.0.1');
    });

    it('should handle missing user agent in request context', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/test',
        headers: {},
        ip: '192.168.1.1',
      });

      const event: HttpEvent = { type: 'http', method: 'GET', path: '/test', cors: true };
      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.requestContext.identity.userAgent).toBe('unknown');
      expect(result.requestContext.identity.sourceIp).toBe('192.168.1.1');
    });

    it('should generate timestamps and timing information', () => {
      const connectionId = 'abc123';
      const route = 'test';
      const message = 'test';

      const beforeTime = Date.now();
      const result = EventTransformer.toWebSocketEvent(message, connectionId, route, 'MESSAGE');
      const afterTime = Date.now();

      expect(result.requestContext.requestTime).toBeDefined();
      expect(Date.parse(result.requestContext.requestTime)).toBeGreaterThanOrEqual(beforeTime);
      expect(Date.parse(result.requestContext.requestTime)).toBeLessThanOrEqual(afterTime);

      expect(result.requestContext.requestTimeEpoch).toBeGreaterThanOrEqual(beforeTime);
      expect(result.requestContext.requestTimeEpoch).toBeLessThanOrEqual(afterTime);

      expect(result.requestContext.connectedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(result.requestContext.connectedAt).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('generateRequestId', () => {
    it('should generate unique request IDs', () => {
      const req1 = createMockRequest({ method: 'GET', path: '/test1' });
      const req2 = createMockRequest({ method: 'GET', path: '/test2' });

      const event: HttpEvent = { type: 'http', method: 'GET', path: '/test', cors: true };

      const result1 = EventTransformer.toHttpEvent(req1, event);
      const result2 = EventTransformer.toHttpEvent(req2, event);

      expect(result1.requestContext.requestId).not.toBe(result2.requestContext.requestId);
      expect(result1.requestContext.requestId).toMatch(/^[a-z0-9]+$/);
      expect(result2.requestContext.requestId).toMatch(/^[a-z0-9]+$/);
    });

    it('should generate consistent length request IDs', () => {
      const req = createMockRequest({ method: 'GET', path: '/test' });
      const event: HttpEvent = { type: 'http', method: 'GET', path: '/test', cors: true };

      const results = [];
      for (let i = 0; i < 10; i++) {
        const result = EventTransformer.toHttpEvent(req, event);
        results.push(result.requestContext.requestId);
      }

      // All IDs should have similar length (around 26 characters)
      results.forEach((id) => {
        expect(id.length).toBeGreaterThanOrEqual(20);
        expect(id.length).toBeLessThanOrEqual(30);
      });

      // All IDs should be unique
      const uniqueIds = new Set(results);
      expect(uniqueIds.size).toBe(results.length);
    });
  });

  describe('edge cases', () => {
    it('should handle numeric query parameter values', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/test',
        query: { page: 1 as unknown as string, limit: 50 as unknown as string },
      });

      const event: HttpEvent = { type: 'http', method: 'GET', path: '/test', cors: true };
      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.queryStringParameters).toEqual({ page: '1', limit: '50' });
    });

    it('should handle boolean query parameter values', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/test',
        query: { active: true as unknown as string, deleted: false as unknown as string },
      });

      const event: HttpEvent = { type: 'http', method: 'GET', path: '/test', cors: true };
      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.queryStringParameters).toEqual({ active: 'true', deleted: 'false' });
    });

    it('should handle empty string in multi-value query parameters', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/test',
        query: { tags: ['', 'valid'] },
      });

      const event: HttpEvent = { type: 'http', method: 'GET', path: '/test', cors: true };
      const result = EventTransformer.toHttpEvent(req, event);

      expect(result.queryStringParameters).toEqual({ tags: '' });
      expect(result.multiValueQueryStringParameters).toEqual({ tags: ['', 'valid'] });
    });

    it('should include websocket domain and extended request ID', () => {
      const result = EventTransformer.toWebSocketEvent('test', 'conn123', '$connect');

      expect(result.requestContext.domainName).toBe('localhost');
      expect(result.requestContext.extendedRequestId).toBeDefined();
    });
  });
});
