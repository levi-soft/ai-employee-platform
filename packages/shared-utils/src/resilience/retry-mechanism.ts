
import { logger } from '../logger';

export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay?: number;
  backoffFactor?: number;
  jitter?: boolean;
  retryCondition?: (error: Error, attempt: number) => boolean;
  onRetry?: (error: Error, attempt: number, delay: number) => void;
  onSuccess?: (attempt: number, totalTime: number) => void;
  onMaxAttemptsReached?: (error: Error, attempts: number, totalTime: number) => void;
}

export interface RetryStats {
  totalAttempts: number;
  successfulRetries: number;
  failedRetries: number;
  averageAttempts: number;
  averageRetryTime: number;
  lastRetryTime?: Date;
}

export class RetryMechanism {
  private stats: RetryStats = {
    totalAttempts: 0,
    successfulRetries: 0,
    failedRetries: 0,
    averageAttempts: 0,
    averageRetryTime: 0
  };
  
  private attemptHistory: number[] = [];
  private timeHistory: number[] = [];
  private readonly maxHistorySize = 100;

  constructor(
    private readonly serviceName: string = 'UnknownService'
  ) {}

  public async execute<T>(
    operation: () => Promise<T>,
    options: RetryOptions
  ): Promise<T> {
    const startTime = Date.now();
    let lastError: Error;
    let attempt = 0;

    const defaultRetryCondition = (error: Error, attempt: number) => {
      // Don't retry on validation errors (400), authorization errors (401, 403), not found (404)
      if (error instanceof Error && (error as any).statusCode) {
        const statusCode = (error as any).statusCode;
        if (statusCode >= 400 && statusCode < 500) {
          return false;
        }
      }
      return true;
    };

    const retryCondition = options.retryCondition || defaultRetryCondition;

    for (attempt = 1; attempt <= options.maxAttempts; attempt++) {
      try {
        const result = await operation();
        
        // Record successful execution
        const totalTime = Date.now() - startTime;
        this.recordSuccess(attempt, totalTime);
        options.onSuccess?.(attempt, totalTime);
        
        if (attempt > 1) {
          logger.info(`Operation succeeded on attempt ${attempt}`, {
            service: this.serviceName,
            attempts: attempt,
            totalTime,
            stats: this.getStats()
          });
        }
        
        return result;
      } catch (error) {
        lastError = error as Error;
        
        // Check if we should retry
        if (attempt === options.maxAttempts || !retryCondition(lastError, attempt)) {
          break;
        }
        
        // Calculate delay
        const delay = this.calculateDelay(attempt, options);
        
        // Record retry attempt
        this.recordRetry();
        options.onRetry?.(lastError, attempt, delay);
        
        logger.warn(`Operation failed, retrying in ${delay}ms`, {
          service: this.serviceName,
          attempt,
          maxAttempts: options.maxAttempts,
          error: lastError.message,
          delay
        });
        
        // Wait before retry
        await this.delay(delay);
      }
    }

    // All attempts failed
    const totalTime = Date.now() - startTime;
    this.recordFailure(attempt, totalTime);
    options.onMaxAttemptsReached?.(lastError!, attempt - 1, totalTime);
    
    logger.error(`Operation failed after ${attempt - 1} attempts`, {
      service: this.serviceName,
      attempts: attempt - 1,
      totalTime,
      finalError: lastError!.message,
      stats: this.getStats()
    });
    
    throw lastError!;
  }

