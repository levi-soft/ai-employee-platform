
import { RedisCache, CacheKeys } from './redis-cache';
import { PrismaClient } from '@prisma/client';

export interface CacheWarmingConfig {
  cache: RedisCache;
  prisma?: PrismaClient;
  strategies: WarmingStrategy[];
  schedule?: {
    enabled: boolean;
    interval: number; // minutes
    startTime?: string; // HH:mm format
  };
  batchSize?: number;
  concurrency?: number;
  enableMetrics?: boolean;
}

export interface WarmingStrategy {
  name: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  pattern: string;
  ttl?: number;
  condition?: () => boolean | Promise<boolean>;
  warmer: (cache: RedisCache, prisma?: PrismaClient) => Promise<WarmingResult>;
  schedule?: {
    frequency: 'startup' | 'daily' | 'hourly' | 'custom';
    interval?: number; // minutes (for custom frequency)
  };
}

export interface WarmingResult {
  strategy: string;
  keysWarmed: string[];
  duration: number;
  success: boolean;
  error?: string;
  dataSize: number;
  hitsPredicted?: number;
}

export interface WarmingMetrics {
  totalStrategies: number;
  strategiesExecuted: number;
  strategiesSuccessful: number;
  totalKeysWarmed: number;
  totalWarmingTime: number;
  averageWarmingTime: number;
  lastWarmingTime: Date | null;
  nextScheduledWarming: Date | null;
  strategyMetrics: Record<string, {
    executions: number;
    successRate: number;
    averageDuration: number;
    averageKeysWarmed: number;
    lastExecution: Date | null;
  }>;
}

export class CacheWarming {
  private cache: RedisCache;
  private prisma?: PrismaClient;
  private config: CacheWarmingConfig;
  private strategies: Map<string, WarmingStrategy> = new Map();
  private metrics: WarmingMetrics;
  private scheduledTasks: Map<string, NodeJS.Timeout> = new Map();
  private isWarming: boolean = false;

  constructor(config: CacheWarmingConfig) {
    this.config = {
      batchSize: 100,
      concurrency: 3,
      enableMetrics: true,
      ...config,
    };
    
    this.cache = config.cache;
    this.prisma = config.prisma;
    
    this.initializeMetrics();
    this.setupStrategies(config.strategies);
    this.setupScheduling();
  }

  private initializeMetrics(): void {
    this.metrics = {
      totalStrategies: 0,
      strategiesExecuted: 0,
      strategiesSuccessful: 0,
      totalKeysWarmed: 0,
      totalWarmingTime: 0,
      averageWarmingTime: 0,
      lastWarmingTime: null,
      nextScheduledWarming: null,
      strategyMetrics: {},
    };
  }

  private setupStrategies(strategies: WarmingStrategy[]): void {
    for (const strategy of strategies) {
      this.strategies.set(strategy.name, strategy);
      this.metrics.strategyMetrics[strategy.name] = {
        executions: 0,
        successRate: 0,
        averageDuration: 0,
        averageKeysWarmed: 0,
        lastExecution: null,
      };
    }
    
    this.metrics.totalStrategies = strategies.length;
  }

  private setupScheduling(): void {
    if (this.config.schedule?.enabled) {
      const interval = this.config.schedule.interval * 60 * 1000; // Convert to ms
      
      setInterval(() => {
        this.executeScheduledWarming();
      }, interval);
      
      // Schedule startup warming
      setTimeout(() => {
        this.warmUp(['startup']);
      }, 5000); // 5 seconds after initialization
    }
  }

  private async executeScheduledWarming(): Promise<void> {
    const now = new Date();
    const hour = now.getHours();
    
    // Determine which strategies to run based on schedule
    const strategiesToRun: string[] = [];
    
    for (const [name, strategy] of this.strategies.entries()) {
      const schedule = strategy.schedule;
      if (!schedule) continue;
      
      switch (schedule.frequency) {
        case 'hourly':
          strategiesToRun.push(name);
          break;
        case 'daily':
          if (hour === 2) { // Run daily warming at 2 AM
            strategiesToRun.push(name);
          }
          break;
        case 'custom':
          // Custom interval handling would go here
          break;
      }
    }
    
    if (strategiesToRun.length > 0) {
      await this.warmUp(strategiesToRun);
    }
  }

