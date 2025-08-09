
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';

export interface FallbackConfig {
  enableFallbacks: boolean;
  maxFallbackAttempts: number;
  fallbackDelay: number;
  providerFailureThreshold: number;
  agentFailureThreshold: number;
  healthCheckInterval: number;
  emergencyMode: boolean;
  qualityThreshold: number;
}

export interface FallbackRoute {
  id: string;
  type: 'provider' | 'agent' | 'endpoint' | 'model';
  priority: number;
  source: string;
  target: string;
  condition: (context: FallbackContext) => boolean;
  enabled: boolean;
  successRate: number;
  lastUsed: Date;
  metadata: Record<string, any>;
}

export interface FallbackContext {
  requestId: string;
  originalProvider?: string;
  originalAgent?: string;
  originalEndpoint?: string;
  error: any;
  attempt: number;
  maxAttempts: number;
  quality?: number;
  timeout?: number;
  userId?: string;
  metadata: Record<string, any>;
}

export interface FallbackResult {
  success: boolean;
  data?: any;
  error?: any;
  routeUsed?: FallbackRoute;
  fallbacksAttempted: string[];
  totalDuration: number;
  qualityScore?: number;
  metadata: Record<string, any>;
}

export interface ProviderHealth {
  providerId: string;
  isHealthy: boolean;
  successRate: number;
  averageResponseTime: number;
  errorRate: number;
  lastHealthCheck: Date;
  consecutiveFailures: number;
  lastError?: string;
  metadata: Record<string, any>;
}

