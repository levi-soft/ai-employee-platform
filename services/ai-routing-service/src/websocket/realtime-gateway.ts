
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';
import jwt from 'jsonwebtoken';
import { logger } from '@ai-platform/shared-utils';
import { StreamHandlerService } from '../streaming/stream-handler.service';

export interface WebSocketClient {
  id: string;
  userId: string;
  socket: WebSocket;
  subscriptions: Set<string>;
  lastActivity: number;
}

export interface RealtimeMessage {
  type: 'subscribe' | 'unsubscribe' | 'stream_data' | 'progress' | 'error' | 'ping' | 'pong';
  id?: string;
  streamId?: string;
  data?: any;
  timestamp: number;
}

export interface SubscriptionFilter {
  userId?: string;
  agentId?: string;
  requestType?: string;
}

export class RealtimeGateway {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WebSocketClient> = new Map();
  private subscriptions: Map<string, Set<string>> = new Map(); // streamId -> clientIds
  private streamHandler: StreamHandlerService;

  constructor(streamHandler: StreamHandlerService) {
    this.streamHandler = streamHandler;
    this.setupStreamHandlers();
    this.setupCleanup();
  }

  /**
   * Initialize WebSocket server
   */
  initialize(server: any): void {
    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      verifyClient: this.verifyClient.bind(this)
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', (error) => {
      logger.error('WebSocket server error', { error: error.message });
    });

    logger.info('Realtime Gateway initialized', {
      path: '/ws'
    });
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: RealtimeMessage, filter?: SubscriptionFilter): void {
    const serializedMessage = JSON.stringify(message);

    for (const client of this.clients.values()) {
      try {
        // Apply filter if provided
        if (filter && !this.matchesFilter(client, filter)) {
          continue;
        }

        if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.send(serializedMessage);
          client.lastActivity = Date.now();
        }
      } catch (error) {
        logger.error('Error broadcasting to client', {
          clientId: client.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    logger.debug('Message broadcasted', {
      type: message.type,
      clientCount: this.getFilteredClientCount(filter),
      filter
    });
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId: string, message: RealtimeMessage): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      client.socket.send(JSON.stringify(message));
      client.lastActivity = Date.now();
      return true;
    } catch (error) {
      logger.error('Error sending message to client', {
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Send stream data to subscribed clients
   */
  sendStreamData(streamId: string, data: any): void {
    const subscribedClients = this.subscriptions.get(streamId);
    if (!subscribedClients || subscribedClients.size === 0) {
      return;
    }

    const message: RealtimeMessage = {
      type: 'stream_data',
      streamId,
      data,
      timestamp: Date.now()
    };

    for (const clientId of subscribedClients) {
      this.sendToClient(clientId, message);
    }
  }

  /**
   * Send progress update to subscribed clients
   */
  sendProgressUpdate(streamId: string, progress: number, tokens?: number): void {
    const subscribedClients = this.subscriptions.get(streamId);
    if (!subscribedClients || subscribedClients.size === 0) {
      return;
    }

    const message: RealtimeMessage = {
      type: 'progress',
      streamId,
      data: { progress, tokens },
      timestamp: Date.now()
    };

    for (const clientId of subscribedClients) {
      this.sendToClient(clientId, message);
    }
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get client statistics
   */
  getStats(): {
    totalClients: number;
    activeSubscriptions: number;
    clientsByUser: Record<string, number>;
  } {
    const clientsByUser: Record<string, number> = {};
    
    for (const client of this.clients.values()) {
      clientsByUser[client.userId] = (clientsByUser[client.userId] || 0) + 1;
    }

    return {
      totalClients: this.clients.size,
      activeSubscriptions: this.subscriptions.size,
      clientsByUser
    };
  }

  /**
   * Close connection to specific client
   */
  disconnectClient(clientId: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    try {
      client.socket.close();
      return true;
    } catch (error) {
      logger.error('Error disconnecting client', {
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  private verifyClient(info: { origin: string; secure: boolean; req: IncomingMessage }): boolean {
    try {
      const url = new URL(info.req.url || '', `http://${info.req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        logger.warn('WebSocket connection rejected: No token provided');
        return false;
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret');
      if (!decoded || typeof decoded !== 'object') {
        logger.warn('WebSocket connection rejected: Invalid token');
        return false;
      }

      // Store user info for later use
      (info.req as any).user = decoded;
      return true;

    } catch (error) {
      logger.warn('WebSocket connection rejected: Token verification failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const user = (request as any).user;
    const clientId = this.generateClientId();

    const client: WebSocketClient = {
      id: clientId,
      userId: user.userId,
      socket,
      subscriptions: new Set(),
      lastActivity: Date.now()
    };

    this.clients.set(clientId, client);

    logger.info('WebSocket client connected', {
      clientId,
      userId: user.userId,
      userAgent: request.headers['user-agent']
    });

    // Set up client message handler
    socket.on('message', (data) => {
      this.handleClientMessage(clientId, data);
    });

    // Set up client disconnect handler
    socket.on('close', () => {
      this.handleClientDisconnect(clientId);
    });

    socket.on('error', (error) => {
      logger.error('WebSocket client error', {
        clientId,
        userId: user.userId,
        error: error.message
      });
    });

    // Send welcome message
    this.sendToClient(clientId, {
      type: 'ping',
      data: { message: 'Connected to realtime gateway' },
      timestamp: Date.now()
    });
  }

  private handleClientMessage(clientId: string, data: any): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      const message: RealtimeMessage = JSON.parse(data.toString());
      client.lastActivity = Date.now();

      logger.debug('WebSocket message received', {
        clientId,
        type: message.type,
        streamId: message.streamId
      });

      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(clientId, message.streamId!);
          break;

        case 'unsubscribe':
          this.handleUnsubscribe(clientId, message.streamId!);
          break;

        case 'ping':
          this.sendToClient(clientId, {
            type: 'pong',
            id: message.id,
            timestamp: Date.now()
          });
          break;

        default:
          logger.warn('Unknown message type', {
            clientId,
            type: message.type
          });
      }

    } catch (error) {
      logger.error('Error handling client message', {
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      this.sendToClient(clientId, {
        type: 'error',
        data: { error: 'Invalid message format' },
        timestamp: Date.now()
      });
    }
  }

  private handleClientDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove client from all subscriptions
    for (const streamId of client.subscriptions) {
      this.handleUnsubscribe(clientId, streamId);
    }

    // Remove client
    this.clients.delete(clientId);

    logger.info('WebSocket client disconnected', {
      clientId,
      userId: client.userId
    });
  }

  private handleSubscribe(clientId: string, streamId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Add client to stream subscription
    if (!this.subscriptions.has(streamId)) {
      this.subscriptions.set(streamId, new Set());
    }
    
    this.subscriptions.get(streamId)!.add(clientId);
    client.subscriptions.add(streamId);

    logger.debug('Client subscribed to stream', {
      clientId,
      streamId,
      totalSubscribers: this.subscriptions.get(streamId)!.size
    });
  }

  private handleUnsubscribe(clientId: string, streamId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove client from stream subscription
    const streamSubscriptions = this.subscriptions.get(streamId);
    if (streamSubscriptions) {
      streamSubscriptions.delete(clientId);
      
      if (streamSubscriptions.size === 0) {
        this.subscriptions.delete(streamId);
      }
    }

    client.subscriptions.delete(streamId);

    logger.debug('Client unsubscribed from stream', {
      clientId,
      streamId,
      remainingSubscribers: streamSubscriptions?.size || 0
    });
  }

  private setupStreamHandlers(): void {
    // Listen for stream events from StreamHandlerService
    this.streamHandler.on('progress', ({ streamId, progress, tokens }) => {
      this.sendProgressUpdate(streamId, progress, tokens);
    });

    this.streamHandler.on('streamEnd', ({ streamId, metrics }) => {
      const message: RealtimeMessage = {
        type: 'stream_data',
        streamId,
        data: { status: 'completed', metrics },
        timestamp: Date.now()
      };

      const subscribedClients = this.subscriptions.get(streamId);
      if (subscribedClients) {
        for (const clientId of subscribedClients) {
          this.sendToClient(clientId, message);
        }
      }
    });

    this.streamHandler.on('error', ({ streamId, error }) => {
      const message: RealtimeMessage = {
        type: 'error',
        streamId,
        data: { error: error.message },
        timestamp: Date.now()
      };

      const subscribedClients = this.subscriptions.get(streamId);
      if (subscribedClients) {
        for (const clientId of subscribedClients) {
          this.sendToClient(clientId, message);
        }
      }
    });
  }

  private matchesFilter(client: WebSocketClient, filter: SubscriptionFilter): boolean {
    if (filter.userId && client.userId !== filter.userId) {
      return false;
    }

    // Add more filter logic as needed
    return true;
  }

  private getFilteredClientCount(filter?: SubscriptionFilter): number {
    if (!filter) {
      return this.clients.size;
    }

    let count = 0;
    for (const client of this.clients.values()) {
      if (this.matchesFilter(client, filter)) {
        count++;
      }
    }
    return count;
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private setupCleanup(): void {
    // Clean up inactive clients every 2 minutes
    setInterval(() => {
      const now = Date.now();
      const maxInactivity = 10 * 60 * 1000; // 10 minutes

      for (const [clientId, client] of this.clients.entries()) {
        if (now - client.lastActivity > maxInactivity) {
          logger.info('Cleaning up inactive client', { clientId });
          this.disconnectClient(clientId);
        }
      }
    }, 2 * 60 * 1000);

    // Ping clients every 30 seconds to keep connections alive
    setInterval(() => {
      const pingMessage: RealtimeMessage = {
        type: 'ping',
        timestamp: Date.now()
      };

      for (const clientId of this.clients.keys()) {
        this.sendToClient(clientId, pingMessage);
      }
    }, 30 * 1000);
  }
}

export default RealtimeGateway;
