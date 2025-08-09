
import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { logger } from '@ai-platform/shared-utils';
import { v4 as uuidv4 } from 'uuid';

export interface QueuedRequest {
  id: string;
  userId: string;
  providerId: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  payload: {
    messages: any[];
    model: string;
    maxTokens?: number;
    temperature?: number;
    [key: string]: any;
  };
  metadata: {
    createdAt: Date;
    scheduledAt?: Date;
    attempts: number;
    maxAttempts: number;
    timeout: number;
    retryDelay: number;
    userTier: 'basic' | 'premium' | 'enterprise';
    estimatedCost: number;
    complexity: number;
  };
  context?: {
    requestId: string;
    sessionId?: string;
    conversationId?: string;
    clientInfo?: any;
  };
}

export interface QueueConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
  processing: {
    batchSize: number;
    maxConcurrent: number;
    processingInterval: number;
    retryAttempts: number;
    retryDelay: number;
    timeoutMs: number;
  };
  priorityWeights: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  throttling: {
    basicTier: { requestsPerMinute: number; burstLimit: number };
    premiumTier: { requestsPerMinute: number; burstLimit: number };
    enterpriseTier: { requestsPerMinute: number; burstLimit: number };
  };
}

export class RequestQueueService extends EventEmitter {
  private redis: Redis;
  private config: QueueConfig;
  private isProcessing = false;
  private processingInterval?: NodeJS.Timeout;
  private concurrentProcessing = 0;
  
  // Queue keys
  private readonly PENDING_QUEUE = 'ai:queue:pending';
  private readonly PROCESSING_QUEUE = 'ai:queue:processing';
  private readonly FAILED_QUEUE = 'ai:queue:failed';
  private readonly COMPLETED_QUEUE = 'ai:queue:completed';
  private readonly THROTTLE_PREFIX = 'ai:throttle:';
  private readonly METRICS_KEY = 'ai:queue:metrics';

  constructor(config: QueueConfig) {
    super();
    this.config = config;
    this.redis = new Redis(config.redis);
    this.setupRedisEventHandlers();
  }

  /**
   * Setup Redis event handlers
   */
  private setupRedisEventHandlers(): void {
    this.redis.on('connect', () => {
      logger.info('Request queue Redis connected');
      this.emit('redisConnected');
    });
    
    this.redis.on('error', (error) => {
      logger.error('Request queue Redis error', { error });
      this.emit('redisError', error);
    });
    
    this.redis.on('close', () => {
      logger.warn('Request queue Redis disconnected');
      this.emit('redisDisconnected');
    });
  }

  /**
   * Start request queue processing
   */
  async startProcessing(): Promise<void> {
    if (this.isProcessing) {
      logger.warn('Request queue processing is already running');
      return;
    }
    
    this.isProcessing = true;
    
    // Start periodic processing
    this.processingInterval = setInterval(
      () => this.processQueueBatch(),
      this.config.processing.processingInterval
    );
    
    // Start immediate processing
    await this.processQueueBatch();
    
    logger.info('Request queue processing started', {
      interval: this.config.processing.processingInterval,
      batchSize: this.config.processing.batchSize,
      maxConcurrent: this.config.processing.maxConcurrent
    });
    
    this.emit('processingStarted');
  }

