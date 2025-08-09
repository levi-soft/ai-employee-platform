
import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import { logger } from '@ai-platform/shared-utils';

export interface SSEClient {
  id: string;
  userId: string;
  response: Response;
  subscriptions: Set<string>;
  lastActivity: number;
  headers: Record<string, string>;
}

export interface SSEEvent {
  id?: string;
  event?: string;
  data: any;
  retry?: number;
}

export class SSEHandlerService extends EventEmitter {
  private clients: Map<string, SSEClient> = new Map();
  private subscriptions: Map<string, Set<string>> = new Map(); // streamId -> clientIds
  private eventIdCounter = 0;

  constructor() {
    super();
    this.setupCleanup();
  }

  /**
   * Initialize SSE connection for a client
   */
  initializeClient(req: Request, res: Response, userId: string): string {
    const clientId = this.generateClientId();

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'X-Accel-Buffering': 'no' // Disable Nginx buffering
    });

    // Create client object
    const client: SSEClient = {
      id: clientId,
      userId,
      response: res,
      subscriptions: new Set(),
      lastActivity: Date.now(),
      headers: {
        userAgent: req.headers['user-agent'] || 'Unknown',
        ip: req.ip || req.connection.remoteAddress || 'Unknown'
      }
    };

    this.clients.set(clientId, client);

    // Set up connection handlers
    this.setupClientHandlers(clientId, res);

    // Send initial connection event
    this.sendToClient(clientId, {
      event: 'connected',
      data: {
        clientId,
        timestamp: new Date().toISOString(),
        message: 'SSE connection established'
      }
    });

    logger.info('SSE client connected', {
      clientId,
      userId,
      userAgent: client.headers.userAgent,
      ip: client.headers.ip
    });

    return clientId;
  }

  /**
   * Send event to specific client
   */
  sendToClient(clientId: string, event: SSEEvent): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    try {
      const eventData = this.formatSSEEvent(event);
      client.response.write(eventData);
      client.lastActivity = Date.now();

      logger.debug('SSE event sent to client', {
        clientId,
        event: event.event,
        dataSize: JSON.stringify(event.data).length
      });

      return true;
    } catch (error) {
      logger.error('Error sending SSE event to client', {
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      this.removeClient(clientId);
      return false;
    }
  }

  /**
   * Broadcast event to all connected clients
   */
  broadcast(event: SSEEvent, filter?: { userId?: string; subscriptions?: string[] }): void {
    let sentCount = 0;

    for (const [clientId, client] of this.clients.entries()) {
      // Apply filters
      if (filter?.userId && client.userId !== filter.userId) {
        continue;
      }

      if (filter?.subscriptions) {
        const hasMatchingSubscription = filter.subscriptions.some(sub => 
          client.subscriptions.has(sub)
        );
        if (!hasMatchingSubscription) {
          continue;
        }
      }

      if (this.sendToClient(clientId, event)) {
        sentCount++;
      }
    }

    logger.debug('SSE event broadcasted', {
      event: event.event,
      clientCount: sentCount,
      totalClients: this.clients.size
    });
  }

  /**
   * Send stream data to subscribed clients
   */
  sendStreamData(streamId: string, data: any, event: string = 'stream_data'): void {
    const subscribedClients = this.subscriptions.get(streamId);
    if (!subscribedClients || subscribedClients.size === 0) {
      return;
    }

    const sseEvent: SSEEvent = {
      id: this.generateEventId(),
      event,
      data: {
        streamId,
        timestamp: new Date().toISOString(),
        ...data
      }
    };

    for (const clientId of subscribedClients) {
      this.sendToClient(clientId, sseEvent);
    }
  }

  /**
   * Send progress update to subscribed clients
   */
  sendProgressUpdate(streamId: string, progress: number, tokens?: number): void {
    this.sendStreamData(streamId, {
      progress,
      tokens,
      status: 'processing'
    }, 'progress');
  }

  /**
   * Subscribe client to stream
   */
  subscribeToStream(clientId: string, streamId: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    // Add client to stream subscription
    if (!this.subscriptions.has(streamId)) {
      this.subscriptions.set(streamId, new Set());
    }

    this.subscriptions.get(streamId)!.add(clientId);
    client.subscriptions.add(streamId);

    // Send confirmation
    this.sendToClient(clientId, {
      event: 'subscribed',
      data: {
        streamId,
        timestamp: new Date().toISOString()
      }
    });

    logger.debug('Client subscribed to stream via SSE', {
      clientId,
      streamId,
      totalSubscribers: this.subscriptions.get(streamId)!.size
    });

    return true;
  }

  /**
   * Unsubscribe client from stream
   */
  unsubscribeFromStream(clientId: string, streamId: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    // Remove client from stream subscription
    const streamSubscriptions = this.subscriptions.get(streamId);
    if (streamSubscriptions) {
      streamSubscriptions.delete(clientId);
      
      if (streamSubscriptions.size === 0) {
        this.subscriptions.delete(streamId);
      }
    }

    client.subscriptions.delete(streamId);

    // Send confirmation
    this.sendToClient(clientId, {
      event: 'unsubscribed',
      data: {
        streamId,
        timestamp: new Date().toISOString()
      }
    });

    logger.debug('Client unsubscribed from stream via SSE', {
      clientId,
      streamId,
      remainingSubscribers: streamSubscriptions?.size || 0
    });

    return true;
  }

  /**
   * Send keep-alive ping to all clients
   */
  sendHeartbeat(): void {
    const heartbeatEvent: SSEEvent = {
      event: 'heartbeat',
      data: {
        timestamp: new Date().toISOString(),
        serverTime: Date.now()
      }
    };

    let activeClients = 0;
    for (const clientId of this.clients.keys()) {
      if (this.sendToClient(clientId, heartbeatEvent)) {
        activeClients++;
      }
    }

    logger.debug('Heartbeat sent to SSE clients', {
      activeClients,
      totalClients: this.clients.size
    });
  }

  /**
   * Get client statistics
   */
  getStats(): {
    totalClients: number;
    clientsByUser: Record<string, number>;
    activeSubscriptions: number;
    subscriptionsByStream: Record<string, number>;
  } {
    const clientsByUser: Record<string, number> = {};
    const subscriptionsByStream: Record<string, number> = {};

    for (const client of this.clients.values()) {
      clientsByUser[client.userId] = (clientsByUser[client.userId] || 0) + 1;
    }

    for (const [streamId, clients] of this.subscriptions.entries()) {
      subscriptionsByStream[streamId] = clients.size;
    }

    return {
      totalClients: this.clients.size,
      clientsByUser,
      activeSubscriptions: this.subscriptions.size,
      subscriptionsByStream
    };
  }

  /**
   * Remove client and clean up subscriptions
   */
  removeClient(clientId: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    try {
      // Remove client from all subscriptions
      for (const streamId of client.subscriptions) {
        this.unsubscribeFromStream(clientId, streamId);
      }

      // Close the response
      if (!client.response.destroyed) {
        client.response.end();
      }

      // Remove client
      this.clients.delete(clientId);

      logger.info('SSE client removed', {
        clientId,
        userId: client.userId
      });

      this.emit('clientRemoved', { clientId, userId: client.userId });
      
      return true;
    } catch (error) {
      logger.error('Error removing SSE client', {
        clientId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  private formatSSEEvent(event: SSEEvent): string {
    let formatted = '';

    if (event.id) {
      formatted += `id: ${event.id}\n`;
    }

    if (event.event) {
      formatted += `event: ${event.event}\n`;
    }

    if (event.retry) {
      formatted += `retry: ${event.retry}\n`;
    }

    // Format data (can be multi-line)
    const dataString = typeof event.data === 'string' 
      ? event.data 
      : JSON.stringify(event.data);

    const dataLines = dataString.split('\n');
    for (const line of dataLines) {
      formatted += `data: ${line}\n`;
    }

    formatted += '\n'; // Double newline to end event

    return formatted;
  }

  private setupClientHandlers(clientId: string, res: Response): void {
    res.on('close', () => {
      logger.debug('SSE client connection closed', { clientId });
      this.removeClient(clientId);
    });

    res.on('error', (error) => {
      logger.error('SSE client connection error', {
        clientId,
        error: error.message
      });
      this.removeClient(clientId);
    });
  }

  private generateClientId(): string {
    return `sse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateEventId(): string {
    return (++this.eventIdCounter).toString();
  }

  private setupCleanup(): void {
    // Send heartbeat every 30 seconds
    setInterval(() => {
      this.sendHeartbeat();
    }, 30 * 1000);

    // Clean up inactive clients every 5 minutes
    setInterval(() => {
      const now = Date.now();
      const maxInactivity = 10 * 60 * 1000; // 10 minutes

      for (const [clientId, client] of this.clients.entries()) {
        if (now - client.lastActivity > maxInactivity) {
          logger.info('Cleaning up inactive SSE client', { clientId });
          this.removeClient(clientId);
        }
      }
    }, 5 * 60 * 1000);

    // Clean up on process exit
    process.on('SIGINT', () => {
      logger.info('Shutting down SSE service, closing all connections');
      for (const clientId of this.clients.keys()) {
        this.removeClient(clientId);
      }
    });
  }
}

export default new SSEHandlerService();
