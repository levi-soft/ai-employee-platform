
import { RedisCache } from './redis-cache';
import { EventBus, EVENT_TYPES } from '../events/event-bus';

export interface InvalidationRule {
  eventType: string;
  patterns: string[];
  tags?: string[];
  delay?: number; // seconds
  strategy: 'immediate' | 'lazy' | 'scheduled';
  condition?: (eventData: any) => boolean;
}

export interface InvalidationConfig {
  cache: RedisCache;
  eventBus: EventBus;
  rules: InvalidationRule[];
  enableMetrics?: boolean;
  maxRetries?: number;
  retryDelay?: number;
}

export interface InvalidationMetrics {
  totalInvalidations: number;
  successfulInvalidations: number;
  failedInvalidations: number;
  averageInvalidationTime: number;
  invalidationsByType: Record<string, number>;
  invalidationsByStrategy: Record<string, number>;
  lazyInvalidationQueue: number;
  scheduledInvalidations: number;
}

export class CacheInvalidation {
  private cache: RedisCache;
  private eventBus: EventBus;
  private rules: Map<string, InvalidationRule[]> = new Map();
  private config: InvalidationConfig;
  private metrics: InvalidationMetrics;
  private lazyQueue: Set<string> = new Set();
  private scheduledTasks: Map<string, NodeJS.Timeout> = new Map();
  private invalidationTimes: number[] = [];

  constructor(config: InvalidationConfig) {
    this.config = config;
    this.cache = config.cache;
    this.eventBus = config.eventBus;
    
    this.initializeMetrics();
    this.setupInvalidationRules(config.rules);
    this.setupEventHandlers();
  }

  private initializeMetrics(): void {
    this.metrics = {
      totalInvalidations: 0,
      successfulInvalidations: 0,
      failedInvalidations: 0,
      averageInvalidationTime: 0,
      invalidationsByType: {},
      invalidationsByStrategy: {
        immediate: 0,
        lazy: 0,
        scheduled: 0,
      },
      lazyInvalidationQueue: 0,
      scheduledInvalidations: 0,
    };
  }

  private setupInvalidationRules(rules: InvalidationRule[]): void {
    for (const rule of rules) {
      if (!this.rules.has(rule.eventType)) {
        this.rules.set(rule.eventType, []);
      }
      this.rules.get(rule.eventType)!.push(rule);
    }
  }

  private setupEventHandlers(): void {
    // Subscribe to all configured event types
    for (const eventType of this.rules.keys()) {
      this.eventBus.subscribe(eventType, this.handleEvent.bind(this));
    }

    // Subscribe to cache access events for lazy invalidation
    this.cache.on('hit', this.handleCacheHit.bind(this));
    this.cache.on('miss', this.handleCacheMiss.bind(this));
  }

  private async handleEvent(payload: any): Promise<void> {
    const eventType = this.extractEventType(payload);
    const rules = this.rules.get(eventType) || [];

    for (const rule of rules) {
      // Check condition if provided
      if (rule.condition && !rule.condition(payload.data)) {
        continue;
      }

      await this.executeInvalidationRule(rule, payload);
    }
  }

  private extractEventType(payload: any): string {
    // Extract event type from payload metadata or source
    return payload.metadata?.eventType || payload.source || 'unknown';
  }

  private async executeInvalidationRule(rule: InvalidationRule, payload: any): Promise<void> {
    const startTime = Date.now();
    
    try {
      switch (rule.strategy) {
        case 'immediate':
          await this.immediateInvalidation(rule, payload);
          break;
        case 'lazy':
          await this.lazyInvalidation(rule, payload);
          break;
        case 'scheduled':
          await this.scheduledInvalidation(rule, payload);
          break;
      }

      this.updateMetrics(rule.strategy, Date.now() - startTime, true);
    } catch (error) {
      console.error(`[CacheInvalidation] Error executing rule for ${rule.eventType}:`, error);
      this.updateMetrics(rule.strategy, Date.now() - startTime, false);
    }
  }

  private async immediateInvalidation(rule: InvalidationRule, payload: any): Promise<void> {
    const patterns = this.interpolatePatterns(rule.patterns, payload.data);
    const tags = rule.tags || [];

    // Invalidate by patterns
    for (const pattern of patterns) {
      await this.cache.invalidateByPattern(pattern);
    }

    // Invalidate by tags
    for (const tag of tags) {
      await this.cache.invalidateByTag(tag);
    }

    console.log(`[CacheInvalidation] Immediate invalidation completed for ${rule.eventType}`);
  }

