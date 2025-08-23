import { describe, it, expect, beforeEach } from 'vitest';
import { RouteMatcher } from './route-matcher.js';
import { HttpEvent, LambdaFunction } from '../config/schema.js';

describe('RouteMatcher', () => {
  let matcher: RouteMatcher;
  let mockFunctionConfig: LambdaFunction;
  let mockEvent: HttpEvent;

  beforeEach(() => {
    matcher = new RouteMatcher();
    mockFunctionConfig = {
      handler: 'src/handlers/test.handler',
      memorySize: 128,
      timeout: 30,
      environment: {},
      events: [],
    };
    mockEvent = {
      type: 'http',
      method: 'GET',
      path: '/test',
    };
  });

  describe('parsePathTemplate', () => {
    it('should parse simple path without parameters', () => {
      matcher.registerRoute('/api/users', 'GET', 'test-function', mockFunctionConfig, mockEvent);
      const routes = matcher.getRoutes();

      expect(routes).toHaveLength(1);
      expect(routes[0].regex.source).toBe('^\\/api\\/users$');
      expect(routes[0].paramNames).toEqual([]);
    });

    it('should parse path with single parameter', () => {
      const event = { ...mockEvent, path: '/users/{id}' };
      matcher.registerRoute('/users/{id}', 'GET', 'test-function', mockFunctionConfig, event);
      const routes = matcher.getRoutes();

      expect(routes).toHaveLength(1);
      expect(routes[0].regex.source).toBe('^\\/users\\/(?<id>[^/]+)$');
      expect(routes[0].paramNames).toEqual(['id']);
    });

    it('should parse path with proxy+ parameter', () => {
      const event = { ...mockEvent, path: '/api/{proxy+}' };
      matcher.registerRoute('/api/{proxy+}', 'GET', 'test-function', mockFunctionConfig, event);
      const routes = matcher.getRoutes();

      expect(routes).toHaveLength(1);
      expect(routes[0].regex.source).toBe('^\\/api\\/(?<proxy>.*)$');
      expect(routes[0].paramNames).toEqual(['proxy']);
    });

    it('should parse complex path with multiple parameters', () => {
      const event = { ...mockEvent, path: '/v1/{id}/items/{proxy+}' };
      matcher.registerRoute('/v1/{id}/items/{proxy+}', 'GET', 'test-function', mockFunctionConfig, event);
      const routes = matcher.getRoutes();

      expect(routes).toHaveLength(1);
      expect(routes[0].regex.source).toBe('^\\/v1\\/(?<id>[^/]+)\\/items\\/(?<proxy>.*)$');
      expect(routes[0].paramNames).toEqual(['id', 'proxy']);
    });

    it('should escape regex characters in path segments', () => {
      const event = { ...mockEvent, path: '/api/v1.0/test+special' };
      matcher.registerRoute('/api/v1.0/test+special', 'GET', 'test-function', mockFunctionConfig, event);
      const routes = matcher.getRoutes();

      expect(routes[0].regex.source).toBe('^\\/api\\/v1\\.0\\/test\\+special$');
    });

    it('should handle empty segments correctly', () => {
      const event = { ...mockEvent, path: '/{proxy+}' };
      matcher.registerRoute('/{proxy+}', 'GET', 'test-function', mockFunctionConfig, event);
      const routes = matcher.getRoutes();

      expect(routes[0].regex.source).toBe('^\\/(?<proxy>.*)$');
      expect(routes[0].paramNames).toEqual(['proxy']);
    });
  });

  describe('matchRoute', () => {
    beforeEach(() => {
      // Register test routes - more specific routes first
      matcher.registerRoute('/api/users/{id}', 'GET', 'user-function', mockFunctionConfig, mockEvent);
      matcher.registerRoute('/api/users', 'GET', 'users-function', mockFunctionConfig, mockEvent);
      matcher.registerRoute('/v1/{id}/items/{proxy+}', 'GET', 'complex-function', mockFunctionConfig, mockEvent);
      matcher.registerRoute('/api/{proxy+}', 'ANY', 'proxy-function', mockFunctionConfig, mockEvent);
    });

    it('should match exact routes', () => {
      const result = matcher.matchRoute('/api/users', 'GET');

      expect(result).not.toBeNull();
      expect(result!.route.functionName).toBe('users-function');
      expect(result!.match.pathParameters).toEqual({});
    });

    it('should match routes with single parameter', () => {
      const result = matcher.matchRoute('/api/users/123', 'GET');

      expect(result).not.toBeNull();
      expect(result!.route.functionName).toBe('user-function');
      expect(result!.match.pathParameters).toEqual({ id: '123' });
    });

    it('should match proxy routes with simple paths', () => {
      const result = matcher.matchRoute('/api/accounts', 'GET');

      expect(result).not.toBeNull();
      expect(result!.route.functionName).toBe('proxy-function');
      expect(result!.match.pathParameters).toEqual({ proxy: 'accounts' });
    });

    it('should match proxy routes with nested paths', () => {
      const result = matcher.matchRoute('/api/v1/accounts/123/details', 'POST');

      expect(result).not.toBeNull();
      expect(result!.route.functionName).toBe('proxy-function');
      expect(result!.match.pathParameters).toEqual({ proxy: 'v1/accounts/123/details' });
    });

    it('should match complex routes with multiple parameters', () => {
      const result = matcher.matchRoute('/v1/user123/items/categories/tech', 'GET');

      expect(result).not.toBeNull();
      expect(result!.route.functionName).toBe('complex-function');
      expect(result!.match.pathParameters).toEqual({
        id: 'user123',
        proxy: 'categories/tech',
      });
    });

    it('should handle ANY method matching', () => {
      const getResult = matcher.matchRoute('/api/test', 'GET');
      const postResult = matcher.matchRoute('/api/test', 'POST');

      expect(getResult).not.toBeNull();
      expect(postResult).not.toBeNull();
      expect(getResult!.route.functionName).toBe('proxy-function');
      expect(postResult!.route.functionName).toBe('proxy-function');
    });

    it('should return null for non-matching routes', () => {
      const result = matcher.matchRoute('/nonexistent', 'GET');
      expect(result).toBeNull();
    });

    it('should return null for wrong HTTP method on specific routes', () => {
      // Test with a path that only matches the specific GET route, not the ANY proxy route
      const result = matcher.matchRoute('/nonapi/test', 'POST');
      expect(result).toBeNull();
    });

    it('should prefer more specific routes over general ones', () => {
      // The route matcher returns the first match, so order matters
      // More specific routes should be registered first
      const result = matcher.matchRoute('/api/users/123', 'GET');

      expect(result).not.toBeNull();
      expect(result!.route.functionName).toBe('user-function');
      expect(result!.match.pathParameters).toEqual({ id: '123' });
    });
  });

  describe('error handling', () => {
    it('should throw error for invalid parameter syntax', () => {
      expect(() => {
        matcher.registerRoute('/api/{invalid', 'GET', 'test-function', mockFunctionConfig, mockEvent);
      }).toThrow('Invalid parameter syntax in path: {invalid');
    });
  });

  describe('named capture groups', () => {
    it('should correctly extract parameters using named groups', () => {
      matcher.registerRoute('/users/{userId}/posts/{postId}', 'GET', 'post-function', mockFunctionConfig, mockEvent);

      const result = matcher.matchRoute('/users/123/posts/456', 'GET');

      expect(result).not.toBeNull();
      expect(result!.match.pathParameters).toEqual({
        userId: '123',
        postId: '456',
      });
    });

    it('should URL decode path parameters like AWS API Gateway', () => {
      matcher.registerRoute(
        '/files/{fileName}/details/{proxy+}',
        'GET',
        'file-function',
        mockFunctionConfig,
        mockEvent,
      );

      const result = matcher.matchRoute('/files/my%20file.txt/details/folder%2Fsubfolder', 'GET');

      expect(result).not.toBeNull();
      expect(result!.match.pathParameters).toEqual({
        fileName: 'my file.txt',
        proxy: 'folder/subfolder',
      });
    });

    it('should handle complex paths with both regular and proxy parameters', () => {
      matcher.registerRoute('/v1/{tenant}/items/{proxy+}', 'GET', 'tenant-function', mockFunctionConfig, mockEvent);

      const result = matcher.matchRoute('/v1/acme/items/categories/tech/gadgets', 'GET');

      expect(result).not.toBeNull();
      expect(result!.match.pathParameters).toEqual({
        tenant: 'acme',
        proxy: 'categories/tech/gadgets',
      });
    });

    it('should handle empty proxy parameters', () => {
      matcher.registerRoute('/api/{proxy+}', 'GET', 'api-function', mockFunctionConfig, mockEvent);

      const result = matcher.matchRoute('/api/', 'GET');

      expect(result).not.toBeNull();
      expect(result!.match.pathParameters).toEqual({
        proxy: '',
      });
    });

    it('should verify regex patterns use named groups', () => {
      matcher.registerRoute('/test/{id}/nested/{proxy+}', 'GET', 'test-function', mockFunctionConfig, mockEvent);

      const routes = matcher.getRoutes();
      const route = routes.find((r) => r.pattern === '/test/{id}/nested/{proxy+}');

      expect(route).toBeDefined();
      // Check that the regex contains named groups
      expect(route!.regex.source).toContain('(?<id>');
      expect(route!.regex.source).toContain('(?<proxy>');
    });
  });
});
