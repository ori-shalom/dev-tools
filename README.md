# Dev Tools

A lightweight AWS Lambda local development and packaging tool for TypeScript projects. Provides local API Gateway and WebSocket simulation without requiring AWS credentials or external dependencies.

## Features

- 🚀 **Focus on Development** - Built exclusively for local development, doesn't touch your production deployment or runtime
- 🔐 **No AWS Required** - No AWS credentials, accounts, or intrusive setup needed
- 🔄 **Hot Reload** - Automatic code reloading during development
- 🌐 **Full API Gateway Simulation** - HTTP and WebSocket events work just like in AWS
- 🎯 **Unified Server Architecture** - Single port serves HTTP, WebSocket, and Management API (just like AWS API Gateway)
- 📦 **Simple Packaging** - Build and zip functions when you're ready to deploy
- 🔧 **TypeScript First** - Full TypeScript support with proper type definitions
- ⚡ **Lightning Fast** - Powered by esbuild for instant builds
- 🎯 **Minimal Setup** - One config file and you're ready to go

## Quick Start

### Installation

```bash
# npm
npm install @ori-sh/dev-tools --save-dev

# yarn
yarn add @ori-sh/dev-tools --dev

# pnpm
pnpm add @ori-sh/dev-tools --save-dev
```

### Initialize a New Project

```bash
npx @ori-sh/dev-tools init
```

This creates:

- `dev-tools.yaml` - Configuration file with examples
- `src/handlers/` - Example handler functions
- JSON schema for YAML IntelliSense

### Start Development Server

```bash
dt dev
```

Your functions are now available at:

- HTTP: http://localhost:3000
- WebSocket: ws://localhost:3000
- WebSocket @connections API: http://localhost:3000/@connections (AWS-compatible)

### Build Functions

```bash
dt build
```

Builds your functions without packaging (useful for testing the build output).

### Preview Production Build

```bash
dt preview
```

Serve your built functions without hot reload (production-like environment).

### Package for Deployment

```bash
dt package
```

Creates ZIP files ready for AWS Lambda deployment.

### Optional: Add npm scripts

You can optionally add these scripts to your `package.json` for convenience:

```json
{
  "scripts": {
    "dev": "dt dev",
    "build": "dt build",
    "preview": "dt preview",
    "package": "dt package"
  }
}
```

## Configuration

Create a `dev-tools.yaml` file in your project root:

```yaml
# yaml-language-server: $schema=./node_modules/@ori-sh/dev-tools/schemas/config-schema.json

service: my-lambda-service

# Global environment variables (applied to all functions)
environment:
  NODE_ENV: development
  API_VERSION: v1

functions:
  hello:
    handler: src/handlers/hello.handler
    events:
      - type: http
        method: GET
        path: /hello
        cors: true
      - type: http
        method: POST
        path: /hello/{name}
        cors: true

  websocket:
    handler: src/handlers/websocket.handler
    events:
      - type: websocket
        route: $connect
      - type: websocket
        route: $disconnect
      - type: websocket
        route: message

server:
  port: 3000
  host: localhost
  cors: true
  websocket:
    pingInterval: 30000

build:
  outDir: ./dist
  target: node18
  minify: true
  sourcemap: false
  external: []
```

## Writing Handlers

### HTTP Handler

```typescript
import { ApiGatewayHttpEvent, ApiGatewayHttpResponse, LambdaContext } from '@ori-sh/dev-tools';

export async function handler(event: ApiGatewayHttpEvent, context: LambdaContext): Promise<ApiGatewayHttpResponse> {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Hello from Lambda!',
      path: event.path,
      method: event.httpMethod,
      // Access path parameters (including proxy routes)
      pathParameters: event.pathParameters,
    }),
  };
}
```

### Proxy Route Handler Example

For proxy routes using `{proxy+}`, you can access the captured path segments:

```typescript
export async function handler(event: ApiGatewayHttpEvent, context: LambdaContext): Promise<ApiGatewayHttpResponse> {
  const { proxy } = event.pathParameters || {};

  // Route based on the proxy path
  if (proxy?.startsWith('users/')) {
    return handleUserRequest(event, context);
  } else if (proxy?.startsWith('posts/')) {
    return handlePostRequest(event, context);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'API Gateway Proxy Integration',
      capturedPath: proxy,
      originalPath: event.path,
    }),
  };
}
```

### WebSocket Handler

```typescript
import { WebSocketEvent, WebSocketResponse, LambdaContext } from '@ori-sh/dev-tools';

export async function handler(event: WebSocketEvent, context: LambdaContext): Promise<WebSocketResponse | void> {
  const { routeKey, connectionId } = event.requestContext;

  switch (routeKey) {
    case '$connect':
      console.log(`Client connected: ${connectionId}`);
      return { statusCode: 200 };

    case '$disconnect':
      console.log(`Client disconnected: ${connectionId}`);
      return { statusCode: 200 };

    case 'message':
      console.log(`Message from ${connectionId}: ${event.body}`);
      return { statusCode: 200 };
  }
}
```

## Development Features

### Hot Reload

Code changes are automatically detected and handlers are reloaded without restarting the server.

### AWS-Compatible @connections API

Manage WebSocket connections using AWS API Gateway-compatible endpoints:

