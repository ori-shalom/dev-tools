import express, { Request, Response } from 'express';
import cors from 'cors';
import { LambdaWebSocketServer } from './websocket-server.js';

export type ManagementServerOptions = {
  websocketServer: LambdaWebSocketServer;
  port: number;
  host: string;
};

export class ManagementServer {
  private app = express();
  private server?: ReturnType<typeof this.app.listen>;

  constructor(private options: ManagementServerOptions) {
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
  }

  private setupRoutes(): void {
    // Send message to specific connection
    this.app.post('/connections/:connectionId/send', (req: Request, res: Response) => {
      const { connectionId } = req.params;
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const success = this.options.websocketServer.sendToConnection(
        connectionId,
        typeof message === 'string' ? message : JSON.stringify(message),
      );

      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Connection not found or closed' });
      }
    });

    // Broadcast message to all connections
    this.app.post('/connections/broadcast', (req: Request, res: Response) => {
      const { message } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const sentCount = this.options.websocketServer.broadcast(
        typeof message === 'string' ? message : JSON.stringify(message),
      );

      res.json({ success: true, sentCount });
    });

    // Get active connections
    this.app.get('/connections', (req: Request, res: Response) => {
      const connections = this.options.websocketServer.getConnections();
      res.json({ connections });
    });

    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'lambda-dev-tools-management',
      });
    });
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.options.port + 1, this.options.host, () => {
        console.log(`Management server listening on http://${this.options.host}:${this.options.port + 1}`);
        console.log(`  - POST /connections/:id/send - Send message to connection`);
        console.log(`  - POST /connections/broadcast - Broadcast to all connections`);
        console.log(`  - GET  /connections - List active connections`);
        resolve();
      });

      this.server.on('error', reject);
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
