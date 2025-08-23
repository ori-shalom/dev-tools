import { IncomingMessage } from 'http';
import { parse as parseUrl } from 'url';
import { randomBytes } from 'crypto';
import { ApiGatewayHttpEvent, WebSocketEvent } from '../types/aws-lambda.js';
import { HttpEvent } from '../config/schema.js';

export class EventTransformer {
  /**
   * Transform Node.js IncomingMessage to API Gateway HTTP event
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
    let queryStringParameters: Record<string, string> | null = null;
    let multiValueQueryStringParameters: Record<string, string[]> | null = null;
    let headers: Record<string, string> | null = null;
    let multiValueHeaders: Record<string, string[]> | null = null;

    // Extract query parameters from WebSocket connection URL (for CONNECT events)
    if (request?.url) {
      const parsedUrl = parseUrl(request.url, true);
      const queryParams: Record<string, string> = {};
      const multiValueQueryParams: Record<string, string[]> = {};

      Object.entries(parsedUrl.query || {}).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          multiValueQueryParams[key] = value;
          queryParams[key] = value[0];
        } else if (value !== undefined) {
          queryParams[key] = value;
          multiValueQueryParams[key] = [value];
        }
      });

      if (Object.keys(queryParams).length > 0) {
        queryStringParameters = queryParams;
        multiValueQueryStringParameters = multiValueQueryParams;
      }
    }

    // Extract headers from WebSocket connection request
    if (request?.headers && Object.keys(request.headers).length > 0) {
      const headerMap: Record<string, string> = {};
      const multiValueHeaderMap: Record<string, string[]> = {};

      Object.entries(request.headers).forEach(([key, value]) => {
        const headerKey = key.toLowerCase();
        if (Array.isArray(value)) {
          multiValueHeaderMap[headerKey] = value;
          headerMap[headerKey] = value[0];
        } else if (value !== undefined) {
          headerMap[headerKey] = value;
          multiValueHeaderMap[headerKey] = [value];
        }
      });

      if (Object.keys(headerMap).length > 0) {
        headers = headerMap;
        multiValueHeaders = multiValueHeaderMap;
      }
    }

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
      queryStringParameters,
      multiValueQueryStringParameters,
      headers,
      multiValueHeaders,
      body: message instanceof Buffer ? message.toString() : String(message),
      isBase64Encoded: false,
    };
  }

  /**
   * Generate a random request ID
   */
  private static generateRequestId(): string {
    // Use crypto.randomBytes for better randomness and consistent length
    // Generate 16 random bytes and convert to hex (32 characters)
    return randomBytes(16).toString('hex');
  }
}
