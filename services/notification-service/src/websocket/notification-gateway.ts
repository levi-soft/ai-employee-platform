
import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { createServiceLogger, metrics } from '@ai-platform/shared-utils';
import { NotificationHistoryService } from '../services/notification-history.service';
import { PrismaClient } from '@prisma/client';

const logger = createServiceLogger('notification-gateway');
const prisma = new PrismaClient();

export interface SocketUser {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId?: string;
}

export interface NotificationData {
  id: string;
  type: string;
  title: string;
  message: string;
  data?: any;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  userId?: string;
  organizationId?: string;
  expiresAt?: Date;
}

export class NotificationGateway {
  private io: SocketIOServer;
  private connectedUsers: Map<string, Set<string>> = new Map(); // userId -> Set of socketIds
  private socketUsers: Map<string, SocketUser> = new Map(); // socketId -> user
  private historyService: NotificationHistoryService;

  constructor(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: process.env.FRONTEND_URLS?.split(',') || ['http://localhost:3000', 'http://localhost:3001'],
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000
    });

    this.historyService = new NotificationHistoryService(prisma);
    this.setupMiddleware();
    this.setupEventHandlers();
    
    logger.info('Notification Gateway initialized');
  }

  /**
   * Setup authentication middleware
   */
  private setupMiddleware(): void {
    this.io.use((socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          logger.warn('WebSocket connection rejected - no token', {
            socketId: socket.id,
            ip: socket.handshake.address
          });
          return next(new Error('Authentication token required'));
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret') as any;
        
        const user: SocketUser = {
          id: decoded.id,
          email: decoded.email,
          name: decoded.name,
          role: decoded.role,
          organizationId: decoded.organizationId
        };

        // Attach user to socket
        (socket as any).user = user;
        
        logger.info('WebSocket user authenticated', {
          socketId: socket.id,
          userId: user.id,
          userRole: user.role
        });

        next();
      } catch (error) {
        logger.error('WebSocket authentication failed', {
          socketId: socket.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        next(new Error('Invalid authentication token'));
      }
    });
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    this.io.on('connection', (socket) => {
      const user = (socket as any).user as SocketUser;
      
      // Track connected user
      this.trackUserConnection(user.id, socket.id, user);
      
      logger.info('WebSocket user connected', {
        socketId: socket.id,
        userId: user.id,
        totalConnections: this.io.engine.clientsCount
      });

      // Update metrics
      metrics.incrementCounter('websocket_connections_total');
      metrics.observeGauge('websocket_connected_users', this.connectedUsers.size);

      // Handle user joining specific rooms
      socket.on('join:organization', (organizationId: string) => {
        if (user.organizationId === organizationId || user.role === 'admin') {
          socket.join(`org:${organizationId}`);
          logger.info('User joined organization room', {
            userId: user.id,
            organizationId,
            socketId: socket.id
          });
        } else {
          logger.warn('Unauthorized organization room join attempt', {
            userId: user.id,
            requestedOrgId: organizationId,
            userOrgId: user.organizationId
          });
        }
      });

      socket.on('join:user', () => {
        socket.join(`user:${user.id}`);
        logger.debug('User joined personal room', {
          userId: user.id,
          socketId: socket.id
        });
      });

      // Handle notification acknowledgment
      socket.on('notification:ack', async (notificationId: string) => {
        try {
          await this.historyService.markAsRead(notificationId, user.id);
          logger.debug('Notification acknowledged', {
            notificationId,
            userId: user.id
          });
        } catch (error) {
          logger.error('Failed to acknowledge notification', {
            notificationId,
            userId: user.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      });

      // Handle notification preferences update
      socket.on('preferences:update', (preferences: any) => {
        logger.info('Notification preferences updated', {
          userId: user.id,
          preferences
        });
        // This would typically update user preferences in database
      });

      // Handle disconnect
      socket.on('disconnect', (reason) => {
        this.handleUserDisconnection(user.id, socket.id, reason);
      });

      // Send pending notifications on connect
      this.sendPendingNotifications(user.id, socket.id);
    });
  }

  /**
   * Track user connection
   */
  private trackUserConnection(userId: string, socketId: string, user: SocketUser): void {
    // Add socket to user's socket set
    if (!this.connectedUsers.has(userId)) {
      this.connectedUsers.set(userId, new Set());
    }
    this.connectedUsers.get(userId)!.add(socketId);
    
    // Map socket to user
    this.socketUsers.set(socketId, user);
  }

  /**
   * Handle user disconnection
   */
  private handleUserDisconnection(userId: string, socketId: string, reason: string): void {
    // Remove from tracking
    const userSockets = this.connectedUsers.get(userId);
    if (userSockets) {
      userSockets.delete(socketId);
      if (userSockets.size === 0) {
        this.connectedUsers.delete(userId);
      }
    }
    
    this.socketUsers.delete(socketId);
    
    logger.info('WebSocket user disconnected', {
      socketId,
      userId,
      reason,
      totalConnections: this.io.engine.clientsCount
    });

    // Update metrics
    metrics.decrementCounter('websocket_connections_total');
    metrics.observeGauge('websocket_connected_users', this.connectedUsers.size);
  }

  /**
   * Send notification to specific user
   */
  async sendToUser(userId: string, notification: NotificationData): Promise<boolean> {
    try {
      const userSockets = this.connectedUsers.get(userId);
      
      if (!userSockets || userSockets.size === 0) {
        logger.debug('User not connected, storing notification', {
          userId,
          notificationId: notification.id
        });
        
        // Store notification for later delivery
        await this.historyService.createNotification({
          ...notification,
          userId,
          status: 'PENDING',
          deliveredAt: null
        });
        
        return false;
      }

      // Send to all user's connected sockets
      this.io.to(`user:${userId}`).emit('notification', notification);
      
      // Mark as delivered
      await this.historyService.createNotification({
        ...notification,
        userId,
        status: 'DELIVERED',
        deliveredAt: new Date()
      });

      logger.info('Notification sent to user', {
        userId,
        notificationId: notification.id,
        socketCount: userSockets.size
      });

      // Update metrics
      metrics.incrementCounter('notifications_sent_total', {
        type: notification.type,
        priority: notification.priority,
        method: 'websocket'
      });

      return true;
    } catch (error) {
      logger.error('Failed to send notification to user', {
        userId,
        notificationId: notification.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return false;
    }
  }

  /**
   * Send notification to organization
   */
  async sendToOrganization(organizationId: string, notification: NotificationData): Promise<number> {
    try {
      // Send to organization room
      this.io.to(`org:${organizationId}`).emit('notification', notification);
      
      // Count connected users in organization
      const orgRoom = this.io.sockets.adapter.rooms.get(`org:${organizationId}`);
      const connectedCount = orgRoom?.size || 0;

      // Store notification for organization members
      await this.historyService.createNotification({
        ...notification,
        organizationId,
        status: 'DELIVERED',
        deliveredAt: new Date()
      });

      logger.info('Notification sent to organization', {
        organizationId,
        notificationId: notification.id,
        connectedUsers: connectedCount
      });

      // Update metrics
      metrics.incrementCounter('notifications_sent_total', {
        type: notification.type,
        priority: notification.priority,
        method: 'websocket',
        scope: 'organization'
      });

      return connectedCount;
    } catch (error) {
      logger.error('Failed to send notification to organization', {
        organizationId,
        notificationId: notification.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return 0;
    }
  }

  /**
   * Broadcast notification to all connected users
   */
  async broadcast(notification: NotificationData, excludeUsers: string[] = []): Promise<number> {
    try {
      // Create a list of excluded socket IDs
      const excludedSockets = new Set<string>();
      excludeUsers.forEach(userId => {
        const userSockets = this.connectedUsers.get(userId);
        if (userSockets) {
          userSockets.forEach(socketId => excludedSockets.add(socketId));
        }
      });

      // Send to all connected sockets except excluded ones
      const allSockets = Array.from(this.io.sockets.sockets.keys());
      const targetSockets = allSockets.filter(socketId => !excludedSockets.has(socketId));

      targetSockets.forEach(socketId => {
        this.io.to(socketId).emit('notification', notification);
      });

      // Store broadcast notification
      await this.historyService.createNotification({
        ...notification,
        status: 'DELIVERED',
        deliveredAt: new Date()
      });

      logger.info('Notification broadcasted', {
        notificationId: notification.id,
        targetSockets: targetSockets.length,
        excludedUsers: excludeUsers.length
      });

      // Update metrics
      metrics.incrementCounter('notifications_sent_total', {
        type: notification.type,
        priority: notification.priority,
        method: 'websocket',
        scope: 'broadcast'
      });

      return targetSockets.length;
    } catch (error) {
      logger.error('Failed to broadcast notification', {
        notificationId: notification.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return 0;
    }
  }

  /**
   * Send pending notifications to newly connected user
   */
  private async sendPendingNotifications(userId: string, socketId: string): Promise<void> {
    try {
      const pendingNotifications = await this.historyService.getUserNotifications(userId, {
        status: 'PENDING',
        limit: 50
      });

      if (pendingNotifications.length > 0) {
        // Send pending notifications
        pendingNotifications.forEach(notification => {
          this.io.to(socketId).emit('notification', notification);
        });

        // Mark as delivered
        const notificationIds = pendingNotifications.map(n => n.id);
        await this.historyService.markAsDelivered(notificationIds);

        logger.info('Sent pending notifications to user', {
          userId,
          socketId,
          count: pendingNotifications.length
        });
      }
    } catch (error) {
      logger.error('Failed to send pending notifications', {
        userId,
        socketId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get connected users count
   */
  getConnectedUsersCount(): number {
    return this.connectedUsers.size;
  }

  /**
   * Get total socket connections
   */
  getTotalConnections(): number {
    return this.io.engine.clientsCount;
  }

  /**
   * Check if user is online
   */
  isUserOnline(userId: string): boolean {
    return this.connectedUsers.has(userId);
  }

  /**
   * Get online users in organization
   */
  getOnlineUsersInOrganization(organizationId: string): string[] {
    const onlineUsers: string[] = [];
    
    this.connectedUsers.forEach((sockets, userId) => {
      sockets.forEach(socketId => {
        const user = this.socketUsers.get(socketId);
        if (user && user.organizationId === organizationId) {
          onlineUsers.push(userId);
        }
      });
    });

    return [...new Set(onlineUsers)]; // Remove duplicates
  }

  /**
   * Shutdown gateway gracefully
   */
  async shutdown(): Promise<void> {
    return new Promise((resolve) => {
      logger.info('Shutting down WebSocket gateway...');
      
      // Notify all connected clients
      this.io.emit('server:shutdown', {
        message: 'Server is shutting down',
        timestamp: new Date().toISOString()
      });

      // Close all connections
      this.io.close(() => {
        logger.info('WebSocket gateway shutdown complete');
        resolve();
      });
    });
  }
}
