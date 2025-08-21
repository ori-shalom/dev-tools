# Lambda Dev Tools

A lightweight AWS Lambda local development and packaging tool for TypeScript projects. Provides local API Gateway and WebSocket simulation without requiring AWS credentials or external dependencies.

## Features

- 🚀 **Local Development Server** - Simulates AWS API Gateway HTTP and WebSocket events
- 🔄 **Hot Reload** - Automatic code reloading during development
- 📦 **Function Packaging** - Build and zip Lambda functions for deployment
- 🔧 **TypeScript First** - Full TypeScript support with type safety
- 📝 **YAML Configuration** - Simple YAML config with IntelliSense support
- 🌐 **WebSocket Support** - Full WebSocket API Gateway simulation
- 📡 **Management API** - Send messages to WebSocket clients during development
- ⚡ **Fast Builds** - Powered by esbuild for lightning-fast bundling
- 🎯 **Zero Config** - Minimal setup required

## Quick Start

### Installation

```bash
pnpm add lambda-dev-tools --save-dev
```

### Initialize a New Project

```bash
npx lambda-dev init
```

This creates:
- `lambda-dev.yml` - Configuration file with examples
- `src/handlers/` - Example handler functions
- JSON schema for YAML IntelliSense

### Start Development Server

```bash
pnpm run dev
# or
pnpm exec lambda-dev dev
```

### Package Functions

```bash
pnpm run package
# or
pnpm exec lambda-dev package
```

## Configuration

Create a `lambda-dev.yml` file in your project root:

```yaml
# yaml-language-server: $schema=./node_modules/lambda-dev-tools/schemas/config-schema.json

service: my-lambda-service

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
    port: 3001
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
import { ApiGatewayHttpEvent, ApiGatewayHttpResponse, LambdaContext } from 'lambda-dev-tools';

export async function handler(
  event: ApiGatewayHttpEvent,
  context: LambdaContext
): Promise<ApiGatewayHttpResponse> {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Hello from Lambda!',
      path: event.path,
      method: event.httpMethod,
    }),
  };
}
```

### WebSocket Handler

```typescript
import { WebSocketEvent, WebSocketResponse, LambdaContext } from 'lambda-dev-tools';

export async function handler(
  event: WebSocketEvent,
  context: LambdaContext
): Promise<WebSocketResponse | void> {
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

### WebSocket Management API

Send messages to WebSocket clients during development:

```bash
# Send to specific connection
curl -X POST http://localhost:3001/connections/{connectionId}/send \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from server"}'

# Broadcast to all connections
curl -X POST http://localhost:3001/connections/broadcast \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello everyone"}'

# List active connections
curl http://localhost:3001/connections
```

## CLI Commands

### `lambda-dev init`

Initialize a new project with example configuration and handlers.

Options:
- `--service <name>` - Service name (default: "my-lambda-service")
- `--force` - Overwrite existing files

### `lambda-dev dev`

Start the local development server.

Options:
- `--config <path>` - Configuration file path (default: "lambda-dev.yml")
- `--port <port>` - HTTP server port (default: 3000)
- `--websocket-port <port>` - WebSocket server port (default: 3001)
- `--no-watch` - Disable file watching

### `lambda-dev package`

Build and package Lambda functions for deployment.

Options:
- `--config <path>` - Configuration file path (default: "lambda-dev.yml")
- `--output <dir>` - Output directory for packages (default: "lambda-packages")
- `--function <name>` - Package specific function only
- `--no-minify` - Disable code minification
- `--sourcemap` - Generate source maps

## Configuration Options

### Function Configuration

```yaml
functions:
  my-function:
    handler: src/handlers/my-function.handler
    timeout: 30                    # Function timeout in seconds (1-900)
    memorySize: 1024              # Memory size in MB (128-10240)
    environment:                  # Environment variables
      NODE_ENV: development
    events:                       # Event triggers
      - type: http
        method: GET
        path: /api/users
        cors: true
      - type: websocket
        route: $connect
```

### Server Configuration

```yaml
server:
  port: 3000                      # HTTP server port
  host: localhost                 # Server host
  cors: true                      # Enable CORS globally
  websocket:
    port: 3001                    # WebSocket server port
    pingInterval: 30000           # Ping interval in milliseconds
```

### Build Configuration

```yaml
build:
  outDir: ./dist                  # Output directory for built functions
  target: node18                  # Node.js target version
  minify: true                    # Minify the built code
  sourcemap: false                # Generate source maps
  external: []                    # External dependencies to exclude
```

## IDE Integration

The generated JSON schema enables IntelliSense in VS Code and other editors. Make sure your `lambda-dev.yml` includes:

```yaml
# yaml-language-server: $schema=./node_modules/lambda-dev-tools/schemas/config-schema.json
```

## Contributing to Development

This project uses Claude Code for development. See [CLAUDE.md](./CLAUDE.md) for guidance on working with this codebase using Claude Code.

## License

MIT