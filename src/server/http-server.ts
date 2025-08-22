import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { Config, HttpEvent, LambdaFunction } from '../config/schema.js';
import { EventTransformer } from './event-transformer.js';
import { createLambdaContext } from './lambda-context.js';
import { HttpHandler, ApiGatewayHttpResponse } from '../types/aws-lambda.js';
import { pathToRegexp, Key } from 'path-to-regexp';

export type HttpServerOptions = {
  config: Config;
  loadHandler: (handlerPath: string) => Promise<HttpHandler>;
};

export class HttpServer {
  private app = express();
  private server?: ReturnType<typeof this.app.listen>;

  constructor(private options: HttpServerOptions) {
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // CORS middleware
    if (this.options.config.server.cors) {
      this.app.use(cors());
    }

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.text({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use(express.raw({ limit: '10mb' }));

    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Process each function's HTTP events
    Object.entries(this.options.config.functions).forEach(([functionName, functionConfig]) => {
      functionConfig.events
        .filter((event): event is HttpEvent => event.type === 'http')
        .forEach((event) => {
          this.registerHttpRoute(functionName, functionConfig, event);
        });
    });

    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
  }

  private registerHttpRoute(functionName: string, functionConfig: LambdaFunction, event: HttpEvent): void {
    // Convert API Gateway path syntax to Express path syntax
    const expressPath = this.convertApiGatewayPath(event.path);

    // Create route handler
    const handler = async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Extract path parameters
        const pathParameters = this.extractPathParameters(event.path, req.path);

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
          const lambdaEvent = EventTransformer.toHttpEvent(req, event, pathParameters);

          // Create Lambda context
          const context = createLambdaContext(
            functionName,
            lambdaEvent.requestContext.requestId,
            functionConfig.memorySize,
            functionConfig.timeout,
          );

          // Execute the handler
          const result = await Promise.resolve(lambdaHandler(lambdaEvent, context));

          // Transform response
          this.sendHttpResponse(res, result);
        } finally {
          // Restore original environment
          process.env = originalEnv;
        }
      } catch (error) {
        next(error);
      }
    };

    // Register the route for specific method or all methods
    if (event.method === 'ANY') {
      // Register for all HTTP methods
      this.app.all(expressPath, handler);
      console.log(`Registered ANY ${event.path} -> ${functionConfig.handler}`);
    } else {
      const method = event.method.toLowerCase() as keyof typeof this.app;
      if (typeof this.app[method] === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.app as any)[method](expressPath, handler);
        console.log(`Registered ${event.method} ${event.path} -> ${functionConfig.handler}`);
      } else {
        console.warn(`Unsupported HTTP method: ${event.method}`);
      }
    }
  }

  private convertApiGatewayPath(apiGatewayPath: string): string {
    // Convert {proxy+} to * for Express catch-all routing
    let expressPath = apiGatewayPath.replace(/\{([^}]+)\+\}/g, '*');

    // Convert remaining {param} to :param for Express
    expressPath = expressPath.replace(/\{([^}]+)\}/g, ':$1');

    return expressPath;
  }

  private extractPathParameters(apiGatewayPath: string, actualPath: string): Record<string, string> {
    // Handle proxy+ routes directly
    if (apiGatewayPath.includes('+}')) {
      return this.extractProxyPathParameters(apiGatewayPath, actualPath);
    }

    // Handle regular path parameters using path-to-regexp
    const keys: Key[] = [];
    const regexp = pathToRegexp(this.convertApiGatewayPath(apiGatewayPath), keys);
    const match = regexp.exec(actualPath);

    if (!match) {
      return {};
    }

    const params: Record<string, string> = {};
    keys.forEach((key, index) => {
      if (key.name && match[index + 1]) {
        params[key.name.toString()] = match[index + 1];
      }
    });

    return params;
  }

  private extractProxyPathParameters(apiGatewayPath: string, actualPath: string): Record<string, string> {
    const params: Record<string, string> = {};

    // Convert API Gateway path to regex pattern
    // Example: /api/{proxy+} -> /^\/api\/(.*)$/
    // Example: /v1/{id}/items/{proxy+} -> /^\/v1\/([^/]+)\/items\/(.*)$/

    let regexPattern = apiGatewayPath
      .replace(/\{([^}]+)\+\}/g, '(.*)') // {proxy+} -> (.*)
      .replace(/\{([^}]+)\}/g, '([^/]+)') // {param} -> ([^/]+)
      .replace(/\//g, '\\/'); // Escape forward slashes

    regexPattern = `^${regexPattern}$`;

    const regex = new RegExp(regexPattern);
    const match = actualPath.match(regex);

    if (!match) {
      return {};
    }

    // Extract parameter names from the original API Gateway path
    const paramNames: string[] = [];
    let paramMatch;
    const paramRegex = /\{([^}]+)\}/g;

    while ((paramMatch = paramRegex.exec(apiGatewayPath)) !== null) {
      const paramName = paramMatch[1];
      if (paramName.endsWith('+')) {
        paramNames.push(paramName.slice(0, -1)); // Remove the '+' suffix
      } else {
        paramNames.push(paramName);
      }
    }

    // Map captured groups to parameter names
    paramNames.forEach((paramName, index) => {
      if (match[index + 1] !== undefined) {
        params[paramName] = match[index + 1];
      }
    });

    return params;
  }

  private sendHttpResponse(res: Response, lambdaResponse: ApiGatewayHttpResponse): void {
    // Set status code
    res.status(lambdaResponse.statusCode);

    // Set headers
    if (lambdaResponse.headers) {
      Object.entries(lambdaResponse.headers).forEach(([key, value]) => {
        res.set(key, value);
      });
    }

    // Set multi-value headers
    if (lambdaResponse.multiValueHeaders) {
      Object.entries(lambdaResponse.multiValueHeaders).forEach(([key, values]) => {
        res.set(key, values);
      });
    }

    // Send body
    if (lambdaResponse.body) {
      if (lambdaResponse.isBase64Encoded) {
        res.send(Buffer.from(lambdaResponse.body, 'base64'));
      } else {
        // Try to parse as JSON, fallback to text
        try {
          const parsed = JSON.parse(lambdaResponse.body);
          res.json(parsed);
        } catch {
          res.send(lambdaResponse.body);
        }
      }
    } else {
      res.end();
    }
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        message: `Route ${req.method} ${req.path} not found`,
        timestamp: new Date().toISOString(),
      });
    });

    // Error handler
    this.app.use((error: Error, req: Request, res: Response) => {
      console.error(`[ERROR] ${req.method} ${req.path}:`, error);

      res.status(500).json({
        message: 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        timestamp: new Date().toISOString(),
      });
    });
  }

  start(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(port, host, () => {
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
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