  private async lazyInvalidation(rule: InvalidationRule, payload: any): Promise<void> {
    const patterns = this.interpolatePatterns(rule.patterns, payload.data);
    
    // Add patterns to lazy queue
    for (const pattern of patterns) {
      this.lazyQueue.add(pattern);
    }

    // Add tags to lazy queue with tag: prefix
    if (rule.tags) {
      for (const tag of rule.tags) {
        this.lazyQueue.add(`tag:${tag}`);
      }
    }

    this.metrics.lazyInvalidationQueue = this.lazyQueue.size;
    console.log(`[CacheInvalidation] Added to lazy invalidation queue for ${rule.eventType}`);
  }

  private async scheduledInvalidation(rule: InvalidationRule, payload: any): Promise<void> {
    const delay = (rule.delay || 60) * 1000; // Convert to milliseconds
    const taskId = `${rule.eventType}-${Date.now()}`;

    const timeout = setTimeout(async () => {
      try {
        await this.immediateInvalidation(rule, payload);
        this.scheduledTasks.delete(taskId);
        this.metrics.scheduledInvalidations--;
        console.log(`[CacheInvalidation] Scheduled invalidation completed for ${rule.eventType}`);
      } catch (error) {
        console.error(`[CacheInvalidation] Scheduled invalidation failed for ${rule.eventType}:`, error);
      }
    }, delay);

    this.scheduledTasks.set(taskId, timeout);
    this.metrics.scheduledInvalidations++;
    
    console.log(`[CacheInvalidation] Scheduled invalidation for ${rule.eventType} in ${rule.delay || 60}s`);
  }

  private interpolatePatterns(patterns: string[], data: any): string[] {
    return patterns.map(pattern => {
      let interpolated = pattern;
      
      // Replace placeholders with actual values
      Object.entries(data).forEach(([key, value]) => {
        interpolated = interpolated.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
      });
      
      return interpolated;
    });
  }

  private async handleCacheHit(key: string): Promise<void> {
    // Check if key should be lazily invalidated
    const shouldInvalidate = Array.from(this.lazyQueue).some(pattern => {
      if (pattern.startsWith('tag:')) {
        // For tag-based invalidation, we'd need to check if key has this tag
        return false; // Simplified for now
      }
      return this.matchesPattern(key, pattern);
    });

    if (shouldInvalidate) {
      await this.processLazyInvalidation(key);
    }
  }

  private async handleCacheMiss(key: string): Promise<void> {
    // Remove from lazy queue if it was there (already invalidated)
    const patternsToRemove = Array.from(this.lazyQueue).filter(pattern => 
      this.matchesPattern(key, pattern)
    );
    
    for (const pattern of patternsToRemove) {
      this.lazyQueue.delete(pattern);
    }
    
    this.metrics.lazyInvalidationQueue = this.lazyQueue.size;
  }

  private matchesPattern(key: string, pattern: string): boolean {
    // Simple pattern matching with wildcards
    const regexPattern = pattern.replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(key);
  }

  private async processLazyInvalidation(key: string): Promise<void> {
    try {
      await this.cache.del(key);
      console.log(`[CacheInvalidation] Lazy invalidation processed for key: ${key}`);
    } catch (error) {
      console.error(`[CacheInvalidation] Error in lazy invalidation:`, error);
    }
  }

  private updateMetrics(strategy: string, duration: number, success: boolean): void {
    if (!this.config.enableMetrics) return;

    this.metrics.totalInvalidations++;
    this.metrics.invalidationsByStrategy[strategy]++;
    
    if (success) {
      this.metrics.successfulInvalidations++;
    } else {
      this.metrics.failedInvalidations++;
    }

    this.invalidationTimes.push(duration);
    
    // Calculate average invalidation time (keep last 1000 operations)
    if (this.invalidationTimes.length > 1000) {
      this.invalidationTimes = this.invalidationTimes.slice(-1000);
    }
    
    this.metrics.averageInvalidationTime = 
      this.invalidationTimes.reduce((sum, time) => sum + time, 0) / this.invalidationTimes.length;
  }

  // Manual invalidation methods
  public async invalidatePattern(pattern: string): Promise<number> {
    try {
      const deleted = await this.cache.invalidateByPattern(pattern);
      this.updateMetrics('immediate', 0, true);
      return deleted;
    } catch (error) {
      this.updateMetrics('immediate', 0, false);
      throw error;
    }
  }

  public async invalidateTag(tag: string): Promise<number> {
    try {
      const deleted = await this.cache.invalidateByTag(tag);
      this.updateMetrics('immediate', 0, true);
      return deleted;
    } catch (error) {
      this.updateMetrics('immediate', 0, false);
      throw error;
    }
  }

  public async invalidateKeys(keys: string[]): Promise<number> {
    try {
      const deleted = await this.cache.del(keys);
      this.updateMetrics('immediate', 0, true);
      return deleted;
    } catch (error) {
      this.updateMetrics('immediate', 0, false);
      throw error;
    }
  }