  private calculateDelay(attempt: number, options: RetryOptions): number {
    const backoffFactor = options.backoffFactor || 2;
    let delay = options.baseDelay * Math.pow(backoffFactor, attempt - 1);
    
    // Apply maximum delay if specified
    if (options.maxDelay && delay > options.maxDelay) {
      delay = options.maxDelay;
    }
    
    // Apply jitter to prevent thundering herd
    if (options.jitter) {
      const jitterAmount = delay * 0.1; // 10% jitter
      delay = delay + (Math.random() * 2 - 1) * jitterAmount;
    }
    
    return Math.max(delay, 0);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private recordSuccess(attempts: number, totalTime: number): void {
    this.stats.totalAttempts++;
    if (attempts > 1) {
      this.stats.successfulRetries++;
    }
    this.updateAverages(attempts, totalTime);
  }

  private recordRetry(): void {
    this.stats.lastRetryTime = new Date();
  }

  private recordFailure(attempts: number, totalTime: number): void {
    this.stats.totalAttempts++;
    this.stats.failedRetries++;
    this.updateAverages(attempts, totalTime);
  }

  private updateAverages(attempts: number, totalTime: number): void {
    // Track attempt history
    this.attemptHistory.push(attempts);
    this.timeHistory.push(totalTime);
    
    // Keep only recent history
    if (this.attemptHistory.length > this.maxHistorySize) {
      this.attemptHistory = this.attemptHistory.slice(-this.maxHistorySize);
      this.timeHistory = this.timeHistory.slice(-this.maxHistorySize);
    }
    
    // Calculate averages
    this.stats.averageAttempts = this.attemptHistory.length > 0
      ? this.attemptHistory.reduce((sum, val) => sum + val, 0) / this.attemptHistory.length
      : 0;
    
    this.stats.averageRetryTime = this.timeHistory.length > 0
      ? this.timeHistory.reduce((sum, val) => sum + val, 0) / this.timeHistory.length
      : 0;
  }

  public getStats(): RetryStats {
    return { ...this.stats };
  }

  public reset(): void {
    this.stats = {
      totalAttempts: 0,
      successfulRetries: 0,
      failedRetries: 0,
      averageAttempts: 0,
      averageRetryTime: 0
    };
    this.attemptHistory = [];
    this.timeHistory = [];
    
    logger.info(`Retry mechanism stats reset for ${this.serviceName}`);
  }
}

// Retry factory for managing multiple retry instances
export class RetryFactory {
  private static retryInstances: Map<string, RetryMechanism> = new Map();

  public static getInstance(serviceName: string): RetryMechanism {
    if (!this.retryInstances.has(serviceName)) {
      this.retryInstances.set(serviceName, new RetryMechanism(serviceName));
    }
    return this.retryInstances.get(serviceName)!;
  }

  public static getStats(): Record<string, RetryStats> {
    const stats: Record<string, RetryStats> = {};
    for (const [name, instance] of this.retryInstances.entries()) {
      stats[name] = instance.getStats();
    }
    return stats;
  }

  public static resetAll(): void {
    for (const instance of this.retryInstances.values()) {
      instance.reset();
    }
  }
}

// Helper function for common retry patterns
export async function withRetry<T>(
  operation: () => Promise<T>,
  serviceName: string,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const defaultOptions: RetryOptions = {
    maxAttempts: 3,
    baseDelay: 1000, // 1 second
    backoffFactor: 2,
    jitter: true,
    ...options
  };

  const retryInstance = RetryFactory.getInstance(serviceName);
  return retryInstance.execute(operation, defaultOptions);
}

// Predefined retry conditions
export const RetryConditions = {
  // Only retry on network/server errors
  networkErrors: (error: Error) => {
    if ((error as any).code === 'ECONNRESET' || 
        (error as any).code === 'ENOTFOUND' || 
        (error as any).code === 'ECONNREFUSED') {
      return true;
    }
    
    const statusCode = (error as any).statusCode;
    return statusCode >= 500 || statusCode === 429; // Server errors and rate limits
  },
  
  // Retry on specific HTTP status codes
  httpRetryable: (error: Error) => {
    const statusCode = (error as any).statusCode;
    // 429 (Too Many Requests), 502 (Bad Gateway), 503 (Service Unavailable), 504 (Gateway Timeout)
    return [429, 502, 503, 504].includes(statusCode);
  },
  
  // Never retry (for operations that should not be retried)
  never: () => false,
  
  // Always retry up to max attempts
  always: () => true
};

// Decorator for automatic retry wrapping
export function withRetryDecorator(
  serviceName?: string,
  options: Partial<RetryOptions> = {}
) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    const name = serviceName || `${target.constructor.name}.${propertyName}`;
    
    descriptor.value = function (...args: any[]) {
      return withRetry(
        () => method.apply(this, args),
        name,
        options
      );
    };
    
    return descriptor;
  };
}
