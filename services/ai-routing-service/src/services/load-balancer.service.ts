
import { EventEmitter } from 'events';
import { logger } from '@ai-platform/shared-utils';
import { ProviderHealthService } from '../monitoring/provider-health.service';
import { CapacityManagerService } from './capacity-manager.service';
import { AIProviderType } from '../types/ai-types';

export interface LoadBalancingStrategy {
  ROUND_ROBIN: 'round_robin';
  WEIGHTED_ROUND_ROBIN: 'weighted_round_robin';
  LEAST_CONNECTIONS: 'least_connections';
  RESPONSE_TIME: 'response_time';
  COST_OPTIMIZED: 'cost_optimized';
  INTELLIGENT: 'intelligent';
}

export interface ProviderMetrics {
  providerId: string;
  providerType: AIProviderType;
  currentConnections: number;
  averageResponseTime: number;
  requestCount: number;
  errorRate: number;
  cost: number;
  availability: number;
  weight: number;
  lastUsed: Date;
  priority: number;
}

export interface LoadBalancingConfig {
  strategy: keyof LoadBalancingStrategy;
  healthCheckInterval: number;
  maxRetries: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
  weights: Record<string, number>;
  costWeight: number;
  performanceWeight: number;
  availabilityWeight: number;
}

export class LoadBalancerService extends EventEmitter {
  private providerMetrics: Map<string, ProviderMetrics> = new Map();
  private roundRobinIndex = 0;
  private config: LoadBalancingConfig;
  private healthService: ProviderHealthService;
  private capacityManager: CapacityManagerService;
  private circuitBreakers: Map<string, { isOpen: boolean; lastFailure: Date; failureCount: number }> = new Map();

  constructor(
    config: LoadBalancingConfig,
    healthService: ProviderHealthService,
    capacityManager: CapacityManagerService
  ) {
    super();
    this.config = config;
    this.healthService = healthService;
    this.capacityManager = capacityManager;
    this.initializeCircuitBreakers();
  }

  /**
   * Initialize circuit breakers for all providers
   */
  private initializeCircuitBreakers(): void {
    const providers = [
      'openai-gpt-4',
      'openai-gpt-3.5',
      'claude-3',
      'gemini-pro',
      'ollama-mistral'
    ];

    providers.forEach(providerId => {
      this.circuitBreakers.set(providerId, {
        isOpen: false,
        lastFailure: new Date(0),
        failureCount: 0
      });
    });
  }

  /**
   * Select the best provider based on current strategy and conditions
   */
  async selectProvider(
    availableProviders: string[],
    requestContext?: {
      complexity?: number;
      urgency?: 'low' | 'medium' | 'high';
      budget?: number;
      preferredProvider?: string;
    }
  ): Promise<string | null> {
    try {
      // Filter out unhealthy and circuit-opened providers
      const healthyProviders = await this.filterHealthyProviders(availableProviders);
      
      if (healthyProviders.length === 0) {
        logger.warn('No healthy providers available', { availableProviders });
        return null;
      }

      // Check capacity constraints
      const capacityFilteredProviders = await this.filterByCapacity(healthyProviders);
      
      if (capacityFilteredProviders.length === 0) {
        logger.warn('No providers with available capacity', { healthyProviders });
        return null;
      }

      // Apply load balancing strategy
      const selectedProvider = await this.applyLoadBalancingStrategy(
        capacityFilteredProviders,
        requestContext
      );

      if (selectedProvider) {
        await this.recordProviderSelection(selectedProvider);
        this.emit('providerSelected', {
          provider: selectedProvider,
          strategy: this.config.strategy,
          availableCount: capacityFilteredProviders.length
        });
      }

      return selectedProvider;
    } catch (error) {
      logger.error('Error selecting provider', { error, availableProviders });
      return null;
    }
  }

  /**
   * Filter providers based on health status and circuit breaker state
   */
  private async filterHealthyProviders(providers: string[]): Promise<string[]> {
    const healthyProviders: string[] = [];

    for (const providerId of providers) {
      const isHealthy = await this.healthService.checkProviderHealth(providerId);
      const circuitBreaker = this.circuitBreakers.get(providerId);
      
      if (isHealthy && !circuitBreaker?.isOpen) {
        healthyProviders.push(providerId);
      } else if (circuitBreaker?.isOpen) {
        // Check if circuit breaker should be reset
        const timeSinceFailure = Date.now() - circuitBreaker.lastFailure.getTime();
        if (timeSinceFailure > 60000) { // 1 minute cooldown
          circuitBreaker.isOpen = false;
          circuitBreaker.failureCount = 0;
          healthyProviders.push(providerId);
        }
      }
    }

    return healthyProviders;
  }

  /**
   * Filter providers based on capacity constraints
   */
  private async filterByCapacity(providers: string[]): Promise<string[]> {
    const capacityFilteredProviders: string[] = [];

    for (const providerId of providers) {
      const hasCapacity = await this.capacityManager.hasAvailableCapacity(providerId);
      if (hasCapacity) {
        capacityFilteredProviders.push(providerId);
      }
    }

    return capacityFilteredProviders;
  }

