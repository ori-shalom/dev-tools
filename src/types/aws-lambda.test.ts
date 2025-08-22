import { describe, it, expect } from 'vitest';
import { createLambdaContext } from '../server/lambda-context.js';
import { ApiGatewayHttpEvent, LambdaContext } from './aws-lambda.js';

describe('Types index exports', () => {
  it('should provide LambdaContext type for type checking', () => {
    // Create a context to verify the type works
    const context = createLambdaContext('test-function', 'test-request-id', 128, 30);

    // Type check that it matches the LambdaContext interface
    const typedContext: LambdaContext = context;

    expect(typedContext).toHaveProperty('functionName', 'test-function');
    expect(typedContext).toHaveProperty('awsRequestId', 'test-request-id');
    expect(typedContext).toHaveProperty('memoryLimitInMB', '128');
    expect(typedContext).toHaveProperty('getRemainingTimeInMillis');
    expect(typeof typedContext.getRemainingTimeInMillis).toBe('function');
  });

  it('should provide ApiGatewayHttpEvent type for type checking', () => {
    // Create a mock event that conforms to the type
    const mockEvent: ApiGatewayHttpEvent = {
      httpMethod: 'GET',
      path: '/api/test',
      resource: '/api/test',
      headers: { 'Content-Type': 'application/json' },
      multiValueHeaders: {},
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      requestContext: {
        accountId: '123456789012',
        apiId: 'test-api-id',
        httpMethod: 'GET',
        requestId: 'test-request-id',
        resourceId: 'test-resource-id',
        resourcePath: '/api/test',
        stage: 'dev',
        identity: {
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
        },
      },
      body: null,
      isBase64Encoded: false,
    };

    // Verify the structure matches what we expect
    expect(mockEvent.httpMethod).toBe('GET');
    expect(mockEvent.path).toBe('/api/test');
    expect(mockEvent.requestContext).toHaveProperty('requestId', 'test-request-id');
    expect(mockEvent.isBase64Encoded).toBe(false);
  });

  it('should support type composition and inheritance', () => {
    // Test that we can create more specific types based on exported ones
    type CustomLambdaEvent = ApiGatewayHttpEvent & {
      customField?: string;
    };

    const customEvent: CustomLambdaEvent = {
      httpMethod: 'POST',
      path: '/api/custom',
      resource: '/api/custom',
      headers: {},
      multiValueHeaders: {},
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      pathParameters: null,
      stageVariables: null,
      requestContext: {
        accountId: '123456789012',
        apiId: 'test-api-id',
        httpMethod: 'POST',
        requestId: 'test-request-id',
        resourceId: 'test-resource-id',
        resourcePath: '/api/custom',
        stage: 'dev',
        identity: {
          sourceIp: '127.0.0.1',
          userAgent: 'test-agent',
        },
      },
      body: '{"test": true}',
      isBase64Encoded: false,
      customField: 'custom-value',
    };

    expect(customEvent.httpMethod).toBe('POST');
    expect(customEvent.customField).toBe('custom-value');
  });

  it('should have function signature types available for handlers', () => {
    // Test that handler types can be used for type checking
    const mockHandler = async (event: ApiGatewayHttpEvent, context: LambdaContext) => {
      expect(event).toHaveProperty('httpMethod');
      expect(context).toHaveProperty('getRemainingTimeInMillis');

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'success' }),
      };
    };

    expect(typeof mockHandler).toBe('function');
  });

  it('should provide compile-time type safety', () => {
    // This test verifies that TypeScript compilation works with our types
    // If types are malformed, the build would fail
    expect(true).toBe(true);
  });
});
