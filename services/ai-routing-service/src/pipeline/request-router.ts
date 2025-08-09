
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';
import { IPreprocessedRequest } from './request-preprocessor';
import { AgentRegistryService } from '../services/agent-registry.service';
import { LoadBalancerService } from '../services/load-balancer.service';
import { CapabilityDiscoveryService } from '../services/capability-discovery.service';

export interface IRoutingResult {
  requestId: string;
  selectedProvider?: {
    id: string;
    name: string;
    type: 'openai' | 'claude' | 'gemini' | 'ollama' | 'custom';
    endpoint: string;
    model?: string;
    capabilities: string[];
    estimatedCost: number;
    estimatedResponseTime: number;
  };
  selectedAgent?: {
    id: string;
    name: string;
    version: string;
    capabilities: string[];
    confidence: number;
  };
  fallbackOptions: Array<{
    id: string;
    name: string;
    type: string;
    reason: string;
    priority: number;
  }>;
  routingStrategy: 'provider' | 'agent' | 'hybrid';
  routingReason: string;
  processingTime: number;
  metadata: {
    attemptCount: number;
    fallbackUsed: boolean;
    costOptimized: boolean;
    qualityScore: number;
  };
}

export interface IRoutingStrategy {
  name: string;
  priority: number;
  condition: (request: IPreprocessedRequest) => boolean;
  route: (request: IPreprocessedRequest) => Promise<IRoutingResult>;
}

export interface IFallbackConfig {
  maxAttempts: number;
  fallbackDelay: number;
  retryStrategies: ('same_provider' | 'different_provider' | 'agent_fallback')[];
  emergencyProvider?: string;
}

/**
 * Advanced request routing service with intelligent provider/agent selection and fallback mechanisms
 */
export class RequestRouterService extends EventEmitter {
  private logger: Logger;
  private agentRegistry: AgentRegistryService;
  private loadBalancer: LoadBalancerService;
  private capabilityDiscovery: CapabilityDiscoveryService;
  private routingStrategies: Map<string, IRoutingStrategy> = new Map();
  private fallbackConfig: IFallbackConfig;
  private routingHistory = new Map<string, any[]>();

  constructor(
    agentRegistry: AgentRegistryService,
    loadBalancer: LoadBalancerService,
    capabilityDiscovery: CapabilityDiscoveryService
  ) {
    super();
    this.logger = new Logger('RequestRouter');
    this.agentRegistry = agentRegistry;
    this.loadBalancer = loadBalancer;
    this.capabilityDiscovery = capabilityDiscovery;
    
    this.fallbackConfig = {
      maxAttempts: 3,
      fallbackDelay: 1000,
      retryStrategies: ['different_provider', 'agent_fallback', 'same_provider'],
      emergencyProvider: 'gpt-3.5-turbo'
    };

    this.initializeRoutingStrategies();
  }

