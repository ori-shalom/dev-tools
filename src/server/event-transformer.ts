import { Request } from 'express';
import { IncomingMessage } from 'http';
import { ApiGatewayHttpEvent, WebSocketEvent } from '../types/aws-lambda.js';
import { HttpEvent } from '../config/schema.js';

export class EventTransformer {
  /**
   * Transform Express request to API Gateway HTTP event
   */
  static toHttpEvent(req: Request, event: HttpEvent, pathParameters: Record<string, string> = {}): ApiGatewayHttpEvent {
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
          userAgent: req.get('User-Agent') || 'unknown',
        },
      },
      body: req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : null,
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
