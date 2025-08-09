
import { createLogger } from '@ai-platform/shared-utils';
import { BaseProvider } from '../integrations/base-provider';
import { ProviderHealth } from '../types/ai.types';

const logger = createLogger('health-monitor');

export interface HealthMonitorConfig {
  checkInterval?: number; // in milliseconds
  unhealthyThreshold?: number;
  degradedThreshold?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export class HealthMonitorService {
  private config: HealthMonitorConfig;
  private providers: Map<string, BaseProvider> = new Map();
  private healthStatus: Map<string, ProviderHealth> = new Map();
  private healthHistory: Map<string, ProviderHealth[]> = new Map();
  private monitoring: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;

  constructor(config: HealthMonitorConfig = {}) {
    this.config = {
      checkInterval: 30000, // 30 seconds
      unhealthyThreshold: 5000, // 5 seconds
      degradedThreshold: 2000, // 2 seconds
      retryAttempts: 3,
      retryDelay: 1000,
      ...config,
    };

    logger.info('Health Monitor Service initialized', {
      checkInterval: this.config.checkInterval,
      thresholds: {
        unhealthy: this.config.unhealthyThreshold,
        degraded: this.config.degradedThreshold,
      },
    });
  }

  registerProvider(provider: BaseProvider): void {
    const providerId = provider.getProviderId();
    this.providers.set(providerId, provider);
    
    // Initialize health status
    this.healthStatus.set(providerId, {
      providerId,
      status: 'offline',
      responseTime: 0,
      lastCheck: new Date().toISOString(),
    });
    
    // Initialize health history
    this.healthHistory.set(providerId, []);

    logger.info('Provider registered with health monitor', {
      providerId,
      providerName: provider.getProviderName(),
    });

    // Perform initial health check
    this.checkProviderHealth(providerId);
  }

  unregisterProvider(providerId: string): void {
    this.providers.delete(providerId);
    this.healthStatus.delete(providerId);
    this.healthHistory.delete(providerId);

    logger.info('Provider unregistered from health monitor', { providerId });
  }

  startMonitoring(): void {
    if (this.monitoring) {
      logger.warn('Health monitoring already started');
      return;
    }

    this.monitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.config.checkInterval);

    logger.info('Health monitoring started', {
      interval: this.config.checkInterval,
      providersCount: this.providers.size,
    });

    // Perform initial health checks
    this.performHealthChecks();
  }

  stopMonitoring(): void {
    if (!this.monitoring) {
      return;
    }

    this.monitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    logger.info('Health monitoring stopped');
  }

  getProviderHealth(providerId: string): ProviderHealth | undefined {
    return this.healthStatus.get(providerId);
  }

  getAllProviderHealth(): Map<string, ProviderHealth> {
    return new Map(this.healthStatus);
  }

  getHealthyProviders(): string[] {
    const healthyProviders: string[] = [];
    
    for (const [providerId, health] of this.healthStatus) {
      if (health.status === 'healthy') {
        healthyProviders.push(providerId);
      }
    }

    return healthyProviders;
  }

  getProviderHealthHistory(providerId: string, limit: number = 10): ProviderHealth[] {
    const history = this.healthHistory.get(providerId) || [];
    return history.slice(-limit);
  }

  isProviderHealthy(providerId: string): boolean {
    const health = this.healthStatus.get(providerId);
    return health?.status === 'healthy';
  }

  getHealthSummary(): {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
    offline: number;
    uptime: number;
  } {
    const summary = {
      total: 0,
      healthy: 0,
      degraded: 0,
      unhealthy: 0,
      offline: 0,
      uptime: 0,
    };

    for (const health of this.healthStatus.values()) {
      summary.total++;
      
      switch (health.status) {
        case 'healthy':
          summary.healthy++;
          break;
        case 'degraded':
          summary.degraded++;
          break;
        case 'unhealthy':
          summary.unhealthy++;
          break;
        case 'offline':
          summary.offline++;
          break;
      }
    }

    // Calculate uptime percentage (healthy + degraded)
    if (summary.total > 0) {
      summary.uptime = ((summary.healthy + summary.degraded) / summary.total) * 100;
    }

    return summary;
  }

