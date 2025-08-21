import { Config } from '../config/schema.js';

export class ConsoleMessages {
  static printStartupMessage(config: Config, httpPort: number, wsPort: number, mgmtPort: number): void {
    console.log('\n====================================');
    console.log(`🚀 Lambda Dev Tools Started`);
    console.log('====================================');
    console.log(`Service: ${config.service}`);
    console.log(`Functions: ${Object.keys(config.functions).length}`);
    console.log('\nServers:');
    console.log(`  HTTP:       http://localhost:${httpPort}`);
    console.log(`  WebSocket:  ws://localhost:${wsPort}`);
    console.log(`  Management: http://localhost:${mgmtPort}`);
    console.log('\nEndpoints:');

    Object.entries(config.functions).forEach(([name, func]) => {
      func.events.forEach((event) => {
        if (event.type === 'http') {
          console.log(`  ${event.method.padEnd(7)} http://localhost:${httpPort}${event.path} -> ${name}`);
        } else if (event.type === 'websocket') {
          console.log(`  WS      ws://localhost:${wsPort}/${event.route} -> ${name}`);
        }
      });
    });

    console.log('\n📝 Watching for file changes...');
    console.log('Press Ctrl+C to stop\n');
  }
}
