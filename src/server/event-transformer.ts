import { IncomingMessage } from 'http';
import { parse as parseUrl } from 'url';
import { ApiGatewayHttpEvent, WebSocketEvent } from '../types/aws-lambda.js';
import { HttpEvent } from '../config/schema.js';

// Simple type for Express-like requests (for backward compatibility in tests)
type RequestLike = {
  method: string;
  path: string;
  headers: Record<string, string | string[]>;
  query: Record<string, string | string[]>;
  body?: unknown;
  ip?: string;
  get?: (header: string) => string | undefined;
};

export class EventTransformer {
  /**
   * Transform Express-like request to API Gateway HTTP event
   * @deprecated Use toNativeHttpEvent for production code
   */
  static toHttpEvent(
    req: RequestLike,
    event: HttpEvent,
    pathParameters: Record<string, string> = {},
  ): ApiGatewayHttpEvent {
    const headers: Record<string, string> = {};
    const multiValueHeaders: Record<string, string[]> = {};

    // Process headers
    Object.entries(req.headers).forEach(([key, value]) => {
      const headerKey = key.toLowerCase();
      if (Array.isArray(value)) {
        multiValueHeaders[headerKey] = value;
        headers[headerKey] = value[0];
      } else if (value !== undefined) {
        headers[headerKey] = value as string;
        multiValueHeaders[headerKey] = [value as string];
      }
    });

    // Process query parameters
    const queryStringParameters: Record<string, string> = {};
    const multiValueQueryStringParameters: Record<string, string[]> = {};

    Object.entries(req.query).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        multiValueQueryStringParameters[key] = value.map((v) => String(v));
        queryStringParameters[key] = value[0] ? String(value[0]) : '';
      } else if (value !== undefined) {
        const stringValue = String(value);
        queryStringParameters[key] = stringValue;
        multiValueQueryStringParameters[key] = [stringValue];
      }
    });

    return {
      httpMethod: req.method,
      path: req.path,
      resource: event.path,
      headers,
      multiValueHeaders,
      queryStringParameters: Object.keys(queryStringParameters).length > 0 ? queryStringParameters : null,
      multiValueQueryStringParameters:
        Object.keys(multiValueQueryStringParameters).length > 0 ? multiValueQueryStringParameters : null,
      pathParameters: Object.keys(pathParameters).length > 0 ? pathParameters : null,
      stageVariables: null,
      requestContext: {
        accountId: '123456789012',
        apiId: 'local-api',
        httpMethod: req.method,
        requestId: this.generateRequestId(),
        resourceId: 'local-resource',
        resourcePath: event.path,
        stage: 'local',
        identity: {
          sourceIp: req.ip || '127.0.0.1',
          userAgent: req.get?.('User-Agent') || 'unknown',
        },
      },
      body: req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : null,
      isBase64Encoded: false,
    };
  }
  /**
   * Transform Node.js IncomingMessage to API Gateway HTTP event
   * (for use with native HTTP server instead of Express)
   */
  static toNativeHttpEvent(
    req: IncomingMessage,
    event: HttpEvent,
    pathParameters: Record<string, string> = {},
    body?: Buffer,
  ): ApiGatewayHttpEvent {
    const headers: Record<string, string> = {};
    const multiValueHeaders: Record<string, string[]> = {};

    // Process headers
    Object.entries(req.headers).forEach(([key, value]) => {
      const headerKey = key.toLowerCase();
      if (Array.isArray(value)) {
        multiValueHeaders[headerKey] = value;
        headers[headerKey] = value[0];
      } else if (value !== undefined) {
        headers[headerKey] = value;
        multiValueHeaders[headerKey] = [value];
      }
    });

    // Parse URL for query parameters
    const parsedUrl = parseUrl(req.url || '', true);
    const queryStringParameters: Record<string, string> = {};
    const multiValueQueryStringParameters: Record<string, string[]> = {};

    Object.entries(parsedUrl.query || {}).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        multiValueQueryStringParameters[key] = value;
        queryStringParameters[key] = value[0];
      } else if (value !== undefined) {
        queryStringParameters[key] = value;
        multiValueQueryStringParameters[key] = [value];
      }
    });

    // Parse body
    let bodyString: string | null = null;
    if (body && body.length > 0) {
      // Try to parse as JSON first, fallback to string
      try {
        bodyString = body.toString('utf8');
        JSON.parse(bodyString); // Validate it's valid JSON
      } catch {
        // If not valid JSON, keep as string
        bodyString = body.toString('utf8');
      }
    }

    return {
      httpMethod: req.method || 'GET',
      path: parsedUrl.pathname || '/',
      resource: event.path,
      headers,
      multiValueHeaders,
      queryStringParameters: Object.keys(queryStringParameters).length > 0 ? queryStringParameters : null,
      multiValueQueryStringParameters:
        Object.keys(multiValueQueryStringParameters).length > 0 ? multiValueQueryStringParameters : null,
      pathParameters: Object.keys(pathParameters).length > 0 ? pathParameters : null,
      stageVariables: null,
      requestContext: {
        accountId: '123456789012',
        apiId: 'local-api',
        httpMethod: req.method || 'GET',
        requestId: this.generateRequestId(),
        resourceId: 'local-resource',
        resourcePath: event.path,
        stage: 'local',
        identity: {
          sourceIp: req.socket?.remoteAddress || '127.0.0.1',
          userAgent: req.headers['user-agent'] || 'unknown',
        },
      },
      body: bodyString,
      isBase64Encoded: false,
    };
  }

  /**
   * Transform WebSocket message to WebSocket event
   */
  static toWebSocketEvent(
    message: string | Buffer,
    connectionId: string,
    route: string,
    eventType: 'CONNECT' | 'MESSAGE' | 'DISCONNECT' = 'MESSAGE',
    request?: IncomingMessage,
  ): WebSocketEvent {
    return {
      requestContext: {
        routeKey: route,
        messageId: eventType === 'MESSAGE' ? this.generateRequestId() : undefined,
        eventType,
        extendedRequestId: this.generateRequestId(),
        requestTime: new Date().toISOString(),
        messageDirection: 'IN',
        stage: 'local',
        connectedAt: Date.now(),
        requestTimeEpoch: Date.now(),
        identity: {
          sourceIp: request?.socket?.remoteAddress || '127.0.0.1',
        },
        requestId: this.generateRequestId(),
        domainName: 'localhost',
        connectionId,
        apiId: 'local-websocket',
      },
      body: message instanceof Buffer ? message.toString() : String(message),
      isBase64Encoded: false,
    };
  }

  /**
   * Generate a random request ID
   */
  private static generateRequestId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}
