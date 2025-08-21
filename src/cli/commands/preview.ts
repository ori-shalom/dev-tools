import { Command } from 'commander';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { ConfigParser } from '../../config/parser.js';
import { HttpServer } from '../../server/http-server.js';
import { LambdaWebSocketServer } from '../../server/websocket-server.js';
import { ManagementServer } from '../../server/management-server.js';
import { ConsoleMessages } from '../../utils/console.js';

export function createPreviewCommand(): Command {
  const command = new Command('preview');

  command
    .description('Preview built Lambda functions without hot reload')
    .option('-c, --config <path>', 'Configuration file path', 'lambda-dev.yml')
    .option('-p, --port <number>', 'HTTP server port', '3000')
    .option('-w, --ws-port <number>', 'WebSocket server port', '3001')
    .option('-m, --mgmt-port <number>', 'Management server port', '3002')
    .option('-d, --build-dir <path>', 'Build output directory', 'lambda-build')
    .action(async (options) => {
      await runPreviewCommand(options);
    });

  return command;
}

type PreviewOptions = {
  config: string;
  port: string;
  wsPort: string;
  mgmtPort: string;
  buildDir: string;
};

async function runPreviewCommand(options: PreviewOptions): Promise<void> {
  const configPath = resolve(process.cwd(), options.config);

  if (!existsSync(configPath)) {
    console.error(`Configuration file not found: ${configPath}`);
    console.log('Create a lambda-dev.yml file or specify a different path with --config');
    process.exit(1);
  }

  try {
    // Parse configuration
    const config = ConfigParser.parseFile(configPath);
    const buildDir = resolve(process.cwd(), options.buildDir);

    // Check if build directory exists
    if (!existsSync(buildDir)) {
      console.error(`Build directory not found: ${buildDir}`);
      console.log('Run "lambda-dev build" first to create the build artifacts');
      process.exit(1);
    }

    // Create a custom handler loader that loads from build directory
    const handlerLoader = {
      loadHandler: async (handlerPath: string) => {
        // Extract function name from handler path
        const [functionPath, exportName = 'handler'] = handlerPath.split('.');
        const functionName = functionPath.split('/').pop() || '';

        // Look for the built handler in the build directory
        const builtHandlerPath = join(buildDir, functionName, 'index.js');

        if (!existsSync(builtHandlerPath)) {
          throw new Error(`Built handler not found: ${builtHandlerPath}. Run "dt build" first.`);
        }

        // Dynamically import the built handler
        const module = await import(`file://${builtHandlerPath}?t=${Date.now()}`);
        const handler = module[exportName] || module.default || module;

        if (typeof handler !== 'function') {
          throw new Error(`Export '${exportName}' is not a function in ${builtHandlerPath}`);
        }

        return handler;
      },
      clearCache: () => {},
      dispose: () => {},
    };

    // Parse ports
    const httpPort = parseInt(options.port);
    const wsPort = parseInt(options.wsPort);
    const mgmtPort = parseInt(options.mgmtPort);

    // Initialize servers without file watching
    const httpServer = new HttpServer({
      config,
      loadHandler: (path: string) => handlerLoader.loadHandler(path),
    });
    const wsServer = new LambdaWebSocketServer({
      config,
      loadHandler: (path: string) => handlerLoader.loadHandler(path),
    });
    const mgmtServer = new ManagementServer({
      websocketServer: wsServer,
      port: mgmtPort,
      host: '0.0.0.0',
    });

    await httpServer.start(httpPort, '0.0.0.0');
    await wsServer.start(wsPort, '0.0.0.0');
    await mgmtServer.start();

    ConsoleMessages.printStartupMessage(config, httpPort, wsPort, mgmtPort);
    console.log('\n📦 Preview Mode: Serving built artifacts from', buildDir);
    console.log('   (No hot reload - restart to see changes)');

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log('\n\nShutting down preview servers...');
      await httpServer.stop();
      await wsServer.stop();
      await mgmtServer.stop();
      console.log('Preview servers stopped.');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Failed to start preview server: ${error.message}`);
      if (error.stack) {
        console.error(error.stack);
      }
    } else {
      console.error('Failed to start preview server:', error);
    }
    process.exit(1);
  }
}
