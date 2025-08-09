
import { EventEmitter } from 'events';
import Redis from 'ioredis';

export interface EventPayload {
  id: string;
  timestamp: Date;
  source: string;
  version: string;
  data: any;
  metadata?: Record<string, any>;
}

export interface EventHandler {
  eventType: string;
  handler: (payload: EventPayload) => Promise<void> | void;
  options?: {
    retry?: number;
    timeout?: number;
    priority?: 'high' | 'medium' | 'low';
  };
}

export interface EventBusConfig {
  redis?: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  serviceName: string;
  enablePersistence?: boolean;
  enableDeadLetterQueue?: boolean;
  retryAttempts?: number;
  retryDelay?: number;
}

export class EventBus {
  private localEmitter: EventEmitter;
  private redis?: Redis;
  private redisSubscriber?: Redis;
  private serviceName: string;
  private handlers: Map<string, EventHandler[]>;
  private deadLetterQueue: EventPayload[];
  private config: EventBusConfig;
  private isConnected: boolean = false;

  constructor(config: EventBusConfig) {
    this.config = config;
    this.serviceName = config.serviceName;
    this.localEmitter = new EventEmitter();
    this.handlers = new Map();
    this.deadLetterQueue = [];

    this.setupRedis();
    this.setupLocalEventHandling();
  }

  private setupRedis(): void {
    if (this.config.redis) {
      this.redis = new Redis({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        db: this.config.redis.db || 0,
        retryDelayOnFailover: 1000,
        maxRetriesPerRequest: 3,
      });

      this.redisSubscriber = new Redis({
        host: this.config.redis.host,
        port: this.config.redis.port,
        password: this.config.redis.password,
        db: this.config.redis.db || 0,
      });

      this.redis.on('connect', () => {
        this.isConnected = true;
        console.log(`[EventBus] Connected to Redis for service: ${this.serviceName}`);
      });

      this.redis.on('error', (error) => {
        this.isConnected = false;
        console.error(`[EventBus] Redis connection error:`, error);
      });

      this.setupRedisSubscription();
    }
  }

  private setupRedisSubscription(): void {
    if (!this.redisSubscriber) return;

    this.redisSubscriber.psubscribe(`events:${this.serviceName}:*`);
    this.redisSubscriber.psubscribe('events:global:*');

    this.redisSubscriber.on('pmessage', async (pattern, channel, message) => {
      try {
        const payload: EventPayload = JSON.parse(message);
        const eventType = channel.split(':')[2];
        
        await this.processEvent(eventType, payload);
      } catch (error) {
        console.error('[EventBus] Error processing Redis message:', error);
      }
    });
  }

  private setupLocalEventHandling(): void {
    this.localEmitter.on('*', async (eventType: string, payload: EventPayload) => {
      await this.processEvent(eventType, payload);
    });
  }

  public async publish(eventType: string, data: any, options?: {
    target?: string;
    priority?: 'high' | 'medium' | 'low';
    persistent?: boolean;
  }): Promise<void> {
    const payload: EventPayload = {
      id: this.generateEventId(),
      timestamp: new Date(),
      source: this.serviceName,
      version: '1.0.0',
      data,
      metadata: {
        priority: options?.priority || 'medium',
        persistent: options?.persistent || false,
      },
    };

    // Emit locally first
    this.localEmitter.emit('*', eventType, payload);

    // Publish to Redis for cross-service communication
    if (this.redis && this.isConnected) {
      const channel = options?.target 
        ? `events:${options.target}:${eventType}`
        : `events:global:${eventType}`;

      try {
        await this.redis.publish(channel, JSON.stringify(payload));
        
        // Store in persistent storage if enabled
        if (options?.persistent && this.config.enablePersistence) {
          await this.redis.zadd(
            `events:persistent:${eventType}`,
            Date.now(),
            JSON.stringify(payload)
          );
        }
      } catch (error) {
        console.error('[EventBus] Error publishing to Redis:', error);
        this.addToDeadLetterQueue(payload, eventType);
      }
    }
  }

  public subscribe(eventType: string, handler: (payload: EventPayload) => Promise<void> | void, options?: {
    retry?: number;
    timeout?: number;
    priority?: 'high' | 'medium' | 'low';
  }): void {
    const eventHandler: EventHandler = {
      eventType,
      handler,
      options,
    };

    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(eventHandler);
  }

