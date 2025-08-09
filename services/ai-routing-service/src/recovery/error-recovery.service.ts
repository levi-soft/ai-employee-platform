
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';

export interface ErrorRecoveryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  jitter: boolean;
  backoffMultiplier: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
  fallbackEnabled: boolean;
  degradationEnabled: boolean;
}

export interface RecoveryStrategy {
  id: string;
  name: string;
  priority: number;
  condition: (error: any) => boolean;
  execute: (context: RecoveryContext) => Promise<RecoveryResult>;
}

export interface RecoveryContext {
  originalRequest: any;
  error: any;
  attemptCount: number;
  totalAttempts: number;
  provider?: string;
  agent?: string;
  userId?: string;
  sessionId?: string;
  metadata: Record<string, any>;
}

export interface RecoveryResult {
  success: boolean;
  data?: any;
  error?: any;
  strategy: string;
  duration: number;
  nextStrategy?: string;
  shouldRetry: boolean;
  metadata: Record<string, any>;
}

export interface ErrorPattern {
  type: string;
  count: number;
  lastOccurrence: Date;
  providers: string[];
  agents: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoveryStrategies: string[];
  metadata: Record<string, any>;
}

export class ErrorRecoveryService extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: ErrorRecoveryConfig;
  private recoveryStrategies: Map<string, RecoveryStrategy> = new Map();
  private errorPatterns: Map<string, ErrorPattern> = new Map();
  private circuitBreakers: Map<string, {
    failures: number;
    lastFailure: Date;
    state: 'closed' | 'open' | 'half-open';
  }> = new Map();
  
  private metrics = {
    totalRecoveries: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    strategiesUsed: new Map<string, number>(),
    averageRecoveryTime: 0,
    errorPatterns: new Map<string, number>(),
    circuitBreakerTrips: 0
  };

  constructor(config: Partial<ErrorRecoveryConfig> = {}) {
    super();
    this.logger = new Logger('ErrorRecoveryService');
    this.config = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      jitter: true,
      backoffMultiplier: 2,
      circuitBreakerThreshold: 10,
      circuitBreakerTimeout: 60000,
      fallbackEnabled: true,
      degradationEnabled: true,
      ...config
    };

    this.initializeStrategies();
    this.startMonitoring();
  }

  /**
   * Initialize default recovery strategies
   */
  private initializeStrategies(): void {
    // Retry strategy with exponential backoff
    this.registerStrategy({
      id: 'exponential-backoff',
      name: 'Exponential Backoff Retry',
      priority: 1,
      condition: (error) => this.isRetryableError(error),
      execute: async (context) => this.executeRetryStrategy(context)
    });

    // Provider fallback strategy
    this.registerStrategy({
      id: 'provider-fallback',
      name: 'Provider Fallback',
      priority: 2,
      condition: (error) => this.isProviderError(error),
      execute: async (context) => this.executeProviderFallback(context)
    });

    // Agent fallback strategy
    this.registerStrategy({
      id: 'agent-fallback',
      name: 'Agent Fallback',
      priority: 3,
      condition: (error) => this.isAgentError(error),
      execute: async (context) => this.executeAgentFallback(context)
    });

    // Graceful degradation strategy
    this.registerStrategy({
      id: 'graceful-degradation',
      name: 'Graceful Degradation',
      priority: 4,
      condition: () => this.config.degradationEnabled,
      execute: async (context) => this.executeGracefulDegradation(context)
    });

    // Emergency response strategy
    this.registerStrategy({
      id: 'emergency-response',
      name: 'Emergency Response',
      priority: 5,
      condition: () => true, // Always available as last resort
      execute: async (context) => this.executeEmergencyResponse(context)
    });
  }

  /**
   * Register a custom recovery strategy
   */
  registerStrategy(strategy: RecoveryStrategy): void {
    this.recoveryStrategies.set(strategy.id, strategy);
    this.logger.info(`Registered recovery strategy: ${strategy.name}`, {
      strategyId: strategy.id,
      priority: strategy.priority
    });
  }

  /**
   * Execute error recovery for a failed request
   */
  async recover(error: any, context: Partial<RecoveryContext>): Promise<RecoveryResult> {
    const startTime = Date.now();
    const recoveryContext: RecoveryContext = {
      originalRequest: {},
      attemptCount: 1,
      totalAttempts: this.config.maxRetries + 1,
      metadata: {},
      ...context,
      error
    };

    this.metrics.totalRecoveries++;
    this.recordErrorPattern(error, recoveryContext);

    this.logger.info('Starting error recovery', {
      error: error.message,
      provider: recoveryContext.provider,
      agent: recoveryContext.agent,
      attemptCount: recoveryContext.attemptCount
    });

    // Check circuit breaker
    if (this.isCircuitBreakerOpen(recoveryContext)) {
      return this.createFailureResult(
        'circuit-breaker-open',
        new Error('Circuit breaker is open'),
        startTime,
        recoveryContext
      );
    }

    // Get applicable recovery strategies
    const strategies = this.getApplicableStrategies(error);
    
    for (const strategy of strategies) {
      try {
        const result = await strategy.execute(recoveryContext);
        const duration = Date.now() - startTime;
        
        if (result.success) {
          this.metrics.successfulRecoveries++;
          this.updateStrategyMetrics(strategy.id, true);
          this.resetCircuitBreaker(recoveryContext);
          
          this.emit('recoverySuccess', {
            strategy: strategy.id,
            context: recoveryContext,
            result,
            duration
          });

          this.logger.info('Recovery successful', {
            strategy: strategy.name,
            duration,
            provider: recoveryContext.provider
          });

          return result;
        }

        // Strategy failed, try next one
        this.logger.warn('Recovery strategy failed', {
          strategy: strategy.name,
          error: result.error?.message,
          willRetryNext: strategies.indexOf(strategy) < strategies.length - 1
        });

      } catch (strategyError) {
        this.logger.error('Strategy execution failed', {
          strategy: strategy.name,
          error: strategyError.message
        });
      }
    }

    // All strategies failed
    this.metrics.failedRecoveries++;
    this.updateCircuitBreaker(recoveryContext);
    
    const finalResult = this.createFailureResult(
      'all-strategies-failed',
      error,
      startTime,
      recoveryContext
    );

    this.emit('recoveryFailed', {
      context: recoveryContext,
      result: finalResult,
      strategiesTried: strategies.map(s => s.id)
    });

    return finalResult;
  }

  /**
   * Get applicable recovery strategies for an error
   */
  private getApplicableStrategies(error: any): RecoveryStrategy[] {
    const strategies = Array.from(this.recoveryStrategies.values())
      .filter(strategy => strategy.condition(error))
      .sort((a, b) => a.priority - b.priority);

    this.logger.debug('Found applicable strategies', {
      count: strategies.length,
      strategies: strategies.map(s => s.name)
    });

    return strategies;
  }

  /**
   * Execute retry strategy with exponential backoff
   */
  private async executeRetryStrategy(context: RecoveryContext): Promise<RecoveryResult> {
    const startTime = Date.now();
    
    if (context.attemptCount >= this.config.maxRetries) {
      return {
        success: false,
        error: new Error('Maximum retry attempts exceeded'),
        strategy: 'exponential-backoff',
        duration: Date.now() - startTime,
        shouldRetry: false,
        metadata: { maxRetriesReached: true }
      };
    }

    // Calculate delay with exponential backoff and jitter
    let delay = Math.min(
      this.config.baseDelay * Math.pow(this.config.backoffMultiplier, context.attemptCount - 1),
      this.config.maxDelay
    );

    if (this.config.jitter) {
      delay += Math.random() * delay * 0.1;
    }

    await this.sleep(delay);

    try {
      // Simulate retry of original request
      // In real implementation, this would call the original service
      const result = await this.simulateRequest(context);
      
      return {
        success: true,
        data: result,
        strategy: 'exponential-backoff',
        duration: Date.now() - startTime,
        shouldRetry: false,
        metadata: { 
          delay,
          attemptCount: context.attemptCount,
          retrySuccessful: true
        }
      };

    } catch (retryError) {
      return {
        success: false,
        error: retryError,
        strategy: 'exponential-backoff',
        duration: Date.now() - startTime,
        shouldRetry: context.attemptCount < this.config.maxRetries,
        nextStrategy: 'provider-fallback',
        metadata: { 
          delay,
          attemptCount: context.attemptCount,
          retryFailed: true
        }
      };
    }
  }

  /**
   * Execute provider fallback strategy
   */
  private async executeProviderFallback(context: RecoveryContext): Promise<RecoveryResult> {
    const startTime = Date.now();
    
    if (!this.config.fallbackEnabled) {
      return {
        success: false,
        error: new Error('Fallback routing is disabled'),
        strategy: 'provider-fallback',
        duration: Date.now() - startTime,
        shouldRetry: false,
        metadata: { fallbackDisabled: true }
      };
    }

    try {
      // Get alternative provider
      const fallbackProvider = this.getFallbackProvider(context.provider);
      
      if (!fallbackProvider) {
        return {
          success: false,
          error: new Error('No fallback provider available'),
          strategy: 'provider-fallback',
          duration: Date.now() - startTime,
          shouldRetry: false,
          nextStrategy: 'agent-fallback',
          metadata: { noFallbackProvider: true }
        };
      }

      // Simulate request with fallback provider
      const result = await this.simulateRequestWithProvider(context, fallbackProvider);
      
      return {
        success: true,
        data: result,
        strategy: 'provider-fallback',
        duration: Date.now() - startTime,
        shouldRetry: false,
        metadata: { 
          originalProvider: context.provider,
          fallbackProvider,
          fallbackSuccessful: true
        }
      };

    } catch (fallbackError) {
      return {
        success: false,
        error: fallbackError,
        strategy: 'provider-fallback',
        duration: Date.now() - startTime,
        shouldRetry: false,
        nextStrategy: 'agent-fallback',
        metadata: { fallbackFailed: true }
      };
    }
  }

  /**
   * Execute agent fallback strategy
   */
  private async executeAgentFallback(context: RecoveryContext): Promise<RecoveryResult> {
    const startTime = Date.now();
    
    try {
      // Get alternative agent
      const fallbackAgent = this.getFallbackAgent(context.agent);
      
      if (!fallbackAgent) {
        return {
          success: false,
          error: new Error('No fallback agent available'),
          strategy: 'agent-fallback',
          duration: Date.now() - startTime,
          shouldRetry: false,
          nextStrategy: 'graceful-degradation',
          metadata: { noFallbackAgent: true }
        };
      }

      // Simulate request with fallback agent
      const result = await this.simulateRequestWithAgent(context, fallbackAgent);
      
      return {
        success: true,
        data: result,
        strategy: 'agent-fallback',
        duration: Date.now() - startTime,
        shouldRetry: false,
        metadata: { 
          originalAgent: context.agent,
          fallbackAgent,
          agentFallbackSuccessful: true
        }
      };

    } catch (fallbackError) {
      return {
        success: false,
        error: fallbackError,
        strategy: 'agent-fallback',
        duration: Date.now() - startTime,
        shouldRetry: false,
        nextStrategy: 'graceful-degradation',
        metadata: { agentFallbackFailed: true }
      };
    }
  }

  /**
   * Execute graceful degradation strategy
   */
  private async executeGracefulDegradation(context: RecoveryContext): Promise<RecoveryResult> {
    const startTime = Date.now();
    
    try {
      // Provide degraded but functional response
      const degradedResponse = this.generateDegradedResponse(context);
      
      return {
        success: true,
        data: degradedResponse,
        strategy: 'graceful-degradation',
        duration: Date.now() - startTime,
        shouldRetry: false,
        metadata: { 
          degraded: true,
          qualityReduced: true,
          functionalityLimited: true
        }
      };

    } catch (degradationError) {
      return {
        success: false,
        error: degradationError,
        strategy: 'graceful-degradation',
        duration: Date.now() - startTime,
        shouldRetry: false,
        nextStrategy: 'emergency-response',
        metadata: { degradationFailed: true }
      };
    }
  }

  /**
   * Execute emergency response strategy
   */
  private async executeEmergencyResponse(context: RecoveryContext): Promise<RecoveryResult> {
    const startTime = Date.now();
    
    // Always provide some response, even if minimal
    const emergencyResponse = {
      status: 'service_unavailable',
      message: 'Service is currently experiencing issues. Please try again later.',
      requestId: context.sessionId || 'unknown',
      timestamp: new Date().toISOString(),
      supportContact: 'support@ai-platform.com'
    };

    this.emit('emergencyResponseActivated', {
      context,
      response: emergencyResponse
    });

    return {
      success: true,
      data: emergencyResponse,
      strategy: 'emergency-response',
      duration: Date.now() - startTime,
      shouldRetry: false,
      metadata: { 
        emergency: true,
        minimalResponse: true,
        serviceUnavailable: true
      }
    };
  }

  /**
   * Record error patterns for analysis
   */
  private recordErrorPattern(error: any, context: RecoveryContext): void {
    const errorType = this.classifyError(error);
    const patternKey = `${errorType}:${context.provider || 'unknown'}:${context.agent || 'unknown'}`;
    
    let pattern = this.errorPatterns.get(patternKey);
    if (!pattern) {
      pattern = {
        type: errorType,
        count: 0,
        lastOccurrence: new Date(),
        providers: [],
        agents: [],
        severity: 'low',
        recoveryStrategies: [],
        metadata: {}
      };
      this.errorPatterns.set(patternKey, pattern);
    }

    pattern.count++;
    pattern.lastOccurrence = new Date();
    
    if (context.provider && !pattern.providers.includes(context.provider)) {
      pattern.providers.push(context.provider);
    }
    
    if (context.agent && !pattern.agents.includes(context.agent)) {
      pattern.agents.push(context.agent);
    }

    // Update severity based on frequency
    if (pattern.count > 100) pattern.severity = 'critical';
    else if (pattern.count > 50) pattern.severity = 'high';
    else if (pattern.count > 20) pattern.severity = 'medium';
    else pattern.severity = 'low';

    this.metrics.errorPatterns.set(errorType, (this.metrics.errorPatterns.get(errorType) || 0) + 1);
  }

  /**
   * Check if circuit breaker is open
   */
  private isCircuitBreakerOpen(context: RecoveryContext): boolean {
    const key = `${context.provider || 'unknown'}:${context.agent || 'unknown'}`;
    const breaker = this.circuitBreakers.get(key);
    
    if (!breaker || breaker.state === 'closed') {
      return false;
    }
    
    if (breaker.state === 'open') {
      // Check if timeout has elapsed
      if (Date.now() - breaker.lastFailure.getTime() > this.config.circuitBreakerTimeout) {
        breaker.state = 'half-open';
        return false;
      }
      return true;
    }
    
    return false; // half-open allows one attempt
  }

  /**
   * Update circuit breaker state
   */
  private updateCircuitBreaker(context: RecoveryContext): void {
    const key = `${context.provider || 'unknown'}:${context.agent || 'unknown'}`;
    let breaker = this.circuitBreakers.get(key);
    
    if (!breaker) {
      breaker = { failures: 0, lastFailure: new Date(), state: 'closed' };
      this.circuitBreakers.set(key, breaker);
    }
    
    breaker.failures++;
    breaker.lastFailure = new Date();
    
    if (breaker.failures >= this.config.circuitBreakerThreshold && breaker.state === 'closed') {
      breaker.state = 'open';
      this.metrics.circuitBreakerTrips++;
      
      this.emit('circuitBreakerOpened', {
        key,
        failures: breaker.failures,
        context
      });
      
      this.logger.warn('Circuit breaker opened', {
        key,
        failures: breaker.failures,
        threshold: this.config.circuitBreakerThreshold
      });
    }
  }

  /**
   * Reset circuit breaker after successful recovery
   */
  private resetCircuitBreaker(context: RecoveryContext): void {
    const key = `${context.provider || 'unknown'}:${context.agent || 'unknown'}`;
    const breaker = this.circuitBreakers.get(key);
    
    if (breaker) {
      breaker.failures = 0;
      breaker.state = 'closed';
      
      this.emit('circuitBreakerReset', {
        key,
        context
      });
    }
  }

  /**
   * Helper methods
   */
  private isRetryableError(error: any): boolean {
    const retryableCodes = [408, 429, 500, 502, 503, 504];
    return retryableCodes.includes(error.status) || error.code === 'TIMEOUT';
  }

  private isProviderError(error: any): boolean {
    return error.code === 'PROVIDER_ERROR' || error.provider;
  }

  private isAgentError(error: any): boolean {
    return error.code === 'AGENT_ERROR' || error.agent;
  }

  private classifyError(error: any): string {
    if (error.status >= 500) return 'server_error';
    if (error.status >= 400) return 'client_error';
    if (error.code === 'TIMEOUT') return 'timeout_error';
    if (error.code === 'NETWORK_ERROR') return 'network_error';
    return 'unknown_error';
  }

  private getFallbackProvider(provider?: string): string | null {
    const providers = ['openai', 'claude', 'gemini'];
    const currentIndex = provider ? providers.indexOf(provider) : -1;
    return currentIndex !== -1 && currentIndex < providers.length - 1 ? providers[currentIndex + 1] : providers[0];
  }

  private getFallbackAgent(agent?: string): string | null {
    const agents = ['gpt-4', 'gpt-3.5-turbo', 'claude-3-sonnet', 'gemini-pro'];
    const currentIndex = agent ? agents.indexOf(agent) : -1;
    return currentIndex !== -1 && currentIndex < agents.length - 1 ? agents[currentIndex + 1] : agents[0];
  }

  private generateDegradedResponse(context: RecoveryContext): any {
    return {
      status: 'degraded',
      message: 'Service is operating in degraded mode. Response quality may be reduced.',
      data: {
        text: 'I apologize, but I am currently experiencing technical difficulties. Please try your request again or contact support if the issue persists.',
        confidence: 0.5,
        quality: 'degraded'
      },
      metadata: {
        degraded: true,
        originalRequest: context.originalRequest,
        timestamp: new Date().toISOString()
      }
    };
  }

  private async simulateRequest(context: RecoveryContext): Promise<any> {
    // Simulate network delay and random success/failure
    await this.sleep(100 + Math.random() * 200);
    
    if (Math.random() < 0.7) { // 70% success rate for retries
      return { status: 'success', data: 'Retry successful', timestamp: new Date().toISOString() };
    }
    
    throw new Error('Simulated retry failure');
  }

  private async simulateRequestWithProvider(context: RecoveryContext, provider: string): Promise<any> {
    await this.sleep(150 + Math.random() * 100);
    
    if (Math.random() < 0.8) { // 80% success rate for fallback
      return { 
        status: 'success', 
        data: `Fallback provider ${provider} successful`, 
        provider,
        timestamp: new Date().toISOString() 
      };
    }
    
    throw new Error(`Simulated fallback failure for provider ${provider}`);
  }

  private async simulateRequestWithAgent(context: RecoveryContext, agent: string): Promise<any> {
    await this.sleep(120 + Math.random() * 80);
    
    if (Math.random() < 0.75) { // 75% success rate for agent fallback
      return { 
        status: 'success', 
        data: `Fallback agent ${agent} successful`, 
        agent,
        timestamp: new Date().toISOString() 
      };
    }
    
    throw new Error(`Simulated agent fallback failure for agent ${agent}`);
  }

  private createFailureResult(
    strategy: string, 
    error: any, 
    startTime: number, 
    context: RecoveryContext
  ): RecoveryResult {
    return {
      success: false,
      error,
      strategy,
      duration: Date.now() - startTime,
      shouldRetry: false,
      metadata: { 
        totalStrategiesTried: this.recoveryStrategies.size,
        finalFailure: true,
        context: context.metadata
      }
    };
  }

  private updateStrategyMetrics(strategyId: string, success: boolean): void {
    const current = this.metrics.strategiesUsed.get(strategyId) || 0;
    this.metrics.strategiesUsed.set(strategyId, current + 1);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Start monitoring and cleanup routines
   */
  private startMonitoring(): void {
    // Clean up old error patterns every hour
    setInterval(() => {
      const oneHourAgo = Date.now() - 3600000;
      for (const [key, pattern] of this.errorPatterns.entries()) {
        if (pattern.lastOccurrence.getTime() < oneHourAgo && pattern.count < 5) {
          this.errorPatterns.delete(key);
        }
      }
    }, 3600000);

    // Reset circuit breakers based on timeout
    setInterval(() => {
      for (const [key, breaker] of this.circuitBreakers.entries()) {
        if (breaker.state === 'open' && 
            Date.now() - breaker.lastFailure.getTime() > this.config.circuitBreakerTimeout) {
          breaker.state = 'half-open';
          this.logger.info('Circuit breaker state changed to half-open', { key });
        }
      }
    }, 30000);

    this.logger.info('Error recovery service monitoring started');
  }

  /**
   * Get current error patterns
   */
  getErrorPatterns(): Map<string, ErrorPattern> {
    return new Map(this.errorPatterns);
  }

  /**
   * Get recovery metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(): Map<string, any> {
    return new Map(this.circuitBreakers);
  }

  /**
   * Reset all metrics and patterns
   */
  reset(): void {
    this.metrics = {
      totalRecoveries: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      strategiesUsed: new Map(),
      averageRecoveryTime: 0,
      errorPatterns: new Map(),
      circuitBreakerTrips: 0
    };
    this.errorPatterns.clear();
    this.circuitBreakers.clear();
    
    this.logger.info('Error recovery service reset completed');
  }
}

export default ErrorRecoveryService;