  async checkProviderHealth(providerId: string): Promise<ProviderHealth> {
    const provider = this.providers.get(providerId);
    
    if (!provider) {
      const offlineHealth: ProviderHealth = {
        providerId,
        status: 'offline',
        responseTime: 0,
        lastCheck: new Date().toISOString(),
        details: { error: 'Provider not found' },
      };
      
      this.updateProviderHealth(providerId, offlineHealth);
      return offlineHealth;
    }

    const startTime = Date.now();
    let attempts = 0;
    let lastError: any;

    while (attempts < (this.config.retryAttempts || 3)) {
      try {
        attempts++;
        
        const healthResult = await provider.healthCheck();
        const responseTime = Date.now() - startTime;
        
        // Determine status based on response time and health check result
        let status: ProviderHealth['status'] = 'healthy';
        
        if (healthResult.status === 'unhealthy') {
          status = 'unhealthy';
        } else if (healthResult.status === 'degraded' || responseTime > (this.config.unhealthyThreshold || 5000)) {
          status = 'unhealthy';
        } else if (responseTime > (this.config.degradedThreshold || 2000)) {
          status = 'degraded';
        }

        const health: ProviderHealth = {
          providerId,
          status,
          responseTime,
          lastCheck: new Date().toISOString(),
          details: {
            attempts,
            ...healthResult.details,
          },
        };

        this.updateProviderHealth(providerId, health);
        
        logger.debug('Provider health check completed', {
          providerId,
          status,
          responseTime,
          attempts,
        });

        return health;
      } catch (error) {
        lastError = error;
        
        if (attempts < (this.config.retryAttempts || 3)) {
          logger.warn('Health check attempt failed, retrying', {
            providerId,
            attempt: attempts,
            error: error.message,
          });
          
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelay || 1000));
        }
      }
    }

    // All attempts failed
    const responseTime = Date.now() - startTime;
    const health: ProviderHealth = {
      providerId,
      status: 'unhealthy',
      responseTime,
      lastCheck: new Date().toISOString(),
      details: {
        error: lastError?.message || 'Unknown error',
        attempts,
      },
    };

    this.updateProviderHealth(providerId, health);
    
    logger.error('Provider health check failed after all attempts', {
      providerId,
      attempts,
      error: lastError?.message,
    });

    return health;
  }

  private async performHealthChecks(): Promise<void> {
    const checkPromises: Promise<ProviderHealth>[] = [];

    for (const providerId of this.providers.keys()) {
      checkPromises.push(this.checkProviderHealth(providerId));
    }

    try {
      await Promise.all(checkPromises);
      
      const summary = this.getHealthSummary();
      logger.debug('Health checks completed', {
        totalProviders: summary.total,
        healthy: summary.healthy,
        degraded: summary.degraded,
        unhealthy: summary.unhealthy,
        offline: summary.offline,
        uptime: `${summary.uptime.toFixed(1)}%`,
      });
    } catch (error) {
      logger.error('Error during health checks', { error: error.message });
    }
  }

  private updateProviderHealth(providerId: string, health: ProviderHealth): void {
    // Update current status
    this.healthStatus.set(providerId, health);

    // Update history
    const history = this.healthHistory.get(providerId) || [];
    history.push(health);
    
    // Keep only last 100 health checks
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
    
    this.healthHistory.set(providerId, history);

    // Log status changes
    const previousHealth = history[history.length - 2];
    if (previousHealth && previousHealth.status !== health.status) {
      logger.info('Provider health status changed', {
        providerId,
        previousStatus: previousHealth.status,
        newStatus: health.status,
        responseTime: health.responseTime,
      });
    }
  }
}

export default HealthMonitorService;