  /**
   * Main routing entry point
   */
  async routeRequest(request: IPreprocessedRequest): Promise<IRoutingResult> {
    const startTime = Date.now();
    let attemptCount = 0;
    let lastError: Error | null = null;

    this.logger.info('Starting request routing', {
      requestId: request.id,
      type: request.normalizedRequest.type,
      priority: request.metadata.priority
    });

    // Get applicable routing strategies
    const strategies = this.getApplicableStrategies(request);

    for (const strategy of strategies) {
      attemptCount++;

      try {
        this.logger.debug('Trying routing strategy', {
          requestId: request.id,
          strategy: strategy.name,
          attempt: attemptCount
        });

        const result = await strategy.route(request);
        result.metadata.attemptCount = attemptCount;
        result.processingTime = Date.now() - startTime;

        // Record successful routing
        this.recordRoutingHistory(request.id, {
          strategy: strategy.name,
          success: true,
          processingTime: result.processingTime,
          selectedProvider: result.selectedProvider?.id,
          selectedAgent: result.selectedAgent?.id
        });

        this.logger.info('Request routed successfully', {
          requestId: request.id,
          strategy: strategy.name,
          provider: result.selectedProvider?.name,
          agent: result.selectedAgent?.name,
          processingTime: result.processingTime,
          attemptCount
        });

        this.emit('routingSuccess', { request, result });
        return result;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        this.logger.warn('Routing strategy failed', {
          requestId: request.id,
          strategy: strategy.name,
          error: lastError.message,
          attempt: attemptCount
        });

        // Record failed routing attempt
        this.recordRoutingHistory(request.id, {
          strategy: strategy.name,
          success: false,
          error: lastError.message,
          attempt: attemptCount
        });
      }
    }

    // All strategies failed, try fallback routing
    this.logger.warn('All routing strategies failed, trying fallback', {
      requestId: request.id,
      attemptCount
    });

    try {
      const fallbackResult = await this.fallbackRouting(request);
      fallbackResult.metadata.attemptCount = attemptCount + 1;
      fallbackResult.metadata.fallbackUsed = true;
      fallbackResult.processingTime = Date.now() - startTime;

      this.emit('fallbackUsed', { request, result: fallbackResult });
      return fallbackResult;

    } catch (error) {
      const finalError = error instanceof Error ? error : new Error(String(error));
      
      this.logger.error('Request routing failed completely', {
        requestId: request.id,
        finalError: finalError.message,
        totalAttempts: attemptCount + 1
      });

      // Return failed routing result
      const failedResult: IRoutingResult = {
        requestId: request.id,
        fallbackOptions: [],
        routingStrategy: 'provider',
        routingReason: `All routing attempts failed: ${finalError.message}`,
        processingTime: Date.now() - startTime,
        metadata: {
          attemptCount: attemptCount + 1,
          fallbackUsed: true,
          costOptimized: false,
          qualityScore: 0
        }
      };

      this.emit('routingError', { request, error: finalError, result: failedResult });
      throw finalError;
    }
  }

