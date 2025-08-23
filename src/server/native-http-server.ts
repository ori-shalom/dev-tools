import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import { Config, HttpEvent } from '../config/schema.js';
import { EventTransformer } from './event-transformer.js';
import { createLambdaContext } from './lambda-context.js';
import { HttpHandler, ApiGatewayHttpResponse } from '../types/aws-lambda.js';
import { RouteMatcher, Route } from './route-matcher.js';

/** Maximum request body size */
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB in bytes

export type HttpServerOptions = {
  config: Config;
  loadHandler: (handlerPath: string) => Promise<HttpHandler>;
};

/**
 * HTTP Server using Node.js native HTTP server with custom route matching.
 *
 * Benefits over Express approach:
 * - Single parsing of AWS API Gateway path templates
 * - No dependency on Express or path-to-regexp
 * - Direct control over request/response handling
 * - Better performance with fewer middleware layers
 */
export class NativeHttpServer {
  private server = createServer();
  private routeMatcher = new RouteMatcher();

  constructor(private options: HttpServerOptions) {
    this.setupRoutes();
    this.setupRequestHandler();
  }

  private setupRoutes(): void {
    // Register routes from function configurations
    Object.entries(this.options.config.functions).forEach(([functionName, functionConfig]) => {
      functionConfig.events
        .filter((event): event is HttpEvent => event.type === 'http')
        .forEach((event) => {
          this.routeMatcher.registerRoute(event.path, event.method, functionName, functionConfig, event);
          console.log(`Registered ${event.method} ${event.path} -> ${functionConfig.handler}`);
        });
    });
  }

  private setupRequestHandler(): void {
    this.server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      try {
        // Log request
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

        // Handle CORS preflight requests
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

        // Find matching route
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

  private setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
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

    // Merge global and function-specific environment variables
    const environment = {
      ...this.options.config.environment,
      ...functionConfig.environment,
    };

    // Set environment variables in process.env for the handler
    const originalEnv = { ...process.env };
    Object.assign(process.env, environment);

    try {
      // Load the Lambda handler
      const lambdaHandler = await this.options.loadHandler(functionConfig.handler);

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
      // Restore original environment
      process.env = originalEnv;
    }
  }

  private sendLambdaResponse(res: ServerResponse, lambdaResponse: ApiGatewayHttpResponse): void {
    // Set status code
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
        // Try to parse as JSON, fallback to text
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
      this.server.listen(port, host, () => {
        console.log(`HTTP server listening on http://${host}:${port}`);
        resolve();
      });

      this.server.on('error', (error: NodeJS.ErrnoException) => {
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
      if (this.server.listening) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
