
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Redis } from 'ioredis';

export interface BurstConfig {
  burstSize: number; // Maximum burst capacity
  refillRate: number; // Tokens per second
  maxBurstDuration: number; // Maximum burst duration in ms
  cooldownPeriod: number; // Cooldown period in ms after burst
  burstThreshold: number; // Threshold to trigger burst mode
}

export interface BurstState {
  identifier: string;
  currentTokens: number;
  lastRefill: Date;
  inBurstMode: boolean;
  burstStartTime?: Date;
  cooldownUntil?: Date;
  burstCount: number;
  totalBursts: number;
}

export interface BurstResult {
  allowed: boolean;
  tokensRemaining: number;
  inBurstMode: boolean;
  burstCapacityUsed: number;
  waitTime: number;
  nextRefillTime: Date;
  recommendation?: string;
}

export interface BurstPattern {
  identifier: string;
  avgRequestsPerSecond: number;
  peakRequestsPerSecond: number;
  burstFrequency: number;
  avgBurstDuration: number;
  efficiency: number;
}

@Injectable()
export class BurstHandlerService {
  private readonly logger = new Logger(BurstHandlerService.name);
  private readonly redisClient: Redis;
  private readonly defaultConfig: BurstConfig;
  private readonly burstConfigs: Map<string, BurstConfig> = new Map();
  private readonly burstPatterns: Map<string, BurstPattern> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.redisClient = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      keyPrefix: 'burst:',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
    });

    this.defaultConfig = {
      burstSize: this.configService.get('DEFAULT_BURST_SIZE', 100),
      refillRate: this.configService.get('DEFAULT_REFILL_RATE', 10), // 10 tokens per second
      maxBurstDuration: this.configService.get('MAX_BURST_DURATION', 30000), // 30 seconds
      cooldownPeriod: this.configService.get('BURST_COOLDOWN_PERIOD', 60000), // 1 minute
      burstThreshold: this.configService.get('BURST_THRESHOLD', 5), // 5 requests per second
    };

    this.startBurstMonitoring();
  }

  async checkBurstAllowance(
    identifier: string,
    requestCount: number = 1,
    priority: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ): Promise<BurstResult> {
    try {
      const config = this.getBurstConfig(identifier);
      const state = await this.getBurstState(identifier);

      // Update token bucket
      const updatedState = this.updateTokenBucket(state, config);
      
      // Check if request can be satisfied
      const canConsume = updatedState.currentTokens >= requestCount;
      
      if (!canConsume) {
        // Check if we can enter burst mode
        const burstResult = await this.handleBurstMode(identifier, updatedState, config, requestCount);
        
        if (!burstResult.allowed) {
          await this.saveBurstState(updatedState);
          return burstResult;
        }
        
        // Consume tokens from burst
        updatedState.currentTokens -= requestCount;
        updatedState.burstCount += requestCount;
      } else {
        // Normal consumption
        updatedState.currentTokens -= requestCount;
      }

      // Save updated state
      await this.saveBurstState(updatedState);

      // Track burst patterns
      await this.trackBurstPattern(identifier, requestCount);

      // Emit events for monitoring
      this.eventEmitter.emit('burst.request_processed', {
        identifier,
        requestCount,
        tokensRemaining: updatedState.currentTokens,
        inBurstMode: updatedState.inBurstMode,
      });

      return {
        allowed: true,
        tokensRemaining: updatedState.currentTokens,
        inBurstMode: updatedState.inBurstMode,
        burstCapacityUsed: this.calculateBurstUsage(updatedState, config),
        waitTime: 0,
        nextRefillTime: new Date(Date.now() + 1000),
        recommendation: this.generateRecommendation(updatedState, config),
      };
    } catch (error) {
      this.logger.error(`Burst check failed for ${identifier}`, error);
      return {
        allowed: true, // Fail open
        tokensRemaining: 100,
        inBurstMode: false,
        burstCapacityUsed: 0,
        waitTime: 0,
        nextRefillTime: new Date(),
      };
    }
  }

  async setBurstConfig(identifier: string, config: Partial<BurstConfig>): Promise<void> {
    const fullConfig = { ...this.defaultConfig, ...config };
    this.burstConfigs.set(identifier, fullConfig);
    
    await this.redisClient.setex(
      `config:${identifier}`,
      24 * 60 * 60, // 24 hours
      JSON.stringify(fullConfig)
    );

    this.logger.log(`Updated burst config for ${identifier}`);
    this.eventEmitter.emit('burst.config_updated', { identifier, config: fullConfig });
  }

  async getBurstStatus(identifier: string): Promise<{
    state: BurstState;
    config: BurstConfig;
    pattern: BurstPattern | null;
    efficiency: number;
    recommendations: string[];
  }> {
    try {
      const state = await this.getBurstState(identifier);
      const config = this.getBurstConfig(identifier);
      const pattern = this.burstPatterns.get(identifier) || null;
      
      const efficiency = pattern ? pattern.efficiency : 1.0;
      const recommendations = this.generateRecommendations(state, config, pattern);

      return {
        state,
        config,
        pattern,
        efficiency,
        recommendations,
      };
    } catch (error) {
      this.logger.error(`Failed to get burst status for ${identifier}`, error);
      return {
        state: this.getDefaultBurstState(identifier),
        config: this.defaultConfig,
        pattern: null,
        efficiency: 1.0,
        recommendations: [],
      };
    }
  }

  async resetBurstState(identifier: string): Promise<boolean> {
    try {
      await this.redisClient.del(`state:${identifier}`);
      this.burstPatterns.delete(identifier);
      
      this.logger.log(`Reset burst state for ${identifier}`);
      this.eventEmitter.emit('burst.state_reset', { identifier });
      
      return true;
    } catch (error) {
      this.logger.error(`Failed to reset burst state for ${identifier}`, error);
      return false;
    }
  }

  async optimizeBurstConfig(identifier: string): Promise<BurstConfig> {
    try {
      const pattern = this.burstPatterns.get(identifier);
      if (!pattern) {
        return this.defaultConfig;
      }

      // Optimize config based on usage patterns
      const optimizedConfig: BurstConfig = {
        burstSize: Math.max(
          this.defaultConfig.burstSize,
          Math.ceil(pattern.peakRequestsPerSecond * pattern.avgBurstDuration / 1000)
        ),
        refillRate: Math.max(
          this.defaultConfig.refillRate,
          Math.ceil(pattern.avgRequestsPerSecond * 1.2) // 20% buffer
        ),
        maxBurstDuration: Math.max(
          this.defaultConfig.maxBurstDuration,
          pattern.avgBurstDuration * 1.5 // 50% buffer
        ),
        cooldownPeriod: Math.min(
          this.defaultConfig.cooldownPeriod,
          Math.max(10000, pattern.avgBurstDuration / 2) // At least 10s, max half burst duration
        ),
        burstThreshold: Math.max(
          this.defaultConfig.burstThreshold,
          pattern.avgRequestsPerSecond
        ),
      };

      await this.setBurstConfig(identifier, optimizedConfig);
      
      this.logger.log(`Optimized burst config for ${identifier}`);
      return optimizedConfig;
    } catch (error) {
      this.logger.error(`Failed to optimize burst config for ${identifier}`, error);
      return this.defaultConfig;
    }
  }

  async getBurstAnalytics(daysPeriod: number = 7): Promise<{
    totalBursts: number;
    avgBurstDuration: number;
    peakBurstRate: number;
    topBurstUsers: Array<{ identifier: string; burstCount: number }>;
    burstEfficiency: number;
    patterns: BurstPattern[];
  }> {
    try {
      // This would analyze historical burst data
      // For now, returning aggregated data from current patterns
      
      const patterns = Array.from(this.burstPatterns.values());
      const totalBursts = patterns.reduce((sum, p) => sum + (p.burstFrequency * daysPeriod), 0);
      const avgBurstDuration = patterns.length > 0 
        ? patterns.reduce((sum, p) => sum + p.avgBurstDuration, 0) / patterns.length
        : 0;

      return {
        totalBursts,
        avgBurstDuration,
        peakBurstRate: Math.max(...patterns.map(p => p.peakRequestsPerSecond), 0),
        topBurstUsers: patterns
          .map(p => ({ identifier: p.identifier, burstCount: p.burstFrequency * daysPeriod }))
          .sort((a, b) => b.burstCount - a.burstCount)
          .slice(0, 10),
        burstEfficiency: patterns.length > 0 
          ? patterns.reduce((sum, p) => sum + p.efficiency, 0) / patterns.length
          : 1.0,
        patterns,
      };
    } catch (error) {
      this.logger.error('Failed to get burst analytics', error);
      return {
        totalBursts: 0,
        avgBurstDuration: 0,
        peakBurstRate: 0,
        topBurstUsers: [],
        burstEfficiency: 1.0,
        patterns: [],
      };
    }
  }

  private getBurstConfig(identifier: string): BurstConfig {
    return this.burstConfigs.get(identifier) || this.defaultConfig;
  }

  private async getBurstState(identifier: string): Promise<BurstState> {
    try {
      const stateData = await this.redisClient.get(`state:${identifier}`);
      if (stateData) {
        const state = JSON.parse(stateData) as BurstState;
        // Convert date strings back to Date objects
        state.lastRefill = new Date(state.lastRefill);
        if (state.burstStartTime) state.burstStartTime = new Date(state.burstStartTime);
        if (state.cooldownUntil) state.cooldownUntil = new Date(state.cooldownUntil);
        return state;
      }

      return this.getDefaultBurstState(identifier);
    } catch (error) {
      this.logger.error(`Failed to get burst state for ${identifier}`, error);
      return this.getDefaultBurstState(identifier);
    }
  }

  private getDefaultBurstState(identifier: string): BurstState {
    const config = this.getBurstConfig(identifier);
    return {
      identifier,
      currentTokens: config.burstSize,
      lastRefill: new Date(),
      inBurstMode: false,
      burstCount: 0,
      totalBursts: 0,
    };
  }

  private updateTokenBucket(state: BurstState, config: BurstConfig): BurstState {
    const now = new Date();
    const timeSinceRefill = now.getTime() - state.lastRefill.getTime();
    const tokensToAdd = Math.floor((timeSinceRefill / 1000) * config.refillRate);
    
    if (tokensToAdd > 0) {
      state.currentTokens = Math.min(config.burstSize, state.currentTokens + tokensToAdd);
      state.lastRefill = now;
    }

    // Check if we should exit burst mode
    if (state.inBurstMode && state.burstStartTime) {
      const burstDuration = now.getTime() - state.burstStartTime.getTime();
      if (burstDuration >= config.maxBurstDuration) {
        state.inBurstMode = false;
        state.cooldownUntil = new Date(now.getTime() + config.cooldownPeriod);
        state.burstCount = 0;
        
        this.eventEmitter.emit('burst.mode_exited', {
          identifier: state.identifier,
          burstDuration,
          tokensUsed: state.burstCount,
        });
      }
    }

    // Check if cooldown period is over
    if (state.cooldownUntil && now > state.cooldownUntil) {
      state.cooldownUntil = undefined;
    }

    return state;
  }

  private async handleBurstMode(
    identifier: string,
    state: BurstState,
    config: BurstConfig,
    requestCount: number
  ): Promise<BurstResult> {
    const now = new Date();

    // Check if in cooldown period
    if (state.cooldownUntil && now <= state.cooldownUntil) {
      const waitTime = state.cooldownUntil.getTime() - now.getTime();
      return {
        allowed: false,
        tokensRemaining: state.currentTokens,
        inBurstMode: false,
        burstCapacityUsed: 0,
        waitTime,
        nextRefillTime: state.cooldownUntil,
        recommendation: 'Wait for cooldown period to end',
      };
    }

    // Check if we can enter burst mode
    if (!state.inBurstMode) {
      // Enter burst mode
      state.inBurstMode = true;
      state.burstStartTime = now;
      state.totalBursts++;
      
      this.eventEmitter.emit('burst.mode_entered', {
        identifier,
        timestamp: now,
        totalBursts: state.totalBursts,
      });

      this.logger.debug(`Entered burst mode for ${identifier}`);
    }

    // Check if burst capacity can handle the request
    const burstCapacity = config.burstSize;
    const burstUsed = this.calculateBurstUsage(state, config);
    
    if (burstUsed + requestCount > burstCapacity) {
      // Burst capacity exceeded
      return {
        allowed: false,
        tokensRemaining: state.currentTokens,
        inBurstMode: true,
        burstCapacityUsed: burstUsed,
        waitTime: 1000, // Wait 1 second
        nextRefillTime: new Date(now.getTime() + 1000),
        recommendation: 'Burst capacity exceeded, reduce request rate',
      };
    }

    return {
      allowed: true,
      tokensRemaining: state.currentTokens,
      inBurstMode: true,
      burstCapacityUsed: burstUsed + requestCount,
      waitTime: 0,
      nextRefillTime: new Date(now.getTime() + 1000),
      recommendation: 'Using burst capacity',
    };
  }

  private calculateBurstUsage(state: BurstState, config: BurstConfig): number {
    return state.burstCount;
  }

  private async saveBurstState(state: BurstState): Promise<void> {
    await this.redisClient.setex(
      `state:${state.identifier}`,
      12 * 60 * 60, // 12 hours
      JSON.stringify(state)
    );
  }

  private async trackBurstPattern(identifier: string, requestCount: number): Promise<void> {
    const now = new Date();
    const windowSize = 60000; // 1 minute window
    const windowKey = `pattern:${identifier}:${Math.floor(now.getTime() / windowSize)}`;
    
    // Track requests in current window
    await this.redisClient.hincrby(windowKey, 'requests', requestCount);
    await this.redisClient.hset(windowKey, 'timestamp', now.getTime());
    await this.redisClient.expire(windowKey, 3600); // 1 hour TTL

    // Update pattern analysis periodically
    if (Math.random() < 0.1) { // 10% chance to update pattern
      await this.updateBurstPattern(identifier);
    }
  }

  private async updateBurstPattern(identifier: string): Promise<void> {
    try {
      const windowKeys = await this.redisClient.keys(`pattern:${identifier}:*`);
      if (windowKeys.length === 0) return;

      const windowData = [];
      for (const key of windowKeys.slice(-60)) { // Last 60 minutes
        const data = await this.redisClient.hmget(key, 'requests', 'timestamp');
        if (data[0] && data[1]) {
          windowData.push({
            requests: parseInt(data[0], 10),
            timestamp: parseInt(data[1], 10),
          });
        }
      }

      if (windowData.length === 0) return;

      // Calculate pattern metrics
      const requestsPerSecond = windowData.map(d => d.requests / 60);
      const avgRequestsPerSecond = requestsPerSecond.reduce((a, b) => a + b, 0) / requestsPerSecond.length;
      const peakRequestsPerSecond = Math.max(...requestsPerSecond);

      // Identify bursts (windows with >2x average rate)
      const burstThreshold = avgRequestsPerSecond * 2;
      const burstWindows = windowData.filter((_, i) => requestsPerSecond[i] > burstThreshold);
      
      const pattern: BurstPattern = {
        identifier,
        avgRequestsPerSecond,
        peakRequestsPerSecond,
        burstFrequency: burstWindows.length / (windowData.length / 60), // bursts per hour
        avgBurstDuration: burstWindows.length > 0 ? (burstWindows.length * 60000) / burstWindows.length : 0,
        efficiency: avgRequestsPerSecond > 0 ? Math.min(1, avgRequestsPerSecond / peakRequestsPerSecond) : 1,
      };

      this.burstPatterns.set(identifier, pattern);
    } catch (error) {
      this.logger.error(`Failed to update burst pattern for ${identifier}`, error);
    }
  }

  private generateRecommendation(state: BurstState, config: BurstConfig): string | undefined {
    if (state.inBurstMode) {
      return 'Currently in burst mode - monitor usage to avoid cooldown';
    }
    
    const utilization = (config.burstSize - state.currentTokens) / config.burstSize;
    if (utilization > 0.8) {
      return 'High token utilization - consider reducing request rate';
    }
    
    return undefined;
  }

  private generateRecommendations(
    state: BurstState,
    config: BurstConfig,
    pattern: BurstPattern | null
  ): string[] {
    const recommendations: string[] = [];

    if (state.inBurstMode) {
      recommendations.push('Currently in burst mode - monitor usage carefully');
    }

    if (state.totalBursts > 10) {
      recommendations.push('Frequent bursting detected - consider optimizing request patterns');
    }

    if (pattern && pattern.efficiency < 0.5) {
      recommendations.push('Low burst efficiency - consider smoothing out request patterns');
    }

    if (pattern && pattern.peakRequestsPerSecond > config.refillRate * 2) {
      recommendations.push('Peak request rate exceeds capacity - consider increasing burst size');
    }

    return recommendations;
  }

  private startBurstMonitoring(): void {
    // Clean up old patterns every hour
    setInterval(async () => {
      try {
        const oldPatternKeys = await this.redisClient.keys('pattern:*');
        const cutoffTime = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago
        
        for (const key of oldPatternKeys) {
          const timestamp = await this.redisClient.hget(key, 'timestamp');
          if (timestamp && parseInt(timestamp, 10) < cutoffTime) {
            await this.redisClient.del(key);
          }
        }
      } catch (error) {
        this.logger.error('Failed to clean up old patterns', error);
      }
    }, 60 * 60 * 1000); // Every hour

    this.logger.log('Started burst monitoring and cleanup');
  }
}
