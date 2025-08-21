import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { ConfigParser } from '../../config/parser.js';
import { HttpServer } from '../../server/http-server.js';
import { LambdaWebSocketServer } from '../../server/websocket-server.js';
import { ManagementServer } from '../../server/management-server.js';
import { HandlerLoader } from '../../utils/handler-loader.js';
import { FileWatcher } from '../../utils/file-watcher.js';
import { HttpHandler, WebSocketHandler } from '../../types/aws-lambda.js';

export function createDevCommand(): Command {
  const command = new Command('dev');

  command
    .description('Start local development server')
    .option('-c, --config <path>', 'Configuration file path', 'lambda-dev.yml')
    .option('-p, --port <port>', 'HTTP server port', '3000')
    .option('-w, --websocket-port <port>', 'WebSocket server port', '3001')
    .option('--no-watch', 'Disable file watching')
    .action(async (options) => {
      await runDevServer(options);
    });

  return command;
}

type DevOptions = {
  config: string;
  port?: string;
  websocketPort?: string;
  watch: boolean;
};

async function runDevServer(options: DevOptions): Promise<void> {
  const configPath = resolve(process.cwd(), options.config);

  if (!existsSync(configPath)) {
    console.error(`Configuration file not found: ${configPath}`);
    console.log('Create a lambda-dev.yml file or specify a different path with --config');
    process.exit(1);
  }

  try {
    // Parse configuration
    console.log(`Loading configuration from: ${configPath}`);
    const config = ConfigParser.parseFile(configPath);

    // Override ports from CLI options
    if (options.port) {
      config.server.port = parseInt(options.port, 10);
    }
    if (options.websocketPort) {
      config.server.websocket = config.server.websocket || {};
      config.server.websocket.port = parseInt(options.websocketPort, 10);
    }

    console.log(`Starting development server for service: ${config.service}`);

    // Initialize handler loader
    const handlerLoader = new HandlerLoader();

    // Initialize servers
    const httpServer = new HttpServer({
      config,
      loadHandler: (handlerPath: string) => handlerLoader.loadHandler(handlerPath, process.cwd()) as Promise<HttpHandler>,
    });

    const websocketServer = new LambdaWebSocketServer({
      config,
      loadHandler: (handlerPath: string) => handlerLoader.loadHandler(handlerPath, process.cwd()) as Promise<WebSocketHandler>,
    });

    const managementServer = new ManagementServer({
      websocketServer,
      port: config.server.port,
      host: config.server.host,
    });

    // Set up file watching for hot reload
    let fileWatcher: FileWatcher | undefined;
    if (options.watch !== false) {
      fileWatcher = new FileWatcher();

      fileWatcher.on('file-change', (event) => {
        console.log(`[${new Date().toISOString()}] File ${event.type}: ${event.path}`);
        handlerLoader.clearCache();
        console.log('Handler cache cleared for hot reload');
      });

      fileWatcher.on('error', (error) => {
        console.error('File watcher error:', error);
      });

      // Watch source directories
      const watchPaths = ['src/**/*', configPath];

      fileWatcher.start(watchPaths);
      console.log('File watching enabled for hot reload');
    }

    // Start servers
    await Promise.all([
      httpServer.start(config.server.port, config.server.host),
      websocketServer.start(config.server.websocket?.port || config.server.port + 1, config.server.host),
      managementServer.start(),
    ]);

    console.log('\n🚀 Development server is running!');
    console.log(`📄 Configuration: ${configPath}`);
    console.log(`🌐 HTTP server: http://${config.server.host}:${config.server.port}`);
    console.log(
      `🔌 WebSocket server: ws://${config.server.host}:${config.server.websocket?.port || config.server.port + 1}`,
    );
    console.log(`⚙️  Management API: http://${config.server.host}:${config.server.port + 1}`);
    console.log(`🔄 Hot reload: ${options.watch !== false ? 'enabled' : 'disabled'}`);

    console.log('\nLambda functions:');
    Object.entries(config.functions).forEach(([name, func]) => {
      console.log(`  📦 ${name}: ${func.handler}`);
      func.events.forEach((event) => {
        if (event.type === 'http') {
          console.log(`    - HTTP ${event.method} ${event.path}`);
        } else if (event.type === 'websocket') {
          console.log(`    - WebSocket ${event.route}`);
        }
      });
    });

    console.log('\nPress Ctrl+C to stop the server');

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down servers...');

      try {
        await Promise.all([httpServer.stop(), websocketServer.stop(), managementServer.stop()]);

        if (fileWatcher) {
          fileWatcher.stop();
        }

        handlerLoader.dispose();

        console.log('✅ Servers stopped successfully');
        process.exit(0);
      } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Failed to start development server: ${error.message}`);
    } else {
      console.error('Failed to start development server:', error);
    }
    process.exit(1);
  }
}
