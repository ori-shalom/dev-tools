import { z } from 'zod/v4';

// HTTP method schema
const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'ANY']);

// HTTP event configuration
const HttpEventSchema = z.object({
  method: HttpMethodSchema,
  path: z.string().describe('API Gateway path with optional parameters (e.g., /users/{id})'),
  cors: z.boolean().optional().default(true).describe('Enable CORS for this endpoint'),
});

// WebSocket event configuration
const WebSocketEventSchema = z.object({
  route: z.string().describe('WebSocket route (e.g., $connect, $disconnect, message)'),
});

// Lambda function configuration
const LambdaFunctionSchema = z.object({
  handler: z.string().describe('Path to handler function (e.g., src/handlers/users.handler)'),
  events: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('http'),
          ...HttpEventSchema.shape,
        }),
        z.object({
          type: z.literal('websocket'),
          ...WebSocketEventSchema.shape,
        }),
      ]),
    )
    .optional()
    .default([])
    .describe('List of events that trigger this function (optional for programmatically invoked functions)'),
  environment: z.record(z.string(), z.string()).optional().describe('Environment variables for this function'),
  timeout: z.number().min(1).max(900).optional().default(30).describe('Function timeout in seconds (1-900)'),
  memorySize: z.number().min(128).max(10240).optional().default(1024).describe('Memory size in MB (128-10240)'),
});

const WebSocketConfigSchema = z.object({
  pingInterval: z.number().min(1000).optional().default(30000).describe('WebSocket ping interval in ms'),
});

// Server configuration
const ServerConfigSchema = z.object({
  port: z.number().min(1000).max(65535).optional().default(3000).describe('Local server port'),
  host: z.string().optional().default('localhost').describe('Local server host'),
  cors: z.boolean().optional().default(true).describe('Enable CORS globally'),
  websocket: WebSocketConfigSchema.optional().default(WebSocketConfigSchema.parse({})),
});

// Build configuration
const BuildConfigSchema = z.object({
  outDir: z.string().optional().default('./dist').describe('Output directory for built lambdas'),
  target: z.string().optional().default('node22').describe('Node.js target version'),
  minify: z.boolean().optional().default(true).describe('Minify the built code'),
  sourcemap: z.boolean().optional().default(false).describe('Generate source maps'),
  external: z.array(z.string()).optional().default([]).describe('External dependencies to exclude from bundle'),
});

// Main configuration schema
export const ConfigSchema = z.object({
  service: z.string().describe('Service name'),
  functions: z.record(z.string(), LambdaFunctionSchema).describe('Lambda functions configuration'),
  environment: z
    .record(z.string(), z.string())
    .optional()
    .describe('Global environment variables applied to all functions'),
  server: ServerConfigSchema.optional().default(ServerConfigSchema.parse({})),
  build: BuildConfigSchema.optional().default(BuildConfigSchema.parse({})),
});

// Type exports
export type ConfigInput = z.input<typeof ConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export type LambdaFunction = z.infer<typeof LambdaFunctionSchema>;
export type HttpEvent = z.infer<typeof HttpEventSchema> & { type: 'http' };
export type WebSocketEvent = z.infer<typeof WebSocketEventSchema> & { type: 'websocket' };
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type BuildConfig = z.infer<typeof BuildConfigSchema>;
export type HttpMethod = z.infer<typeof HttpMethodSchema>;
