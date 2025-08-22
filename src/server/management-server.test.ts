import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ManagementServer } from './management-server.js';
import { LambdaWebSocketServer } from './websocket-server.js';
import request from 'supertest';

// Mock dependencies
vi.mock('cors', () => ({
  default: () => (req: any, res: any, next: any) => next(),
}));

describe('ManagementServer', () => {
  let managementServer: ManagementServer;
  let mockWebSocketServer: LambdaWebSocketServer;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Mock WebSocket server
    mockWebSocketServer = {
      sendToConnection: vi.fn(),
      broadcast: vi.fn(),
      getConnections: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    } as any;

    managementServer = new ManagementServer({
      websocketServer: mockWebSocketServer,
      port: 3001,
      host: '0.0.0.0',
    });
  });

  afterEach(async () => {
    await managementServer.stop();
    consoleLogSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a management server instance', () => {
      expect(managementServer).toBeDefined();
      expect(managementServer).toBeInstanceOf(ManagementServer);
    });
  });

  describe('server lifecycle', () => {
    it('should start server successfully', async () => {
      await expect(managementServer.start()).resolves.toBeUndefined();
      expect(consoleLogSpy).toHaveBeenCalledWith('Management server listening on http://0.0.0.0:3002');
      expect(consoleLogSpy).toHaveBeenCalledWith('  - POST /connections/:id/send - Send message to connection');
      expect(consoleLogSpy).toHaveBeenCalledWith('  - POST /connections/broadcast - Broadcast to all connections');
      expect(consoleLogSpy).toHaveBeenCalledWith('  - GET  /connections - List active connections');
    });

    it('should stop server gracefully', async () => {
      await managementServer.start();
      await expect(managementServer.stop()).resolves.toBeUndefined();
    });

    it('should handle stop when server is not started', async () => {
      await expect(managementServer.stop()).resolves.toBeUndefined();
    });

    it('should handle server start errors', async () => {
      // Create another server to test port conflict
      const secondServer = new ManagementServer({
        websocketServer: mockWebSocketServer,
        port: 3001,
        host: '0.0.0.0',
      });

      await managementServer.start();
      await expect(secondServer.start()).rejects.toThrow();
      await secondServer.stop();
    });
  });

  describe('API endpoints', () => {
    beforeEach(async () => {
      await managementServer.start();
    });

    describe('POST /connections/:connectionId/send', () => {
      it('should send message to specific connection successfully', async () => {
        (mockWebSocketServer.sendToConnection as any).mockReturnValue(true);

        const response = await request(managementServer['app'])
          .post('/connections/test-connection-id/send')
          .send({ message: 'Hello specific client' })
          .expect(200);

        expect(response.body).toEqual({ success: true });
        expect(mockWebSocketServer.sendToConnection).toHaveBeenCalledWith(
          'test-connection-id',
          'Hello specific client',
        );
      });

      it('should send JSON message to specific connection', async () => {
        (mockWebSocketServer.sendToConnection as any).mockReturnValue(true);

        const jsonMessage = { type: 'greeting', data: 'Hello' };

        const response = await request(managementServer['app'])
          .post('/connections/test-connection-id/send')
          .send({ message: jsonMessage })
          .expect(200);

        expect(response.body).toEqual({ success: true });
        expect(mockWebSocketServer.sendToConnection).toHaveBeenCalledWith(
          'test-connection-id',
          JSON.stringify(jsonMessage),
        );
      });

      it('should return 404 when connection not found', async () => {
        (mockWebSocketServer.sendToConnection as any).mockReturnValue(false);

        const response = await request(managementServer['app'])
          .post('/connections/nonexistent-id/send')
          .send({ message: 'Hello' })
          .expect(404);

        expect(response.body).toEqual({ error: 'Connection not found or closed' });
        expect(mockWebSocketServer.sendToConnection).toHaveBeenCalledWith('nonexistent-id', 'Hello');
      });

      it('should return 400 when message is missing', async () => {
        const response = await request(managementServer['app'])
          .post('/connections/test-connection-id/send')
          .send({})
          .expect(400);

        expect(response.body).toEqual({ error: 'Message is required' });
        expect(mockWebSocketServer.sendToConnection).not.toHaveBeenCalled();
      });

      it('should return 400 when message is empty string', async () => {
        const response = await request(managementServer['app'])
          .post('/connections/test-connection-id/send')
          .send({ message: '' })
          .expect(400);

        expect(response.body).toEqual({ error: 'Message is required' });
        expect(mockWebSocketServer.sendToConnection).not.toHaveBeenCalled();
      });

      it('should return 400 when message is null', async () => {
        const response = await request(managementServer['app'])
          .post('/connections/test-connection-id/send')
          .send({ message: null })
          .expect(400);

        expect(response.body).toEqual({ error: 'Message is required' });
        expect(mockWebSocketServer.sendToConnection).not.toHaveBeenCalled();
      });
    });

    describe('POST /connections/broadcast', () => {
      it('should broadcast message to all connections successfully', async () => {
        (mockWebSocketServer.broadcast as any).mockReturnValue(3);

        const response = await request(managementServer['app'])
          .post('/connections/broadcast')
          .send({ message: 'Hello everyone' })
          .expect(200);

        expect(response.body).toEqual({ success: true, sentCount: 3 });
        expect(mockWebSocketServer.broadcast).toHaveBeenCalledWith('Hello everyone');
      });

      it('should broadcast JSON message to all connections', async () => {
        (mockWebSocketServer.broadcast as any).mockReturnValue(2);

        const jsonMessage = { type: 'announcement', data: 'Server update' };

        const response = await request(managementServer['app'])
          .post('/connections/broadcast')
          .send({ message: jsonMessage })
          .expect(200);

        expect(response.body).toEqual({ success: true, sentCount: 2 });
        expect(mockWebSocketServer.broadcast).toHaveBeenCalledWith(JSON.stringify(jsonMessage));
      });

      it('should return 400 when message is missing', async () => {
        const response = await request(managementServer['app']).post('/connections/broadcast').send({}).expect(400);

        expect(response.body).toEqual({ error: 'Message is required' });
        expect(mockWebSocketServer.broadcast).not.toHaveBeenCalled();
      });

      it('should return 400 when message is empty string', async () => {
        const response = await request(managementServer['app'])
          .post('/connections/broadcast')
          .send({ message: '' })
          .expect(400);

        expect(response.body).toEqual({ error: 'Message is required' });
        expect(mockWebSocketServer.broadcast).not.toHaveBeenCalled();
      });

      it('should return 400 when message is null', async () => {
        const response = await request(managementServer['app'])
          .post('/connections/broadcast')
          .send({ message: null })
          .expect(400);

        expect(response.body).toEqual({ error: 'Message is required' });
        expect(mockWebSocketServer.broadcast).not.toHaveBeenCalled();
      });

      it('should handle broadcast with zero connections', async () => {
        (mockWebSocketServer.broadcast as any).mockReturnValue(0);

        const response = await request(managementServer['app'])
          .post('/connections/broadcast')
          .send({ message: 'Hello everyone' })
          .expect(200);

        expect(response.body).toEqual({ success: true, sentCount: 0 });
        expect(mockWebSocketServer.broadcast).toHaveBeenCalledWith('Hello everyone');
      });
    });

    describe('GET /connections', () => {
      it('should return list of active connections', async () => {
        const mockConnections = [
          { connectionId: 'conn-1', connectedAt: 1234567890 },
          { connectionId: 'conn-2', connectedAt: 1234567891 },
        ];

        (mockWebSocketServer.getConnections as any).mockReturnValue(mockConnections);

        const response = await request(managementServer['app']).get('/connections').expect(200);

        expect(response.body).toEqual({ connections: mockConnections });
        expect(mockWebSocketServer.getConnections).toHaveBeenCalled();
      });

      it('should return empty list when no connections', async () => {
        (mockWebSocketServer.getConnections as any).mockReturnValue([]);

        const response = await request(managementServer['app']).get('/connections').expect(200);

        expect(response.body).toEqual({ connections: [] });
        expect(mockWebSocketServer.getConnections).toHaveBeenCalled();
      });
    });

    describe('GET /health', () => {
      it('should return health check response', async () => {
        const response = await request(managementServer['app']).get('/health').expect(200);

        expect(response.body).toHaveProperty('status', 'ok');
        expect(response.body).toHaveProperty('timestamp');
        expect(response.body).toHaveProperty('service', '@ori-sh/dev-tools-management');
        expect(typeof response.body.timestamp).toBe('string');
        expect(new Date(response.body.timestamp)).toBeInstanceOf(Date);
      });
    });

    describe('404 handler', () => {
      it('should return 404 for unknown endpoints', async () => {
        await request(managementServer['app']).get('/unknown-endpoint').expect(404);
      });

      it('should return 404 for unknown POST endpoints', async () => {
        await request(managementServer['app']).post('/unknown-endpoint').expect(404);
      });
    });
  });

  describe('middleware', () => {
    beforeEach(async () => {
      await managementServer.start();
    });

    it('should handle CORS', async () => {
      const response = await request(managementServer['app']).options('/health');

      // CORS should be enabled, actual status depends on cors middleware implementation
      expect([200, 204]).toContain(response.status);
    });

    it('should parse JSON bodies', async () => {
      (mockWebSocketServer.broadcast as any).mockReturnValue(1);

      await request(managementServer['app']).post('/connections/broadcast').send({ message: 'test' }).expect(200);

      expect(mockWebSocketServer.broadcast).toHaveBeenCalledWith('test');
    });

    it('should handle malformed JSON', async () => {
      await request(managementServer['app'])
        .post('/connections/broadcast')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400);
    });
  });

  describe('port calculation', () => {
    it('should use port + 1 for management server', async () => {
      const customServer = new ManagementServer({
        websocketServer: mockWebSocketServer,
        port: 5000,
        host: 'localhost',
      });

      await customServer.start();

      expect(consoleLogSpy).toHaveBeenCalledWith('Management server listening on http://localhost:5001');

      await customServer.stop();
    });
  });

  describe('message type handling', () => {
    beforeEach(async () => {
      await managementServer.start();
    });

    it('should handle string messages as-is', async () => {
      (mockWebSocketServer.sendToConnection as any).mockReturnValue(true);

      await request(managementServer['app'])
        .post('/connections/test-id/send')
        .send({ message: 'plain string message' })
        .expect(200);

      expect(mockWebSocketServer.sendToConnection).toHaveBeenCalledWith('test-id', 'plain string message');
    });

    it('should stringify object messages', async () => {
      (mockWebSocketServer.sendToConnection as any).mockReturnValue(true);

      const objectMessage = {
        type: 'notification',
        payload: { id: 123, text: 'Hello' },
        timestamp: Date.now(),
      };

      await request(managementServer['app'])
        .post('/connections/test-id/send')
        .send({ message: objectMessage })
        .expect(200);

      expect(mockWebSocketServer.sendToConnection).toHaveBeenCalledWith('test-id', JSON.stringify(objectMessage));
    });

    it('should stringify array messages', async () => {
      (mockWebSocketServer.sendToConnection as any).mockReturnValue(true);

      const arrayMessage = ['item1', 'item2', { key: 'value' }];

      await request(managementServer['app'])
        .post('/connections/test-id/send')
        .send({ message: arrayMessage })
        .expect(200);

      expect(mockWebSocketServer.sendToConnection).toHaveBeenCalledWith('test-id', JSON.stringify(arrayMessage));
    });

    it('should handle number messages by converting to string', async () => {
      (mockWebSocketServer.broadcast as any).mockReturnValue(1);

      await request(managementServer['app']).post('/connections/broadcast').send({ message: 42 }).expect(200);

      expect(mockWebSocketServer.broadcast).toHaveBeenCalledWith('42');
    });

    it('should handle boolean messages by converting to string', async () => {
      (mockWebSocketServer.broadcast as any).mockReturnValue(1);

      await request(managementServer['app']).post('/connections/broadcast').send({ message: true }).expect(200);

      expect(mockWebSocketServer.broadcast).toHaveBeenCalledWith('true');
    });
  });
});