  // Batch processing for lazy invalidation
  public async processLazyQueue(): Promise<void> {
    if (this.lazyQueue.size === 0) return;

    console.log(`[CacheInvalidation] Processing ${this.lazyQueue.size} lazy invalidations`);
    
    const patterns = Array.from(this.lazyQueue);
    this.lazyQueue.clear();

    for (const pattern of patterns) {
      if (pattern.startsWith('tag:')) {
        const tag = pattern.substring(4);
        await this.cache.invalidateByTag(tag);
      } else {
        await this.cache.invalidateByPattern(pattern);
      }
    }

    this.metrics.lazyInvalidationQueue = 0;
  }

  // Configuration management
  public addRule(rule: InvalidationRule): void {
    if (!this.rules.has(rule.eventType)) {
      this.rules.set(rule.eventType, []);
      // Subscribe to new event type
      this.eventBus.subscribe(rule.eventType, this.handleEvent.bind(this));
    }
    
    this.rules.get(rule.eventType)!.push(rule);
  }

  public removeRule(eventType: string, ruleIndex?: number): boolean {
    const rules = this.rules.get(eventType);
    if (!rules) return false;

    if (ruleIndex !== undefined) {
      if (ruleIndex >= 0 && ruleIndex < rules.length) {
        rules.splice(ruleIndex, 1);
        return true;
      }
    } else {
      this.rules.delete(eventType);
      return true;
    }

    return false;
  }

  public getRules(): Record<string, InvalidationRule[]> {
    const result: Record<string, InvalidationRule[]> = {};
    for (const [eventType, rules] of this.rules.entries()) {
      result[eventType] = [...rules];
    }
    return result;
  }

  // Metrics and monitoring
  public getMetrics(): InvalidationMetrics {
    return { ...this.metrics };
  }

  public async cleanupScheduledTasks(): Promise<void> {
    for (const [taskId, timeout] of this.scheduledTasks.entries()) {
      clearTimeout(timeout);
      this.scheduledTasks.delete(taskId);
    }
    this.metrics.scheduledInvalidations = 0;
  }

  public async shutdown(): Promise<void> {
    await this.cleanupScheduledTasks();
    await this.processLazyQueue();
    console.log('[CacheInvalidation] Shutdown completed');
  }
}

// Predefined invalidation rules for common scenarios
export const INVALIDATION_RULES: InvalidationRule[] = [
  // User-related invalidations
  {
    eventType: EVENT_TYPES.USER.UPDATED,
    patterns: ['user:{userId}', 'user:profile:{userId}', 'user:sessions:{userId}'],
    tags: ['user-data'],
    strategy: 'immediate',
  },
  {
    eventType: EVENT_TYPES.USER.DELETED,
    patterns: ['user:{userId}*'],
    tags: ['user-data'],
    strategy: 'immediate',
  },
  {
    eventType: EVENT_TYPES.USER.LOGIN,
    patterns: ['user:sessions:{userId}'],
    strategy: 'immediate',
  },
  
  // AI-related invalidations
  {
    eventType: EVENT_TYPES.AI.AGENT_HEALTH_CHANGE,
    patterns: ['ai:agent:{agentId}', 'ai:agent:health:{agentId}', 'ai:routing:*'],
    tags: ['ai-routing'],
    strategy: 'immediate',
  },
  {
    eventType: EVENT_TYPES.AI.REQUEST_COMPLETE,
    patterns: ['ai:routing:{userId}:*'],
    strategy: 'lazy',
    delay: 300, // 5 minutes
  },
  
  // Billing-related invalidations
  {
    eventType: EVENT_TYPES.BILLING.CREDIT_CONSUMED,
    patterns: ['billing:credits:{userId}', 'billing:usage:{userId}:*'],
    strategy: 'immediate',
  },
  {
    eventType: EVENT_TYPES.BILLING.BUDGET_EXCEEDED,
    patterns: ['billing:*:{userId}'],
    tags: ['billing-data'],
    strategy: 'immediate',
  },
  
  // Plugin-related invalidations
  {
    eventType: EVENT_TYPES.PLUGIN.INSTALLED,
    patterns: ['plugins:installed:{userId}', 'plugins:marketplace:all'],
    strategy: 'immediate',
  },
  {
    eventType: EVENT_TYPES.PLUGIN.UNINSTALLED,
    patterns: ['plugins:installed:{userId}'],
    strategy: 'immediate',
  },
  
  // Notification-related invalidations
  {
    eventType: EVENT_TYPES.NOTIFICATION.PREFERENCE_UPDATED,
    patterns: ['notifications:prefs:{userId}'],
    strategy: 'immediate',
  },
];

// Factory function
export function createCacheInvalidation(config: InvalidationConfig): CacheInvalidation {
  return new CacheInvalidation(config);
}