  public unsubscribe(eventType: string, handler?: (payload: EventPayload) => Promise<void> | void): void {
    const handlers = this.handlers.get(eventType);
    if (!handlers) return;

    if (handler) {
      const index = handlers.findIndex(h => h.handler === handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    } else {
      this.handlers.delete(eventType);
    }
  }

  private async processEvent(eventType: string, payload: EventPayload): Promise<void> {
    const handlers = this.handlers.get(eventType) || [];
    
    // Sort handlers by priority
    const sortedHandlers = handlers.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const aPriority = priorityOrder[a.options?.priority || 'medium'];
      const bPriority = priorityOrder[b.options?.priority || 'medium'];
      return bPriority - aPriority;
    });

    for (const eventHandler of sortedHandlers) {
      await this.executeHandler(eventHandler, payload);
    }
  }

  private async executeHandler(eventHandler: EventHandler, payload: EventPayload): Promise<void> {
    const { handler, options } = eventHandler;
    const maxRetries = options?.retry || this.config.retryAttempts || 3;
    const timeout = options?.timeout || 5000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('Handler timeout')), timeout);
        });

        const handlerPromise = Promise.resolve(handler(payload));
        await Promise.race([handlerPromise, timeoutPromise]);
        
        return; // Success
      } catch (error) {
        console.error(`[EventBus] Handler error (attempt ${attempt}/${maxRetries}):`, error);
        
        if (attempt === maxRetries) {
          this.addToDeadLetterQueue(payload, eventHandler.eventType);
        } else {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
        }
      }
    }
  }

  private addToDeadLetterQueue(payload: EventPayload, eventType: string): void {
    if (this.config.enableDeadLetterQueue) {
      this.deadLetterQueue.push({
        ...payload,
        metadata: { ...payload.metadata, eventType, failedAt: new Date() },
      });
      
      console.error(`[EventBus] Added event to dead letter queue: ${eventType}`);
    }
  }

  public getDeadLetterQueue(): EventPayload[] {
    return [...this.deadLetterQueue];
  }

  public async reprocessDeadLetterQueue(): Promise<void> {
    const events = [...this.deadLetterQueue];
    this.deadLetterQueue = [];

    for (const event of events) {
      const eventType = event.metadata?.eventType;
      if (eventType) {
        await this.processEvent(eventType, event);
      }
    }
  }

  public async getEventHistory(eventType: string, limit: number = 100): Promise<EventPayload[]> {
    if (!this.redis || !this.config.enablePersistence) return [];

    try {
      const events = await this.redis.zrevrange(
        `events:persistent:${eventType}`,
        0,
        limit - 1,
        'WITHSCORES'
      );

      const result: EventPayload[] = [];
      for (let i = 0; i < events.length; i += 2) {
        const eventData = JSON.parse(events[i]);
        result.push(eventData);
      }
      return result;
    } catch (error) {
      console.error('[EventBus] Error getting event history:', error);
      return [];
    }
  }

  public getMetrics() {
    return {
      serviceName: this.serviceName,
      isConnected: this.isConnected,
      subscribedEvents: Array.from(this.handlers.keys()),
      deadLetterQueueSize: this.deadLetterQueue.length,
      totalHandlers: Array.from(this.handlers.values()).reduce((sum, handlers) => sum + handlers.length, 0),
    };
  }

  private generateEventId(): string {
    return `${this.serviceName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  public async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.disconnect();
    }
    if (this.redisSubscriber) {
      await this.redisSubscriber.disconnect();
    }
    this.localEmitter.removeAllListeners();
    this.isConnected = false;
  }
}

// Factory function
export function createEventBus(config: EventBusConfig): EventBus {
  return new EventBus(config);
}

// Event types constants
export const EVENT_TYPES = {
  USER: {
    CREATED: 'user.created',
    UPDATED: 'user.updated',
    DELETED: 'user.deleted',
    LOGIN: 'user.login',
    LOGOUT: 'user.logout',
  },
  AI: {
    REQUEST_START: 'ai.request.start',
    REQUEST_COMPLETE: 'ai.request.complete',
    REQUEST_FAILED: 'ai.request.failed',
    AGENT_HEALTH_CHANGE: 'ai.agent.health_change',
  },
  BILLING: {
    CREDIT_CONSUMED: 'billing.credit.consumed',
    CREDIT_ADDED: 'billing.credit.added',
    BUDGET_EXCEEDED: 'billing.budget.exceeded',
    INVOICE_GENERATED: 'billing.invoice.generated',
  },
  PLUGIN: {
    INSTALLED: 'plugin.installed',
    UNINSTALLED: 'plugin.uninstalled',
    EXECUTION_START: 'plugin.execution.start',
    EXECUTION_COMPLETE: 'plugin.execution.complete',
  },
  NOTIFICATION: {
    SENT: 'notification.sent',
    FAILED: 'notification.failed',
    PREFERENCE_UPDATED: 'notification.preference.updated',
  },
} as const;