  public async warmUp(strategyNames?: string[]): Promise<WarmingResult[]> {
    if (this.isWarming) {
      console.log('[CacheWarming] Warming already in progress, skipping');
      return [];
    }

    this.isWarming = true;
    const results: WarmingResult[] = [];
    const startTime = Date.now();

    try {
      const strategies = strategyNames 
        ? strategyNames.map(name => this.strategies.get(name)).filter(Boolean) as WarmingStrategy[]
        : Array.from(this.strategies.values());

      // Sort strategies by priority
      const sortedStrategies = strategies.sort((a, b) => {
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });

      console.log(`[CacheWarming] Starting cache warming with ${sortedStrategies.length} strategies`);

      // Execute strategies with controlled concurrency
      const batches = this.createBatches(sortedStrategies, this.config.concurrency!);
      
      for (const batch of batches) {
        const batchPromises = batch.map(strategy => this.executeStrategy(strategy));
        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            results.push({
              strategy: batch[index].name,
              keysWarmed: [],
              duration: 0,
              success: false,
              error: result.reason?.message || 'Unknown error',
              dataSize: 0,
            });
          }
        });
      }

      this.updateOverallMetrics(results, Date.now() - startTime);
      console.log(`[CacheWarming] Completed warming in ${Date.now() - startTime}ms`);

    } catch (error) {
      console.error('[CacheWarming] Error during cache warming:', error);
    } finally {
      this.isWarming = false;
    }

    return results;
  }

  private async executeStrategy(strategy: WarmingStrategy): Promise<WarmingResult> {
    const startTime = Date.now();
    
    try {
      // Check condition if provided
      if (strategy.condition) {
        const shouldExecute = await strategy.condition();
        if (!shouldExecute) {
          return {
            strategy: strategy.name,
            keysWarmed: [],
            duration: 0,
            success: true,
            dataSize: 0,
            error: 'Condition not met, skipped',
          };
        }
      }

      console.log(`[CacheWarming] Executing strategy: ${strategy.name}`);
      const result = await strategy.warmer(this.cache, this.prisma);
      
      result.duration = Date.now() - startTime;
      result.strategy = strategy.name;
      
      this.updateStrategyMetrics(strategy.name, result);
      
      console.log(`[CacheWarming] Strategy ${strategy.name} completed: ${result.keysWarmed.length} keys in ${result.duration}ms`);
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const failureResult: WarmingResult = {
        strategy: strategy.name,
        keysWarmed: [],
        duration,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        dataSize: 0,
      };
      
      this.updateStrategyMetrics(strategy.name, failureResult);
      console.error(`[CacheWarming] Strategy ${strategy.name} failed:`, error);
      
      return failureResult;
    }
  }

  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  private updateStrategyMetrics(strategyName: string, result: WarmingResult): void {
    if (!this.config.enableMetrics) return;

    const metrics = this.metrics.strategyMetrics[strategyName];
    if (!metrics) return;

    metrics.executions++;
    metrics.lastExecution = new Date();
    
    // Update averages
    const prevSuccessCount = Math.floor(metrics.successRate * (metrics.executions - 1) / 100);
    const newSuccessCount = prevSuccessCount + (result.success ? 1 : 0);
    metrics.successRate = (newSuccessCount / metrics.executions) * 100;
    
    metrics.averageDuration = (metrics.averageDuration * (metrics.executions - 1) + result.duration) / metrics.executions;
    metrics.averageKeysWarmed = (metrics.averageKeysWarmed * (metrics.executions - 1) + result.keysWarmed.length) / metrics.executions;
  }

  private updateOverallMetrics(results: WarmingResult[], totalDuration: number): void {
    if (!this.config.enableMetrics) return;

    this.metrics.strategiesExecuted += results.length;
    this.metrics.strategiesSuccessful += results.filter(r => r.success).length;
    this.metrics.totalKeysWarmed += results.reduce((sum, r) => sum + r.keysWarmed.length, 0);
    this.metrics.totalWarmingTime += totalDuration;
    this.metrics.averageWarmingTime = this.metrics.totalWarmingTime / this.metrics.strategiesExecuted;
    this.metrics.lastWarmingTime = new Date();
  }

  // Strategy management
  public addStrategy(strategy: WarmingStrategy): void {
    this.strategies.set(strategy.name, strategy);
    this.metrics.strategyMetrics[strategy.name] = {
      executions: 0,
      successRate: 0,
      averageDuration: 0,
      averageKeysWarmed: 0,
      lastExecution: null,
    };
    this.metrics.totalStrategies++;
  }

  public removeStrategy(strategyName: string): boolean {
    if (this.strategies.has(strategyName)) {
      this.strategies.delete(strategyName);
      delete this.metrics.strategyMetrics[strategyName];
      this.metrics.totalStrategies--;
      return true;
    }
    return false;
  }

  public getStrategy(name: string): WarmingStrategy | undefined {
    return this.strategies.get(name);
  }

  public listStrategies(): WarmingStrategy[] {
    return Array.from(this.strategies.values());
  }

  // Metrics and monitoring
  public getMetrics(): WarmingMetrics {
    return { ...this.metrics };
  }

  public async getWarmingEstimate(strategyNames?: string[]): Promise<{
    estimatedDuration: number;
    estimatedKeys: number;
    strategies: string[];
  }> {
    const strategies = strategyNames 
      ? strategyNames.map(name => this.strategies.get(name)).filter(Boolean) as WarmingStrategy[]
      : Array.from(this.strategies.values());

    let estimatedDuration = 0;
    let estimatedKeys = 0;

    for (const strategy of strategies) {
      const metrics = this.metrics.strategyMetrics[strategy.name];
      if (metrics) {
        estimatedDuration += metrics.averageDuration;
        estimatedKeys += metrics.averageKeysWarmed;
      } else {
        // Default estimates for new strategies
        estimatedDuration += 5000; // 5 seconds
        estimatedKeys += 50;
      }
    }

    return {
      estimatedDuration,
      estimatedKeys,
      strategies: strategies.map(s => s.name),
    };
  }

  public async shutdown(): Promise<void> {
    // Clear scheduled tasks
    for (const [taskId, timeout] of this.scheduledTasks.entries()) {
      clearTimeout(timeout);
      this.scheduledTasks.delete(taskId);
    }
    
    console.log('[CacheWarming] Shutdown completed');
  }
}

