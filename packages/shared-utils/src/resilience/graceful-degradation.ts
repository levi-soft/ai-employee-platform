
import { logger } from '../logger';

export enum DegradationLevel {
  NONE = 0,
  MINOR = 1,
  MODERATE = 2,
  SEVERE = 3,
  CRITICAL = 4
}

export interface DegradationOptions {
  level: DegradationLevel;
  fallbackValue?: any;
  fallbackFunction?: () => Promise<any> | any;
  timeout?: number;
  maxRetries?: number;
  healthCheckInterval?: number;
  recoveryThreshold?: number;
  degradationThreshold?: number;
}

export interface ServiceHealth {
  isHealthy: boolean;
  degradationLevel: DegradationLevel;
  lastHealthCheck: Date;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  errorRate: number;
  responseTime: number;
  uptime: number;
  startTime: Date;
}

export class GracefulDegradation {
  private serviceHealth: ServiceHealth;
  private healthCheckTimer?: NodeJS.Timeout;
  private failureCount: number = 0;
  private successCount: number = 0;
  private responseTimes: number[] = [];
  private readonly maxResponseTimeHistory = 50;

  constructor(
    private readonly serviceName: string,
    private readonly healthCheckFunction: () => Promise<boolean>,
    private readonly options: DegradationOptions
  ) {
    this.serviceHealth = {
      isHealthy: true,
      degradationLevel: DegradationLevel.NONE,
      lastHealthCheck: new Date(),
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      errorRate: 0,
      responseTime: 0,
      uptime: 100,
      startTime: new Date()
    };

    this.startHealthMonitoring();
  }

