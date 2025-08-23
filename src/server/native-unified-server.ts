import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { Config, HttpEvent, WebSocketEvent, LambdaFunction } from '../config/schema.js';
import { EventTransformer } from './event-transformer.js';
import { createLambdaContext } from './lambda-context.js';
import { HttpHandler, WebSocketHandler, ApiGatewayHttpResponse } from '../types/aws-lambda.js';
import { RouteMatcher, Route } from './route-matcher.js';

/** Maximum request body size */
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB in bytes

export type UnifiedServerOptions = {
  config: Config;
  loadHandler: (handlerPath: string) => Promise<HttpHandler | WebSocketHandler>;
};

type ConnectionInfo = {
  ws: WebSocket;
  context: {
    connectionId: string;
    connectedAt: number;
    routeKey: string;
  };
  request?: IncomingMessage; // Original WebSocket upgrade request
};

/**
 * Native unified server that handles both HTTP and WebSocket on the same port
 * without using Express.js
 */
export class NativeUnifiedServer {
  private httpServer = createServer();
  private wsServer = new WebSocketServer({ server: this.httpServer });
  private connections = new Map<string, ConnectionInfo>();
  private routeMatcher = new RouteMatcher();

  constructor(private options: UnifiedServerOptions) {
    this.setupHttpRoutes();
    this.setupHttpHandler();
    this.setupWebSocketHandlers();
  }

  private setupHttpRoutes(): void {
    // Register HTTP routes from function configurations
    Object.entries(this.options.config.functions).forEach(([functionName, functionConfig]) => {
      functionConfig.events
        .filter((event): event is HttpEvent => event.type === 'http')
        .forEach((event) => {
          this.routeMatcher.registerRoute(event.path, event.method, functionName, functionConfig, event);
          console.log(`Registered ${event.method} ${event.path} -> ${functionConfig.handler}`);
        });
    });
  }