  /**
   * Stop request queue processing
   */
  async stopProcessing(): Promise<void> {
    if (!this.isProcessing) {
      return;
    }
    
    this.isProcessing = false;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
    
    // Wait for current processing to complete
    while (this.concurrentProcessing > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    logger.info('Request queue processing stopped');
    this.emit('processingStopped');
  }

  /**
   * Add request to queue with priority and throttling
   */
  async enqueueRequest(request: Omit<QueuedRequest, 'id'>): Promise<string> {
    const requestId = uuidv4();
    
    // Check throttling limits
    const canProcess = await this.checkThrottling(request.userId, request.metadata.userTier);
    if (!canProcess) {
      throw new Error('Request rate limit exceeded');
    }
    
    const queuedRequest: QueuedRequest = {
      id: requestId,
      ...request,
      metadata: {
        ...request.metadata,
        createdAt: new Date(),
        attempts: 0
      }
    };
    
    // Calculate priority score for sorting
    const priorityScore = this.calculatePriorityScore(queuedRequest);
    
    // Add to pending queue with priority score
    await this.redis.zadd(
      this.PENDING_QUEUE,
      priorityScore,
      JSON.stringify(queuedRequest)
    );
    
    // Update metrics
    await this.updateMetrics('enqueued', queuedRequest.priority);
    
    logger.debug('Request enqueued', {
      requestId,
      userId: request.userId,
      providerId: request.providerId,
      priority: request.priority,
      priorityScore
    });
    
    this.emit('requestEnqueued', {
      requestId,
      priority: request.priority,
      userId: request.userId,
      queueSize: await this.getQueueSize()
    });
    
    return requestId;
  }

  /**
   * Check throttling limits for user
   */
  private async checkThrottling(userId: string, userTier: string): Promise<boolean> {
    const throttleKey = `${this.THROTTLE_PREFIX}${userId}`;
    const tierConfig = this.config.throttling[`${userTier}Tier` as keyof typeof this.config.throttling];
    
    if (!tierConfig) {
      logger.warn('Unknown user tier for throttling', { userId, userTier });
      return false;
    }
    
    // Use sliding window rate limiting
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window
    
    // Remove old entries
    await this.redis.zremrangebyscore(throttleKey, 0, windowStart);
    
    // Count current requests in window
    const currentCount = await this.redis.zcard(throttleKey);
    
    if (currentCount >= tierConfig.requestsPerMinute) {
      logger.warn('Rate limit exceeded', {
        userId,
        userTier,
        currentCount,
        limit: tierConfig.requestsPerMinute
      });
      
      this.emit('rateLimitExceeded', {
        userId,
        userTier,
        currentCount,
        limit: tierConfig.requestsPerMinute
      });
      
      return false;
    }
    
    // Add current request to sliding window
    await this.redis.zadd(throttleKey, now, `${now}-${Math.random()}`);
    await this.redis.expire(throttleKey, 60); // Expire after 1 minute
    
    return true;
  }

  /**
   * Calculate priority score for queue ordering
   */
  private calculatePriorityScore(request: QueuedRequest): number {
    const baseScore = this.config.priorityWeights[request.priority];
    const ageBonus = Math.floor((Date.now() - request.metadata.createdAt.getTime()) / 1000); // Age in seconds
    const tierMultiplier = request.metadata.userTier === 'enterprise' ? 1.2 : 
                          request.metadata.userTier === 'premium' ? 1.1 : 1.0;
    
    // Lower score = higher priority (Redis sorted set ordering)
    return -(baseScore * tierMultiplier + ageBonus);
  }

  /**
   * Process a batch of requests from the queue
   */
  private async processQueueBatch(): Promise<void> {
    if (this.concurrentProcessing >= this.config.processing.maxConcurrent) {
      return;
    }
    
    try {
      // Get batch of requests with highest priority
      const requests = await this.redis.zpopmin(
        this.PENDING_QUEUE,
        Math.min(
          this.config.processing.batchSize,
          this.config.processing.maxConcurrent - this.concurrentProcessing
        )
      );
      
      if (requests.length === 0) {
        return;
      }
      
      // Process each request concurrently
      const processingPromises = [];
      
      for (let i = 0; i < requests.length; i += 2) {
        const requestData = requests[i];
        try {
          const request: QueuedRequest = JSON.parse(requestData);
          processingPromises.push(this.processRequest(request));
        } catch (error) {
          logger.error('Failed to parse queued request', { error, requestData });
        }
      }
      
      await Promise.allSettled(processingPromises);
      
    } catch (error) {
      logger.error('Error processing queue batch', { error });
    }
  }

  /**
   * Process individual request
   */
  private async processRequest(request: QueuedRequest): Promise<void> {
    this.concurrentProcessing++;
    
    try {
      // Move to processing queue
      await this.redis.zadd(
        this.PROCESSING_QUEUE,
        Date.now(),
        JSON.stringify(request)
      );
      
      // Update attempt count
      request.metadata.attempts++;
      
      logger.debug('Processing request', {
        requestId: request.id,
        userId: request.userId,
        providerId: request.providerId,
        attempts: request.metadata.attempts
      });
      
      this.emit('requestProcessingStarted', {
        requestId: request.id,
        providerId: request.providerId,
        attempts: request.metadata.attempts
      });
      
      // Emit for actual processing by AI routing service
      const processingPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Request processing timeout'));
        }, request.metadata.timeout);
        
        this.emit('processRequest', {
          request,
          resolve: (result: any) => {
            clearTimeout(timeout);
            resolve();
          },
          reject: (error: Error) => {
            clearTimeout(timeout);
            reject(error);
          }
        });
      });
      
      await processingPromise;
      
      // Move to completed queue
      await this.moveToCompleted(request);
      
    } catch (error) {
      await this.handleProcessingError(request, error as Error);
    } finally {
      this.concurrentProcessing--;
    }
  }

  /**
   * Handle processing error with retry logic
   */
  private async handleProcessingError(request: QueuedRequest, error: Error): Promise<void> {
    logger.error('Request processing failed', {
      requestId: request.id,
      error: error.message,
      attempts: request.metadata.attempts,
      maxAttempts: request.metadata.maxAttempts
    });
    
    // Remove from processing queue
    await this.redis.zrem(this.PROCESSING_QUEUE, JSON.stringify(request));
    
    if (request.metadata.attempts < request.metadata.maxAttempts) {
      // Retry with exponential backoff
      const retryDelay = request.metadata.retryDelay * Math.pow(2, request.metadata.attempts - 1);
      const retryAt = Date.now() + retryDelay;
      
      request.metadata.scheduledAt = new Date(retryAt);
      
      // Re-queue for retry
      const priorityScore = this.calculatePriorityScore(request) + retryDelay;
      await this.redis.zadd(this.PENDING_QUEUE, priorityScore, JSON.stringify(request));
      
      logger.info('Request scheduled for retry', {
        requestId: request.id,
        retryAt: new Date(retryAt),
        attempts: request.metadata.attempts,
        retryDelay
      });
      
      this.emit('requestRetry', {
        requestId: request.id,
        attempts: request.metadata.attempts,
        retryAt: new Date(retryAt),
        error: error.message
      });
      
      await this.updateMetrics('retried');
      
    } else {
      // Move to failed queue
      await this.moveToFailed(request, error.message);
    }
  }

  /**
   * Move request to completed queue
   */
  private async moveToCompleted(request: QueuedRequest): Promise<void> {
    // Remove from processing queue
    await this.redis.zrem(this.PROCESSING_QUEUE, JSON.stringify(request));
    
    // Add to completed queue with TTL
    await this.redis.zadd(this.COMPLETED_QUEUE, Date.now(), JSON.stringify({
      ...request,
      completedAt: new Date()
    }));
    
    // Keep only recent completed requests (last 24 hours)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    await this.redis.zremrangebyscore(this.COMPLETED_QUEUE, 0, oneDayAgo);
    
    await this.updateMetrics('completed', request.priority);
    
    logger.info('Request completed successfully', {
      requestId: request.id,
      userId: request.userId,
      providerId: request.providerId,
      attempts: request.metadata.attempts
    });
    
    this.emit('requestCompleted', {
      requestId: request.id,
      userId: request.userId,
      providerId: request.providerId,
      attempts: request.metadata.attempts
    });
  }

  /**
   * Move request to failed queue
   */
  private async moveToFailed(request: QueuedRequest, errorMessage: string): Promise<void> {
    // Remove from processing queue
    await this.redis.zrem(this.PROCESSING_QUEUE, JSON.stringify(request));
    
    // Add to failed queue
    await this.redis.zadd(this.FAILED_QUEUE, Date.now(), JSON.stringify({
      ...request,
      failedAt: new Date(),
      errorMessage
    }));
    
    await this.updateMetrics('failed', request.priority);
    
    logger.error('Request permanently failed', {
      requestId: request.id,
      userId: request.userId,
      providerId: request.providerId,
      attempts: request.metadata.attempts,
      error: errorMessage
    });
    
    this.emit('requestFailed', {
      requestId: request.id,
      userId: request.userId,
      providerId: request.providerId,
      attempts: request.metadata.attempts,
      error: errorMessage
    });
  }

  /**
   * Update queue metrics
   */
  private async updateMetrics(action: string, priority?: string): Promise<void> {
    const timestamp = new Date().toISOString().split('T')[0]; // Daily metrics
    const metricsKey = `${this.METRICS_KEY}:${timestamp}`;
    
    await this.redis.hincrby(metricsKey, `${action}_total`, 1);
    
    if (priority) {
      await this.redis.hincrby(metricsKey, `${action}_${priority}`, 1);
    }
    
    // Set expiry for metrics (30 days)
    await this.redis.expire(metricsKey, 30 * 24 * 60 * 60);
  }

  /**
   * Get current queue size
   */
  async getQueueSize(): Promise<{
    pending: number;
    processing: number;
    failed: number;
    completed: number;
  }> {
    const [pending, processing, failed, completed] = await Promise.all([
      this.redis.zcard(this.PENDING_QUEUE),
      this.redis.zcard(this.PROCESSING_QUEUE),
      this.redis.zcard(this.FAILED_QUEUE),
      this.redis.zcard(this.COMPLETED_QUEUE)
    ]);
    
    return { pending, processing, failed, completed };
  }

  /**
   * Get queue metrics
   */
  async getQueueMetrics(days = 7): Promise<Record<string, any>> {
    const metrics: Record<string, any> = {};
    
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      const metricsKey = `${this.METRICS_KEY}:${dateKey}`;
      
      const dailyMetrics = await this.redis.hgetall(metricsKey);
      if (Object.keys(dailyMetrics).length > 0) {
        metrics[dateKey] = dailyMetrics;
      }
    }
    
    return metrics;
  }

  /**
   * Get request status
   */
  async getRequestStatus(requestId: string): Promise<{
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'not_found';
    request?: QueuedRequest;
    position?: number;
  }> {
    // Check in each queue
    const queues = [
      { name: 'pending', key: this.PENDING_QUEUE },
      { name: 'processing', key: this.PROCESSING_QUEUE },
      { name: 'completed', key: this.COMPLETED_QUEUE },
      { name: 'failed', key: this.FAILED_QUEUE }
    ];
    
    for (const queue of queues) {
      const requests = await this.redis.zrange(queue.key, 0, -1);
      
      for (let i = 0; i < requests.length; i++) {
        try {
          const request: QueuedRequest = JSON.parse(requests[i]);
          if (request.id === requestId) {
            return {
              status: queue.name as any,
              request,
              position: queue.name === 'pending' ? i + 1 : undefined
            };
          }
        } catch (error) {
          logger.error('Failed to parse request in queue', { error, queue: queue.name });
        }
      }
    }
    
    return { status: 'not_found' };
  }

  /**
   * Cancel a pending request
   */
  async cancelRequest(requestId: string): Promise<boolean> {
    const requests = await this.redis.zrange(this.PENDING_QUEUE, 0, -1);
    
    for (const requestData of requests) {
      try {
        const request: QueuedRequest = JSON.parse(requestData);
        if (request.id === requestId) {
          await this.redis.zrem(this.PENDING_QUEUE, requestData);
          
          logger.info('Request cancelled', { requestId });
          this.emit('requestCancelled', { requestId });
          
          return true;
        }
      } catch (error) {
        logger.error('Failed to parse request for cancellation', { error });
      }
    }
    
    return false;
  }

  /**
   * Clear all queues (for maintenance)
   */
  async clearAllQueues(): Promise<void> {
    await Promise.all([
      this.redis.del(this.PENDING_QUEUE),
      this.redis.del(this.PROCESSING_QUEUE),
      this.redis.del(this.FAILED_QUEUE),
      this.redis.del(this.COMPLETED_QUEUE)
    ]);
    
    logger.info('All queues cleared');
    this.emit('queuesCleared');
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.stopProcessing();
    await this.redis.quit();
  }
}

