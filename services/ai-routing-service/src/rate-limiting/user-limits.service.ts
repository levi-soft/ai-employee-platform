
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Redis } from 'ioredis';

export interface UserLimitConfig {
  userId: string;
  tier: 'free' | 'basic' | 'premium' | 'enterprise';
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerRequest: number;
  tokensPerDay: number;
  concurrentRequests: number;
  maxContextLength: number;
  monthlyBudget: number;
  customLimits?: Record<string, any>;
  overrideRules?: Array<{
    condition: string;
    multiplier: number;
    validUntil?: Date;
  }>;
}

export interface UserUsageStats {
  userId: string;
  currentPeriod: {
    requestsToday: number;
    tokensToday: number;
    costToday: number;
  };
  monthlyUsage: {
    requests: number;
    tokens: number;
    cost: number;
  };
  realTimeUsage: {
    requestsThisMinute: number;
    requestsThisHour: number;
    concurrentRequests: number;
  };
  limits: UserLimitConfig;
  utilizationPercentages: {
    requestsMinute: number;
    requestsHour: number;
    requestsDay: number;
    tokensDay: number;
    budget: number;
  };
}

export interface UserLimitResult {
  allowed: boolean;
  reason?: string;
  waitTime: number;
  quotaRemaining: {
    requests: number;
    tokens: number;
    budget: number;
  };
  resetTimes: {
    minute: Date;
    hour: Date;
    day: Date;
  };
  recommendedAction?: string;
}