  /**
   * Fallback routing mechanism
   */
  private async fallbackRouting(request: IPreprocessedRequest): Promise<IRoutingResult> {
    const fallbackOptions: Array<{ id: string; name: string; type: string; reason: string; priority: number }> = [];

    // Try emergency provider if configured
    if (this.fallbackConfig.emergencyProvider) {
      try {
        const provider = await this.loadBalancer.getProvider(this.fallbackConfig.emergencyProvider);
        if (provider && provider.isHealthy) {
          return {
            requestId: request.id,
            selectedProvider: {
              id: provider.id,
              name: provider.name,
              type: provider.type as any,
              endpoint: provider.config.endpoint,
              model: this.fallbackConfig.emergencyProvider,
              capabilities: provider.capabilities || [],
              estimatedCost: 0.001, // Emergency pricing
              estimatedResponseTime: 2000
            },
            fallbackOptions,
            routingStrategy: 'provider',
            routingReason: 'Emergency fallback to configured provider',
            processingTime: 0,
            metadata: {
              attemptCount: 1,
              fallbackUsed: true,
              costOptimized: false,
              qualityScore: 5 // Moderate quality for fallback
            }
          };
        }
      } catch (error) {
        this.logger.warn('Emergency provider unavailable', {
          provider: this.fallbackConfig.emergencyProvider,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Try any available provider
    const availableProviders = await this.loadBalancer.getAvailableProviders();
    for (const provider of availableProviders.slice(0, 3)) { // Try top 3
      fallbackOptions.push({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        reason: 'Available provider fallback',
        priority: provider.priority
      });

      try {
        return {
          requestId: request.id,
          selectedProvider: {
            id: provider.id,
            name: provider.name,
            type: provider.type as any,
            endpoint: provider.config.endpoint,
            model: provider.defaultModel || 'default',
            capabilities: provider.capabilities || [],
            estimatedCost: 0.002, // Fallback pricing
            estimatedResponseTime: 3000
          },
          fallbackOptions,
          routingStrategy: 'provider',
          routingReason: 'Fallback to available provider',
          processingTime: 0,
          metadata: {
            attemptCount: 1,
            fallbackUsed: true,
            costOptimized: false,
            qualityScore: 4 // Lower quality for fallback
          }
        };
      } catch (error) {
        continue; // Try next provider
      }
    }

    throw new Error('No fallback options available');
  }

  /**
   * Get applicable routing strategies
   */
  private getApplicableStrategies(request: IPreprocessedRequest): IRoutingStrategy[] {
    const applicable: IRoutingStrategy[] = [];

    for (const strategy of this.routingStrategies.values()) {
      if (strategy.condition(request)) {
        applicable.push(strategy);
      }
    }

    // Sort by priority (higher first)
    return applicable.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Initialize routing strategies
   */
  private initializeRoutingStrategies(): void {
    // High-priority request strategy
    this.addStrategy({
      name: 'high_priority',
      priority: 100,
      condition: (request) => request.metadata.priority >= 8,
      route: async (request) => {
        // Route to best available provider for high priority
        const providers = await this.loadBalancer.getAvailableProviders();
        const bestProvider = providers
          .filter(p => p.isHealthy && p.responseTime < 2000)
          .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))[0];

        if (!bestProvider) {
          throw new Error('No suitable provider for high priority request');
        }

        return this.createProviderResult(request, bestProvider, 'high_priority');
      }
    });

    // Cost-optimized strategy
    this.addStrategy({
      name: 'cost_optimized',
      priority: 80,
      condition: (request) => {
        const context = request.context;
        return context.userTier === 'free' || request.metadata.estimatedCost > 0.1;
      },
      route: async (request) => {
        // Route to most cost-effective provider
        const providers = await this.loadBalancer.getAvailableProviders();
        const costEffective = providers
          .filter(p => p.isHealthy)
          .sort((a, b) => (a.costPerToken || 0) - (b.costPerToken || 0))[0];

        if (!costEffective) {
          throw new Error('No cost-effective provider available');
        }

        return this.createProviderResult(request, costEffective, 'cost_optimized', { costOptimized: true });
      }
    });

    // Agent-based strategy
    this.addStrategy({
      name: 'agent_based',
      priority: 90,
      condition: (request) => {
        const type = request.normalizedRequest.type;
        return ['code_generation', 'data_analysis', 'specialized_task'].includes(type);
      },
      route: async (request) => {
        // Find best matching agent
        const agents = await this.agentRegistry.searchAgents({
          capabilities: [request.normalizedRequest.type],
          status: 'active',
          limit: 5
        });

        if (agents.length === 0) {
          throw new Error('No suitable agents found');
        }

        const bestAgent = agents[0]; // Already sorted by score
        
        return {
          requestId: request.id,
          selectedAgent: {
            id: bestAgent.id,
            name: bestAgent.name,
            version: bestAgent.version,
            capabilities: bestAgent.capabilities.map(c => c.type),
            confidence: bestAgent.score || 0.8
          },
          fallbackOptions: agents.slice(1, 4).map((agent, index) => ({
            id: agent.id,
            name: agent.name,
            type: 'agent',
            reason: 'Alternative agent option',
            priority: index + 1
          })),
          routingStrategy: 'agent',
          routingReason: 'Matched to specialized agent based on capabilities',
          processingTime: 0,
          metadata: {
            attemptCount: 1,
            fallbackUsed: false,
            costOptimized: false,
            qualityScore: bestAgent.score || 0.8
          }
        };
      }
    });

    // Load balanced strategy
    this.addStrategy({
      name: 'load_balanced',
      priority: 70,
      condition: (request) => request.metadata.priority <= 7,
      route: async (request) => {
        // Use load balancer to select provider
        const provider = await this.loadBalancer.selectProvider({
          requestType: request.normalizedRequest.type,
          priority: request.metadata.priority,
          estimatedTokens: request.metadata.estimatedTokens.input
        });

        if (!provider) {
          throw new Error('No provider selected by load balancer');
        }

        return this.createProviderResult(request, provider, 'load_balanced');
      }
    });

    // Capability-based strategy
    this.addStrategy({
      name: 'capability_based',
      priority: 85,
      condition: (request) => {
        return request.normalizedRequest.parameters?.requiredCapabilities?.length > 0;
      },
      route: async (request) => {
        const requiredCapabilities = request.normalizedRequest.parameters.requiredCapabilities;
        
        // First try to find matching agents
        const matchingAgents = await this.capabilityDiscovery.findMatchingAgents({
          capabilities: requiredCapabilities,
          context: request.context
        });

        if (matchingAgents.length > 0) {
          const bestAgent = matchingAgents[0];
          return {
            requestId: request.id,
            selectedAgent: {
              id: bestAgent.id,
              name: bestAgent.name,
              version: bestAgent.version || '1.0.0',
              capabilities: bestAgent.capabilities,
              confidence: bestAgent.confidence
            },
            fallbackOptions: matchingAgents.slice(1, 3).map((agent, index) => ({
              id: agent.id,
              name: agent.name,
              type: 'agent',
              reason: 'Capability match',
              priority: index + 1
            })),
            routingStrategy: 'agent',
            routingReason: 'Matched based on required capabilities',
            processingTime: 0,
            metadata: {
              attemptCount: 1,
              fallbackUsed: false,
              costOptimized: false,
              qualityScore: bestAgent.confidence
            }
          };
        }

        // Fall back to provider with matching capabilities
        const providers = await this.loadBalancer.getAvailableProviders();
        const capableProvider = providers.find(p => 
          p.isHealthy && 
          requiredCapabilities.every(cap => p.capabilities?.includes(cap))
        );

        if (!capableProvider) {
          throw new Error('No provider with required capabilities');
        }

        return this.createProviderResult(request, capableProvider, 'capability_based');
      }
    });
  }

  /**
   * Create provider routing result
   */
  private createProviderResult(
    request: IPreprocessedRequest, 
    provider: any, 
    strategy: string, 
    extraMetadata: any = {}
  ): IRoutingResult {
    return {
      requestId: request.id,
      selectedProvider: {
        id: provider.id,
        name: provider.name,
        type: provider.type,
        endpoint: provider.config?.endpoint || provider.endpoint,
        model: provider.defaultModel || 'default',
        capabilities: provider.capabilities || [],
        estimatedCost: request.metadata.estimatedCost,
        estimatedResponseTime: provider.responseTime || 2000
      },
      fallbackOptions: [],
      routingStrategy: 'provider',
      routingReason: `Routed via ${strategy} strategy`,
      processingTime: 0,
      metadata: {
        attemptCount: 1,
        fallbackUsed: false,
        costOptimized: false,
        qualityScore: provider.qualityScore || 0.7,
        ...extraMetadata
      }
    };
  }

  /**
   * Add routing strategy
   */
  addStrategy(strategy: IRoutingStrategy): void {
    this.routingStrategies.set(strategy.name, strategy);
    this.logger.info('Routing strategy added', { 
      name: strategy.name, 
      priority: strategy.priority 
    });
  }

  /**
   * Remove routing strategy
   */
  removeStrategy(name: string): void {
    if (this.routingStrategies.delete(name)) {
      this.logger.info('Routing strategy removed', { name });
    }
  }

  /**
   * Record routing history
   */
  private recordRoutingHistory(requestId: string, entry: any): void {
    const history = this.routingHistory.get(requestId) || [];
    history.push({
      ...entry,
      timestamp: new Date().toISOString()
    });
    this.routingHistory.set(requestId, history);

    // Cleanup old history (keep last 1000 requests)
    if (this.routingHistory.size > 1000) {
      const oldestKey = this.routingHistory.keys().next().value;
      this.routingHistory.delete(oldestKey);
    }
  }

  /**
   * Get routing history for a request
   */
  getRoutingHistory(requestId: string): any[] {
    return this.routingHistory.get(requestId) || [];
  }

  /**
   * Get routing statistics
   */
  getRoutingStatistics(): {
    totalRequests: number;
    strategyUsage: Record<string, number>;
    successRate: number;
    averageProcessingTime: number;
    fallbackRate: number;
  } {
    const allHistory = Array.from(this.routingHistory.values()).flat();
    const totalRequests = allHistory.length;
    
    if (totalRequests === 0) {
      return {
        totalRequests: 0,
        strategyUsage: {},
        successRate: 0,
        averageProcessingTime: 0,
        fallbackRate: 0
      };
    }

    const strategyUsage: Record<string, number> = {};
    let successCount = 0;
    let totalProcessingTime = 0;
    let fallbackCount = 0;

    for (const entry of allHistory) {
      strategyUsage[entry.strategy] = (strategyUsage[entry.strategy] || 0) + 1;
      
      if (entry.success) {
        successCount++;
        totalProcessingTime += entry.processingTime || 0;
      }

      if (entry.strategy === 'fallback') {
        fallbackCount++;
      }
    }

    return {
      totalRequests,
      strategyUsage,
      successRate: successCount / totalRequests,
      averageProcessingTime: totalProcessingTime / successCount,
      fallbackRate: fallbackCount / totalRequests
    };
  }

  /**
   * Update fallback configuration
   */
  updateFallbackConfig(config: Partial<IFallbackConfig>): void {
    this.fallbackConfig = { ...this.fallbackConfig, ...config };
    this.logger.info('Fallback configuration updated', { config });
  }
}