  public async executeWithDegradation<T>(
    operation: () => Promise<T>,
    degradationOptions?: Partial<DegradationOptions>
  ): Promise<T> {
    const mergedOptions = { ...this.options, ...degradationOptions };
    const startTime = Date.now();

    try {
      // Check if service is severely degraded
      if (this.serviceHealth.degradationLevel >= DegradationLevel.SEVERE) {
        logger.warn(`Service ${this.serviceName} is severely degraded, using fallback`, {
          degradationLevel: this.serviceHealth.degradationLevel,
          health: this.serviceHealth
        });
        return this.getFallbackResponse<T>(mergedOptions);
      }

      // Execute with timeout if specified
      let result: T;
      if (mergedOptions.timeout) {
        result = await this.executeWithTimeout(operation, mergedOptions.timeout);
      } else {
        result = await operation();
      }

      // Record success
      this.recordSuccess(Date.now() - startTime);
      return result;

    } catch (error) {
      this.recordFailure();
      
      // Determine if we should use fallback based on degradation level
      const shouldUseFallback = this.shouldUseFallback(error as Error, mergedOptions);
      
      if (shouldUseFallback) {
        logger.warn(`Operation failed, using fallback for ${this.serviceName}`, {
          error: (error as Error).message,
          degradationLevel: this.serviceHealth.degradationLevel,
          health: this.serviceHealth
        });
        return this.getFallbackResponse<T>(mergedOptions);
      }

      throw error;
    }
  }

  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);

      operation()
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private shouldUseFallback(error: Error, options: DegradationOptions): boolean {
    // Always use fallback for critical degradation
    if (this.serviceHealth.degradationLevel >= DegradationLevel.CRITICAL) {
      return true;
    }

    // Use fallback for moderate degradation with certain error types
    if (this.serviceHealth.degradationLevel >= DegradationLevel.MODERATE) {
      // Check for timeout or network errors
      const errorMessage = error.message.toLowerCase();
      if (errorMessage.includes('timeout') || 
          errorMessage.includes('network') ||
          errorMessage.includes('connection')) {
        return true;
      }
    }

    // Use fallback if error rate is too high
    if (this.serviceHealth.errorRate > (options.degradationThreshold || 50)) {
      return true;
    }

    return false;
  }

  private getFallbackResponse<T>(options: DegradationOptions): T {
    if (options.fallbackFunction) {
      const result = options.fallbackFunction();
      return result instanceof Promise ? result : Promise.resolve(result);
    }

    if (options.fallbackValue !== undefined) {
      return options.fallbackValue;
    }

    // Default fallback responses based on degradation level
    switch (options.level) {
      case DegradationLevel.MINOR:
        return this.getMinorDegradationResponse<T>();
      case DegradationLevel.MODERATE:
        return this.getModerateDegradationResponse<T>();
      case DegradationLevel.SEVERE:
        return this.getSevereDegradationResponse<T>();
      case DegradationLevel.CRITICAL:
        return this.getCriticalDegradationResponse<T>();
      default:
        throw new Error(`No fallback available for ${this.serviceName}`);
    }
  }

  private getMinorDegradationResponse<T>(): T {
    return {
      success: true,
      data: null,
      message: 'Service is experiencing minor issues, limited functionality available',
      degradationLevel: DegradationLevel.MINOR
    } as T;
  }

  private getModerateDegradationResponse<T>(): T {
    return {
      success: true,
      data: null,
      message: 'Service is experiencing moderate issues, basic functionality only',
      degradationLevel: DegradationLevel.MODERATE
    } as T;
  }

  private getSevereDegradationResponse<T>(): T {
    return {
      success: false,
      data: null,
      message: 'Service is temporarily unavailable, please try again later',
      degradationLevel: DegradationLevel.SEVERE
    } as T;
  }

  private getCriticalDegradationResponse<T>(): T {
    return {
      success: false,
      data: null,
      message: 'Service is currently offline, please contact support',
      degradationLevel: DegradationLevel.CRITICAL
    } as T;
  }

  private recordSuccess(responseTime: number): void {
    this.successCount++;
    this.serviceHealth.consecutiveSuccesses++;
    this.serviceHealth.consecutiveFailures = 0;
    
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > this.maxResponseTimeHistory) {
      this.responseTimes.shift();
    }

    this.updateHealthMetrics();
    this.checkForRecovery();
  }

  private recordFailure(): void {
    this.failureCount++;
    this.serviceHealth.consecutiveFailures++;
    this.serviceHealth.consecutiveSuccesses = 0;
    
    this.updateHealthMetrics();
    this.checkForDegradation();
  }

  private updateHealthMetrics(): void {
    const totalRequests = this.successCount + this.failureCount;
    this.serviceHealth.errorRate = totalRequests > 0 
      ? (this.failureCount / totalRequests) * 100 
      : 0;

    this.serviceHealth.responseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length
      : 0;

    const uptime = Date.now() - this.serviceHealth.startTime.getTime();
    this.serviceHealth.uptime = totalRequests > 0 
      ? (this.successCount / totalRequests) * 100 
      : 100;
  }

  private checkForDegradation(): void {
    const oldLevel = this.serviceHealth.degradationLevel;
    let newLevel = DegradationLevel.NONE;

    const { consecutiveFailures, errorRate, responseTime } = this.serviceHealth;
    const degradationThreshold = this.options.degradationThreshold || 50;

    // Determine degradation level based on metrics
    if (consecutiveFailures >= 10 || errorRate >= 80 || responseTime >= 10000) {
      newLevel = DegradationLevel.CRITICAL;
    } else if (consecutiveFailures >= 7 || errorRate >= 60 || responseTime >= 5000) {
      newLevel = DegradationLevel.SEVERE;
    } else if (consecutiveFailures >= 5 || errorRate >= 40 || responseTime >= 3000) {
      newLevel = DegradationLevel.MODERATE;
    } else if (consecutiveFailures >= 3 || errorRate >= 20 || responseTime >= 1500) {
      newLevel = DegradationLevel.MINOR;
    }

    if (newLevel > oldLevel) {
      this.serviceHealth.degradationLevel = newLevel;
      this.serviceHealth.isHealthy = newLevel === DegradationLevel.NONE;
      
      logger.warn(`Service ${this.serviceName} degradation level increased`, {
        from: DegradationLevel[oldLevel],
        to: DegradationLevel[newLevel],
        health: this.serviceHealth
      });
    }
  }

  private checkForRecovery(): void {
    const oldLevel = this.serviceHealth.degradationLevel;
    const { consecutiveSuccesses, errorRate, responseTime } = this.serviceHealth;
    const recoveryThreshold = this.options.recoveryThreshold || 5;

    // Check if service has recovered
    if (consecutiveSuccesses >= recoveryThreshold && 
        errorRate < 10 && 
        responseTime < 1000) {
      
      if (oldLevel > DegradationLevel.NONE) {
        this.serviceHealth.degradationLevel = DegradationLevel.NONE;
        this.serviceHealth.isHealthy = true;
        
        logger.info(`Service ${this.serviceName} has recovered`, {
          from: DegradationLevel[oldLevel],
          to: DegradationLevel[DegradationLevel.NONE],
          health: this.serviceHealth
        });
      }
    }
  }

  private startHealthMonitoring(): void {
    const interval = this.options.healthCheckInterval || 30000; // 30 seconds
    
    this.healthCheckTimer = setInterval(async () => {
      try {
        const isHealthy = await this.healthCheckFunction();
        this.serviceHealth.lastHealthCheck = new Date();
        
        if (isHealthy) {
          this.recordSuccess(0); // Health check success
        } else {
          this.recordFailure(); // Health check failure
        }
      } catch (error) {
        logger.error(`Health check failed for ${this.serviceName}`, {
          error: (error as Error).message
        });
        this.recordFailure();
      }
    }, interval);
  }

  public getHealth(): ServiceHealth {
    return { ...this.serviceHealth };
  }

  public reset(): void {
    this.failureCount = 0;
    this.successCount = 0;
    this.responseTimes = [];
    this.serviceHealth = {
      isHealthy: true,
      degradationLevel: DegradationLevel.NONE,
      lastHealthCheck: new Date(),
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      errorRate: 0,
      responseTime: 0,
      uptime: 100,
      startTime: new Date()
    };
    
    logger.info(`Graceful degradation reset for ${this.serviceName}`);
  }

  public destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }
}

// Factory for managing graceful degradation instances
export class GracefulDegradationFactory {
  private static instances: Map<string, GracefulDegradation> = new Map();

  public static create(
    serviceName: string,
    healthCheckFunction: () => Promise<boolean>,
    options: Partial<DegradationOptions> = {}
  ): GracefulDegradation {
    if (this.instances.has(serviceName)) {
      return this.instances.get(serviceName)!;
    }

    const defaultOptions: DegradationOptions = {
      level: DegradationLevel.MODERATE,
      timeout: 5000,
      maxRetries: 3,
      healthCheckInterval: 30000,
      recoveryThreshold: 5,
      degradationThreshold: 50,
      ...options
    };

    const instance = new GracefulDegradation(serviceName, healthCheckFunction, defaultOptions);
    this.instances.set(serviceName, instance);
    
    return instance;
  }

  public static get(serviceName: string): GracefulDegradation | undefined {
    return this.instances.get(serviceName);
  }

  public static getHealthReport(): Record<string, ServiceHealth> {
    const report: Record<string, ServiceHealth> = {};
    
    for (const [name, instance] of this.instances.entries()) {
      report[name] = instance.getHealth();
    }
    
    return report;
  }

  public static destroyAll(): void {
    for (const instance of this.instances.values()) {
      instance.destroy();
    }
    this.instances.clear();
  }
}
