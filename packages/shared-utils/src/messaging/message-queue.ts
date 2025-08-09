
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

export interface Message {
  id: string;
  type: string;
  payload: any;
  priority: number;
  timestamp: Date;
  attempts: number;
  maxAttempts: number;
  delayUntil?: Date;
  metadata?: Record<string, any>;
}

export interface QueueConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  queueName: string;
  defaultPriority?: number;
  defaultMaxAttempts?: number;
  processingTimeout?: number;
  maxConcurrency?: number;
  enableMetrics?: boolean;
}

export interface JobHandler {
  (message: Message): Promise<void> | void;
}

export interface QueueMetrics {
  queueName: string;
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  retryJobs: number;
  deadLetterJobs: number;
  throughputPerMinute: number;
  averageProcessingTime: number;
  uptime: number;
}

export class MessageQueue {
  private redis: Redis;
  private queueName: string;
  private config: QueueConfig;
  private handlers: Map<string, JobHandler>;
  private isProcessing: boolean = false;
  private processingCount: number = 0;
  private metrics: QueueMetrics;
  private startTime: Date;
  private recentCompletions: Date[] = [];

  constructor(config: QueueConfig) {
    this.config = config;
    this.queueName = config.queueName;
    this.handlers = new Map();
    this.startTime = new Date();
    
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db || 0,
      retryDelayOnFailover: 1000,
      maxRetriesPerRequest: 3,
    });

    this.initializeMetrics();
    this.setupRedisHandlers();
  }

  private setupRedisHandlers(): void {
    this.redis.on('connect', () => {
      console.log(`[MessageQueue] Connected to Redis for queue: ${this.queueName}`);
    });

    this.redis.on('error', (error) => {
      console.error(`[MessageQueue] Redis error:`, error);
    });
  }

  private initializeMetrics(): void {
    this.metrics = {
      queueName: this.queueName,
      pendingJobs: 0,
      processingJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      retryJobs: 0,
      deadLetterJobs: 0,
      throughputPerMinute: 0,
      averageProcessingTime: 0,
      uptime: 0,
    };

    if (this.config.enableMetrics) {
      this.startMetricsUpdater();
    }
  }

  private startMetricsUpdater(): void {
    setInterval(async () => {
      await this.updateMetrics();
      this.cleanupOldCompletions();
    }, 30000); // Update every 30 seconds
  }

  private async updateMetrics(): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      
      pipeline.llen(`${this.queueName}:pending`);
      pipeline.llen(`${this.queueName}:processing`);
      pipeline.get(`${this.queueName}:stats:completed`);
      pipeline.get(`${this.queueName}:stats:failed`);
      pipeline.llen(`${this.queueName}:retry`);
      pipeline.llen(`${this.queueName}:dead-letter`);

      const results = await pipeline.exec();
      
      if (results) {
        this.metrics.pendingJobs = (results[0][1] as number) || 0;
        this.metrics.processingJobs = (results[1][1] as number) || 0;
        this.metrics.completedJobs = parseInt((results[2][1] as string) || '0');
        this.metrics.failedJobs = parseInt((results[3][1] as string) || '0');
        this.metrics.retryJobs = (results[4][1] as number) || 0;
        this.metrics.deadLetterJobs = (results[5][1] as number) || 0;
      }

      // Calculate throughput
      const recentCompletions = this.recentCompletions.filter(
        completion => Date.now() - completion.getTime() < 60000
      );
      this.metrics.throughputPerMinute = recentCompletions.length;

      // Calculate uptime
      this.metrics.uptime = Date.now() - this.startTime.getTime();
    } catch (error) {
      console.error('[MessageQueue] Error updating metrics:', error);
    }
  }

  private cleanupOldCompletions(): void {
    const cutoff = Date.now() - 60000;
    this.recentCompletions = this.recentCompletions.filter(
      completion => completion.getTime() > cutoff
    );
  }

  public async add(type: string, payload: any, options?: {
    priority?: number;
    delay?: number;
    maxAttempts?: number;
    metadata?: Record<string, any>;
  }): Promise<string> {
    const message: Message = {
      id: uuidv4(),
      type,
      payload,
      priority: options?.priority || this.config.defaultPriority || 0,
      timestamp: new Date(),
      attempts: 0,
      maxAttempts: options?.maxAttempts || this.config.defaultMaxAttempts || 3,
      delayUntil: options?.delay ? new Date(Date.now() + options.delay * 1000) : undefined,
      metadata: options?.metadata,
    };

    const queueKey = message.delayUntil ? `${this.queueName}:delayed` : `${this.queueName}:pending`;
    
    if (message.delayUntil) {
      // Add to sorted set with delay timestamp as score
      await this.redis.zadd(queueKey, message.delayUntil.getTime(), JSON.stringify(message));
    } else {
      // Add to priority queue (higher priority = lower score for reverse order)
      await this.redis.zadd(queueKey, -message.priority, JSON.stringify(message));
    }

    return message.id;
  }

  public process(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
    
    if (!this.isProcessing) {
      this.startProcessing();
    }
  }

  public async processAll(globalHandler: JobHandler): Promise<void> {
    this.handlers.set('*', globalHandler);
    
    if (!this.isProcessing) {
      this.startProcessing();
    }
  }

  private async startProcessing(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    const maxConcurrency = this.config.maxConcurrency || 5;

    console.log(`[MessageQueue] Started processing queue: ${this.queueName}`);

    while (this.isProcessing) {
      try {
        if (this.processingCount < maxConcurrency) {
          await this.processNext();
        } else {
          // Wait before checking again
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error('[MessageQueue] Processing error:', error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private async processNext(): Promise<void> {
    // First, move delayed messages that are ready
    await this.moveDelayedMessages();

    // Get next message from pending queue
    const messageData = await this.redis.zpopmin(`${this.queueName}:pending`);
    if (!messageData || messageData.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return;
    }

    const message: Message = JSON.parse(messageData[0]);
    this.processingCount++;

    // Move to processing queue
    await this.redis.lpush(`${this.queueName}:processing`, JSON.stringify(message));

    try {
      const startTime = Date.now();
      await this.executeMessage(message);
      
      // Job completed successfully
      await this.redis.lrem(`${this.queueName}:processing`, 1, JSON.stringify(message));
      await this.redis.incr(`${this.queueName}:stats:completed`);
      
      this.recentCompletions.push(new Date());
      this.updateAverageProcessingTime(Date.now() - startTime);
      
    } catch (error) {
      await this.handleFailedMessage(message, error);
    } finally {
      this.processingCount--;
    }
  }

  private async moveDelayedMessages(): Promise<void> {
    const now = Date.now();
    const delayedMessages = await this.redis.zrangebyscore(
      `${this.queueName}:delayed`,
      0,
      now,
      'WITHSCORES'
    );

    if (delayedMessages.length > 0) {
      const pipeline = this.redis.pipeline();
      
      for (let i = 0; i < delayedMessages.length; i += 2) {
        const messageData = delayedMessages[i];
        const message: Message = JSON.parse(messageData);
        
        // Move to pending queue
        pipeline.zadd(`${this.queueName}:pending`, -message.priority, messageData);
        pipeline.zrem(`${this.queueName}:delayed`, messageData);
      }
      
      await pipeline.exec();
    }
  }

  private async executeMessage(message: Message): Promise<void> {
    const handler = this.handlers.get(message.type) || this.handlers.get('*');
    
    if (!handler) {
      throw new Error(`No handler found for message type: ${message.type}`);
    }

    const timeout = this.config.processingTimeout || 30000;
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Processing timeout')), timeout);
    });

    const handlerPromise = Promise.resolve(handler(message));
    await Promise.race([handlerPromise, timeoutPromise]);
  }

  private async handleFailedMessage(message: Message, error: any): Promise<void> {
    console.error(`[MessageQueue] Message failed:`, { 
      id: message.id, 
      type: message.type, 
      error: error.message 
    });

    // Remove from processing queue
    await this.redis.lrem(`${this.queueName}:processing`, 1, JSON.stringify(message));

    message.attempts++;
    
    if (message.attempts < message.maxAttempts) {
      // Add to retry queue with exponential backoff
      const delay = Math.min(60000, 1000 * Math.pow(2, message.attempts));
      message.delayUntil = new Date(Date.now() + delay);
      
      await this.redis.zadd(
        `${this.queueName}:retry`,
        message.delayUntil.getTime(),
        JSON.stringify(message)
      );
    } else {
      // Move to dead letter queue
      await this.redis.lpush(`${this.queueName}:dead-letter`, JSON.stringify({
        ...message,
        failedAt: new Date(),
        lastError: error.message,
      }));
    }

    await this.redis.incr(`${this.queueName}:stats:failed`);
  }

  public async retryFailedJobs(limit: number = 10): Promise<number> {
    const now = Date.now();
    const retryMessages = await this.redis.zrangebyscore(
      `${this.queueName}:retry`,
      0,
      now,
      'LIMIT',
      0,
      limit
    );

    if (retryMessages.length > 0) {
      const pipeline = this.redis.pipeline();
      
      for (const messageData of retryMessages) {
        const message: Message = JSON.parse(messageData);
        
        // Move back to pending queue
        pipeline.zadd(`${this.queueName}:pending`, -message.priority, messageData);
        pipeline.zrem(`${this.queueName}:retry`, messageData);
      }
      
      await pipeline.exec();
    }

    return retryMessages.length;
  }

  public async getDeadLetterJobs(limit: number = 100): Promise<Message[]> {
    const deadJobs = await this.redis.lrange(`${this.queueName}:dead-letter`, 0, limit - 1);
    return deadJobs.map(job => JSON.parse(job));
  }

  public async reprocessDeadLetterJob(jobId: string): Promise<boolean> {
    const deadJobs = await this.redis.lrange(`${this.queueName}:dead-letter`, 0, -1);
    
    for (let i = 0; i < deadJobs.length; i++) {
      const message: Message = JSON.parse(deadJobs[i]);
      if (message.id === jobId) {
        // Reset attempts and move back to pending
        message.attempts = 0;
        delete message.delayUntil;
        
        const pipeline = this.redis.pipeline();
        pipeline.lrem(`${this.queueName}:dead-letter`, 1, deadJobs[i]);
        pipeline.zadd(`${this.queueName}:pending`, -message.priority, JSON.stringify(message));
        
        await pipeline.exec();
        return true;
      }
    }
    
    return false;
  }

  public async pause(): Promise<void> {
    this.isProcessing = false;
    console.log(`[MessageQueue] Paused processing for queue: ${this.queueName}`);
  }

  public async resume(): Promise<void> {
    if (!this.isProcessing) {
      this.startProcessing();
    }
  }

  public async clear(): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.del(`${this.queueName}:pending`);
    pipeline.del(`${this.queueName}:processing`);
    pipeline.del(`${this.queueName}:retry`);
    pipeline.del(`${this.queueName}:delayed`);
    pipeline.del(`${this.queueName}:dead-letter`);
    pipeline.del(`${this.queueName}:stats:completed`);
    pipeline.del(`${this.queueName}:stats:failed`);
    
    await pipeline.exec();
  }

  public getMetrics(): QueueMetrics {
    return { ...this.metrics };
  }

  private updateAverageProcessingTime(processingTime: number): void {
    const weight = 0.1; // Exponential moving average
    this.metrics.averageProcessingTime = 
      this.metrics.averageProcessingTime * (1 - weight) + processingTime * weight;
  }

  public async disconnect(): Promise<void> {
    this.isProcessing = false;
    await this.redis.disconnect();
  }
}

// Factory function
export function createMessageQueue(config: QueueConfig): MessageQueue {
  return new MessageQueue(config);
}

// Queue priorities
export const PRIORITY = {
  CRITICAL: 100,
  HIGH: 75,
  NORMAL: 50,
  LOW: 25,
  BULK: 0,
} as const;

// Common message types
export const MESSAGE_TYPES = {
  EMAIL: 'email',
  SMS: 'sms',
  PUSH_NOTIFICATION: 'push_notification',
  AI_REQUEST: 'ai_request',
  BILLING_PROCESS: 'billing_process',
  PLUGIN_EXECUTION: 'plugin_execution',
  DATA_SYNC: 'data_sync',
  ANALYTICS: 'analytics',
} as const;
