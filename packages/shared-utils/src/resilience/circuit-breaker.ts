
import { logger } from '../logger';

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
  expectedExceptionPredicate?: (error: Error) => boolean;
  onStateChange?: (from: CircuitBreakerState, to: CircuitBreakerState) => void;
  onCallSuccess?: (executionTime: number) => void;
  onCallFailure?: (error: Error, executionTime: number) => void;
}

export interface CircuitBreakerStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  currentState: CircuitBreakerState;
  failureRate: number;
  averageExecutionTime: number;
}

export class CircuitBreaker<T = any> {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime?: Date;
  private nextAttempt?: Date;
  private stats: CircuitBreakerStats;
  private executionTimes: number[] = [];
  private readonly maxExecutionTimesTracked = 100;

  constructor(
    private readonly service: (...args: any[]) => Promise<T>,
    private readonly options: CircuitBreakerOptions,
    private readonly serviceName: string = 'UnknownService'
  ) {
    this.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      currentState: this.state,
      failureRate: 0,
      averageExecutionTime: 0
    };
  }

  public async execute(...args: any[]): Promise<T> {
    const startTime = Date.now();
    this.stats.totalCalls++;

    // Check if circuit is open
    if (this.state === CircuitBreakerState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.onStateChange(CircuitBreakerState.OPEN, CircuitBreakerState.HALF_OPEN);
        logger.info(`Circuit breaker for ${this.serviceName} moved to HALF_OPEN state`);
      } else {
        throw new Error(`Circuit breaker for ${this.serviceName} is OPEN. Next attempt at: ${this.nextAttempt?.toISOString()}`);
      }
    }

    try {
      const result = await this.service(...args);
      this.onSuccess(Date.now() - startTime);
      return result;
    } catch (error) {
      this.onFailure(error as Error, Date.now() - startTime);
      throw error;
    }
  }

  private onSuccess(executionTime: number): void {
    this.stats.successfulCalls++;
    this.recordExecutionTime(executionTime);
    
    this.options.onCallSuccess?.(executionTime);

    // Reset failure count on success
    this.failureCount = 0;
    this.stats.lastSuccessTime = new Date();

    // If we were in HALF_OPEN state and succeeded, close the circuit
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.state = CircuitBreakerState.CLOSED;
      this.onStateChange(CircuitBreakerState.HALF_OPEN, CircuitBreakerState.CLOSED);
      logger.info(`Circuit breaker for ${this.serviceName} moved to CLOSED state after successful call`);
    }

    this.updateStats();
  }

  private onFailure(error: Error, executionTime: number): void {
    this.stats.failedCalls++;
    this.recordExecutionTime(executionTime);
    
    this.options.onCallFailure?.(error, executionTime);

    // Check if this is an expected exception that shouldn't trip the circuit
    if (this.options.expectedExceptionPredicate && this.options.expectedExceptionPredicate(error)) {
      this.updateStats();
      return;
    }

    this.failureCount++;
    this.lastFailureTime = new Date();
    this.stats.lastFailureTime = this.lastFailureTime;

    // Check if we should open the circuit
    if (this.failureCount >= this.options.failureThreshold) {
      const previousState = this.state;
      this.state = CircuitBreakerState.OPEN;
      this.nextAttempt = new Date(Date.now() + this.options.resetTimeout);
      
      if (previousState !== CircuitBreakerState.OPEN) {
        this.onStateChange(previousState, CircuitBreakerState.OPEN);
        logger.warn(`Circuit breaker for ${this.serviceName} opened due to ${this.failureCount} failures`);
      }
    }

    this.updateStats();
  }

  private shouldAttemptReset(): boolean {
    return this.nextAttempt ? Date.now() >= this.nextAttempt.getTime() : false;
  }

  private onStateChange(from: CircuitBreakerState, to: CircuitBreakerState): void {
    this.stats.currentState = to;
    this.options.onStateChange?.(from, to);
    
    logger.info(`Circuit breaker for ${this.serviceName} state changed`, {
      from,
      to,
      failureCount: this.failureCount,
      stats: this.stats
    });
  }

  private recordExecutionTime(time: number): void {
    this.executionTimes.push(time);
    
    // Keep only the latest execution times
    if (this.executionTimes.length > this.maxExecutionTimesTracked) {
      this.executionTimes = this.executionTimes.slice(-this.maxExecutionTimesTracked);
    }
  }

  private updateStats(): void {
    this.stats.failureRate = this.stats.totalCalls > 0 
      ? (this.stats.failedCalls / this.stats.totalCalls) * 100 
      : 0;

    this.stats.averageExecutionTime = this.executionTimes.length > 0
      ? this.executionTimes.reduce((sum, time) => sum + time, 0) / this.executionTimes.length
      : 0;
  }

  public getStats(): CircuitBreakerStats {
    return { ...this.stats };
  }

  public getCurrentState(): CircuitBreakerState {
    return this.state;
  }

  public reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = undefined;
    this.nextAttempt = undefined;
    
    logger.info(`Circuit breaker for ${this.serviceName} has been reset`);
  }

  public forceOpen(): void {
    const previousState = this.state;
    this.state = CircuitBreakerState.OPEN;
    this.nextAttempt = new Date(Date.now() + this.options.resetTimeout);
    this.onStateChange(previousState, CircuitBreakerState.OPEN);
    
    logger.warn(`Circuit breaker for ${this.serviceName} has been forced open`);
  }

  public forceClose(): void {
    const previousState = this.state;
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.nextAttempt = undefined;
    this.onStateChange(previousState, CircuitBreakerState.CLOSED);
    
    logger.info(`Circuit breaker for ${this.serviceName} has been forced closed`);
  }
}

// Circuit breaker factory
export class CircuitBreakerFactory {
  private static breakers: Map<string, CircuitBreaker> = new Map();

  public static create<T>(
    name: string,
    service: (...args: any[]) => Promise<T>,
    options: Partial<CircuitBreakerOptions> = {}
  ): CircuitBreaker<T> {
    if (this.breakers.has(name)) {
      return this.breakers.get(name) as CircuitBreaker<T>;
    }

    const defaultOptions: CircuitBreakerOptions = {
      failureThreshold: 5,
      resetTimeout: 60000, // 1 minute
      monitoringPeriod: 10000, // 10 seconds
      expectedExceptionPredicate: () => false,
      ...options
    };

    const breaker = new CircuitBreaker<T>(service, defaultOptions, name);
    this.breakers.set(name, breaker);
    
    return breaker;
  }

  public static get(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  public static getAll(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  public static remove(name: string): boolean {
    return this.breakers.delete(name);
  }

  public static clear(): void {
    this.breakers.clear();
  }

  public static getHealthReport(): Record<string, CircuitBreakerStats> {
    const report: Record<string, CircuitBreakerStats> = {};
    
    for (const [name, breaker] of this.breakers.entries()) {
      report[name] = breaker.getStats();
    }
    
    return report;
  }
}

// Decorator for automatic circuit breaker wrapping
export function withCircuitBreaker(
  name: string,
  options: Partial<CircuitBreakerOptions> = {}
) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    
    descriptor.value = function (...args: any[]) {
      const breaker = CircuitBreakerFactory.create(
        `${target.constructor.name}.${propertyName}`,
        method.bind(this),
        options
      );
      
      return breaker.execute(...args);
    };
    
    return descriptor;
  };
}
