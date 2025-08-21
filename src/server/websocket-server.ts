import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { Config, WebSocketEvent as ConfigWebSocketEvent, LambdaFunction } from '../config/schema.js';
import { EventTransformer } from './event-transformer.js';
import { createLambdaContext } from './lambda-context.js';
import { WebSocketHandler } from '../types/aws-lambda.js';

export type WebSocketServerOptions = {
  config: Config;
  loadHandler: (handlerPath: string) => Promise<WebSocketHandler>;
};

type Connection = {
  ws: WebSocket;
  connectionId: string;
  connectedAt: number;
};

export class LambdaWebSocketServer {
  private wss?: WebSocketServer;
  private connections = new Map<string, Connection>();
  private pingInterval?: NodeJS.Timeout;

  constructor(private options: WebSocketServerOptions) {}

  start(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port,
          host,
          clientTracking: false,
        });

        this.setupWebSocketHandlers();
        this.startPingInterval();

        console.log(`WebSocket server listening on ws://${host}:${port}`);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  private setupWebSocketHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', async (ws, request) => {
      const connectionId = this.generateConnectionId();
      const connection: Connection = {
        ws,
        connectionId,
        connectedAt: Date.now(),
      };

      this.connections.set(connectionId, connection);
      console.log(`WebSocket connection established: ${connectionId}`);

      // Handle $connect event
      await this.handleWebSocketEvent(connection, '$connect', '', 'CONNECT', request);

      // Handle messages
      ws.on('message', async (data) => {
        try {
          const message = data.toString();
          let route = 'message'; // default route

          // Try to extract route from message if it's JSON
          try {
            const parsed = JSON.parse(message);
            if (parsed.action) {
              route = parsed.action;
            }
          } catch {
            // Not JSON, use default route
          }

          await this.handleWebSocketEvent(connection, route, message, 'MESSAGE', request);
        } catch (error) {
          console.error(`Error handling WebSocket message from ${connectionId}:`, error);
        }
      });

      // Handle disconnect
      ws.on('close', async () => {
        console.log(`WebSocket connection closed: ${connectionId}`);
        await this.handleWebSocketEvent(connection, '$disconnect', '', 'DISCONNECT', request);
        this.connections.delete(connectionId);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`WebSocket error for ${connectionId}:`, error);
      });
    });
  }

  private async handleWebSocketEvent(
    connection: Connection,
    route: string,
    message: string,
    eventType: 'CONNECT' | 'MESSAGE' | 'DISCONNECT',
    request?: unknown,
  ): Promise<void> {
    // Find matching handler
    const handlerInfo = this.findWebSocketHandler(route);
    if (!handlerInfo) {
      console.warn(`No handler found for WebSocket route: ${route}`);
      return;
    }

    try {
      // Load the handler
      const handler = await this.options.loadHandler(handlerInfo.functionConfig.handler);

      // Create WebSocket event
      const webSocketEvent = EventTransformer.toWebSocketEvent(
        message,
        connection.connectionId,
        route,
        eventType,
        request as IncomingMessage,
      );

      // Create Lambda context
      const context = createLambdaContext(
        handlerInfo.functionName,
        webSocketEvent.requestContext.requestId,
        handlerInfo.functionConfig.memorySize,
        handlerInfo.functionConfig.timeout,
      );

      // Execute handler
      const result = await Promise.resolve(handler(webSocketEvent, context));

      // Handle response if provided
      if (result && result.statusCode !== 200) {
        console.warn(`WebSocket handler returned non-200 status: ${result.statusCode}`);
      }
    } catch (error) {
      console.error(`Error executing WebSocket handler for route ${route}:`, error);
    }
  }

  private findWebSocketHandler(route: string): {
    functionName: string;
    functionConfig: LambdaFunction;
    event: ConfigWebSocketEvent & { type: 'websocket' };
  } | null {
    for (const [functionName, functionConfig] of Object.entries(this.options.config.functions)) {
      for (const event of functionConfig.events) {
        if (event.type === 'websocket' && event.route === route) {
          return {
            functionName,
            functionConfig,
            event: event as ConfigWebSocketEvent & { type: 'websocket' },
          };
        }
      }
    }
    return null;
  }

  private startPingInterval(): void {
    const interval = this.options.config.server.websocket?.pingInterval || 30000;

    this.pingInterval = setInterval(() => {
      this.connections.forEach((connection) => {
        if (connection.ws.readyState === WebSocket.OPEN) {
          connection.ws.ping();
        } else {
          this.connections.delete(connection.connectionId);
        }
      });
    }, interval);
  }

  private generateConnectionId(): string {
    return `local_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  /**
   * Send message to a specific connection
   */
  sendToConnection(connectionId: string, message: string): boolean {
    const connection = this.connections.get(connectionId);
    if (!connection || connection.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      connection.ws.send(message);
      return true;
    } catch (error) {
      console.error(`Failed to send message to ${connectionId}:`, error);
      return false;
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: string): number {
    let sentCount = 0;
    this.connections.forEach((connection) => {
      if (connection.ws.readyState === WebSocket.OPEN) {
        try {
          connection.ws.send(message);
          sentCount++;
        } catch (error) {
          console.error(`Failed to broadcast to ${connection.connectionId}:`, error);
        }
      }
    });
    return sentCount;
  }

  /**
   * Get list of active connections
   */
  getConnections(): { connectionId: string; connectedAt: number }[] {
    return Array.from(this.connections.values()).map((conn) => ({
      connectionId: conn.connectionId,
      connectedAt: conn.connectedAt,
    }));
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = undefined;
      }

      if (this.wss) {
        // Close all connections
        this.connections.forEach((connection) => {
          connection.ws.close();
        });
        this.connections.clear();

        // Close the server
        this.wss.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
