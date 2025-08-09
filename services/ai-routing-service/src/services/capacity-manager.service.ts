
import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { logger } from '@ai-platform/shared-utils';

export interface ProviderCapacity {
  providerId: string;
  maxConcurrentRequests: number;
  currentActiveRequests: number;
  reservedCapacity: number;
  availableCapacity: number;
  requestsPerMinute: number;
  currentMinuteRequests: number;
  queueLength: number;
  averageProcessingTime: number;
  healthScore: number;
  lastUpdated: Date;
}

export interface CapacityConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
  monitoring: {
    updateInterval: number; // milliseconds
    capacityWindow: number; // seconds
    healthCheckInterval: number; // seconds
  };
  thresholds: {
    warningUtilization: number; // 0.0 to 1.0
    criticalUtilization: number; // 0.0 to 1.0
    overloadProtection: number; // 0.0 to 1.0
    queueLengthLimit: number;
  };
  defaultCapacities: Record<string, {
    maxConcurrentRequests: number;
    requestsPerMinute: number;
    averageProcessingTime: number;
  }>;
}

export class CapacityManagerService extends EventEmitter {
  private redis: Redis;
  private config: CapacityConfig;
  private capacityData: Map<string, ProviderCapacity> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private isMonitoring = false;

  private readonly CAPACITY_KEY_PREFIX = 'ai:capacity:';
  private readonly USAGE_KEY_PREFIX = 'ai:usage:';
  private readonly QUEUE_KEY_PREFIX = 'ai:queue:';
  private readonly METRICS_KEY = 'ai:capacity:metrics';

  constructor(config: CapacityConfig) {
    super();
    this.config = config;
    this.redis = new Redis(config.redis);
    this.initializeProviderCapacities();
  }

  /**
   * Initialize default capacities for all providers
   */
  private initializeProviderCapacities(): void {
    const defaultCapacities = {
      'openai-gpt-4': {
        maxConcurrentRequests: 100,
        requestsPerMinute: 3500,
        averageProcessingTime: 3000
      },
      'openai-gpt-3.5': {
        maxConcurrentRequests: 200,
        requestsPerMinute: 10000,
        averageProcessingTime: 1500
      },
      'claude-3-sonnet': {
        maxConcurrentRequests: 50,
        requestsPerMinute: 1000,
        averageProcessingTime: 4000
      },
      'claude-3-haiku': {
        maxConcurrentRequests: 100,
        requestsPerMinute: 2500,
        averageProcessingTime: 2000
      },
      'gemini-pro': {
        maxConcurrentRequests: 75,
        requestsPerMinute: 2000,
        averageProcessingTime: 2500
      },
      'ollama-mistral': {
        maxConcurrentRequests: 20,
        requestsPerMinute: 300,
        averageProcessingTime: 5000
      }
    };

    Object.entries(defaultCapacities).forEach(([providerId, capacity]) => {
      this.capacityData.set(providerId, {
        providerId,
        maxConcurrentRequests: capacity.maxConcurrentRequests,
        currentActiveRequests: 0,
        reservedCapacity: 0,
        availableCapacity: capacity.maxConcurrentRequests,
        requestsPerMinute: capacity.requestsPerMinute,
        currentMinuteRequests: 0,
        queueLength: 0,
        averageProcessingTime: capacity.averageProcessingTime,
        healthScore: 1.0,
        lastUpdated: new Date()
      });
    });

    logger.info('Provider capacities initialized', {
      providers: Object.keys(defaultCapacities)
    });
  }

