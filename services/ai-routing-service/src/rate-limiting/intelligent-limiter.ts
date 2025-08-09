
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Redis } from 'ioredis';

export interface RateLimitConfig {
  identifier: string; // user_id, ip, or custom identifier
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (identifier: string) => string;
  onLimitReached?: (identifier: string) => void;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  retryAfter?: number;
  currentCount: number;
  windowStart: Date;
}

export interface RateLimitRule {
  name: string;
  pattern: string; // Regex pattern or exact match
  config: RateLimitConfig;
  priority: number; // Higher number = higher priority
  enabled: boolean;
  conditions?: Array<{
    field: string;
    operator: 'equals' | 'contains' | 'startsWith' | 'greaterThan' | 'lessThan';
    value: any;
  }>;
}

export interface AdaptiveRateLimits {
  normal: RateLimitConfig;
  degraded: RateLimitConfig;
  emergency: RateLimitConfig;
}

@Injectable()
export class IntelligentLimiterService {
  private readonly logger = new Logger(IntelligentLimiterService.name);
  private readonly redisClient: Redis;
  private readonly rules: Map<string, RateLimitRule> = new Map();
  private readonly adaptiveLimits: Map<string, AdaptiveRateLimits> = new Map();
  private systemLoadThresholds: { degraded: number; emergency: number };

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.redisClient = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      keyPrefix: 'rate_limit:',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
    });

    this.systemLoadThresholds = {
      degraded: this.configService.get('SYSTEM_LOAD_DEGRADED_THRESHOLD', 0.7),
      emergency: this.configService.get('SYSTEM_LOAD_EMERGENCY_THRESHOLD', 0.9),
    };

    this.initializeDefaultRules();
    this.startSystemMonitoring();
  }

  async checkRateLimit(
    identifier: string,
    endpoint: string,
    metadata?: Record<string, any>
  ): Promise<RateLimitResult> {
    try {
      // Find applicable rule
      const rule = this.findApplicableRule(endpoint, metadata);
      if (!rule || !rule.enabled) {
        return this.createAllowedResult(identifier);
      }

      // Get appropriate rate limit config based on system load
      const config = await this.getAdaptiveConfig(rule, identifier);
      const key = this.generateKey(identifier, endpoint, config);

      // Perform rate limit check
      const result = await this.performRateLimitCheck(key, config);
      
      // Log rate limit events
      if (!result.allowed) {
        this.logger.warn(
          `Rate limit exceeded for ${identifier} on ${endpoint}. ` +
          `Count: ${result.currentCount}, Limit: ${config.maxRequests}`
        );

        this.eventEmitter.emit('rate_limit.exceeded', {
          identifier,
          endpoint,
          rule: rule.name,
          currentCount: result.currentCount,
          limit: config.maxRequests,
          resetTime: result.resetTime,
        });
      }

      // Track usage analytics
      await this.trackUsage(identifier, endpoint, rule.name, result);

      return result;
    } catch (error) {
      this.logger.error(`Rate limit check failed for ${identifier}`, error);
      // On error, allow the request (fail open)
      return this.createAllowedResult(identifier);
    }
  }

  async createRule(rule: RateLimitRule): Promise<boolean> {
    try {
      this.rules.set(rule.name, rule);
      await this.persistRule(rule);
      
      this.logger.log(`Created rate limit rule: ${rule.name}`);
      this.eventEmitter.emit('rate_limit.rule_created', { rule });
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to create rule ${rule.name}`, error);
      return false;
    }
  }

  async updateRule(ruleName: string, updates: Partial<RateLimitRule>): Promise<boolean> {
    try {
      const existingRule = this.rules.get(ruleName);
      if (!existingRule) {
        return false;
      }

      const updatedRule = { ...existingRule, ...updates };
      this.rules.set(ruleName, updatedRule);
      await this.persistRule(updatedRule);
      
      this.logger.log(`Updated rate limit rule: ${ruleName}`);
      this.eventEmitter.emit('rate_limit.rule_updated', { 
        ruleName, 
        oldRule: existingRule, 
        newRule: updatedRule 
      });
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to update rule ${ruleName}`, error);
      return false;
    }
  }

  async deleteRule(ruleName: string): Promise<boolean> {
    try {
      const deleted = this.rules.delete(ruleName);
      if (deleted) {
        await this.removePersistedRule(ruleName);
        this.logger.log(`Deleted rate limit rule: ${ruleName}`);
        this.eventEmitter.emit('rate_limit.rule_deleted', { ruleName });
      }
      
      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete rule ${ruleName}`, error);
      return false;
    }
  }

  async setAdaptiveLimits(identifier: string, limits: AdaptiveRateLimits): Promise<void> {
    this.adaptiveLimits.set(identifier, limits);
    await this.redisClient.setex(
      `adaptive:${identifier}`,
      24 * 60 * 60, // 24 hours
      JSON.stringify(limits)
    );
  }

  async getCurrentUsage(identifier: string, endpoint?: string): Promise<{
    currentCount: number;
    limit: number;
    resetTime: Date;
    utilizationPercentage: number;
  }> {
    try {
      const rule = endpoint ? this.findApplicableRule(endpoint) : this.getDefaultRule();
      if (!rule) {
        return {
          currentCount: 0,
          limit: 0,
          resetTime: new Date(),
          utilizationPercentage: 0,
        };
      }

      const config = await this.getAdaptiveConfig(rule, identifier);
      const key = this.generateKey(identifier, endpoint || 'default', config);
      const result = await this.performRateLimitCheck(key, config);

      return {
        currentCount: result.currentCount,
        limit: config.maxRequests,
        resetTime: result.resetTime,
        utilizationPercentage: (result.currentCount / config.maxRequests) * 100,
      };
    } catch (error) {
      this.logger.error(`Failed to get current usage for ${identifier}`, error);
      return {
        currentCount: 0,
        limit: 0,
        resetTime: new Date(),
        utilizationPercentage: 0,
      };
    }
  }

  async resetUserLimits(identifier: string): Promise<boolean> {
    try {
      const keys = await this.redisClient.keys(`*${identifier}*`);
      
      if (keys.length > 0) {
        await this.redisClient.del(...keys);
        this.logger.log(`Reset rate limits for ${identifier}`);
        this.eventEmitter.emit('rate_limit.reset', { identifier });
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.error(`Failed to reset limits for ${identifier}`, error);
      return false;
    }
  }

  async getGlobalStatistics(): Promise<{
    totalRequests: number;
    blockedRequests: number;
    blockRate: number;
    activeRules: number;
    topBlockedEndpoints: Array<{ endpoint: string; count: number }>;
    topBlockedUsers: Array<{ identifier: string; count: number }>;
  }> {
    try {
      // This would aggregate statistics from Redis
      // For now, returning placeholder data
      return {
        totalRequests: 0,
        blockedRequests: 0,
        blockRate: 0,
        activeRules: this.rules.size,
        topBlockedEndpoints: [],
        topBlockedUsers: [],
      };
    } catch (error) {
      this.logger.error('Failed to get global statistics', error);
      return {
        totalRequests: 0,
        blockedRequests: 0,
        blockRate: 0,
        activeRules: 0,
        topBlockedEndpoints: [],
        topBlockedUsers: [],
      };
    }
  }

  private findApplicableRule(
    endpoint: string,
    metadata?: Record<string, any>
  ): RateLimitRule | null {
    const applicableRules: RateLimitRule[] = [];

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      // Check pattern match
      const patternMatch = this.matchPattern(endpoint, rule.pattern);
      if (!patternMatch) continue;

      // Check conditions if any
      if (rule.conditions && !this.checkConditions(rule.conditions, metadata)) {
        continue;
      }

      applicableRules.push(rule);
    }

    // Return highest priority rule
    if (applicableRules.length === 0) return null;
    
    return applicableRules.reduce((prev, current) => 
      current.priority > prev.priority ? current : prev
    );
  }

  private matchPattern(endpoint: string, pattern: string): boolean {
    try {
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        // Regex pattern
        const regex = new RegExp(pattern.slice(1, -1));
        return regex.test(endpoint);
      } else {
        // Exact match or wildcard
        return endpoint === pattern || 
               pattern === '*' || 
               endpoint.startsWith(pattern.replace('*', ''));
      }
    } catch (error) {
      this.logger.error(`Invalid pattern: ${pattern}`, error);
      return false;
    }
  }

  private checkConditions(
    conditions: Array<{
      field: string;
      operator: string;
      value: any;
    }>,
    metadata?: Record<string, any>
  ): boolean {
    if (!metadata) return false;

    return conditions.every(condition => {
      const fieldValue = metadata[condition.field];
      
      switch (condition.operator) {
        case 'equals':
          return fieldValue === condition.value;
        case 'contains':
          return String(fieldValue).includes(String(condition.value));
        case 'startsWith':
          return String(fieldValue).startsWith(String(condition.value));
        case 'greaterThan':
          return Number(fieldValue) > Number(condition.value);
        case 'lessThan':
          return Number(fieldValue) < Number(condition.value);
        default:
          return false;
      }
    });
  }

  private async getAdaptiveConfig(
    rule: RateLimitRule,
    identifier: string
  ): Promise<RateLimitConfig> {
    try {
      const adaptiveLimits = await this.getAdaptiveLimits(identifier);
      if (!adaptiveLimits) {
        return rule.config;
      }

      const systemLoad = await this.getSystemLoad();
      
      if (systemLoad >= this.systemLoadThresholds.emergency) {
        return adaptiveLimits.emergency;
      } else if (systemLoad >= this.systemLoadThresholds.degraded) {
        return adaptiveLimits.degraded;
      } else {
        return adaptiveLimits.normal;
      }
    } catch (error) {
      this.logger.error('Failed to get adaptive config', error);
      return rule.config;
    }
  }

  private async getAdaptiveLimits(identifier: string): Promise<AdaptiveRateLimits | null> {
    try {
      const cached = this.adaptiveLimits.get(identifier);
      if (cached) return cached;

      const stored = await this.redisClient.get(`adaptive:${identifier}`);
      if (stored) {
        const limits = JSON.parse(stored) as AdaptiveRateLimits;
        this.adaptiveLimits.set(identifier, limits);
        return limits;
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to get adaptive limits for ${identifier}`, error);
      return null;
    }
  }

  private generateKey(identifier: string, endpoint: string, config: RateLimitConfig): string {
    if (config.keyGenerator) {
      return config.keyGenerator(identifier);
    }
    
    const window = Math.floor(Date.now() / config.windowMs);
    return `${identifier}:${endpoint}:${window}`;
  }

  private async performRateLimitCheck(
    key: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const windowStart = new Date(Math.floor(Date.now() / config.windowMs) * config.windowMs);
    const resetTime = new Date(windowStart.getTime() + config.windowMs);

    try {
      // Use Redis INCR for atomic increment
      const currentCount = await this.redisClient.incr(key);
      
      // Set expiry on first increment
      if (currentCount === 1) {
        await this.redisClient.pexpire(key, config.windowMs);
      }

      const allowed = currentCount <= config.maxRequests;
      const remaining = Math.max(0, config.maxRequests - currentCount);
      
      return {
        allowed,
        remaining,
        resetTime,
        retryAfter: allowed ? undefined : resetTime.getTime() - Date.now(),
        currentCount,
        windowStart,
      };
    } catch (error) {
      this.logger.error(`Rate limit check failed for key ${key}`, error);
      return this.createAllowedResult(key);
    }
  }

  private createAllowedResult(identifier: string): RateLimitResult {
    return {
      allowed: true,
      remaining: 1000,
      resetTime: new Date(Date.now() + 60000), // 1 minute from now
      currentCount: 0,
      windowStart: new Date(),
    };
  }

  private async trackUsage(
    identifier: string,
    endpoint: string,
    ruleName: string,
    result: RateLimitResult
  ): Promise<void> {
    try {
      const usageKey = `usage:${identifier}:${endpoint}:${new Date().toDateString()}`;
      const globalKey = `global_usage:${new Date().toDateString()}`;
      
      await Promise.all([
        this.redisClient.hincrby(usageKey, 'total', 1),
        this.redisClient.hincrby(usageKey, result.allowed ? 'allowed' : 'blocked', 1),
        this.redisClient.hincrby(globalKey, 'total', 1),
        this.redisClient.hincrby(globalKey, result.allowed ? 'allowed' : 'blocked', 1),
        this.redisClient.expire(usageKey, 7 * 24 * 60 * 60), // 7 days
        this.redisClient.expire(globalKey, 7 * 24 * 60 * 60), // 7 days
      ]);
    } catch (error) {
      this.logger.error('Failed to track usage', error);
    }
  }

  private async persistRule(rule: RateLimitRule): Promise<void> {
    const key = `rule:${rule.name}`;
    await this.redisClient.setex(key, 30 * 24 * 60 * 60, JSON.stringify(rule)); // 30 days
  }

  private async removePersistedRule(ruleName: string): Promise<void> {
    const key = `rule:${ruleName}`;
    await this.redisClient.del(key);
  }

  private initializeDefaultRules(): void {
    // Default rule for AI endpoints
    this.rules.set('ai_requests', {
      name: 'ai_requests',
      pattern: '/api/ai/*',
      config: {
        identifier: 'user',
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 20,
      },
      priority: 100,
      enabled: true,
    });

    // Default rule for authentication endpoints
    this.rules.set('auth_requests', {
      name: 'auth_requests',
      pattern: '/api/auth/*',
      config: {
        identifier: 'ip',
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 10,
      },
      priority: 200,
      enabled: true,
    });

    // Default rule for general API
    this.rules.set('general_api', {
      name: 'general_api',
      pattern: '/api/*',
      config: {
        identifier: 'user',
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 100,
      },
      priority: 50,
      enabled: true,
    });
  }

  private getDefaultRule(): RateLimitRule {
    return {
      name: 'default',
      pattern: '*',
      config: {
        identifier: 'user',
        windowMs: 60 * 1000,
        maxRequests: 100,
      },
      priority: 1,
      enabled: true,
    };
  }

  private async getSystemLoad(): Promise<number> {
    try {
      // This would integrate with system monitoring
      // For now, return a mock value
      return 0.5; // 50% load
    } catch (error) {
      this.logger.error('Failed to get system load', error);
      return 0.5; // Default to moderate load
    }
  }

  private startSystemMonitoring(): void {
    // Monitor system load every 30 seconds
    setInterval(async () => {
      try {
        const load = await this.getSystemLoad();
        await this.redisClient.setex('system_load', 60, load.toString());
        
        if (load >= this.systemLoadThresholds.emergency) {
          this.eventEmitter.emit('system.load_critical', { load });
        } else if (load >= this.systemLoadThresholds.degraded) {
          this.eventEmitter.emit('system.load_degraded', { load });
        }
      } catch (error) {
        this.logger.error('System monitoring failed', error);
      }
    }, 30000);
  }
}