```bash
# Send to specific connection
curl -X POST http://localhost:3000/@connections/{connectionId} \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from server"}'

# Check connection status
curl -X GET http://localhost:3000/@connections/{connectionId}

# Disconnect connection
curl -X DELETE http://localhost:3000/@connections/{connectionId}

# List active connections (development extension)
curl http://localhost:3000/@connections
```

## CLI Commands

### `dt init`

Initialize a new project with example configuration and handlers.

Options:

- `--service <name>` - Service name (default: "my-lambda-service")
- `--force` - Overwrite existing files

### `dt dev`

Start the local development server.

Options:

- `--config <path>` - Configuration file path (default: "dev-tools.yaml")
- `--port <port>` - HTTP server port (default: 3000)
- `--no-watch` - Disable file watching

### `dt build`

Build Lambda functions without packaging (useful for testing).

Options:

- `--config <path>` - Configuration file path (default: "dev-tools.yaml")
- `--function <name>` - Build specific function only
- `--no-minify` - Disable code minification
- `--sourcemap` - Generate source maps

### `dt preview`

Preview built Lambda functions without hot reload (production-like environment).

Options:

- `--config <path>` - Configuration file path (default: "dev-tools.yaml")
- `--port <port>` - HTTP server port (default: 3000)
- `--build-dir <path>` - Build output directory (default: "lambda-build")

### `dt package`

Build and package Lambda functions into ZIP files for deployment.

Options:

- `--config <path>` - Configuration file path (default: "dev-tools.yaml")
- `--output <dir>` - Output directory for packages (default: "lambda-packages")
- `--function <name>` - Package specific function only
- `--no-minify` - Disable code minification
- `--sourcemap` - Generate source maps

## Configuration Options

### Function Configuration

```yaml
functions:
  api-function:
    handler: src/handlers/api.handler
    timeout: 30 # Function timeout in seconds (1-900)
    memorySize: 1024 # Memory size in MB (128-10240)
    environment: # Function-specific environment variables
      FUNCTION_TYPE: api
    events: # Event triggers
      - type: http
        method: ANY # Supports GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS, ANY
        path: /api/{proxy+} # Catch-all route with proxy parameter
        cors: true
      - type: websocket
        route: $connect

  background-function:
    handler: src/handlers/background.handler
    # Functions without events (for programmatic invocation)
    # No events array needed
```

### Global Environment Variables

```yaml
# Global environment variables applied to all functions
environment:
  NODE_ENV: development
  DATABASE_URL: postgresql://localhost:5432/myapp
  API_KEY: your-api-key

functions:
  my-function:
    handler: src/handlers/my-function.handler
    environment:
      # Function-specific environment variables (merged with global)
      FUNCTION_ROLE: worker
```

### Server Configuration

```yaml
server:
  port: 3000 # Unified server port (HTTP + WebSocket + Management API)
  host: localhost # Server host
  cors: true # Enable CORS globally
  websocket:
    pingInterval: 30000 # WebSocket ping interval in milliseconds
```

### HTTP Method Support

Supports all standard HTTP methods plus `ANY`:

```yaml
events:
  - type: http
    method: ANY # Matches all HTTP methods
    path: /api/{proxy+} # Catch-all route
  - type: http
    method: GET
    path: /users/{id}
```

### Catch-All Routes (Proxy Integration)

Use `{proxy+}` for catch-all routes that capture remaining path segments. The proxy parameter contains the captured path:

```yaml
events:
  - type: http
    method: ANY
    path: /api/{proxy+} # Matches /api/users, /api/users/123, /api/users/123/posts, etc.
```

**Examples of paths matched by `/api/{proxy+}`:**

- `/api/users` → `pathParameters.proxy = "users"`
- `/api/users/123` → `pathParameters.proxy = "users/123"`
- `/api/users/123/posts` → `pathParameters.proxy = "users/123/posts"`
- `/api/v1/accounts` → `pathParameters.proxy = "v1/accounts"`

**Complex proxy patterns also work:**

```yaml
events:
  - type: http
    method: GET
    path: /v1/{id}/items/{proxy+}
```

For the path `/v1/user123/items/categories/tech`:

- `pathParameters.id = "user123"`
- `pathParameters.proxy = "categories/tech"`

### Functions Without Events

Functions don't require events and can be used for programmatic invocation:

```yaml
functions:
  scheduled-task:
    handler: src/handlers/scheduled.handler
    # No events - for background/programmatic use

  api-handler:
    handler: src/handlers/api.handler
    events:
      - type: http
        method: GET
        path: /api/users
```

### Build Configuration

```yaml
build:
  outDir: ./dist # Output directory for built functions
  target: node18 # Node.js target version
  minify: true # Minify the built code
  sourcemap: false # Generate source maps
  external: [] # External dependencies to exclude
```

## IDE Integration

The generated JSON schema enables IntelliSense in VS Code and other editors. Make sure your `dev-tools.yaml` includes:

```yaml
# yaml-language-server: $schema=./node_modules/@ori-sh/dev-tools/schemas/config-schema.json
```

## Contributing to Development

This project uses Claude Code for development. See [CLAUDE.md](./CLAUDE.md) for guidance on working with this codebase using Claude Code.

## License

MIT