  /**
   * Start capacity monitoring
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      logger.warn('Capacity monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    
    // Start periodic capacity updates
    this.monitoringInterval = setInterval(
      () => this.updateAllCapacities(),
      this.config.monitoring.updateInterval
    );

    // Initial capacity update
    await this.updateAllCapacities();
    
    logger.info('Capacity monitoring started', {
      updateInterval: this.config.monitoring.updateInterval,
      providers: Array.from(this.capacityData.keys())
    });
    
    this.emit('monitoringStarted');
  }

  /**
   * Stop capacity monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    
    logger.info('Capacity monitoring stopped');
    this.emit('monitoringStopped');
  }

  /**
   * Check if provider has available capacity
   */
  async hasAvailableCapacity(providerId: string, requestTokens?: number): Promise<boolean> {
    const capacity = await this.getProviderCapacity(providerId);
    
    if (!capacity) {
      logger.warn('Provider capacity not found', { providerId });
      return false;
    }

    // Check concurrent request limit
    if (capacity.currentActiveRequests >= capacity.maxConcurrentRequests) {
      logger.debug('Provider at concurrent request limit', {
        providerId,
        current: capacity.currentActiveRequests,
        max: capacity.maxConcurrentRequests
      });
      return false;
    }

    // Check rate limits
    if (capacity.currentMinuteRequests >= capacity.requestsPerMinute) {
      logger.debug('Provider at rate limit', {
        providerId,
        current: capacity.currentMinuteRequests,
        max: capacity.requestsPerMinute
      });
      return false;
    }

    // Check queue length
    if (capacity.queueLength >= this.config.thresholds.queueLengthLimit) {
      logger.debug('Provider queue length limit reached', {
        providerId,
        queueLength: capacity.queueLength,
        limit: this.config.thresholds.queueLengthLimit
      });
      return false;
    }

    // Check health score
    if (capacity.healthScore < 0.5) {
      logger.debug('Provider health score too low', {
        providerId,
        healthScore: capacity.healthScore
      });
      return false;
    }

    // Check utilization thresholds
    const utilization = capacity.currentActiveRequests / capacity.maxConcurrentRequests;
    if (utilization > this.config.thresholds.overloadProtection) {
      logger.debug('Provider utilization exceeds overload protection threshold', {
        providerId,
        utilization,
        threshold: this.config.thresholds.overloadProtection
      });
      return false;
    }

    return true;
  }

  /**
   * Reserve capacity for a request
   */
  async reserveCapacity(providerId: string, priority: 'low' | 'medium' | 'high' | 'critical' = 'medium'): Promise<boolean> {
    const hasCapacity = await this.hasAvailableCapacity(providerId);
    
    if (!hasCapacity) {
      return false;
    }

    const capacity = this.capacityData.get(providerId);
    if (!capacity) {
      return false;
    }

    // Reserve capacity
    capacity.currentActiveRequests++;
    capacity.availableCapacity--;
    capacity.lastUpdated = new Date();

    // Update in Redis
    await this.updateCapacityInRedis(providerId, capacity);
    
    // Emit capacity change event
    this.emit('capacityReserved', {
      providerId,
      priority,
      remaining: capacity.availableCapacity,
      utilization: capacity.currentActiveRequests / capacity.maxConcurrentRequests
    });

    logger.debug('Capacity reserved', {
      providerId,
      activeRequests: capacity.currentActiveRequests,
      availableCapacity: capacity.availableCapacity
    });

    return true;
  }

  /**
   * Release capacity after request completion
   */
  async releaseCapacity(providerId: string, processingTime?: number): Promise<void> {
    const capacity = this.capacityData.get(providerId);
    if (!capacity) {
      logger.warn('Cannot release capacity for unknown provider', { providerId });
      return;
    }

    // Release capacity
    capacity.currentActiveRequests = Math.max(0, capacity.currentActiveRequests - 1);
    capacity.availableCapacity = capacity.maxConcurrentRequests - capacity.currentActiveRequests - capacity.reservedCapacity;
    capacity.lastUpdated = new Date();

    // Update average processing time if provided
    if (processingTime !== undefined) {
      capacity.averageProcessingTime = 
        (capacity.averageProcessingTime * 0.9) + (processingTime * 0.1);
    }

    // Update in Redis
    await this.updateCapacityInRedis(providerId, capacity);
    
    // Emit capacity change event
    this.emit('capacityReleased', {
      providerId,
      remaining: capacity.availableCapacity,
      utilization: capacity.currentActiveRequests / capacity.maxConcurrentRequests,
      processingTime
    });

    logger.debug('Capacity released', {
      providerId,
      activeRequests: capacity.currentActiveRequests,
      availableCapacity: capacity.availableCapacity
    });
  }

  /**
   * Record provider usage for rate limiting
   */
  async recordProviderUsage(providerId: string): Promise<void> {
    const now = Date.now();
    const minuteKey = Math.floor(now / 60000);
    const usageKey = `${this.USAGE_KEY_PREFIX}${providerId}:${minuteKey}`;
    
    // Increment usage count for current minute
    const currentCount = await this.redis.incr(usageKey);
    
    // Set expiry for cleanup (2 minutes)
    await this.redis.expire(usageKey, 120);
    
    // Update capacity data
    const capacity = this.capacityData.get(providerId);
    if (capacity) {
      capacity.currentMinuteRequests = currentCount;
      capacity.lastUpdated = new Date();
    }
    
    // Check if approaching rate limit
    if (capacity && currentCount >= capacity.requestsPerMinute * 0.9) {
      this.emit('rateLimitWarning', {
        providerId,
        currentRequests: currentCount,
        limit: capacity.requestsPerMinute
      });
      
      logger.warn('Provider approaching rate limit', {
        providerId,
        currentRequests: currentCount,
        limit: capacity.requestsPerMinute
      });
    }
  }