// Predefined warming strategies
export const WARMING_STRATEGIES: WarmingStrategy[] = [
  {
    name: 'user-essential-data',
    priority: 'critical',
    pattern: 'user:*',
    ttl: 3600, // 1 hour
    schedule: { frequency: 'startup' },
    warmer: async (cache, prisma) => {
      const startTime = Date.now();
      const keysWarmed: string[] = [];
      
      if (!prisma) {
        return { strategy: 'user-essential-data', keysWarmed, duration: 0, success: false, error: 'Prisma not available', dataSize: 0 };
      }

      try {
        // Warm frequently accessed user data
        const activeUsers = await prisma.user.findMany({
          where: {
            isActive: true,
            lastLoginAt: {
              gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
            },
          },
          include: {
            creditAccount: true,
          },
          take: 100,
        });

        let dataSize = 0;
        for (const user of activeUsers) {
          const userKey = CacheKeys.user(user.id);
          const profileKey = CacheKeys.userProfile(user.id);
          const creditKey = CacheKeys.billing.credits(user.id);
          
          await cache.set(userKey, user, 3600);
          await cache.set(profileKey, user, 3600);
          if (user.creditAccount) {
            await cache.set(creditKey, user.creditAccount, 1800);
          }
          
          keysWarmed.push(userKey, profileKey, creditKey);
          dataSize += JSON.stringify(user).length;
        }

        return {
          strategy: 'user-essential-data',
          keysWarmed,
          duration: Date.now() - startTime,
          success: true,
          dataSize,
          hitsPredicted: activeUsers.length * 3,
        };
      } catch (error) {
        return {
          strategy: 'user-essential-data',
          keysWarmed,
          duration: Date.now() - startTime,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          dataSize: 0,
        };
      }
    },
  },

  {
    name: 'ai-agents-health',
    priority: 'high',
    pattern: 'ai:agent:*',
    ttl: 1800, // 30 minutes
    schedule: { frequency: 'hourly' },
    warmer: async (cache, prisma) => {
      const startTime = Date.now();
      const keysWarmed: string[] = [];
      
      if (!prisma) {
        return { strategy: 'ai-agents-health', keysWarmed, duration: 0, success: false, error: 'Prisma not available', dataSize: 0 };
      }

      try {
        const agents = await prisma.aIAgent.findMany({
          where: { isActive: true },
          take: 50,
        });

        let dataSize = 0;
        for (const agent of agents) {
          const agentKey = CacheKeys.ai.agent(agent.id);
          const healthKey = CacheKeys.ai.agentHealth(agent.id);
          
          await cache.set(agentKey, agent, 1800);
          
          // Mock health data (in real implementation, this would be actual health check)
          const healthData = {
            status: 'healthy',
            responseTime: Math.random() * 1000 + 200,
            lastCheck: new Date(),
            uptime: Math.random() * 100,
          };
          await cache.set(healthKey, healthData, 600);
          
          keysWarmed.push(agentKey, healthKey);
          dataSize += JSON.stringify(agent).length + JSON.stringify(healthData).length;
        }

        // Warm global capabilities cache
        const capabilitiesKey = CacheKeys.ai.capabilities();
        const capabilities = ['text-generation', 'code-generation', 'translation', 'summarization'];
        await cache.set(capabilitiesKey, capabilities, 3600);
        keysWarmed.push(capabilitiesKey);
        
        return {
          strategy: 'ai-agents-health',
          keysWarmed,
          duration: Date.now() - startTime,
          success: true,
          dataSize,
          hitsPredicted: agents.length * 5, // Each agent likely to be accessed 5 times
        };
      } catch (error) {
        return {
          strategy: 'ai-agents-health',
          keysWarmed,
          duration: Date.now() - startTime,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          dataSize: 0,
        };
      }
    },
  },

  {
    name: 'billing-frequent-data',
    priority: 'medium',
    pattern: 'billing:*',
    ttl: 1800,
    schedule: { frequency: 'daily' },
    condition: async () => {
      const hour = new Date().getHours();
      return hour >= 9 && hour <= 17; // Only during business hours
    },
    warmer: async (cache, prisma) => {
      const startTime = Date.now();
      const keysWarmed: string[] = [];
      
      if (!prisma) {
        return { strategy: 'billing-frequent-data', keysWarmed, duration: 0, success: false, error: 'Prisma not available', dataSize: 0 };
      }

      try {
        // Warm credit account data for active users
        const recentTransactions = await prisma.transaction.groupBy({
          by: ['userId'],
          where: {
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
            },
          },
          _count: {
            id: true,
          },
          orderBy: {
            _count: {
              id: 'desc',
            },
          },
          take: 50,
        });

        let dataSize = 0;
        for (const group of recentTransactions) {
          const creditAccount = await prisma.creditAccount.findUnique({
            where: { userId: group.userId },
          });
          
          if (creditAccount) {
            const creditKey = CacheKeys.billing.credits(group.userId);
            await cache.set(creditKey, creditAccount, 1800);
            keysWarmed.push(creditKey);
            dataSize += JSON.stringify(creditAccount).length;
          }
        }

        return {
          strategy: 'billing-frequent-data',
          keysWarmed,
          duration: Date.now() - startTime,
          success: true,
          dataSize,
          hitsPredicted: Math.floor(keysWarmed.length * 1.5),
        };
      } catch (error) {
        return {
          strategy: 'billing-frequent-data',
          keysWarmed,
          duration: Date.now() - startTime,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          dataSize: 0,
        };
      }
    },
  },

  {
    name: 'plugin-marketplace',
    priority: 'low',
    pattern: 'plugins:*',
    ttl: 7200, // 2 hours
    schedule: { frequency: 'daily' },
    warmer: async (cache, prisma) => {
      const startTime = Date.now();
      const keysWarmed: string[] = [];
      
      if (!prisma) {
        return { strategy: 'plugin-marketplace', keysWarmed, duration: 0, success: false, error: 'Prisma not available', dataSize: 0 };
      }

      try {
        // Warm marketplace data
        const plugins = await prisma.plugin.findMany({
          where: { isActive: true },
          orderBy: { downloadCount: 'desc' },
          take: 100,
        });

        const marketplaceKey = CacheKeys.plugins.marketplace();
        await cache.set(marketplaceKey, plugins, 7200);
        keysWarmed.push(marketplaceKey);

        let dataSize = JSON.stringify(plugins).length;

        // Warm individual plugin data for popular plugins
        const popularPlugins = plugins.slice(0, 20);
        for (const plugin of popularPlugins) {
          const pluginKey = CacheKeys.plugins.plugin(plugin.id);
          await cache.set(pluginKey, plugin, 3600);
          keysWarmed.push(pluginKey);
          dataSize += JSON.stringify(plugin).length;
        }

        return {
          strategy: 'plugin-marketplace',
          keysWarmed,
          duration: Date.now() - startTime,
          success: true,
          dataSize,
          hitsPredicted: Math.floor(plugins.length * 0.3), // 30% of plugins likely to be accessed
        };
      } catch (error) {
        return {
          strategy: 'plugin-marketplace',
          keysWarmed,
          duration: Date.now() - startTime,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          dataSize: 0,
        };
      }
    },
  },
];

// Factory function
export function createCacheWarming(config: CacheWarmingConfig): CacheWarming {
  return new CacheWarming(config);
}