export class FallbackRouterService extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: FallbackConfig;
  private fallbackRoutes: Map<string, FallbackRoute> = new Map();
  private providerHealth: Map<string, ProviderHealth> = new Map();
  private circuitBreakers: Map<string, {
    state: 'closed' | 'open' | 'half-open';
    failures: number;
    lastFailure: Date;
    nextAttempt?: Date;
  }> = new Map();

  private metrics = {
    totalFallbacks: 0,
    successfulFallbacks: 0,
    failedFallbacks: 0,
    routesUsed: new Map<string, number>(),
    averageFallbackTime: 0,
    providerSwitches: 0,
    agentSwitches: 0,
    emergencyActivations: 0
  };

  constructor(config: Partial<FallbackConfig> = {}) {
    super();
    this.logger = new Logger('FallbackRouterService');
    this.config = {
      enableFallbacks: true,
      maxFallbackAttempts: 3,
      fallbackDelay: 1000,
      providerFailureThreshold: 5,
      agentFailureThreshold: 3,
      healthCheckInterval: 30000,
      emergencyMode: false,
      qualityThreshold: 0.7,
      ...config
    };

    this.initializeDefaultRoutes();
    this.startHealthMonitoring();
  }

  /**
   * Initialize default fallback routes
   */
  private initializeDefaultRoutes(): void {
    // Provider fallback routes
    this.addFallbackRoute({
      id: 'openai-to-claude',
      type: 'provider',
      priority: 1,
      source: 'openai',
      target: 'claude',
      condition: (context) => this.isProviderError(context),
      enabled: true,
      successRate: 0.8,
      lastUsed: new Date(0),
      metadata: { type: 'provider_fallback', reason: 'provider_failure' }
    });

    this.addFallbackRoute({
      id: 'claude-to-gemini',
      type: 'provider',
      priority: 2,
      source: 'claude',
      target: 'gemini',
      condition: (context) => this.isProviderError(context),
      enabled: true,
      successRate: 0.75,
      lastUsed: new Date(0),
      metadata: { type: 'provider_fallback', reason: 'provider_failure' }
    });

    this.addFallbackRoute({
      id: 'gemini-to-openai',
      type: 'provider',
      priority: 3,
      source: 'gemini',
      target: 'openai',
      condition: (context) => this.isProviderError(context),
      enabled: true,
      successRate: 0.85,
      lastUsed: new Date(0),
      metadata: { type: 'provider_fallback', reason: 'provider_failure' }
    });

    // Agent fallback routes
    this.addFallbackRoute({
      id: 'gpt4-to-gpt35',
      type: 'agent',
      priority: 1,
      source: 'gpt-4',
      target: 'gpt-3.5-turbo',
      condition: (context) => this.isModelError(context) || this.isCostConstraint(context),
      enabled: true,
      successRate: 0.9,
      lastUsed: new Date(0),
      metadata: { type: 'agent_fallback', reason: 'cost_optimization' }
    });

    this.addFallbackRoute({
      id: 'claude3-to-claude2',
      type: 'agent',
      priority: 2,
      source: 'claude-3-sonnet',
      target: 'claude-instant',
      condition: (context) => this.isModelError(context),
      enabled: true,
      successRate: 0.85,
      lastUsed: new Date(0),
      metadata: { type: 'agent_fallback', reason: 'model_failure' }
    });

    // Emergency fallback routes
    this.addFallbackRoute({
      id: 'emergency-simple-response',
      type: 'endpoint',
      priority: 10,
      source: '*',
      target: 'emergency',
      condition: () => this.config.emergencyMode,
      enabled: true,
      successRate: 1.0,
      lastUsed: new Date(0),
      metadata: { type: 'emergency', reason: 'system_emergency' }
    });
  }

  /**
   * Add a fallback route
   */
  addFallbackRoute(route: FallbackRoute): void {
    this.fallbackRoutes.set(route.id, route);
    this.logger.info(`Added fallback route: ${route.id}`, {
      type: route.type,
      source: route.source,
      target: route.target,
      priority: route.priority
    });
  }

  /**
   * Execute fallback routing
   */
  async executeFallback(context: FallbackContext): Promise<FallbackResult> {
    const startTime = Date.now();
    this.metrics.totalFallbacks++;

    if (!this.config.enableFallbacks) {
      return {
        success: false,
        error: new Error('Fallback routing is disabled'),
        fallbacksAttempted: [],
        totalDuration: Date.now() - startTime,
        metadata: { fallbackDisabled: true }
      };
    }

    this.logger.info('Executing fallback routing', {
      requestId: context.requestId,
      originalProvider: context.originalProvider,
      originalAgent: context.originalAgent,
      error: context.error?.message
    });

    const applicableRoutes = this.getApplicableRoutes(context);
    const fallbacksAttempted: string[] = [];
    let lastError = context.error;

    for (const route of applicableRoutes) {
      if (context.attempt >= this.config.maxFallbackAttempts) {
        break;
      }

      // Check circuit breaker
      if (this.isCircuitBreakerOpen(route.target)) {
        this.logger.warn('Circuit breaker open for target', {
          route: route.id,
          target: route.target
        });
        continue;
      }

      try {
        fallbacksAttempted.push(route.id);
        context.attempt++;

        this.logger.info('Attempting fallback route', {
          routeId: route.id,
          target: route.target,
          attempt: context.attempt
        });

        // Add delay before fallback attempt
        if (this.config.fallbackDelay > 0) {
          await this.sleep(this.config.fallbackDelay);
        }

        // Execute fallback
        const fallbackResult = await this.executeFallbackRoute(route, context);

        if (fallbackResult.success) {
          // Update route success rate
          this.updateRouteMetrics(route.id, true);
          this.resetCircuitBreaker(route.target);
          this.metrics.successfulFallbacks++;

          // Update counters based on route type
          if (route.type === 'provider') this.metrics.providerSwitches++;
          if (route.type === 'agent') this.metrics.agentSwitches++;

          const result: FallbackResult = {
            success: true,
            data: fallbackResult.data,
            routeUsed: route,
            fallbacksAttempted,
            totalDuration: Date.now() - startTime,
            qualityScore: fallbackResult.qualityScore,
            metadata: {
              routeId: route.id,
              routeType: route.type,
              target: route.target,
              attemptCount: context.attempt
            }
          };

          this.emit('fallbackSuccess', {
            context,
            result,
            route
          });

          this.logger.info('Fallback successful', {
            routeId: route.id,
            target: route.target,
            duration: result.totalDuration
          });

          return result;
        }

        lastError = fallbackResult.error;
        this.updateRouteMetrics(route.id, false);
        this.updateCircuitBreaker(route.target);

      } catch (error) {
        this.logger.error('Fallback route execution failed', {
          routeId: route.id,
          error: error.message
        });
        lastError = error;
        this.updateRouteMetrics(route.id, false);
        this.updateCircuitBreaker(route.target);
      }
    }

    // All fallbacks failed
    this.metrics.failedFallbacks++;

    const result: FallbackResult = {
      success: false,
      error: lastError,
      fallbacksAttempted,
      totalDuration: Date.now() - startTime,
      metadata: {
        allFallbacksFailed: true,
        totalAttempts: context.attempt,
        routesEvaluated: applicableRoutes.length
      }
    };

    this.emit('fallbackFailed', {
      context,
      result,
      routesAttempted: fallbacksAttempted
    });

    this.logger.error('All fallback routes failed', {
      requestId: context.requestId,
      routesAttempted: fallbacksAttempted,
      totalDuration: result.totalDuration
    });

    return result;
  }

  /**
   * Get applicable fallback routes for context
   */
  private getApplicableRoutes(context: FallbackContext): FallbackRoute[] {
    const routes = Array.from(this.fallbackRoutes.values())
      .filter(route => {
        if (!route.enabled) return false;
        
        // Check source match
        if (route.source !== '*' && 
            route.source !== context.originalProvider &&
            route.source !== context.originalAgent &&
            route.source !== context.originalEndpoint) {
          return false;
        }

        // Check condition
        return route.condition(context);
      })
      .sort((a, b) => a.priority - b.priority);

    this.logger.debug('Found applicable fallback routes', {
      count: routes.length,
      routes: routes.map(r => ({ id: r.id, priority: r.priority }))
    });

    return routes;
  }

  /**
   * Execute a specific fallback route
   */
  private async executeFallbackRoute(route: FallbackRoute, context: FallbackContext): Promise<{
    success: boolean;
    data?: any;
    error?: any;
    qualityScore?: number;
  }> {
    const startTime = Date.now();

    try {
      let result;
      
      switch (route.type) {
        case 'provider':
          result = await this.executeProviderFallback(route, context);
          break;
        case 'agent':
          result = await this.executeAgentFallback(route, context);
          break;
        case 'endpoint':
          result = await this.executeEndpointFallback(route, context);
          break;
        case 'model':
          result = await this.executeModelFallback(route, context);
          break;
        default:
          throw new Error(`Unknown fallback route type: ${route.type}`);
      }

      // Update route usage
      route.lastUsed = new Date();

      return {
        success: true,
        data: result.data,
        qualityScore: result.qualityScore
      };

    } catch (error) {
      return {
        success: false,
        error
      };
    }
  }

  /**
   * Provider fallback execution
   */
  private async executeProviderFallback(route: FallbackRoute, context: FallbackContext): Promise<any> {
    this.logger.debug('Executing provider fallback', {
      from: route.source,
      to: route.target
    });

    // Simulate provider switch
    await this.sleep(50 + Math.random() * 100);

    if (Math.random() < route.successRate) {
      return {
        data: {
          response: `Fallback response from ${route.target}`,
          provider: route.target,
          fallback: true,
          originalProvider: context.originalProvider
        },
        qualityScore: Math.max(0.6, route.successRate)
      };
    }

    throw new Error(`Provider fallback failed for ${route.target}`);
  }

  /**
   * Agent fallback execution
   */
  private async executeAgentFallback(route: FallbackRoute, context: FallbackContext): Promise<any> {
    this.logger.debug('Executing agent fallback', {
      from: route.source,
      to: route.target
    });

    // Simulate agent switch
    await this.sleep(30 + Math.random() * 80);

    if (Math.random() < route.successRate) {
      return {
        data: {
          response: `Fallback response from ${route.target}`,
          agent: route.target,
          fallback: true,
          originalAgent: context.originalAgent
        },
        qualityScore: Math.max(0.7, route.successRate)
      };
    }

    throw new Error(`Agent fallback failed for ${route.target}`);
  }

  /**
   * Endpoint fallback execution
   */
  private async executeEndpointFallback(route: FallbackRoute, context: FallbackContext): Promise<any> {
    this.logger.debug('Executing endpoint fallback', {
      to: route.target
    });

    if (route.target === 'emergency') {
      // Emergency response
      this.metrics.emergencyActivations++;
      return {
        data: {
          status: 'emergency_mode',
          message: 'Service is currently experiencing issues. Emergency fallback activated.',
          response: 'I apologize, but I am currently experiencing technical difficulties. Please try again later or contact support.',
          emergency: true,
          timestamp: new Date().toISOString()
        },
        qualityScore: 0.3
      };
    }

    // Simulate endpoint switch
    await this.sleep(20 + Math.random() * 60);

    if (Math.random() < route.successRate) {
      return {
        data: {
          response: `Fallback response from endpoint ${route.target}`,
          endpoint: route.target,
          fallback: true
        },
        qualityScore: Math.max(0.5, route.successRate)
      };
    }

    throw new Error(`Endpoint fallback failed for ${route.target}`);
  }

  /**
   * Model fallback execution
   */
  private async executeModelFallback(route: FallbackRoute, context: FallbackContext): Promise<any> {
    this.logger.debug('Executing model fallback', {
      from: route.source,
      to: route.target
    });

    // Simulate model switch
    await this.sleep(40 + Math.random() * 120);

    if (Math.random() < route.successRate) {
      return {
        data: {
          response: `Fallback response from model ${route.target}`,
          model: route.target,
          fallback: true,
          originalModel: route.source
        },
        qualityScore: Math.max(0.6, route.successRate * 0.9)
      };
    }

    throw new Error(`Model fallback failed for ${route.target}`);
  }

  /**
   * Error condition checkers
   */
  private isProviderError(context: FallbackContext): boolean {
    const providerErrors = ['PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'API_LIMIT_EXCEEDED'];
    return providerErrors.includes(context.error?.code) || 
           (context.error?.status >= 500 && context.error?.status < 600);
  }

  private isModelError(context: FallbackContext): boolean {
    const modelErrors = ['MODEL_UNAVAILABLE', 'MODEL_OVERLOADED', 'UNSUPPORTED_OPERATION'];
    return modelErrors.includes(context.error?.code) || context.error?.model;
  }

  private isCostConstraint(context: FallbackContext): boolean {
    return context.error?.code === 'BUDGET_EXCEEDED' || 
           context.metadata?.costOptimization === true;
  }

  /**
   * Circuit breaker management
   */
  private isCircuitBreakerOpen(target: string): boolean {
    const breaker = this.circuitBreakers.get(target);
    
    if (!breaker || breaker.state === 'closed') {
      return false;
    }

    if (breaker.state === 'open') {
      // Check if we should transition to half-open
      const timeout = 60000; // 1 minute
      if (Date.now() - breaker.lastFailure.getTime() > timeout) {
        breaker.state = 'half-open';
        breaker.nextAttempt = new Date();
        return false;
      }
      return true;
    }

    return false; // half-open
  }

  private updateCircuitBreaker(target: string): void {
    let breaker = this.circuitBreakers.get(target);
    
    if (!breaker) {
      breaker = {
        state: 'closed',
        failures: 0,
        lastFailure: new Date()
      };
      this.circuitBreakers.set(target, breaker);
    }

    breaker.failures++;
    breaker.lastFailure = new Date();

    if (breaker.failures >= this.config.providerFailureThreshold) {
      breaker.state = 'open';
      
      this.emit('circuitBreakerOpened', {
        target,
        failures: breaker.failures
      });
      
      this.logger.warn('Circuit breaker opened', {
        target,
        failures: breaker.failures
      });
    }
  }

  private resetCircuitBreaker(target: string): void {
    const breaker = this.circuitBreakers.get(target);
    if (breaker) {
      breaker.failures = 0;
      breaker.state = 'closed';
      
      this.emit('circuitBreakerReset', { target });
    }
  }

  /**
   * Route metrics update
   */
  private updateRouteMetrics(routeId: string, success: boolean): void {
    const route = this.fallbackRoutes.get(routeId);
    if (!route) return;

    // Update success rate using exponential moving average
    const alpha = 0.1;
    const newValue = success ? 1 : 0;
    route.successRate = alpha * newValue + (1 - alpha) * route.successRate;

    // Update usage metrics
    const current = this.metrics.routesUsed.get(routeId) || 0;
    this.metrics.routesUsed.set(routeId, current + 1);
  }

  /**
   * Health monitoring
   */
  private startHealthMonitoring(): void {
    setInterval(() => {
      this.checkProviderHealth();
    }, this.config.healthCheckInterval);
  }

  private async checkProviderHealth(): Promise<void> {
    const providers = ['openai', 'claude', 'gemini'];

    for (const providerId of providers) {
      try {
        // Simulate health check
        const isHealthy = Math.random() > 0.05; // 95% uptime simulation
        const responseTime = 100 + Math.random() * 200;

        let health = this.providerHealth.get(providerId);
        if (!health) {
          health = {
            providerId,
            isHealthy: true,
            successRate: 0.95,
            averageResponseTime: responseTime,
            errorRate: 0.05,
            lastHealthCheck: new Date(),
            consecutiveFailures: 0,
            metadata: {}
          };
          this.providerHealth.set(providerId, health);
        }

        health.isHealthy = isHealthy;
        health.averageResponseTime = (health.averageResponseTime * 0.8) + (responseTime * 0.2);
        health.lastHealthCheck = new Date();

        if (isHealthy) {
          health.consecutiveFailures = 0;
        } else {
          health.consecutiveFailures++;
          health.lastError = `Health check failed for ${providerId}`;
        }

        // Emit health status change
        this.emit('healthStatusChanged', {
          providerId,
          isHealthy,
          consecutiveFailures: health.consecutiveFailures
        });

      } catch (error) {
        this.logger.error('Health check failed', {
          providerId,
          error: error.message
        });
      }
    }
  }

  /**
   * Utility methods
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Public API methods
   */

  /**
   * Enable/disable fallback routing
   */
  setFallbackEnabled(enabled: boolean): void {
    this.config.enableFallbacks = enabled;
    this.logger.info(`Fallback routing ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable/disable emergency mode
   */
  setEmergencyMode(enabled: boolean): void {
    this.config.emergencyMode = enabled;
    this.logger.warn(`Emergency mode ${enabled ? 'activated' : 'deactivated'}`);
    
    if (enabled) {
      this.emit('emergencyModeActivated');
    } else {
      this.emit('emergencyModeDeactivated');
    }
  }

  /**
   * Get fallback metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Get provider health status
   */
  getProviderHealth(): Map<string, ProviderHealth> {
    return new Map(this.providerHealth);
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(): Map<string, any> {
    return new Map(this.circuitBreakers);
  }

  /**
   * Get fallback routes
   */
  getFallbackRoutes(): Map<string, FallbackRoute> {
    return new Map(this.fallbackRoutes);
  }

  /**
   * Remove a fallback route
   */
  removeFallbackRoute(routeId: string): boolean {
    const deleted = this.fallbackRoutes.delete(routeId);
    if (deleted) {
      this.logger.info(`Removed fallback route: ${routeId}`);
    }
    return deleted;
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalFallbacks: 0,
      successfulFallbacks: 0,
      failedFallbacks: 0,
      routesUsed: new Map(),
      averageFallbackTime: 0,
      providerSwitches: 0,
      agentSwitches: 0,
      emergencyActivations: 0
    };
    
    this.logger.info('Fallback router metrics reset');
  }
}

export default FallbackRouterService;