  /**
   * Update capacity information in Redis
   */
  private async updateCapacityInRedis(providerId: string, capacity: ProviderCapacity): Promise<void> {
    const capacityKey = `${this.CAPACITY_KEY_PREFIX}${providerId}`;
    
    await this.redis.hset(capacityKey, {
      maxConcurrentRequests: capacity.maxConcurrentRequests,
      currentActiveRequests: capacity.currentActiveRequests,
      reservedCapacity: capacity.reservedCapacity,
      availableCapacity: capacity.availableCapacity,
      requestsPerMinute: capacity.requestsPerMinute,
      currentMinuteRequests: capacity.currentMinuteRequests,
      queueLength: capacity.queueLength,
      averageProcessingTime: capacity.averageProcessingTime,
      healthScore: capacity.healthScore,
      lastUpdated: capacity.lastUpdated.toISOString()
    });
    
    // Set expiry (5 minutes)
    await this.redis.expire(capacityKey, 300);
  }

  /**
   * Update all provider capacities
   */
  private async updateAllCapacities(): Promise<void> {
    const updatePromises = Array.from(this.capacityData.keys()).map(async (providerId) => {
      try {
        await this.updateProviderCapacity(providerId);
      } catch (error) {
        logger.error('Error updating provider capacity', { providerId, error });
      }
    });

    await Promise.allSettled(updatePromises);
  }

  /**
   * Update capacity for a specific provider
   */
  private async updateProviderCapacity(providerId: string): Promise<void> {
    const capacity = this.capacityData.get(providerId);
    if (!capacity) {
      return;
    }

    // Update current minute requests
    const now = Date.now();
    const minuteKey = Math.floor(now / 60000);
    const usageKey = `${this.USAGE_KEY_PREFIX}${providerId}:${minuteKey}`;
    const currentMinuteRequests = await this.redis.get(usageKey);
    capacity.currentMinuteRequests = parseInt(currentMinuteRequests || '0');

    // Update queue length (from request queue service)
    const queueKey = `${this.QUEUE_KEY_PREFIX}pending`;
    const queueLength = await this.redis.zcard(queueKey);
    capacity.queueLength = queueLength;

    // Calculate health score based on multiple factors
    capacity.healthScore = this.calculateHealthScore(capacity);

    // Check and emit threshold warnings
    await this.checkThresholds(capacity);

    // Update in memory and Redis
    this.capacityData.set(providerId, capacity);
    await this.updateCapacityInRedis(providerId, capacity);
  }

