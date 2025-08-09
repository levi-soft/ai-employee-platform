
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  jitterRange: number;
  adaptiveFactor: number;
  timeoutFactor: number;
  enableLearning: boolean;
  successThreshold: number;
}

export interface RetryContext {
  requestId: string;
  operation: string;
  provider?: string;
  agent?: string;
  userId?: string;
  attempt: number;
  maxAttempts: number;
  startTime: number;
  lastAttemptTime: number;
  error?: any;
  metadata: Record<string, any>;
}

export interface RetryResult {
  success: boolean;
  data?: any;
  error?: any;
  attempts: number;
  totalDuration: number;
  strategyUsed: string;
  shouldRetry: boolean;
  nextDelay?: number;
  metadata: Record<string, any>;
}

export interface RetryStrategy {
  id: string;
  name: string;
  calculateDelay: (context: RetryContext) => number;
  shouldRetry: (context: RetryContext) => boolean;
  adapt: (context: RetryContext, success: boolean) => void;
}

export interface RetryLearning {
  operation: string;
  provider?: string;
  successRate: number;
  averageAttempts: number;
  averageDelay: number;
  lastUpdated: Date;
  sampleSize: number;
  adaptedMultiplier: number;
  adaptedBaseDelay: number;
}

export class IntelligentRetryService extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: RetryConfig;
  private retryStrategies: Map<string, RetryStrategy> = new Map();
  private learningData: Map<string, RetryLearning> = new Map();
  private activeRetries: Map<string, RetryContext> = new Map();
  
  private metrics = {
    totalRetries: 0,
    successfulRetries: 0,
    failedRetries: 0,
    averageAttempts: 0,
    averageDelay: 0,
    strategiesUsed: new Map<string, number>(),
    learningUpdates: 0,
    adaptations: 0
  };

  constructor(config: Partial<RetryConfig> = {}) {
    super();
    this.logger = new Logger('IntelligentRetryService');
    this.config = {
      maxRetries: 5,
      baseDelay: 1000,
      maxDelay: 32000,
      backoffMultiplier: 2,
      jitter: true,
      jitterRange: 0.1,
      adaptiveFactor: 0.1,
      timeoutFactor: 1.5,
      enableLearning: true,
      successThreshold: 0.7,
      ...config
    };

    this.initializeStrategies();
    this.startLearningCleanup();
  }

  /**
   * Initialize retry strategies
   */
  private initializeStrategies(): void {
    // Exponential backoff strategy
    this.registerStrategy({
      id: 'exponential',
      name: 'Exponential Backoff',
      calculateDelay: (context) => this.calculateExponentialDelay(context),
      shouldRetry: (context) => this.shouldRetryExponential(context),
      adapt: (context, success) => this.adaptExponential(context, success)
    });

    // Linear backoff strategy
    this.registerStrategy({
      id: 'linear',
      name: 'Linear Backoff',
      calculateDelay: (context) => this.calculateLinearDelay(context),
      shouldRetry: (context) => this.shouldRetryLinear(context),
      adapt: (context, success) => this.adaptLinear(context, success)
    });

    // Fixed interval strategy
    this.registerStrategy({
      id: 'fixed',
      name: 'Fixed Interval',
      calculateDelay: (context) => this.calculateFixedDelay(context),
      shouldRetry: (context) => this.shouldRetryFixed(context),
      adapt: (context, success) => this.adaptFixed(context, success)
    });

    // Adaptive strategy based on learning
    this.registerStrategy({
      id: 'adaptive',
      name: 'Adaptive Learning',
      calculateDelay: (context) => this.calculateAdaptiveDelay(context),
      shouldRetry: (context) => this.shouldRetryAdaptive(context),
      adapt: (context, success) => this.adaptAdaptive(context, success)
    });

    // Fibonacci backoff strategy
    this.registerStrategy({
      id: 'fibonacci',
      name: 'Fibonacci Backoff',
      calculateDelay: (context) => this.calculateFibonacciDelay(context),
      shouldRetry: (context) => this.shouldRetryFibonacci(context),
      adapt: (context, success) => this.adaptFibonacci(context, success)
    });
  }

  /**
   * Register a custom retry strategy
   */
  registerStrategy(strategy: RetryStrategy): void {
    this.retryStrategies.set(strategy.id, strategy);
    this.logger.info(`Registered retry strategy: ${strategy.name}`, {
      strategyId: strategy.id
    });
  }

  /**
   * Execute intelligent retry with learning
   */
  async retry<T>(
    operation: () => Promise<T>,
    options: {
      requestId: string;
      operationType: string;
      provider?: string;
      agent?: string;
      userId?: string;
      strategyId?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<RetryResult & { data?: T }> {
    const startTime = Date.now();
    const context: RetryContext = {
      requestId: options.requestId,
      operation: options.operationType,
      provider: options.provider,
      agent: options.agent,
      userId: options.userId,
      attempt: 0,
      maxAttempts: this.config.maxRetries + 1,
      startTime,
      lastAttemptTime: startTime,
      metadata: options.metadata || {}
    };

    // Select strategy
    const strategyId = options.strategyId || this.selectBestStrategy(context);
    const strategy = this.retryStrategies.get(strategyId);
    
    if (!strategy) {
      throw new Error(`Unknown retry strategy: ${strategyId}`);
    }

    this.activeRetries.set(options.requestId, context);
    this.metrics.totalRetries++;

    this.logger.info('Starting intelligent retry', {
      requestId: options.requestId,
      strategy: strategy.name,
      maxAttempts: context.maxAttempts
    });

    let lastError: any;
    let result: T | undefined;

    while (context.attempt < context.maxAttempts) {
      context.attempt++;
      context.lastAttemptTime = Date.now();

      try {
        this.logger.debug('Attempting operation', {
          requestId: options.requestId,
          attempt: context.attempt,
          strategy: strategy.name
        });

        result = await operation();
        
        // Success!
        const totalDuration = Date.now() - startTime;
        this.metrics.successfulRetries++;
        this.updateStrategyMetrics(strategyId, true);
        
        if (this.config.enableLearning) {
          this.updateLearningData(context, true, totalDuration);
          strategy.adapt(context, true);
        }

        this.activeRetries.delete(options.requestId);

        const retryResult: RetryResult = {
          success: true,
          data: result,
          attempts: context.attempt,
          totalDuration,
          strategyUsed: strategy.name,
          shouldRetry: false,
          metadata: {
            strategy: strategyId,
            learningEnabled: this.config.enableLearning,
            finalAttempt: context.attempt
          }
        };

        this.emit('retrySuccess', {
          context,
          result: retryResult,
          strategy: strategy.name
        });

        this.logger.info('Retry operation successful', {
          requestId: options.requestId,
          attempts: context.attempt,
          duration: totalDuration,
          strategy: strategy.name
        });

        return retryResult;

      } catch (error) {
        lastError = error;
        context.error = error;

        this.logger.warn('Retry attempt failed', {
          requestId: options.requestId,
          attempt: context.attempt,
          error: error.message,
          strategy: strategy.name
        });

        // Check if we should retry
        if (!strategy.shouldRetry(context)) {
          this.logger.info('Strategy decided not to retry', {
            requestId: options.requestId,
            attempt: context.attempt,
            strategy: strategy.name
          });
          break;
        }

        // Calculate delay for next attempt
        if (context.attempt < context.maxAttempts) {
          const delay = strategy.calculateDelay(context);
          
          this.logger.debug('Waiting before next attempt', {
            requestId: options.requestId,
            delay,
            nextAttempt: context.attempt + 1
          });

          await this.sleep(delay);
        }
      }
    }

    // All attempts failed
    const totalDuration = Date.now() - startTime;
    this.metrics.failedRetries++;
    this.updateStrategyMetrics(strategyId, false);
    
    if (this.config.enableLearning) {
      this.updateLearningData(context, false, totalDuration);
      strategy.adapt(context, false);
    }

    this.activeRetries.delete(options.requestId);

    const failureResult: RetryResult = {
      success: false,
      error: lastError,
      attempts: context.attempt,
      totalDuration,
      strategyUsed: strategy.name,
      shouldRetry: false,
      metadata: {
        strategy: strategyId,
        maxAttemptsReached: true,
        allAttemptsFailed: true
      }
    };

    this.emit('retryFailed', {
      context,
      result: failureResult,
      strategy: strategy.name,
      finalError: lastError
    });

    this.logger.error('All retry attempts failed', {
      requestId: options.requestId,
      attempts: context.attempt,
      duration: totalDuration,
      strategy: strategy.name,
      error: lastError.message
    });

    return failureResult;
  }

  /**
   * Select best retry strategy based on learning data
   */
  private selectBestStrategy(context: RetryContext): string {
    if (!this.config.enableLearning) {
      return 'exponential'; // Default strategy
    }

    const learningKey = this.getLearningKey(context);
    const learning = this.learningData.get(learningKey);

    if (!learning || learning.sampleSize < 10) {
      // Not enough data, use adaptive strategy
      return 'adaptive';
    }

    // Select strategy based on success rate
    if (learning.successRate >= this.config.successThreshold) {
      // High success rate, use the strategy that worked
      if (learning.averageAttempts <= 2) return 'fixed';
      if (learning.averageDelay < this.config.baseDelay * 2) return 'linear';
      return 'exponential';
    } else {
      // Lower success rate, try adaptive approach
      return 'adaptive';
    }
  }

  /**
   * Exponential backoff delay calculation
   */
  private calculateExponentialDelay(context: RetryContext): number {
    const learning = this.getLearningData(context);
    const baseDelay = learning?.adaptedBaseDelay || this.config.baseDelay;
    const multiplier = learning?.adaptedMultiplier || this.config.backoffMultiplier;
    
    let delay = baseDelay * Math.pow(multiplier, context.attempt - 1);
    delay = Math.min(delay, this.config.maxDelay);
    
    if (this.config.jitter) {
      delay = this.addJitter(delay);
    }
    
    return Math.round(delay);
  }

  /**
   * Linear backoff delay calculation
   */
  private calculateLinearDelay(context: RetryContext): number {
    const learning = this.getLearningData(context);
    const baseDelay = learning?.adaptedBaseDelay || this.config.baseDelay;
    
    let delay = baseDelay * context.attempt;
    delay = Math.min(delay, this.config.maxDelay);
    
    if (this.config.jitter) {
      delay = this.addJitter(delay);
    }
    
    return Math.round(delay);
  }

  /**
   * Fixed interval delay calculation
   */
  private calculateFixedDelay(context: RetryContext): number {
    const learning = this.getLearningData(context);
    let delay = learning?.adaptedBaseDelay || this.config.baseDelay;
    
    if (this.config.jitter) {
      delay = this.addJitter(delay);
    }
    
    return Math.round(delay);
  }

  /**
   * Adaptive delay calculation based on learning
   */
  private calculateAdaptiveDelay(context: RetryContext): number {
    const learning = this.getLearningData(context);
    
    if (!learning || learning.sampleSize < 5) {
      // Fallback to exponential
      return this.calculateExponentialDelay(context);
    }

    // Use learned average delay with adaptation
    let delay = learning.averageDelay * (1 + this.config.adaptiveFactor * (context.attempt - 1));
    delay = Math.min(delay, this.config.maxDelay);
    
    if (this.config.jitter) {
      delay = this.addJitter(delay);
    }
    
    return Math.round(delay);
  }

  /**
   * Fibonacci backoff delay calculation
   */
  private calculateFibonacciDelay(context: RetryContext): number {
    const fib = this.fibonacci(context.attempt);
    const learning = this.getLearningData(context);
    const baseDelay = learning?.adaptedBaseDelay || this.config.baseDelay;
    
    let delay = baseDelay * fib;
    delay = Math.min(delay, this.config.maxDelay);
    
    if (this.config.jitter) {
      delay = this.addJitter(delay);
    }
    
    return Math.round(delay);
  }

  /**
   * Strategy-specific retry decision logic
   */
  private shouldRetryExponential(context: RetryContext): boolean {
    if (context.attempt >= context.maxAttempts) return false;
    
    // Don't retry certain errors
    if (this.isNonRetryableError(context.error)) return false;
    
    // Consider learning data for decision
    const learning = this.getLearningData(context);
    if (learning && learning.successRate < 0.3 && context.attempt > 2) {
      return false; // Low success rate, don't waste attempts
    }
    
    return true;
  }

  private shouldRetryLinear(context: RetryContext): boolean {
    return this.shouldRetryExponential(context);
  }

  private shouldRetryFixed(context: RetryContext): boolean {
    return this.shouldRetryExponential(context);
  }

  private shouldRetryAdaptive(context: RetryContext): boolean {
    if (context.attempt >= context.maxAttempts) return false;
    if (this.isNonRetryableError(context.error)) return false;
    
    const learning = this.getLearningData(context);
    if (learning) {
      // Adaptive decision based on learned success rate and current attempt
      const expectedSuccessProbability = learning.successRate * (1 - (context.attempt / context.maxAttempts));
      return expectedSuccessProbability > 0.2; // 20% threshold
    }
    
    return true;
  }

  private shouldRetryFibonacci(context: RetryContext): boolean {
    return this.shouldRetryExponential(context);
  }

  /**
   * Strategy adaptation methods
   */
  private adaptExponential(context: RetryContext, success: boolean): void {
    if (!this.config.enableLearning) return;
    
    const learning = this.ensureLearningData(context);
    if (success && context.attempt <= 2) {
      // Quick success, reduce base delay slightly
      learning.adaptedBaseDelay = Math.max(
        learning.adaptedBaseDelay * (1 - this.config.adaptiveFactor * 0.1),
        this.config.baseDelay * 0.5
      );
    } else if (!success || context.attempt > 3) {
      // Slow or failed, increase delays
      learning.adaptedBaseDelay = Math.min(
        learning.adaptedBaseDelay * (1 + this.config.adaptiveFactor * 0.1),
        this.config.baseDelay * 2
      );
    }
    
    this.metrics.adaptations++;
  }

  private adaptLinear(context: RetryContext, success: boolean): void {
    this.adaptExponential(context, success); // Similar logic
  }

  private adaptFixed(context: RetryContext, success: boolean): void {
    if (!this.config.enableLearning) return;
    
    const learning = this.ensureLearningData(context);
    if (success) {
      learning.adaptedBaseDelay = Math.max(
        learning.adaptedBaseDelay * 0.95,
        this.config.baseDelay * 0.8
      );
    } else {
      learning.adaptedBaseDelay = Math.min(
        learning.adaptedBaseDelay * 1.1,
        this.config.baseDelay * 1.5
      );
    }
    
    this.metrics.adaptations++;
  }

  private adaptAdaptive(context: RetryContext, success: boolean): void {
    if (!this.config.enableLearning) return;
    
    const learning = this.ensureLearningData(context);
    const currentDelay = Date.now() - context.startTime;
    
    // Adaptive learning based on actual performance
    learning.averageDelay = (learning.averageDelay * learning.sampleSize + currentDelay) / (learning.sampleSize + 1);
    
    if (success) {
      // Reduce delay for future attempts
      learning.adaptedBaseDelay = Math.max(
        learning.adaptedBaseDelay * 0.9,
        this.config.baseDelay * 0.5
      );
    } else {
      // Increase delay to avoid overwhelming the service
      learning.adaptedBaseDelay = Math.min(
        learning.adaptedBaseDelay * 1.2,
        this.config.maxDelay * 0.5
      );
    }
    
    this.metrics.adaptations++;
  }

  private adaptFibonacci(context: RetryContext, success: boolean): void {
    this.adaptExponential(context, success); // Similar adaptation logic
  }

  /**
   * Learning data management
   */
  private getLearningKey(context: RetryContext): string {
    return `${context.operation}:${context.provider || 'unknown'}:${context.agent || 'unknown'}`;
  }

  private getLearningData(context: RetryContext): RetryLearning | undefined {
    const key = this.getLearningKey(context);
    return this.learningData.get(key);
  }

  private ensureLearningData(context: RetryContext): RetryLearning {
    const key = this.getLearningKey(context);
    let learning = this.learningData.get(key);
    
    if (!learning) {
      learning = {
        operation: context.operation,
        provider: context.provider,
        successRate: 0.5, // Start with neutral assumption
        averageAttempts: 2,
        averageDelay: this.config.baseDelay,
        lastUpdated: new Date(),
        sampleSize: 0,
        adaptedMultiplier: this.config.backoffMultiplier,
        adaptedBaseDelay: this.config.baseDelay
      };
      this.learningData.set(key, learning);
    }
    
    return learning;
  }

  private updateLearningData(context: RetryContext, success: boolean, duration: number): void {
    const learning = this.ensureLearningData(context);
    
    // Update success rate using running average
    const successValue = success ? 1 : 0;
    learning.successRate = (learning.successRate * learning.sampleSize + successValue) / (learning.sampleSize + 1);
    
    // Update average attempts
    learning.averageAttempts = (learning.averageAttempts * learning.sampleSize + context.attempt) / (learning.sampleSize + 1);
    
    // Update average delay
    learning.averageDelay = (learning.averageDelay * learning.sampleSize + duration) / (learning.sampleSize + 1);
    
    learning.sampleSize++;
    learning.lastUpdated = new Date();
    
    this.metrics.learningUpdates++;
    
    this.logger.debug('Updated learning data', {
      operation: context.operation,
      provider: context.provider,
      successRate: learning.successRate,
      averageAttempts: learning.averageAttempts,
      sampleSize: learning.sampleSize
    });
  }

  /**
   * Helper methods
   */
  private addJitter(delay: number): number {
    const jitterAmount = delay * this.config.jitterRange;
    return delay + (Math.random() - 0.5) * 2 * jitterAmount;
  }

  private fibonacci(n: number): number {
    if (n <= 1) return 1;
    if (n === 2) return 1;
    
    let prev = 1, curr = 1;
    for (let i = 3; i <= n; i++) {
      const next = prev + curr;
      prev = curr;
      curr = next;
    }
    return curr;
  }

  private isNonRetryableError(error: any): boolean {
    if (!error) return false;
    
    const nonRetryableStatuses = [400, 401, 403, 404, 422];
    const nonRetryableCodes = ['INVALID_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN'];
    
    return nonRetryableStatuses.includes(error.status) || 
           nonRetryableCodes.includes(error.code);
  }

  private updateStrategyMetrics(strategyId: string, success: boolean): void {
    const current = this.metrics.strategiesUsed.get(strategyId) || 0;
    this.metrics.strategiesUsed.set(strategyId, current + 1);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Start cleanup routine for old learning data
   */
  private startLearningCleanup(): void {
    setInterval(() => {
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      
      for (const [key, learning] of this.learningData.entries()) {
        if (learning.lastUpdated.getTime() < oneWeekAgo && learning.sampleSize < 10) {
          this.learningData.delete(key);
          this.logger.debug('Cleaned up old learning data', { key });
        }
      }
    }, 24 * 60 * 60 * 1000); // Daily cleanup
  }

  /**
   * Public API methods
   */

  /**
   * Get learning data for analysis
   */
  getLearningData(): Map<string, RetryLearning> {
    return new Map(this.learningData);
  }

  /**
   * Get retry metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Get active retries
   */
  getActiveRetries(): Map<string, RetryContext> {
    return new Map(this.activeRetries);
  }

  /**
   * Clear learning data for specific operation
   */
  clearLearningData(operation?: string, provider?: string): void {
    if (!operation) {
      this.learningData.clear();
      this.logger.info('Cleared all learning data');
      return;
    }

    const keysToDelete = [];
    for (const [key, learning] of this.learningData.entries()) {
      if (learning.operation === operation && 
          (!provider || learning.provider === provider)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.learningData.delete(key));
    this.logger.info(`Cleared learning data for ${keysToDelete.length} operations`);
  }

  /**
   * Update retry configuration
   */
  updateConfig(newConfig: Partial<RetryConfig>): void {
    Object.assign(this.config, newConfig);
    this.logger.info('Updated retry configuration', { newConfig });
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      averageAttempts: 0,
      averageDelay: 0,
      strategiesUsed: new Map(),
      learningUpdates: 0,
      adaptations: 0
    };
    
    this.logger.info('Reset retry service metrics');
  }
}

export default IntelligentRetryService;