  /**
   * Apply the configured load balancing strategy
   */
  private async applyLoadBalancingStrategy(
    providers: string[],
    requestContext?: any
  ): Promise<string | null> {
    switch (this.config.strategy) {
      case 'ROUND_ROBIN':
        return this.roundRobinSelection(providers);
      
      case 'WEIGHTED_ROUND_ROBIN':
        return this.weightedRoundRobinSelection(providers);
      
      case 'LEAST_CONNECTIONS':
        return this.leastConnectionsSelection(providers);
      
      case 'RESPONSE_TIME':
        return this.responseTimeBasedSelection(providers);
      
      case 'COST_OPTIMIZED':
        return this.costOptimizedSelection(providers);
      
      case 'INTELLIGENT':
        return this.intelligentSelection(providers, requestContext);
      
      default:
        return this.roundRobinSelection(providers);
    }
  }

  /**
   * Round robin provider selection
   */
  private roundRobinSelection(providers: string[]): string {
    const provider = providers[this.roundRobinIndex % providers.length];
    this.roundRobinIndex++;
    return provider;
  }

  /**
   * Weighted round robin selection based on provider performance
   */
  private weightedRoundRobinSelection(providers: string[]): string {
    const weights = providers.map(p => this.config.weights[p] || 1);
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let randomWeight = Math.random() * totalWeight;
    
    for (let i = 0; i < providers.length; i++) {
      randomWeight -= weights[i];
      if (randomWeight <= 0) {
        return providers[i];
      }
    }
    
    return providers[0];
  }

  /**
   * Select provider with least active connections
   */
  private leastConnectionsSelection(providers: string[]): string {
    let selectedProvider = providers[0];
    let minConnections = this.getProviderMetrics(providers[0]).currentConnections;

    for (const providerId of providers) {
      const connections = this.getProviderMetrics(providerId).currentConnections;
      if (connections < minConnections) {
        minConnections = connections;
        selectedProvider = providerId;
      }
    }

    return selectedProvider;
  }

  /**
   * Select provider with best response time
   */
  private responseTimeBasedSelection(providers: string[]): string {
    let selectedProvider = providers[0];
    let bestResponseTime = this.getProviderMetrics(providers[0]).averageResponseTime;

    for (const providerId of providers) {
      const responseTime = this.getProviderMetrics(providerId).averageResponseTime;
      if (responseTime < bestResponseTime) {
        bestResponseTime = responseTime;
        selectedProvider = providerId;
      }
    }

    return selectedProvider;
  }

  /**
   * Select provider optimized for cost
   */
  private costOptimizedSelection(providers: string[]): string {
    let selectedProvider = providers[0];
    let bestCostScore = this.calculateCostScore(providers[0]);

    for (const providerId of providers) {
      const costScore = this.calculateCostScore(providerId);
      if (costScore < bestCostScore) {
        bestCostScore = costScore;
        selectedProvider = providerId;
      }
    }

    return selectedProvider;
  }

  /**
   * Intelligent selection using multiple factors and ML-based scoring
   */
  private intelligentSelection(providers: string[], requestContext?: any): string {
    let selectedProvider = providers[0];
    let bestScore = this.calculateIntelligentScore(providers[0], requestContext);

    for (const providerId of providers) {
      const score = this.calculateIntelligentScore(providerId, requestContext);
      if (score > bestScore) {
        bestScore = score;
        selectedProvider = providerId;
      }
    }

    return selectedProvider;
  }

  /**
   * Calculate cost score for a provider
   */
  private calculateCostScore(providerId: string): number {
    const metrics = this.getProviderMetrics(providerId);
    // Lower cost and higher availability result in better (lower) score
    return metrics.cost / Math.max(metrics.availability, 0.1);
  }

  /**
   * Calculate intelligent score using multiple factors
   */
  private calculateIntelligentScore(providerId: string, requestContext?: any): number {
    const metrics = this.getProviderMetrics(providerId);
    
    // Normalize metrics to 0-1 scale
    const performanceScore = Math.max(0, 1 - metrics.averageResponseTime / 10000); // Assume 10s max
    const availabilityScore = metrics.availability;
    const costScore = Math.max(0, 1 - metrics.cost / 100); // Assume $100 max cost
    const connectionScore = Math.max(0, 1 - metrics.currentConnections / 1000); // Assume 1000 max connections
    
    // Apply weights from configuration
    const compositeScore = 
      performanceScore * this.config.performanceWeight +
      availabilityScore * this.config.availabilityWeight +
      costScore * this.config.costWeight +
      connectionScore * 0.1; // Connection load factor

    // Apply context-based adjustments
    let contextMultiplier = 1.0;
    if (requestContext?.urgency === 'high') {
      contextMultiplier *= (1 + performanceScore * 0.2);
    }
    if (requestContext?.budget && requestContext.budget < 10) {
      contextMultiplier *= (1 + costScore * 0.3);
    }
    if (requestContext?.preferredProvider === providerId) {
      contextMultiplier *= 1.2;
    }

    return compositeScore * contextMultiplier;
  }

