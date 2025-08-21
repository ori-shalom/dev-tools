import { Command } from 'commander';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import { toJSONSchema } from 'zod';
import { ConfigSchema } from '../../config/schema.js';

export function createInitCommand(): Command {
  const command = new Command('init');

  command
    .description('Initialize a new dev-tools project')
    .option('-f, --force', 'Overwrite existing files')
    .option('--service <name>', 'Service name', 'my-lambda-service')
    .action(async (options) => {
      await runInitCommand(options);
    });

  return command;
}

type InitOptions = {
  force?: boolean;
  service: string;
};

async function runInitCommand(options: InitOptions): Promise<void> {
  const workingDir = process.cwd();
  const configPath = resolve(workingDir, 'dev-tools.yaml');
  const srcDir = resolve(workingDir, 'src');
  const handlersDir = resolve(srcDir, 'handlers');

  try {
    console.log('🚀 Initializing dev-tools project...');

    // Check if config already exists
    if (existsSync(configPath) && !options.force) {
      console.error('Configuration file already exists: dev-tools.yaml');
      console.log('Use --force to overwrite existing files');
      process.exit(1);
    }

    // Create directories
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(handlersDir, { recursive: true });
    console.log('✓ Created directory structure');

    // Generate JSON schema
    const jsonSchema = toJSONSchema(ConfigSchema, {
      // We want the schema represent valid input values (allow optional fields) not the output values (with marked as required due to the default values)
      io: 'input',
    });
    const schemaPath = join(workingDir, 'schemas', 'config-schema.json');
    mkdirSync(join(workingDir, 'schemas'), { recursive: true });
    writeFileSync(schemaPath, JSON.stringify(jsonSchema, null, 2));
    console.log('✓ Generated JSON schema for YAML IntelliSense');

    // Create example configuration
    const exampleConfig = `# yaml-language-server: $schema=./node_modules/@ori-sh/dev-tools/schemas/config-schema.json

service: ${options.service}

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
`;

    writeFileSync(configPath, exampleConfig);
    console.log('✓ Created dev-tools.yaml configuration');

    // Create example HTTP handler
    const httpHandlerCode = `import { ApiGatewayHttpEvent, ApiGatewayHttpResponse, LambdaContext } from '@ori-sh/dev-tools';

export async function handler(
  event: ApiGatewayHttpEvent,
  context: LambdaContext
): Promise<ApiGatewayHttpResponse> {
  console.log('HTTP Event:', JSON.stringify(event, null, 2));
  console.log('Context:', JSON.stringify(context, null, 2));

  const { httpMethod, path, pathParameters, queryStringParameters } = event;

  if (httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'Hello from Lambda!',
        path,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  if (httpMethod === 'POST' && pathParameters?.name) {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: \`Hello, \${pathParameters.name}!\`,
        path,
        timestamp: new Date().toISOString(),
      }),
    };
  }

  return {
    statusCode: 404,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Not found',
    }),
  };
}
`;

    writeFileSync(join(handlersDir, 'hello.ts'), httpHandlerCode);
    console.log('✓ Created example HTTP handler');

    // Create example WebSocket handler
    const wsHandlerCode = `import { WebSocketEvent, WebSocketResponse, LambdaContext } from '@ori-sh/dev-tools';

export async function handler(
  event: WebSocketEvent,
  context: LambdaContext
): Promise<WebSocketResponse | void> {
  console.log('WebSocket Event:', JSON.stringify(event, null, 2));
  console.log('Context:', JSON.stringify(context, null, 2));

  const { routeKey, eventType, connectionId } = event.requestContext;

  switch (routeKey) {
    case '$connect':
      console.log(\`Client connected: \${connectionId}\`);
      return {
        statusCode: 200,
      };

    case '$disconnect':
      console.log(\`Client disconnected: \${connectionId}\`);
      return {
        statusCode: 200,
      };

    case 'message':
      console.log(\`Message from \${connectionId}: \${event.body}\`);
      
      // Echo the message back (in a real app, you'd use the management API)
      console.log('Echo message:', event.body);
      
      return {
        statusCode: 200,
      };

    default:
      console.log(\`Unknown route: \${routeKey}\`);
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Unknown route' }),
      };
  }
}
`;

    writeFileSync(join(handlersDir, 'websocket.ts'), wsHandlerCode);
    console.log('✓ Created example WebSocket handler');

    // Create package.json scripts
    const packageJsonPath = resolve(workingDir, 'package.json');
    if (existsSync(packageJsonPath)) {
      console.log('📦 Add these scripts to your package.json:');
      console.log('');
      console.log('"scripts": {');
      console.log('  "dev": "dt dev",');
      console.log('  "package": "dt package"');
      console.log('}');
    } else {
      const packageJson = {
        name: options.service,
        version: '1.0.0',
        description: 'Lambda functions built with @ori-sh/dev-tools',
        scripts: {
          dev: 'dt dev',
          package: 'dt package',
        },
        devDependencies: {
          '@ori-sh/dev-tools': '^2.0.0',
          typescript: '^5.0.0',
        },
      };

      writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      console.log('✓ Created package.json');
    }

    console.log('');
    console.log('🎉 Project initialized successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Install dependencies: pnpm install');
    console.log('2. Start development server: pnpm run dev');
    console.log('3. Test your functions:');
    console.log('   - HTTP: curl http://localhost:3000/hello');
    console.log('   - WebSocket: Connect to ws://localhost:3001');
    console.log('4. Package for deployment: pnpm run package');
    console.log('');
    console.log('📄 Configuration file: dev-tools.yaml');
    console.log('📁 Handler files: src/handlers/');
    console.log('');
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Failed to initialize project: ${error.message}`);
    } else {
      console.error('Failed to initialize project:', error);
    }
    process.exit(1);
  }
}
