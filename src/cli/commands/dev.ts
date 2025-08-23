import { Command } from 'commander';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { ConfigParser } from '../../config/parser.js';
import { NativeUnifiedServer } from '../../server/native-unified-server.js';
import { HandlerLoader } from '../../utils/handler-loader.js';
import { FileWatcher } from '../../utils/file-watcher.js';
import { HttpHandler, WebSocketHandler } from '../../types/aws-lambda.js';

export function createDevCommand(): Command {
  const command = new Command('dev');

  command
    .description('Start local development server')
    .option('-c, --config <path>', 'Configuration file path', 'dev-tools.yaml')
    .option('-p, --port <port>', 'Server port', '3000')
    .option('--no-watch', 'Disable file watching')
    .option('--debug-workspace', 'Enable verbose workspace detection logging')
    .option('--trace-imports', 'Trace complete import resolution process')
    .option('--debug-bundle', 'Show ESBuild configuration and bundle analysis')
    .option('--debug-runtime', 'Show runtime environment and module resolution')
    .option('--debug-all', 'Enable all debugging features')
    .action(async (options) => {
      await runDevServer(options);
    });

  return command;
}

type DevOptions = {
  config: string;
  port?: string;
  watch: boolean;
  debugWorkspace?: boolean;
  traceImports?: boolean;
  debugBundle?: boolean;
  debugRuntime?: boolean;
  debugAll?: boolean;
};

async function runDevServer(options: DevOptions): Promise<void> {
  const configPath = resolve(process.cwd(), options.config);

  if (!existsSync(configPath)) {
    console.error(`Configuration file not found: ${configPath}`);
    console.log('Create a dev-tools.yaml file or specify a different path with --config');
    process.exit(1);
  }

  try {
    // Parse configuration
    console.log(`Loading configuration from: ${configPath}`);
    const config = ConfigParser.parseFile(configPath);

    // Override port from CLI option
    if (options.port) {
      config.server.port = parseInt(options.port, 10);
    }

    console.log(`Starting development server for service: ${config.service}`);

    // Set up debug options
    const debugOptions = {
      workspace: options.debugWorkspace || options.debugAll,
      traceImports: options.traceImports || options.debugAll,
      bundle: options.debugBundle || options.debugAll,
      runtime: options.debugRuntime || options.debugAll,
    };

    if (Object.values(debugOptions).some(Boolean)) {
      console.log('\n🐛 Debug mode enabled:');
      if (debugOptions.workspace) console.log('  - Workspace detection logging');
      if (debugOptions.traceImports) console.log('  - Import resolution tracing');
      if (debugOptions.bundle) console.log('  - Bundle configuration analysis');
      if (debugOptions.runtime) console.log('  - Runtime environment debugging');
      console.log('');
    }

    // Initialize handler loader with debug options
    const handlerLoader = new HandlerLoader(debugOptions);

    // Initialize unified server
    const server = new NativeUnifiedServer({
      config,
      loadHandler: (handlerPath: string) =>
        handlerLoader.loadHandler(handlerPath, process.cwd()) as Promise<HttpHandler | WebSocketHandler>,
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

    // Start unified server
    await server.start(config.server.port, config.server.host);

    console.log('\n🚀 Development server is running!');
    console.log(`📄 Configuration: ${configPath}`);
    console.log(`🌐 HTTP server: http://${config.server.host}:${config.server.port}`);
    console.log(`🔌 WebSocket server: ws://${config.server.host}:${config.server.port}`);
    console.log(`⚙️  @connections API: http://${config.server.host}:${config.server.port}/@connections`);
    console.log(`🔄 Hot reload: ${options.watch !== false ? 'enabled' : 'disabled'}`);

    console.log('\nLambda functions:');
    Object.entries(config.functions).forEach(([name, func]) => {
      console.log(`  📦 ${name}: ${func.handler}`);
      if (func.events && func.events.length > 0) {
        func.events.forEach((event) => {
          if (event.type === 'http') {
            console.log(`    - HTTP ${event.method} ${event.path}`);
          } else if (event.type === 'websocket') {
            console.log(`    - WebSocket ${event.route}`);
          }
        });
      } else {
        console.log('    - No events (programmatically invoked)');
      }
    });

    console.log('\nPress Ctrl+C to stop the server');

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down servers...');

      try {
        await server.stop();

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