@Injectable()
export class UserLimitsService {
  private readonly logger = new Logger(UserLimitsService.name);
  private readonly redisClient: Redis;
  private readonly tierConfigs: Map<string, Partial<UserLimitConfig>> = new Map();
  private readonly userOverrides: Map<string, UserLimitConfig> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.redisClient = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      keyPrefix: 'user_limits:',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
    });

    this.initializeTierConfigs();
    this.startUsageMonitoring();
  }

  async checkUserLimits(
    userId: string,
    requestTokens: number = 0,
    endpoint?: string,
    metadata?: Record<string, any>
  ): Promise<UserLimitResult> {
    try {
      const limits = await this.getUserLimits(userId);
      const usage = await this.getUserUsage(userId);

      // Check minute limit
      const minuteCheck = this.checkMinuteLimit(usage, limits);
      if (!minuteCheck.allowed) return minuteCheck;

      // Check hour limit
      const hourCheck = this.checkHourLimit(usage, limits);
      if (!hourCheck.allowed) return hourCheck;

      // Check daily limits
      const dayCheck = this.checkDayLimit(usage, limits, requestTokens);
      if (!dayCheck.allowed) return dayCheck;

      // Check concurrent requests
      const concurrentCheck = await this.checkConcurrentLimit(userId, limits);
      if (!concurrentCheck.allowed) return concurrentCheck;

      // Check monthly budget
      const budgetCheck = this.checkBudgetLimit(usage, limits, requestTokens);
      if (!budgetCheck.allowed) return budgetCheck;

      // Check custom endpoint limits
      if (endpoint) {
        const endpointCheck = await this.checkEndpointLimit(userId, endpoint, limits);
        if (!endpointCheck.allowed) return endpointCheck;
      }

      // Apply dynamic adjustments based on system load
      const dynamicCheck = await this.applyDynamicLimits(userId, limits, usage);
      if (!dynamicCheck.allowed) return dynamicCheck;

      // All checks passed - record the request
      await this.recordUserRequest(userId, requestTokens, endpoint);

      return {
        allowed: true,
        waitTime: 0,
        quotaRemaining: this.calculateRemainingQuota(usage, limits, requestTokens),
        resetTimes: this.calculateResetTimes(),
      };
    } catch (error) {
      this.logger.error(`User limit check failed for ${userId}`, error);
      return {
        allowed: true, // Fail open
        waitTime: 0,
        quotaRemaining: { requests: 100, tokens: 10000, budget: 100 },
        resetTimes: this.calculateResetTimes(),
      };
    }
  }

  async getUserUsage(userId: string): Promise<UserUsageStats> {
    try {
      const limits = await this.getUserLimits(userId);
      
      // Get current period usage
      const todayKey = `usage:${userId}:${this.getDayKey()}`;
      const monthKey = `usage:${userId}:${this.getMonthKey()}`;
      const realTimeKey = `realtime:${userId}`;

      const [todayUsage, monthlyUsage, realTimeUsage] = await Promise.all([
        this.redisClient.hmget(todayKey, 'requests', 'tokens', 'cost'),
        this.redisClient.hmget(monthKey, 'requests', 'tokens', 'cost'),
        this.redisClient.hmget(realTimeKey, 'minute_requests', 'hour_requests', 'concurrent'),
      ]);

      const currentPeriod = {
        requestsToday: parseInt(todayUsage[0] || '0', 10),
        tokensToday: parseInt(todayUsage[1] || '0', 10),
        costToday: parseFloat(todayUsage[2] || '0'),
      };

      const monthlyUsageData = {
        requests: parseInt(monthlyUsage[0] || '0', 10),
        tokens: parseInt(monthlyUsage[1] || '0', 10),
        cost: parseFloat(monthlyUsage[2] || '0'),
      };

      const realTimeUsageData = {
        requestsThisMinute: parseInt(realTimeUsage[0] || '0', 10),
        requestsThisHour: parseInt(realTimeUsage[1] || '0', 10),
        concurrentRequests: parseInt(realTimeUsage[2] || '0', 10),
      };

      const utilizationPercentages = {
        requestsMinute: (realTimeUsageData.requestsThisMinute / limits.requestsPerMinute) * 100,
        requestsHour: (realTimeUsageData.requestsThisHour / limits.requestsPerHour) * 100,
        requestsDay: (currentPeriod.requestsToday / limits.requestsPerDay) * 100,
        tokensDay: (currentPeriod.tokensToday / limits.tokensPerDay) * 100,
        budget: (monthlyUsageData.cost / limits.monthlyBudget) * 100,
      };

      return {
        userId,
        currentPeriod,
        monthlyUsage: monthlyUsageData,
        realTimeUsage: realTimeUsageData,
        limits,
        utilizationPercentages,
      };
    } catch (error) {
      this.logger.error(`Failed to get user usage for ${userId}`, error);
      return this.getDefaultUsageStats(userId);
    }
  }

  async setUserLimits(userId: string, limits: Partial<UserLimitConfig>): Promise<void> {
    try {
      const existingLimits = await this.getUserLimits(userId);
      const newLimits = { ...existingLimits, ...limits };
      
      this.userOverrides.set(userId, newLimits);
      await this.redisClient.setex(
        `custom:${userId}`,
        30 * 24 * 60 * 60, // 30 days
        JSON.stringify(newLimits)
      );

      this.logger.log(`Updated custom limits for user ${userId}`);
      this.eventEmitter.emit('user_limits.updated', { userId, limits: newLimits });
    } catch (error) {
      this.logger.error(`Failed to set user limits for ${userId}`, error);
    }
  }

  async upgradeUserTier(userId: string, newTier: 'free' | 'basic' | 'premium' | 'enterprise'): Promise<boolean> {
    try {
      const tierConfig = this.tierConfigs.get(newTier);
      if (!tierConfig) {
        this.logger.warn(`Invalid tier: ${newTier}`);
        return false;
      }

      const currentLimits = await this.getUserLimits(userId);
      const upgradedLimits: UserLimitConfig = {
        ...currentLimits,
        ...tierConfig,
        userId,
        tier: newTier,
      };

      await this.setUserLimits(userId, upgradedLimits);
      
      this.logger.log(`Upgraded user ${userId} to ${newTier} tier`);
      this.eventEmitter.emit('user_limits.tier_upgraded', { userId, oldTier: currentLimits.tier, newTier });
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to upgrade user ${userId} to ${newTier}`, error);
      return false;
    }
  }

  async addTemporaryBoost(
    userId: string,
    boostMultiplier: number,
    durationHours: number,
    reason?: string
  ): Promise<boolean> {
    try {
      const currentLimits = await this.getUserLimits(userId);
      const boostUntil = new Date(Date.now() + (durationHours * 60 * 60 * 1000));
      
      const boostedLimits = {
        ...currentLimits,
        requestsPerMinute: Math.floor(currentLimits.requestsPerMinute * boostMultiplier),
        requestsPerHour: Math.floor(currentLimits.requestsPerHour * boostMultiplier),
        requestsPerDay: Math.floor(currentLimits.requestsPerDay * boostMultiplier),
        tokensPerDay: Math.floor(currentLimits.tokensPerDay * boostMultiplier),
        overrideRules: [
          ...(currentLimits.overrideRules || []),
          {
            condition: 'temporary_boost',
            multiplier: boostMultiplier,
            validUntil: boostUntil,
          },
        ],
      };

      await this.setUserLimits(userId, boostedLimits);
      
      this.logger.log(
        `Added temporary boost for user ${userId}: ${boostMultiplier}x for ${durationHours}h` +
        (reason ? ` (${reason})` : '')
      );
      
      this.eventEmitter.emit('user_limits.boost_added', {
        userId,
        multiplier: boostMultiplier,
        duration: durationHours,
        reason,
      });

      return true;
    } catch (error) {
      this.logger.error(`Failed to add temporary boost for user ${userId}`, error);
      return false;
    }
  }

  async resetUserUsage(userId: string, resetType: 'daily' | 'monthly' | 'all' = 'daily'): Promise<boolean> {
    try {
      const patterns = [];
      
      switch (resetType) {
        case 'daily':
          patterns.push(`usage:${userId}:${this.getDayKey()}`);
          break;
        case 'monthly':
          patterns.push(`usage:${userId}:${this.getMonthKey()}`);
          break;
        case 'all':
          patterns.push(`usage:${userId}:*`, `realtime:${userId}`);
          break;
      }

      for (const pattern of patterns) {
        const keys = await this.redisClient.keys(pattern);
        if (keys.length > 0) {
          await this.redisClient.del(...keys);
        }
      }

      this.logger.log(`Reset ${resetType} usage for user ${userId}`);
      this.eventEmitter.emit('user_limits.usage_reset', { userId, resetType });
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to reset usage for user ${userId}`, error);
      return false;
    }
  }

  async getUserLimitSummary(userId: string): Promise<{
    tier: string;
    utilizationSummary: string;
    recommendations: string[];
    warnings: string[];
    nextReset: {
      minute: Date;
      hour: Date;
      day: Date;
      month: Date;
    };
  }> {
    try {
      const usage = await this.getUserUsage(userId);
      const recommendations: string[] = [];
      const warnings: string[] = [];

      // Generate recommendations based on usage patterns
      if (usage.utilizationPercentages.budget > 80) {
        warnings.push('Monthly budget utilization is high (>80%)');
        recommendations.push('Consider upgrading your plan or optimizing your usage');
      }

      if (usage.utilizationPercentages.requestsDay > 90) {
        warnings.push('Daily request limit is almost reached (>90%)');
        recommendations.push('Reduce request frequency or upgrade your tier');
      }

      if (usage.utilizationPercentages.tokensDay > 85) {
        warnings.push('Daily token limit is high (>85%)');
        recommendations.push('Use shorter prompts or consider context optimization');
      }

      // Generate utilization summary
      const utilizationSummary = 
        `Requests: ${usage.utilizationPercentages.requestsDay.toFixed(1)}% daily, ` +
        `Tokens: ${usage.utilizationPercentages.tokensDay.toFixed(1)}% daily, ` +
        `Budget: ${usage.utilizationPercentages.budget.toFixed(1)}% monthly`;

      return {
        tier: usage.limits.tier,
        utilizationSummary,
        recommendations,
        warnings,
        nextReset: {
          minute: this.getNextMinuteReset(),
          hour: this.getNextHourReset(),
          day: this.getNextDayReset(),
          month: this.getNextMonthReset(),
        },
      };
    } catch (error) {
      this.logger.error(`Failed to get user limit summary for ${userId}`, error);
      return {
        tier: 'unknown',
        utilizationSummary: 'Unable to calculate utilization',
        recommendations: [],
        warnings: [],
        nextReset: {
          minute: new Date(),
          hour: new Date(),
          day: new Date(),
          month: new Date(),
        },
      };
    }
  }

  private async getUserLimits(userId: string): Promise<UserLimitConfig> {
    try {
      // Check for user-specific overrides first
      const override = this.userOverrides.get(userId);
      if (override) return override;

      const customLimits = await this.redisClient.get(`custom:${userId}`);
      if (customLimits) {
        const limits = JSON.parse(customLimits) as UserLimitConfig;
        this.userOverrides.set(userId, limits);
        return limits;
      }

      // Fall back to tier-based limits (would typically get tier from user database)
      const userTier = 'basic'; // This would come from user service
      const tierConfig = this.tierConfigs.get(userTier) || this.tierConfigs.get('free')!;
      
      return {
        userId,
        tier: userTier as any,
        ...tierConfig,
      } as UserLimitConfig;
    } catch (error) {
      this.logger.error(`Failed to get user limits for ${userId}`, error);
      return this.getDefaultUserLimits(userId);
    }
  }

  private checkMinuteLimit(usage: UserUsageStats, limits: UserLimitConfig): UserLimitResult {
    if (usage.realTimeUsage.requestsThisMinute >= limits.requestsPerMinute) {
      return {
        allowed: false,
        reason: 'Per-minute request limit exceeded',
        waitTime: this.getSecondsUntilNextMinute() * 1000,
        quotaRemaining: { requests: 0, tokens: 0, budget: 0 },
        resetTimes: this.calculateResetTimes(),
        recommendedAction: 'Wait for the next minute or upgrade your plan',
      };
    }
    return { allowed: true, waitTime: 0, quotaRemaining: { requests: 0, tokens: 0, budget: 0 }, resetTimes: this.calculateResetTimes() };
  }

  private checkHourLimit(usage: UserUsageStats, limits: UserLimitConfig): UserLimitResult {
    if (usage.realTimeUsage.requestsThisHour >= limits.requestsPerHour) {
      return {
        allowed: false,
        reason: 'Per-hour request limit exceeded',
        waitTime: this.getSecondsUntilNextHour() * 1000,
        quotaRemaining: { requests: 0, tokens: 0, budget: 0 },
        resetTimes: this.calculateResetTimes(),
        recommendedAction: 'Wait for the next hour or upgrade your plan',
      };
    }
    return { allowed: true, waitTime: 0, quotaRemaining: { requests: 0, tokens: 0, budget: 0 }, resetTimes: this.calculateResetTimes() };
  }

  private checkDayLimit(usage: UserUsageStats, limits: UserLimitConfig, requestTokens: number): UserLimitResult {
    if (usage.currentPeriod.requestsToday >= limits.requestsPerDay) {
      return {
        allowed: false,
        reason: 'Daily request limit exceeded',
        waitTime: this.getSecondsUntilNextDay() * 1000,
        quotaRemaining: { requests: 0, tokens: 0, budget: 0 },
        resetTimes: this.calculateResetTimes(),
        recommendedAction: 'Wait until tomorrow or upgrade your plan',
      };
    }

    if (usage.currentPeriod.tokensToday + requestTokens > limits.tokensPerDay) {
      return {
        allowed: false,
        reason: 'Daily token limit would be exceeded',
        waitTime: this.getSecondsUntilNextDay() * 1000,
        quotaRemaining: { requests: 0, tokens: 0, budget: 0 },
        resetTimes: this.calculateResetTimes(),
        recommendedAction: 'Use fewer tokens or wait until tomorrow',
      };
    }

    return { allowed: true, waitTime: 0, quotaRemaining: { requests: 0, tokens: 0, budget: 0 }, resetTimes: this.calculateResetTimes() };
  }

  private async checkConcurrentLimit(userId: string, limits: UserLimitConfig): Promise<UserLimitResult> {
    const concurrentKey = `concurrent:${userId}`;
    const current = await this.redisClient.get(concurrentKey) || '0';
    const concurrentCount = parseInt(current, 10);

    if (concurrentCount >= limits.concurrentRequests) {
      return {
        allowed: false,
        reason: 'Concurrent request limit exceeded',
        waitTime: 1000, // Wait 1 second
        quotaRemaining: { requests: 0, tokens: 0, budget: 0 },
        resetTimes: this.calculateResetTimes(),
        recommendedAction: 'Wait for current requests to complete',
      };
    }

    return { allowed: true, waitTime: 0, quotaRemaining: { requests: 0, tokens: 0, budget: 0 }, resetTimes: this.calculateResetTimes() };
  }

  private checkBudgetLimit(usage: UserUsageStats, limits: UserLimitConfig, requestTokens: number): UserLimitResult {
    const estimatedCost = (requestTokens / 1000) * 0.002; // Rough estimate
    
    if (usage.monthlyUsage.cost + estimatedCost > limits.monthlyBudget) {
      return {
        allowed: false,
        reason: 'Monthly budget limit would be exceeded',
        waitTime: this.getSecondsUntilNextMonth() * 1000,
        quotaRemaining: { 
          requests: 0, 
          tokens: 0, 
          budget: Math.max(0, limits.monthlyBudget - usage.monthlyUsage.cost) 
        },
        resetTimes: this.calculateResetTimes(),
        recommendedAction: 'Upgrade your plan or wait until next month',
      };
    }

    return { allowed: true, waitTime: 0, quotaRemaining: { requests: 0, tokens: 0, budget: 0 }, resetTimes: this.calculateResetTimes() };
  }

  private async checkEndpointLimit(userId: string, endpoint: string, limits: UserLimitConfig): Promise<UserLimitResult> {
    // Check for endpoint-specific limits
    if (limits.customLimits && limits.customLimits[endpoint]) {
      const endpointLimit = limits.customLimits[endpoint];
      const endpointUsage = await this.getEndpointUsage(userId, endpoint);
      
      if (endpointUsage >= endpointLimit) {
        return {
          allowed: false,
          reason: `Endpoint-specific limit exceeded for ${endpoint}`,
          waitTime: this.getSecondsUntilNextHour() * 1000,
          quotaRemaining: { requests: 0, tokens: 0, budget: 0 },
          resetTimes: this.calculateResetTimes(),
          recommendedAction: 'Use different endpoints or wait for limit reset',
        };
      }
    }

    return { allowed: true, waitTime: 0, quotaRemaining: { requests: 0, tokens: 0, budget: 0 }, resetTimes: this.calculateResetTimes() };
  }

  private async applyDynamicLimits(userId: string, limits: UserLimitConfig, usage: UserUsageStats): Promise<UserLimitResult> {
    // Apply dynamic limits based on system load or other factors
    // For now, just return allowed
    return { allowed: true, waitTime: 0, quotaRemaining: { requests: 0, tokens: 0, budget: 0 }, resetTimes: this.calculateResetTimes() };
  }

  private async recordUserRequest(userId: string, requestTokens: number, endpoint?: string): Promise<void> {
    const todayKey = `usage:${userId}:${this.getDayKey()}`;
    const monthKey = `usage:${userId}:${this.getMonthKey()}`;
    const realTimeKey = `realtime:${userId}`;
    const estimatedCost = (requestTokens / 1000) * 0.002;

    await Promise.all([
      // Update daily usage
      this.redisClient.hincrby(todayKey, 'requests', 1),
      this.redisClient.hincrby(todayKey, 'tokens', requestTokens),
      this.redisClient.hincrbyfloat(todayKey, 'cost', estimatedCost),
      this.redisClient.expire(todayKey, 48 * 60 * 60), // 48 hours

      // Update monthly usage
      this.redisClient.hincrby(monthKey, 'requests', 1),
      this.redisClient.hincrby(monthKey, 'tokens', requestTokens),
      this.redisClient.hincrbyfloat(monthKey, 'cost', estimatedCost),
      this.redisClient.expire(monthKey, 35 * 24 * 60 * 60), // 35 days

      // Update real-time counters
      this.updateRealTimeCounters(userId),
      
      // Update concurrent counter
      this.redisClient.incr(`concurrent:${userId}`),
      
      // Record endpoint usage if provided
      endpoint && this.redisClient.hincrby(`endpoint:${userId}:${this.getDayKey()}`, endpoint, 1),
    ]);
  }

  private async updateRealTimeCounters(userId: string): Promise<void> {
    const realTimeKey = `realtime:${userId}`;
    const minuteWindow = Math.floor(Date.now() / (60 * 1000));
    const hourWindow = Math.floor(Date.now() / (60 * 60 * 1000));

    await Promise.all([
      this.redisClient.hincrby(realTimeKey, 'minute_requests', 1),
      this.redisClient.hincrby(realTimeKey, 'hour_requests', 1),
      this.redisClient.expire(realTimeKey, 2 * 60 * 60), // 2 hours
    ]);
  }

  private async getEndpointUsage(userId: string, endpoint: string): Promise<number> {
    const endpointKey = `endpoint:${userId}:${this.getDayKey()}`;
    const usage = await this.redisClient.hget(endpointKey, endpoint);
    return parseInt(usage || '0', 10);
  }

  private calculateRemainingQuota(usage: UserUsageStats, limits: UserLimitConfig, requestTokens: number): {
    requests: number;
    tokens: number;
    budget: number;
  } {
    return {
      requests: Math.max(0, limits.requestsPerDay - usage.currentPeriod.requestsToday - 1),
      tokens: Math.max(0, limits.tokensPerDay - usage.currentPeriod.tokensToday - requestTokens),
      budget: Math.max(0, limits.monthlyBudget - usage.monthlyUsage.cost),
    };
  }

  private calculateResetTimes(): {
    minute: Date;
    hour: Date;
    day: Date;
  } {
    return {
      minute: this.getNextMinuteReset(),
      hour: this.getNextHourReset(),
      day: this.getNextDayReset(),
    };
  }

  private getDayKey(): string {
    return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  }

  private getMonthKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
  }

  private getSecondsUntilNextMinute(): number {
    return 60 - new Date().getSeconds();
  }

  private getSecondsUntilNextHour(): number {
    const now = new Date();
    return 3600 - (now.getMinutes() * 60 + now.getSeconds());
  }

  private getSecondsUntilNextDay(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
  }

  private getSecondsUntilNextMonth(): number {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return Math.floor((nextMonth.getTime() - now.getTime()) / 1000);
  }

  private getNextMinuteReset(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 0, 0);
  }

  private getNextHourReset(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
  }

  private getNextDayReset(): Date {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
  }

  private getNextMonthReset(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  }

  private initializeTierConfigs(): void {
    this.tierConfigs.set('free', {
      tier: 'free',
      requestsPerMinute: 10,
      requestsPerHour: 100,
      requestsPerDay: 1000,
      tokensPerRequest: 4000,
      tokensPerDay: 50000,
      concurrentRequests: 2,
      maxContextLength: 4000,
      monthlyBudget: 0,
    });

    this.tierConfigs.set('basic', {
      tier: 'basic',
      requestsPerMinute: 60,
      requestsPerHour: 1000,
      requestsPerDay: 10000,
      tokensPerRequest: 8000,
      tokensPerDay: 500000,
      concurrentRequests: 5,
      maxContextLength: 8000,
      monthlyBudget: 20,
    });

    this.tierConfigs.set('premium', {
      tier: 'premium',
      requestsPerMinute: 200,
      requestsPerHour: 5000,
      requestsPerDay: 50000,
      tokensPerRequest: 32000,
      tokensPerDay: 2000000,
      concurrentRequests: 15,
      maxContextLength: 32000,
      monthlyBudget: 100,
    });

    this.tierConfigs.set('enterprise', {
      tier: 'enterprise',
      requestsPerMinute: 1000,
      requestsPerHour: 20000,
      requestsPerDay: 200000,
      tokensPerRequest: 128000,
      tokensPerDay: 10000000,
      concurrentRequests: 50,
      maxContextLength: 128000,
      monthlyBudget: 1000,
    });

    this.logger.log('Initialized user tier configurations');
  }

  private getDefaultUserLimits(userId: string): UserLimitConfig {
    const freeConfig = this.tierConfigs.get('free')!;
    return {
      userId,
      ...freeConfig,
    } as UserLimitConfig;
  }

  private getDefaultUsageStats(userId: string): UserUsageStats {
    const limits = this.getDefaultUserLimits(userId);
    return {
      userId,
      currentPeriod: { requestsToday: 0, tokensToday: 0, costToday: 0 },
      monthlyUsage: { requests: 0, tokens: 0, cost: 0 },
      realTimeUsage: { requestsThisMinute: 0, requestsThisHour: 0, concurrentRequests: 0 },
      limits,
      utilizationPercentages: {
        requestsMinute: 0,
        requestsHour: 0,
        requestsDay: 0,
        tokensDay: 0,
        budget: 0,
      },
    };
  }

  private startUsageMonitoring(): void {
    // Reset minute counters every minute
    setInterval(async () => {
      try {
        const keys = await this.redisClient.keys('realtime:*');
        for (const key of keys) {
          await this.redisClient.hset(key, 'minute_requests', 0);
        }
      } catch (error) {
        this.logger.error('Failed to reset minute counters', error);
      }
    }, 60 * 1000);

    // Reset hour counters every hour
    setInterval(async () => {
      try {
        const keys = await this.redisClient.keys('realtime:*');
        for (const key of keys) {
          await this.redisClient.hset(key, 'hour_requests', 0);
        }
      } catch (error) {
        this.logger.error('Failed to reset hour counters', error);
      }
    }, 60 * 60 * 1000);

    this.logger.log('Started usage monitoring timers');
  }
}