  private setupHttpHandler(): void {
    this.httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      try {
        // Log request
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

        // Handle CORS
        if (this.options.config.server.cors) {
          this.setCorsHeaders(res);

          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
          }
        }

        // Parse URL
        const parsedUrl = parseUrl(req.url || '', true);
        const pathname = parsedUrl.pathname || '/';

        // Handle health check
        if (pathname === '/health') {
          this.sendJsonResponse(res, 200, {
            status: 'ok',
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // Handle AWS-compatible @connections API endpoints
        if (pathname.startsWith('/@connections')) {
          await this.handleConnectionsAPI(req, res, pathname);
          return;
        }

        // Find matching HTTP route
        const routeMatch = this.routeMatcher.matchRoute(pathname, req.method || 'GET');
        if (!routeMatch) {
          this.sendJsonResponse(res, 404, {
            message: `Route ${req.method} ${pathname} not found`,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        const { route, match } = routeMatch;

        // Read request body
        const body = await this.readRequestBody(req);

        // Handle the Lambda function
        await this.handleLambdaRequest(req, res, route, match.pathParameters, body);
      } catch (error) {
        console.error(`[ERROR] ${req.method} ${req.url}:`, error);
        this.sendJsonResponse(res, 500, {
          message: 'Internal Server Error',
          error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
          timestamp: new Date().toISOString(),
        });
      }
    });
  }

  private async handleConnectionsAPI(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    // AWS-compatible @connections API for WebSocket management

    // GET /@connections - List all connections (development extension)
    if (pathname === '/@connections' && req.method === 'GET') {
      const connections = Array.from(this.connections.entries()).map(([id, info]) => ({
        connectionId: id,
        connectedAt: new Date(info.context.connectedAt).toISOString(),
        routeKey: info.context.routeKey,
      }));
      this.sendJsonResponse(res, 200, connections);
      return;
    }

    // POST /@connections/{connectionId} - Send message to specific connection (AWS compatible)
    const connectionMatch = pathname.match(/^\/@connections\/([^/]+)$/);
    if (connectionMatch && req.method === 'POST') {
      const connectionId = connectionMatch[1];
      const connection = this.connections.get(connectionId);

      if (!connection) {
        this.sendJsonResponse(res, 410, { message: 'Connection not found' }); // 410 Gone like AWS
        return;
      }

      const body = await this.readRequestBody(req);
      connection.ws.send(body.toString());

      // AWS returns 200 with no body for successful post-to-connection
      res.statusCode = 200;
      res.end();
      return;
    }

    // GET /@connections/{connectionId} - Check connection status (AWS compatible)
    if (connectionMatch && req.method === 'GET') {
      const connectionId = connectionMatch[1];
      const connection = this.connections.get(connectionId);

      if (!connection) {
        this.sendJsonResponse(res, 410, { message: 'Connection not found' });
        return;
      }

      this.sendJsonResponse(res, 200, {
        connectionId: connectionId,
        connectedAt: new Date(connection.context.connectedAt).toISOString(),
      });
      return;
    }

    // DELETE /@connections/{connectionId} - Disconnect connection (AWS compatible)
    if (connectionMatch && req.method === 'DELETE') {
      const connectionId = connectionMatch[1];
      const connection = this.connections.get(connectionId);

      if (!connection) {
        this.sendJsonResponse(res, 410, { message: 'Connection not found' });
        return;
      }

      connection.ws.close();
      this.connections.delete(connectionId);

      res.statusCode = 204; // No content like AWS
      res.end();
      return;
    }

    this.sendJsonResponse(res, 404, { message: 'Connections API endpoint not found' });
  }

  private setupWebSocketHandlers(): void {
    this.wsServer.on('connection', async (ws: WebSocket, request: IncomingMessage) => {
      const connectionId = `local_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const routeKey = '$connect';

      // Store connection with original request for parameter extraction
      const connectionInfo: ConnectionInfo = {
        ws,
        context: {
          connectionId,
          connectedAt: Date.now(),
          routeKey,
        },
        request, // Store the original WebSocket upgrade request
      };
      this.connections.set(connectionId, connectionInfo);

      console.log(`WebSocket connected: ${connectionId}`);

      // Handle $connect event with original request
      await this.handleWebSocketEvent(routeKey, connectionId, null, request);

      // Handle messages
      ws.on('message', async (data: Buffer) => {
        const message = data.toString();
        console.log(`WebSocket message from ${connectionId}: ${message}`);

        // Try to parse the message to determine the route
        let route = 'message'; // default route
        try {
          const parsed = JSON.parse(message);
          if (parsed.action) {
            route = parsed.action;
          }
        } catch {
          // Not JSON, use default route
        }

        // Get the original request from connection info for query parameters
        const connectionInfo = this.connections.get(connectionId);
        await this.handleWebSocketEvent(route, connectionId, message, connectionInfo?.request);
      });

      // Handle disconnect
      ws.on('close', async () => {
        console.log(`WebSocket disconnected: ${connectionId}`);
        // Get the original request from connection info for query parameters
        const connectionInfo = this.connections.get(connectionId);
        await this.handleWebSocketEvent('$disconnect', connectionId, null, connectionInfo?.request);
        this.connections.delete(connectionId);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`WebSocket error for ${connectionId}:`, error);
      });
    });
  }

  private async handleWebSocketEvent(
    routeKey: string,
    connectionId: string,
    body: string | null,
    request?: IncomingMessage,
  ): Promise<void> {
    // Find function that handles this WebSocket route
    const handlerInfo = this.findWebSocketHandler(routeKey);
    if (!handlerInfo) {
      console.log(`No handler found for WebSocket route: ${routeKey}`);
      return;
    }

    const { functionName, functionConfig } = handlerInfo;

    try {
      // Merge environment variables
      const environment = {
        ...this.options.config.environment,
        ...functionConfig.environment,
      };

      const originalEnv = { ...process.env };
      Object.assign(process.env, environment);

      try {
        // Load the Lambda handler
        const lambdaHandler = (await this.options.loadHandler(functionConfig.handler)) as WebSocketHandler;

        // Transform to Lambda event with correct eventType mapping
        let eventType: 'CONNECT' | 'MESSAGE' | 'DISCONNECT' = 'MESSAGE';
        if (routeKey === '$connect') {
          eventType = 'CONNECT';
        } else if (routeKey === '$disconnect') {
          eventType = 'DISCONNECT';
        }

        const lambdaEvent = EventTransformer.toWebSocketEvent(body || '', connectionId, routeKey, eventType, request);

        // Create Lambda context
        const context = createLambdaContext(
          functionName,
          lambdaEvent.requestContext.requestId,
          functionConfig.memorySize,
          functionConfig.timeout,
        );

        // Execute the handler
        const result = await Promise.resolve(lambdaHandler(lambdaEvent, context));

        // Handle response (match AWS API Gateway behavior)
        let shouldCloseConnection = false;

        if (result && typeof result === 'object' && 'statusCode' in result) {
          // Explicit statusCode provided
          if (result.statusCode >= 400) {
            shouldCloseConnection = true;
            console.log(`WebSocket ${routeKey} handler returned error status: ${result.statusCode}`);
          } else {
            console.log(`WebSocket ${routeKey} handler returned status: ${result.statusCode}`);
          }
        } else {
          // No statusCode or undefined result - AWS defaults to success (200)
          console.log(`WebSocket ${routeKey} handler completed successfully (default 200)`);
        }

        // Close connection only for $connect route with error status
        if (shouldCloseConnection && routeKey === '$connect') {
          const connection = this.connections.get(connectionId);
          if (connection) {
            connection.ws.close(1008, 'Connection rejected');
            this.connections.delete(connectionId);
          }
        }
      } finally {
        process.env = originalEnv;
      }
    } catch (error) {
      console.error(`Error handling WebSocket event ${routeKey} for ${connectionId}:`, error);

      // For $connect handler errors, close the connection (AWS behavior)
      if (routeKey === '$connect') {
        const connection = this.connections.get(connectionId);
        if (connection) {
          console.log(`Closing connection ${connectionId} due to $connect handler error`);
          connection.ws.close(1011, 'Internal server error during connection');
          this.connections.delete(connectionId);
        }
      }
    }
  }

  private findWebSocketHandler(routeKey: string): { functionName: string; functionConfig: LambdaFunction } | null {
    for (const [functionName, functionConfig] of Object.entries(this.options.config.functions)) {
      const hasRoute = functionConfig.events.some(
        (event) => event.type === 'websocket' && (event as WebSocketEvent).route === routeKey,
      );
      if (hasRoute) {
        return { functionName, functionConfig };
      }
    }
    return null;
  }

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  private async readRequestBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;

      req.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_BODY_SIZE) {
          reject(new Error('Request body too large'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        resolve(Buffer.concat(chunks));
      });

      req.on('error', (error) => {
        reject(error);
      });
    });
  }

  private async handleLambdaRequest(
    req: IncomingMessage,
    res: ServerResponse,
    route: Route,
    pathParameters: Record<string, string>,
    body: Buffer,
  ): Promise<void> {
    const { functionName, functionConfig, event } = route;

    // Merge environment variables
    const environment = {
      ...this.options.config.environment,
      ...functionConfig.environment,
    };

    const originalEnv = { ...process.env };
    Object.assign(process.env, environment);

    try {
      // Load the Lambda handler
      const lambdaHandler = (await this.options.loadHandler(functionConfig.handler)) as HttpHandler;

      // Transform request to Lambda event
      const lambdaEvent = EventTransformer.toNativeHttpEvent(req, event, pathParameters, body);

      // Create Lambda context
      const context = createLambdaContext(
        functionName,
        lambdaEvent.requestContext.requestId,
        functionConfig.memorySize,
        functionConfig.timeout,
      );

      // Execute the handler
      const result = await Promise.resolve(lambdaHandler(lambdaEvent, context));

      // Send response
      this.sendLambdaResponse(res, result);
    } finally {
      process.env = originalEnv;
    }
  }

  private sendLambdaResponse(res: ServerResponse, lambdaResponse: ApiGatewayHttpResponse): void {
    res.statusCode = lambdaResponse.statusCode;

    // Set headers
    if (lambdaResponse.headers) {
      Object.entries(lambdaResponse.headers).forEach(([key, value]) => {
        res.setHeader(key, value);
      });
    }

    // Set multi-value headers
    if (lambdaResponse.multiValueHeaders) {
      Object.entries(lambdaResponse.multiValueHeaders).forEach(([key, values]) => {
        res.setHeader(key, values);
      });
    }

    // Send body
    if (lambdaResponse.body) {
      if (lambdaResponse.isBase64Encoded) {
        res.end(Buffer.from(lambdaResponse.body, 'base64'));
      } else {
        try {
          const parsed = JSON.parse(lambdaResponse.body);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(parsed));
        } catch {
          res.end(lambdaResponse.body);
        }
      }
    } else {
      res.end();
    }
  }

  private sendJsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  }

  start(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer.listen(port, host, () => {
        console.log(`Unified server listening on http://${host}:${port}`);
        console.log(`WebSocket endpoint: ws://${host}:${port}`);
        resolve();
      });

      this.httpServer.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(
            new Error(
              `Port ${port} is already in use. Please choose a different port or stop the service using port ${port}.`,
            ),
          );
        } else if (error.code === 'EACCES') {
          reject(new Error(`Permission denied to bind to port ${port}. Try using a port number above 1024.`));
        } else {
          reject(error);
        }
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all WebSocket connections
      this.connections.forEach((connection) => {
        connection.ws.close(1001, 'Server shutting down');
      });
      this.connections.clear();

      // Close the HTTP server
      this.httpServer.close(() => {
        resolve();
      });
    });
  }

  getConnections(): Map<string, ConnectionInfo> {
    return this.connections;
  }
}