  /**
   * Calculate health score for a provider
   */
  private calculateHealthScore(capacity: ProviderCapacity): number {
    let score = 1.0;

    // Utilization factor (0-1, where 1 is best)
    const utilization = capacity.currentActiveRequests / capacity.maxConcurrentRequests;
    const utilizationScore = Math.max(0, 1 - utilization);

    // Rate limit factor
    const rateUtilization = capacity.currentMinuteRequests / capacity.requestsPerMinute;
    const rateScore = Math.max(0, 1 - rateUtilization);

    // Queue length factor
    const queueScore = Math.max(0, 1 - (capacity.queueLength / this.config.thresholds.queueLengthLimit));

    // Weighted average
    score = (utilizationScore * 0.4) + (rateScore * 0.3) + (queueScore * 0.3);

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Check threshold alerts
   */
  private async checkThresholds(capacity: ProviderCapacity): Promise<void> {
    const utilization = capacity.currentActiveRequests / capacity.maxConcurrentRequests;

    // Critical utilization threshold
    if (utilization >= this.config.thresholds.criticalUtilization) {
      this.emit('criticalUtilization', {
        providerId: capacity.providerId,
        utilization,
        activeRequests: capacity.currentActiveRequests,
        maxRequests: capacity.maxConcurrentRequests
      });

      logger.error('Provider at critical utilization', {
        providerId: capacity.providerId,
        utilization,
        threshold: this.config.thresholds.criticalUtilization
      });
    }
    // Warning utilization threshold
    else if (utilization >= this.config.thresholds.warningUtilization) {
      this.emit('warningUtilization', {
        providerId: capacity.providerId,
        utilization,
        activeRequests: capacity.currentActiveRequests,
        maxRequests: capacity.maxConcurrentRequests
      });

      logger.warn('Provider at warning utilization', {
        providerId: capacity.providerId,
        utilization,
        threshold: this.config.thresholds.warningUtilization
      });
    }
  }

  /**
   * Get provider capacity information
   */
  async getProviderCapacity(providerId: string): Promise<ProviderCapacity | null> {
    let capacity = this.capacityData.get(providerId);
    
    if (!capacity) {
      // Try to load from Redis
      const capacityKey = `${this.CAPACITY_KEY_PREFIX}${providerId}`;
      const capacityData = await this.redis.hgetall(capacityKey);
      
      if (Object.keys(capacityData).length > 0) {
        capacity = {
          providerId,
          maxConcurrentRequests: parseInt(capacityData.maxConcurrentRequests),
          currentActiveRequests: parseInt(capacityData.currentActiveRequests),
          reservedCapacity: parseInt(capacityData.reservedCapacity),
          availableCapacity: parseInt(capacityData.availableCapacity),
          requestsPerMinute: parseInt(capacityData.requestsPerMinute),
          currentMinuteRequests: parseInt(capacityData.currentMinuteRequests),
          queueLength: parseInt(capacityData.queueLength),
          averageProcessingTime: parseInt(capacityData.averageProcessingTime),
          healthScore: parseFloat(capacityData.healthScore),
          lastUpdated: new Date(capacityData.lastUpdated)
        };
        
        this.capacityData.set(providerId, capacity);
      }
    }
    
    return capacity || null;
  }

  /**
   * Get capacity information for all providers
   */
  async getAllProviderCapacities(): Promise<Record<string, ProviderCapacity>> {
    const capacities: Record<string, ProviderCapacity> = {};
    
    for (const providerId of this.capacityData.keys()) {
      const capacity = await this.getProviderCapacity(providerId);
      if (capacity) {
        capacities[providerId] = capacity;
      }
    }
    
    return capacities;
  }

  /**
   * Update provider capacity limits
   */
  async updateProviderLimits(
    providerId: string, 
    limits: {
      maxConcurrentRequests?: number;
      requestsPerMinute?: number;
    }
  ): Promise<boolean> {
    const capacity = await this.getProviderCapacity(providerId);
    
    if (!capacity) {
      logger.warn('Cannot update limits for unknown provider', { providerId });
      return false;
    }

    if (limits.maxConcurrentRequests !== undefined) {
      capacity.maxConcurrentRequests = limits.maxConcurrentRequests;
      capacity.availableCapacity = limits.maxConcurrentRequests - capacity.currentActiveRequests - capacity.reservedCapacity;
    }

    if (limits.requestsPerMinute !== undefined) {
      capacity.requestsPerMinute = limits.requestsPerMinute;
    }

    capacity.lastUpdated = new Date();
    
    this.capacityData.set(providerId, capacity);
    await this.updateCapacityInRedis(providerId, capacity);
    
    logger.info('Provider capacity limits updated', { providerId, limits });
    this.emit('capacityLimitsUpdated', { providerId, limits });
    
    return true;
  }

  /**
   * Get capacity utilization statistics
   */
  async getCapacityStatistics(): Promise<{
    totalProviders: number;
    healthyProviders: number;
    overloadedProviders: number;
    totalCapacity: number;
    usedCapacity: number;
    utilizationPercentage: number;
  }> {
    const capacities = await this.getAllProviderCapacities();
    const providers = Object.values(capacities);
    
    const totalProviders = providers.length;
    const healthyProviders = providers.filter(p => p.healthScore > 0.7).length;
    const overloadedProviders = providers.filter(p => 
      p.currentActiveRequests / p.maxConcurrentRequests > this.config.thresholds.criticalUtilization
    ).length;
    
    const totalCapacity = providers.reduce((sum, p) => sum + p.maxConcurrentRequests, 0);
    const usedCapacity = providers.reduce((sum, p) => sum + p.currentActiveRequests, 0);
    const utilizationPercentage = totalCapacity > 0 ? (usedCapacity / totalCapacity) * 100 : 0;
    
    return {
      totalProviders,
      healthyProviders,
      overloadedProviders,
      totalCapacity,
      usedCapacity,
      utilizationPercentage
    };
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    this.stopMonitoring();
    await this.redis.quit();
  }
}

