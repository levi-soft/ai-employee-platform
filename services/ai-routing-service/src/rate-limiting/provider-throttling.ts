
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Redis } from 'ioredis';

export interface ProviderLimits {
  providerId: string;
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerHour: number;
  tokensPerDay: number;
  concurrentRequests: number;
  costPerRequest?: number;
  priorityMultiplier: number;
}

export interface ProviderThrottleResult {
  allowed: boolean;
  waitTime: number; // milliseconds to wait before next request
  reason?: string;
  nextAvailableSlot: Date;
  currentUsage: ProviderUsage;
  recommendedProvider?: string;
}

export interface ProviderUsage {
  providerId: string;
  requestsInWindow: number;
  tokensInWindow: number;
  concurrentRequests: number;
  costAccrued: number;
  lastRequestTime: Date;
  throttleLevel: 'none' | 'light' | 'moderate' | 'heavy';
}

export interface ThrottleStrategy {
  name: string;
  description: string;
  algorithm: 'token_bucket' | 'sliding_window' | 'fixed_window' | 'adaptive';
  parameters: Record<string, any>;
}

@Injectable()
export class ProviderThrottlingService {
  private readonly logger = new Logger(ProviderThrottlingService.name);
  private readonly redisClient: Redis;
  private readonly providerLimits: Map<string, ProviderLimits> = new Map();
  private readonly throttleStrategies: Map<string, ThrottleStrategy> = new Map();
  private readonly concurrentRequests: Map<string, number> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.redisClient = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      keyPrefix: 'provider_throttle:',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
    });

    this.initializeProviderLimits();
    this.initializeThrottleStrategies();
    this.startUsageMonitoring();
  }

  async checkProviderThrottle(
    providerId: string,
    requestTokens: number = 0,
    priority: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ): Promise<ProviderThrottleResult> {
    try {
      const limits = this.providerLimits.get(providerId);
      if (!limits) {
        return {
          allowed: true,
          waitTime: 0,
          nextAvailableSlot: new Date(),
          currentUsage: this.getDefaultUsage(providerId),
        };
      }

      // Get current usage
      const usage = await this.getProviderUsage(providerId);
      
      // Check concurrent requests limit
      const concurrentCheck = await this.checkConcurrentLimit(providerId, limits);
      if (!concurrentCheck.allowed) {
        return concurrentCheck;
      }

      // Check rate limits (requests and tokens)
      const rateLimitCheck = await this.checkRateLimits(
        providerId,
        limits,
        usage,
        requestTokens
      );
      if (!rateLimitCheck.allowed) {
        return rateLimitCheck;
      }

      // Apply priority-based throttling
      const priorityThrottle = await this.applyPriorityThrottling(
        providerId,
        limits,
        usage,
        priority
      );
      if (!priorityThrottle.allowed) {
        return priorityThrottle;
      }

      // Check adaptive throttling based on provider performance
      const adaptiveThrottle = await this.checkAdaptiveThrottling(
        providerId,
        usage
      );
      
      // If all checks pass, allow the request
      await this.recordRequestStart(providerId, requestTokens);
      
      return {
        allowed: true,
        waitTime: adaptiveThrottle.waitTime || 0,
        nextAvailableSlot: new Date(),
        currentUsage: usage,
      };
    } catch (error) {
      this.logger.error(`Provider throttle check failed for ${providerId}`, error);
      return {
        allowed: true, // Fail open
        waitTime: 0,
        nextAvailableSlot: new Date(),
        currentUsage: this.getDefaultUsage(providerId),
      };
    }
  }

  async recordRequestComplete(
    providerId: string,
    requestTokens: number,
    responseTime: number,
    success: boolean,
    cost?: number
  ): Promise<void> {
    try {
      // Decrement concurrent requests
      const currentConcurrent = this.concurrentRequests.get(providerId) || 0;
      this.concurrentRequests.set(providerId, Math.max(0, currentConcurrent - 1));

      // Update usage statistics
      const usageKey = `usage:${providerId}`;
      const windowKey = this.getWindowKey(providerId, 'minute');

      await Promise.all([
        // Update concurrent counter in Redis
        this.redisClient.decr(`concurrent:${providerId}`),
        
        // Record request completion
        this.redisClient.hincrby(usageKey, 'completed_requests', 1),
        this.redisClient.hincrby(usageKey, 'total_tokens', requestTokens),
        this.redisClient.hincrby(usageKey, success ? 'successful_requests' : 'failed_requests', 1),
        
        // Update response time metrics
        this.redisClient.lpush(`response_times:${providerId}`, responseTime),
        this.redisClient.ltrim(`response_times:${providerId}`, 0, 99), // Keep last 100 response times
        
        // Record cost if provided
        cost && this.redisClient.hincrbyfloat(usageKey, 'total_cost', cost),
        
        // Set expiry
        this.redisClient.expire(usageKey, 24 * 60 * 60), // 24 hours
        this.redisClient.expire(`response_times:${providerId}`, 24 * 60 * 60),
      ]);

      // Update adaptive throttling based on performance
      await this.updateAdaptiveThrottling(providerId, responseTime, success);

      this.logger.debug(
        `Request completed for ${providerId}: ${requestTokens} tokens, ` +
        `${responseTime}ms, ${success ? 'success' : 'failure'}`
      );
    } catch (error) {
      this.logger.error(`Failed to record request completion for ${providerId}`, error);
    }
  }

  async setProviderLimits(providerId: string, limits: ProviderLimits): Promise<void> {
    this.providerLimits.set(providerId, limits);
    await this.redisClient.setex(
      `limits:${providerId}`,
      30 * 24 * 60 * 60, // 30 days
      JSON.stringify(limits)
    );
    
    this.logger.log(`Updated limits for provider ${providerId}`);
    this.eventEmitter.emit('provider.limits_updated', { providerId, limits });
  }

  async getProviderStatus(providerId: string): Promise<{
    available: boolean;
    usage: ProviderUsage;
    limits: ProviderLimits;
    performance: {
      averageResponseTime: number;
      successRate: number;
      currentThrottleLevel: string;
    };
    nextAvailableSlot: Date;
  }> {
    try {
      const limits = this.providerLimits.get(providerId);
      const usage = await this.getProviderUsage(providerId);
      const performance = await this.getProviderPerformance(providerId);

      const throttleCheck = await this.checkProviderThrottle(providerId);
      
      return {
        available: throttleCheck.allowed,
        usage,
        limits: limits || this.getDefaultLimits(providerId),
        performance,
        nextAvailableSlot: throttleCheck.nextAvailableSlot,
      };
    } catch (error) {
      this.logger.error(`Failed to get provider status for ${providerId}`, error);
      return {
        available: true,
        usage: this.getDefaultUsage(providerId),
        limits: this.getDefaultLimits(providerId),
        performance: {
          averageResponseTime: 1000,
          successRate: 0.95,
          currentThrottleLevel: 'none',
        },
        nextAvailableSlot: new Date(),
      };
    }
  }

  async getAllProviderStatuses(): Promise<Record<string, any>> {
    const statuses: Record<string, any> = {};
    
    for (const providerId of this.providerLimits.keys()) {
      statuses[providerId] = await this.getProviderStatus(providerId);
    }
    
    return statuses;
  }

  async recommendOptimalProvider(
    requestTokens: number,
    priority: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ): Promise<{
    providerId: string;
    waitTime: number;
    estimatedCost: number;
    confidence: number;
  } | null> {
    try {
      const candidates: Array<{
        providerId: string;
        waitTime: number;
        estimatedCost: number;
        score: number;
      }> = [];

      for (const [providerId, limits] of this.providerLimits.entries()) {
        const throttleResult = await this.checkProviderThrottle(
          providerId,
          requestTokens,
          priority
        );

        if (throttleResult.allowed || throttleResult.waitTime < 30000) { // Accept up to 30s wait
          const performance = await this.getProviderPerformance(providerId);
          const estimatedCost = (limits.costPerRequest || 0) * (requestTokens / 1000);
          
          // Calculate score based on availability, cost, and performance
          const availabilityScore = throttleResult.allowed ? 1 : 0.5;
          const costScore = estimatedCost > 0 ? Math.max(0, 1 - (estimatedCost / 0.1)) : 0.8;
          const performanceScore = performance.successRate;
          const responseTimeScore = Math.max(0, 1 - (performance.averageResponseTime / 5000));
          
          const score = (availabilityScore * 0.4) + 
                       (costScore * 0.2) + 
                       (performanceScore * 0.25) + 
                       (responseTimeScore * 0.15);

          candidates.push({
            providerId,
            waitTime: throttleResult.waitTime,
            estimatedCost,
            score,
          });
        }
      }

      if (candidates.length === 0) {
        return null;
      }

      // Sort by score (highest first)
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];

      return {
        providerId: best.providerId,
        waitTime: best.waitTime,
        estimatedCost: best.estimatedCost,
        confidence: best.score,
      };
    } catch (error) {
      this.logger.error('Failed to recommend optimal provider', error);
      return null;
    }
  }

  private async checkConcurrentLimit(
    providerId: string,
    limits: ProviderLimits
  ): Promise<ProviderThrottleResult> {
    const currentConcurrent = await this.redisClient.get(`concurrent:${providerId}`) || '0';
    const concurrent = parseInt(currentConcurrent, 10);

    if (concurrent >= limits.concurrentRequests) {
      return {
        allowed: false,
        waitTime: 1000, // Wait 1 second
        reason: 'Concurrent request limit exceeded',
        nextAvailableSlot: new Date(Date.now() + 1000),
        currentUsage: await this.getProviderUsage(providerId),
      };
    }

    return { allowed: true, waitTime: 0, nextAvailableSlot: new Date(), currentUsage: await this.getProviderUsage(providerId) };
  }

  private async checkRateLimits(
    providerId: string,
    limits: ProviderLimits,
    usage: ProviderUsage,
    requestTokens: number
  ): Promise<ProviderThrottleResult> {
    const windows = [
      { period: 'minute', requestLimit: limits.requestsPerMinute, tokenLimit: limits.tokensPerMinute },
      { period: 'hour', requestLimit: limits.requestsPerHour, tokenLimit: limits.tokensPerHour },
      { period: 'day', requestLimit: limits.requestsPerDay, tokenLimit: limits.tokensPerDay },
    ];

    for (const window of windows) {
      const windowUsage = await this.getWindowUsage(providerId, window.period);
      
      // Check request limit
      if (windowUsage.requests >= window.requestLimit) {
        const resetTime = this.getWindowResetTime(window.period);
        return {
          allowed: false,
          waitTime: resetTime.getTime() - Date.now(),
          reason: `${window.period} request limit exceeded`,
          nextAvailableSlot: resetTime,
          currentUsage: usage,
        };
      }

      // Check token limit
      if (windowUsage.tokens + requestTokens > window.tokenLimit) {
        const resetTime = this.getWindowResetTime(window.period);
        return {
          allowed: false,
          waitTime: resetTime.getTime() - Date.now(),
          reason: `${window.period} token limit exceeded`,
          nextAvailableSlot: resetTime,
          currentUsage: usage,
        };
      }
    }

    return { allowed: true, waitTime: 0, nextAvailableSlot: new Date(), currentUsage: usage };
  }

  private async applyPriorityThrottling(
    providerId: string,
    limits: ProviderLimits,
    usage: ProviderUsage,
    priority: 'low' | 'medium' | 'high' | 'critical'
  ): Promise<ProviderThrottleResult> {
    const priorityMultipliers = {
      low: 0.5,
      medium: 1.0,
      high: 1.5,
      critical: 2.0,
    };

    const multiplier = priorityMultipliers[priority] * limits.priorityMultiplier;
    
    // For low priority requests, add additional throttling during high usage
    if (priority === 'low' && usage.throttleLevel !== 'none') {
      const waitTime = Math.random() * 5000; // Random wait up to 5 seconds
      return {
        allowed: false,
        waitTime,
        reason: 'Low priority throttling due to high usage',
        nextAvailableSlot: new Date(Date.now() + waitTime),
        currentUsage: usage,
      };
    }

    return { allowed: true, waitTime: 0, nextAvailableSlot: new Date(), currentUsage: usage };
  }

  private async checkAdaptiveThrottling(
    providerId: string,
    usage: ProviderUsage
  ): Promise<{ allowed: boolean; waitTime?: number; reason?: string }> {
    try {
      const performance = await this.getProviderPerformance(providerId);
      
      // Apply throttling based on success rate and response time
      if (performance.successRate < 0.8) {
        const waitTime = Math.random() * 3000; // Up to 3 seconds
        return {
          allowed: true, // Allow but with delay
          waitTime,
          reason: 'Adaptive throttling due to low success rate',
        };
      }

      if (performance.averageResponseTime > 10000) { // 10 seconds
        const waitTime = Math.random() * 2000; // Up to 2 seconds
        return {
          allowed: true, // Allow but with delay
          waitTime,
          reason: 'Adaptive throttling due to high response time',
        };
      }

      return { allowed: true };
    } catch (error) {
      this.logger.error('Adaptive throttling check failed', error);
      return { allowed: true };
    }
  }

  private async getProviderUsage(providerId: string): Promise<ProviderUsage> {
    try {
      const usageKey = `usage:${providerId}`;
      const usage = await this.redisClient.hmget(
        usageKey,
        'completed_requests',
        'total_tokens',
        'total_cost',
        'last_request_time'
      );

      const minuteUsage = await this.getWindowUsage(providerId, 'minute');
      const concurrent = await this.redisClient.get(`concurrent:${providerId}`) || '0';

      return {
        providerId,
        requestsInWindow: minuteUsage.requests,
        tokensInWindow: minuteUsage.tokens,
        concurrentRequests: parseInt(concurrent, 10),
        costAccrued: parseFloat(usage[2] || '0'),
        lastRequestTime: new Date(parseInt(usage[3] || '0', 10) || Date.now()),
        throttleLevel: this.calculateThrottleLevel(minuteUsage.requests, providerId),
      };
    } catch (error) {
      this.logger.error(`Failed to get provider usage for ${providerId}`, error);
      return this.getDefaultUsage(providerId);
    }
  }

  private async getWindowUsage(providerId: string, period: string): Promise<{
    requests: number;
    tokens: number;
  }> {
    const key = this.getWindowKey(providerId, period);
    const usage = await this.redisClient.hmget(key, 'requests', 'tokens');
    
    return {
      requests: parseInt(usage[0] || '0', 10),
      tokens: parseInt(usage[1] || '0', 10),
    };
  }

  private async recordRequestStart(
    providerId: string,
    requestTokens: number
  ): Promise<void> {
    const timestamp = Date.now();
    
    // Increment concurrent requests counter
    const currentConcurrent = this.concurrentRequests.get(providerId) || 0;
    this.concurrentRequests.set(providerId, currentConcurrent + 1);

    await Promise.all([
      // Update concurrent counter in Redis
      this.redisClient.incr(`concurrent:${providerId}`),
      
      // Update window counters
      this.updateWindowCounters(providerId, 1, requestTokens),
      
      // Record last request time
      this.redisClient.hset(`usage:${providerId}`, 'last_request_time', timestamp),
    ]);
  }

  private async updateWindowCounters(
    providerId: string,
    requestCount: number,
    tokenCount: number
  ): Promise<void> {
    const windows = ['minute', 'hour', 'day'];
    
    for (const period of windows) {
      const key = this.getWindowKey(providerId, period);
      const expiry = this.getWindowExpiry(period);
      
      await Promise.all([
        this.redisClient.hincrby(key, 'requests', requestCount),
        this.redisClient.hincrby(key, 'tokens', tokenCount),
        this.redisClient.expire(key, expiry),
      ]);
    }
  }

  private getWindowKey(providerId: string, period: string): string {
    const now = new Date();
    let windowStart: number;

    switch (period) {
      case 'minute':
        windowStart = Math.floor(now.getTime() / (60 * 1000)) * (60 * 1000);
        break;
      case 'hour':
        windowStart = Math.floor(now.getTime() / (60 * 60 * 1000)) * (60 * 60 * 1000);
        break;
      case 'day':
        windowStart = Math.floor(now.getTime() / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
        break;
      default:
        windowStart = Math.floor(now.getTime() / (60 * 1000)) * (60 * 1000);
    }

    return `window:${providerId}:${period}:${windowStart}`;
  }

  private getWindowExpiry(period: string): number {
    switch (period) {
      case 'minute': return 120; // 2 minutes
      case 'hour': return 7200; // 2 hours
      case 'day': return 172800; // 2 days
      default: return 120;
    }
  }

  private getWindowResetTime(period: string): Date {
    const now = new Date();
    
    switch (period) {
      case 'minute':
        return new Date((Math.floor(now.getTime() / (60 * 1000)) + 1) * (60 * 1000));
      case 'hour':
        return new Date((Math.floor(now.getTime() / (60 * 60 * 1000)) + 1) * (60 * 60 * 1000));
      case 'day':
        return new Date((Math.floor(now.getTime() / (24 * 60 * 60 * 1000)) + 1) * (24 * 60 * 60 * 1000));
      default:
        return new Date(now.getTime() + 60000);
    }
  }

  private async getProviderPerformance(providerId: string): Promise<{
    averageResponseTime: number;
    successRate: number;
    currentThrottleLevel: string;
  }> {
    try {
      const responseTimes = await this.redisClient.lrange(`response_times:${providerId}`, 0, -1);
      const usageData = await this.redisClient.hmget(
        `usage:${providerId}`,
        'successful_requests',
        'failed_requests'
      );

      const avgResponseTime = responseTimes.length > 0 
        ? responseTimes.reduce((sum, time) => sum + parseInt(time, 10), 0) / responseTimes.length
        : 1000;

      const successfulRequests = parseInt(usageData[0] || '0', 10);
      const failedRequests = parseInt(usageData[1] || '0', 10);
      const totalRequests = successfulRequests + failedRequests;
      const successRate = totalRequests > 0 ? successfulRequests / totalRequests : 0.95;

      const usage = await this.getProviderUsage(providerId);

      return {
        averageResponseTime: avgResponseTime,
        successRate,
        currentThrottleLevel: usage.throttleLevel,
      };
    } catch (error) {
      this.logger.error(`Failed to get performance for ${providerId}`, error);
      return {
        averageResponseTime: 1000,
        successRate: 0.95,
        currentThrottleLevel: 'none',
      };
    }
  }

  private async updateAdaptiveThrottling(
    providerId: string,
    responseTime: number,
    success: boolean
  ): Promise<void> {
    // This would implement adaptive throttling logic based on provider performance
    // For now, just log the performance data
    this.logger.debug(
      `Performance update for ${providerId}: ${responseTime}ms, ${success ? 'success' : 'failure'}`
    );
  }

  private calculateThrottleLevel(
    requestsInMinute: number,
    providerId: string
  ): 'none' | 'light' | 'moderate' | 'heavy' {
    const limits = this.providerLimits.get(providerId);
    if (!limits) return 'none';

    const utilization = requestsInMinute / limits.requestsPerMinute;
    
    if (utilization >= 0.9) return 'heavy';
    if (utilization >= 0.7) return 'moderate';
    if (utilization >= 0.5) return 'light';
    return 'none';
  }

  private initializeProviderLimits(): void {
    // OpenAI limits
    this.providerLimits.set('openai', {
      providerId: 'openai',
      requestsPerMinute: 3500,
      requestsPerHour: 210000,
      requestsPerDay: 5040000,
      tokensPerMinute: 90000,
      tokensPerHour: 5400000,
      tokensPerDay: 129600000,
      concurrentRequests: 100,
      costPerRequest: 0.002,
      priorityMultiplier: 1.0,
    });

    // Claude limits
    this.providerLimits.set('claude', {
      providerId: 'claude',
      requestsPerMinute: 1000,
      requestsPerHour: 60000,
      requestsPerDay: 1440000,
      tokensPerMinute: 40000,
      tokensPerHour: 2400000,
      tokensPerDay: 57600000,
      concurrentRequests: 50,
      costPerRequest: 0.008,
      priorityMultiplier: 1.2,
    });

    // Gemini limits
    this.providerLimits.set('gemini', {
      providerId: 'gemini',
      requestsPerMinute: 2000,
      requestsPerHour: 120000,
      requestsPerDay: 2880000,
      tokensPerMinute: 60000,
      tokensPerHour: 3600000,
      tokensPerDay: 86400000,
      concurrentRequests: 75,
      costPerRequest: 0.001,
      priorityMultiplier: 0.8,
    });

    this.logger.log('Initialized provider limits for OpenAI, Claude, and Gemini');
  }

  private initializeThrottleStrategies(): void {
    this.throttleStrategies.set('token_bucket', {
      name: 'token_bucket',
      description: 'Token bucket algorithm with refill rate',
      algorithm: 'token_bucket',
      parameters: {
        bucketSize: 100,
        refillRate: 10,
        refillInterval: 1000,
      },
    });

    this.throttleStrategies.set('sliding_window', {
      name: 'sliding_window',
      description: 'Sliding window rate limiting',
      algorithm: 'sliding_window',
      parameters: {
        windowSize: 60000,
        precision: 1000,
      },
    });

    this.logger.log('Initialized throttling strategies');
  }

  private getDefaultUsage(providerId: string): ProviderUsage {
    return {
      providerId,
      requestsInWindow: 0,
      tokensInWindow: 0,
      concurrentRequests: 0,
      costAccrued: 0,
      lastRequestTime: new Date(),
      throttleLevel: 'none',
    };
  }

  private getDefaultLimits(providerId: string): ProviderLimits {
    return {
      providerId,
      requestsPerMinute: 1000,
      requestsPerHour: 60000,
      requestsPerDay: 1440000,
      tokensPerMinute: 50000,
      tokensPerHour: 3000000,
      tokensPerDay: 72000000,
      concurrentRequests: 50,
      costPerRequest: 0.001,
      priorityMultiplier: 1.0,
    };
  }

  private startUsageMonitoring(): void {
    // Monitor usage every minute
    setInterval(async () => {
      try {
        for (const providerId of this.providerLimits.keys()) {
          const usage = await this.getProviderUsage(providerId);
          
          if (usage.throttleLevel === 'heavy') {
            this.eventEmitter.emit('provider.heavy_throttling', {
              providerId,
              usage,
            });
          }
        }
      } catch (error) {
        this.logger.error('Usage monitoring failed', error);
      }
    }, 60000);
  }
}