  /**
   * Get or initialize provider metrics
   */
  private getProviderMetrics(providerId: string): ProviderMetrics {
    if (!this.providerMetrics.has(providerId)) {
      this.providerMetrics.set(providerId, {
        providerId,
        providerType: this.getProviderType(providerId),
        currentConnections: 0,
        averageResponseTime: 1000,
        requestCount: 0,
        errorRate: 0,
        cost: 10,
        availability: 1.0,
        weight: 1.0,
        lastUsed: new Date(0),
        priority: 5
      });
    }
    return this.providerMetrics.get(providerId)!;
  }

  /**
   * Get provider type from provider ID
   */
  private getProviderType(providerId: string): AIProviderType {
    if (providerId.includes('openai')) return 'openai';
    if (providerId.includes('claude')) return 'claude';
    if (providerId.includes('gemini')) return 'gemini';
    if (providerId.includes('ollama')) return 'ollama';
    return 'openai'; // default
  }

  /**
   * Record provider selection for metrics
   */
  private async recordProviderSelection(providerId: string): Promise<void> {
    const metrics = this.getProviderMetrics(providerId);
    metrics.currentConnections++;
    metrics.requestCount++;
    metrics.lastUsed = new Date();
    
    // Update capacity manager
    await this.capacityManager.recordProviderUsage(providerId);
  }

  /**
   * Record provider response metrics
   */
  async recordProviderResponse(
    providerId: string, 
    responseTime: number, 
    success: boolean, 
    cost?: number
  ): Promise<void> {
    const metrics = this.getProviderMetrics(providerId);
    
    // Update response time (rolling average)
    metrics.averageResponseTime = 
      (metrics.averageResponseTime * 0.9) + (responseTime * 0.1);
    
    // Update error rate
    if (!success) {
      metrics.errorRate = (metrics.errorRate * 0.9) + 0.1;
      await this.handleProviderFailure(providerId);
    } else {
      metrics.errorRate = metrics.errorRate * 0.95;
      await this.handleProviderSuccess(providerId);
    }
    
    // Update cost if provided
    if (cost !== undefined) {
      metrics.cost = (metrics.cost * 0.9) + (cost * 0.1);
    }
    
    // Update connections
    metrics.currentConnections = Math.max(0, metrics.currentConnections - 1);
    
    // Emit metrics update event
    this.emit('metricsUpdated', {
      providerId,
      metrics: { ...metrics },
      success
    });
  }

  /**
   * Handle provider failure for circuit breaker
   */
  private async handleProviderFailure(providerId: string): Promise<void> {
    const circuitBreaker = this.circuitBreakers.get(providerId);
    if (circuitBreaker) {
      circuitBreaker.failureCount++;
      circuitBreaker.lastFailure = new Date();
      
      if (circuitBreaker.failureCount >= this.config.circuitBreakerThreshold) {
        circuitBreaker.isOpen = true;
        logger.warn('Circuit breaker opened for provider', { providerId });
        this.emit('circuitBreakerOpened', { providerId });
      }
    }
  }

  /**
   * Handle provider success for circuit breaker
   */
  private async handleProviderSuccess(providerId: string): Promise<void> {
    const circuitBreaker = this.circuitBreakers.get(providerId);
    if (circuitBreaker && circuitBreaker.isOpen) {
      circuitBreaker.isOpen = false;
      circuitBreaker.failureCount = 0;
      logger.info('Circuit breaker closed for provider', { providerId });
      this.emit('circuitBreakerClosed', { providerId });
    }
  }

  /**
   * Update provider weights dynamically
   */
  updateProviderWeights(weights: Record<string, number>): void {
    this.config.weights = { ...this.config.weights, ...weights };
    logger.info('Provider weights updated', { weights });
    this.emit('weightsUpdated', { weights });
  }

  /**
   * Get current load balancing metrics
   */
  getLoadBalancingMetrics(): {
    providerMetrics: Record<string, ProviderMetrics>;
    circuitBreakers: Record<string, any>;
    strategy: string;
  } {
    const providerMetricsObj: Record<string, ProviderMetrics> = {};
    const circuitBreakersObj: Record<string, any> = {};
    
    this.providerMetrics.forEach((metrics, providerId) => {
      providerMetricsObj[providerId] = { ...metrics };
    });
    
    this.circuitBreakers.forEach((breaker, providerId) => {
      circuitBreakersObj[providerId] = { ...breaker };
    });
    
    return {
      providerMetrics: providerMetricsObj,
      circuitBreakers: circuitBreakersObj,
      strategy: this.config.strategy
    };
  }

  /**
   * Reset all provider metrics
   */
  resetMetrics(): void {
    this.providerMetrics.clear();
    this.circuitBreakers.clear();
    this.initializeCircuitBreakers();
    logger.info('Load balancer metrics reset');
    this.emit('metricsReset');
  }
}

