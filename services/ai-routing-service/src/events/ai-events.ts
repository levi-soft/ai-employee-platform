
import { EventBus, EVENT_TYPES, EventPayload, createEventBus } from '@ai-platform/shared-utils';

export interface AIEventPayload extends EventPayload {
  userId?: string;
  requestId?: string;
  agentId?: string;
  agentName?: string;
  model?: string;
  provider?: string;
  costCredits?: number;
  duration?: number;
  tokenCount?: number;
  success?: boolean;
  error?: string;
}

export class AIEvents {
  private eventBus: EventBus;
  private serviceName = 'ai-routing-service';

  constructor() {
    this.eventBus = createEventBus({
      serviceName: this.serviceName,
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
      },
      enablePersistence: true,
      enableDeadLetterQueue: true,
      retryAttempts: 3,
      retryDelay: 1000,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Subscribe to billing events for credit tracking
    this.eventBus.subscribe(EVENT_TYPES.BILLING.CREDIT_CONSUMED, this.handleCreditConsumed.bind(this));
    this.eventBus.subscribe(EVENT_TYPES.BILLING.BUDGET_EXCEEDED, this.handleBudgetExceeded.bind(this));
  }

  // AI request lifecycle events
  public async publishRequestStart(requestId: string, userId: string, agentId: string, details: any): Promise<void> {
    await this.eventBus.publish(EVENT_TYPES.AI.REQUEST_START, {
      requestId,
      userId,
      agentId,
      agentName: details.agentName,
      model: details.model,
      provider: details.provider,
      capabilities: details.capabilities,
      priority: details.priority || 'normal',
      estimatedCost: details.estimatedCost,
      startTime: new Date().toISOString(),
      ...details,
    }, { priority: 'medium' });
  }

  public async publishRequestComplete(requestId: string, userId: string, result: any): Promise<void> {
    await this.eventBus.publish(EVENT_TYPES.AI.REQUEST_COMPLETE, {
      requestId,
      userId,
      agentId: result.agentId,
      agentName: result.agentName,
      model: result.model,
      provider: result.provider,
      success: true,
      duration: result.duration,
      tokenCount: result.tokenCount,
      costCredits: result.costCredits,
      completedTime: new Date().toISOString(),
      qualityScore: result.qualityScore,
      ...result,
    }, { priority: 'medium', persistent: true });
  }

  public async publishRequestFailed(requestId: string, userId: string, error: any, details: any): Promise<void> {
    await this.eventBus.publish(EVENT_TYPES.AI.REQUEST_FAILED, {
      requestId,
      userId,
      agentId: details.agentId,
      agentName: details.agentName,
      model: details.model,
      provider: details.provider,
      success: false,
      error: error.message || error,
      errorCode: error.code,
      duration: details.duration,
      failedTime: new Date().toISOString(),
      retryCount: details.retryCount || 0,
      ...details,
    }, { priority: 'high', persistent: true });
  }

  // Agent health and performance events
  public async publishAgentHealthChange(agentId: string, oldStatus: string, newStatus: string, details: any): Promise<void> {
    await this.eventBus.publish(EVENT_TYPES.AI.AGENT_HEALTH_CHANGE, {
      agentId,
      agentName: details.agentName,
      model: details.model,
      provider: details.provider,
      oldStatus,
      newStatus,
      responseTime: details.responseTime,
      errorRate: details.errorRate,
      loadLevel: details.loadLevel,
      timestamp: new Date().toISOString(),
      healthCheckDetails: details.healthCheckDetails,
    }, { priority: 'high', persistent: true });
  }

  public async publishAgentPerformanceMetrics(agentId: string, metrics: any): Promise<void> {
    await this.eventBus.publish('ai.agent.performance', {
      agentId,
      agentName: metrics.agentName,
      model: metrics.model,
      provider: metrics.provider,
      averageResponseTime: metrics.averageResponseTime,
      successRate: metrics.successRate,
      requestCount: metrics.requestCount,
      tokenThroughput: metrics.tokenThroughput,
      costEfficiency: metrics.costEfficiency,
      utilizationRate: metrics.utilizationRate,
      timestamp: new Date().toISOString(),
    }, { priority: 'low' });
  }

  // Routing and optimization events
  public async publishRoutingDecision(userId: string, request: any, selectedAgent: any, alternatives: any[]): Promise<void> {
    await this.eventBus.publish('ai.routing.decision', {
      userId,
      requestId: request.id,
      requestType: request.type,
      capabilities: request.capabilities,
      selectedAgent: {
        id: selectedAgent.id,
        name: selectedAgent.name,
        model: selectedAgent.model,
        provider: selectedAgent.provider,
        score: selectedAgent.score,
        reasoning: selectedAgent.reasoning,
      },
      alternatives: alternatives.map(alt => ({
        id: alt.id,
        name: alt.name,
        score: alt.score,
        reason: alt.reason,
      })),
      decisionTime: new Date().toISOString(),
    }, { priority: 'low' });
  }

  public async publishCostOptimization(userId: string, originalCost: number, optimizedCost: number, savings: number, details: any): Promise<void> {
    await this.eventBus.publish('ai.cost.optimization', {
      userId,
      originalCost,
      optimizedCost,
      savings,
      savingsPercentage: (savings / originalCost) * 100,
      optimizationStrategy: details.strategy,
      alternativeAgent: details.alternativeAgent,
      timestamp: new Date().toISOString(),
    }, { priority: 'medium', persistent: true });
  }

  // Load balancing events
  public async publishLoadBalancingMetrics(strategy: string, metrics: any): Promise<void> {
    await this.eventBus.publish('ai.load_balancing.metrics', {
      strategy,
      totalRequests: metrics.totalRequests,
      requestDistribution: metrics.requestDistribution,
      averageResponseTime: metrics.averageResponseTime,
      successRate: metrics.successRate,
      agentUtilization: metrics.agentUtilization,
      timestamp: new Date().toISOString(),
    }, { priority: 'low' });
  }

  public async publishLoadBalancingAlert(alert: string, severity: 'low' | 'medium' | 'high', details: any): Promise<void> {
    await this.eventBus.publish('ai.load_balancing.alert', {
      alert,
      severity,
      affectedAgents: details.affectedAgents,
      currentLoad: details.currentLoad,
      threshold: details.threshold,
      recommendedAction: details.recommendedAction,
      timestamp: new Date().toISOString(),
    }, { priority: severity === 'high' ? 'high' : 'medium', persistent: true });
  }

  // Capability and model events
  public async publishCapabilityRequest(userId: string, requestedCapability: string, available: boolean, alternatives: string[]): Promise<void> {
    await this.eventBus.publish('ai.capability.request', {
      userId,
      requestedCapability,
      available,
      alternatives,
      timestamp: new Date().toISOString(),
    }, { priority: 'low' });
  }

  public async publishModelUsageStats(model: string, provider: string, stats: any): Promise<void> {
    await this.eventBus.publish('ai.model.usage_stats', {
      model,
      provider,
      requestCount: stats.requestCount,
      totalTokens: stats.totalTokens,
      averageResponseTime: stats.averageResponseTime,
      successRate: stats.successRate,
      totalCost: stats.totalCost,
      period: stats.period,
      timestamp: new Date().toISOString(),
    }, { priority: 'low', persistent: true });
  }

  // Quality and feedback events
  public async publishQualityFeedback(requestId: string, userId: string, rating: number, feedback: string): Promise<void> {
    await this.eventBus.publish('ai.quality.feedback', {
      requestId,
      userId,
      rating,
      feedback,
      timestamp: new Date().toISOString(),
    }, { priority: 'medium', persistent: true });
  }

  public async publishQualityAlert(agentId: string, qualityIssue: string, severity: string, details: any): Promise<void> {
    await this.eventBus.publish('ai.quality.alert', {
      agentId,
      agentName: details.agentName,
      qualityIssue,
      severity,
      averageRating: details.averageRating,
      recentRatings: details.recentRatings,
      impactedRequests: details.impactedRequests,
      recommendedAction: details.recommendedAction,
      timestamp: new Date().toISOString(),
    }, { priority: severity === 'critical' ? 'high' : 'medium', persistent: true });
  }

  // Event handlers for incoming events
  private async handleCreditConsumed(payload: EventPayload): Promise<void> {
    try {
      const { userId, amount, remainingCredits, requestId } = payload.data;
      
      console.log(`[AIEvents] Credit consumed for AI request - User: ${userId}, Amount: ${amount}, Remaining: ${remainingCredits}`);
      
      // Track AI-specific credit consumption
      await this.eventBus.publish('ai.credit.consumed', {
        userId,
        requestId,
        creditsConsumed: amount,
        remainingCredits,
        timestamp: new Date().toISOString(),
      }, { priority: 'low' });
    } catch (error) {
      console.error('[AIEvents] Error handling credit consumed event:', error);
    }
  }

  private async handleBudgetExceeded(payload: EventPayload): Promise<void> {
    try {
      const { userId, budgetLimit, currentUsage } = payload.data;
      
      console.log(`[AIEvents] Budget exceeded affecting AI services - User: ${userId}, Limit: ${budgetLimit}, Usage: ${currentUsage}`);
      
      // Publish AI-specific budget alert
      await this.publishLoadBalancingAlert(
        'user_budget_exceeded',
        'high',
        {
          userId,
          budgetLimit,
          currentUsage,
          affectedAgents: ['all'],
          currentLoad: 'paused',
          threshold: budgetLimit,
          recommendedAction: 'Pause AI requests until budget reset or increase',
        }
      );
    } catch (error) {
      console.error('[AIEvents] Error handling budget exceeded event:', error);
    }
  }

  // Utility methods
  public async getRequestHistory(userId?: string, limit: number = 100): Promise<EventPayload[]> {
    const events = await Promise.all([
      this.eventBus.getEventHistory(EVENT_TYPES.AI.REQUEST_START, limit),
      this.eventBus.getEventHistory(EVENT_TYPES.AI.REQUEST_COMPLETE, limit),
      this.eventBus.getEventHistory(EVENT_TYPES.AI.REQUEST_FAILED, limit),
    ]);
    
    const allEvents = events.flat().sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    
    if (userId) {
      return allEvents.filter(event => event.data.userId === userId).slice(0, limit);
    }
    
    return allEvents.slice(0, limit);
  }

  public async getAgentPerformanceHistory(agentId?: string, limit: number = 50): Promise<EventPayload[]> {
    const events = await this.eventBus.getEventHistory('ai.agent.performance', limit);
    
    if (agentId) {
      return events.filter(event => event.data.agentId === agentId);
    }
    
    return events;
  }

  public getMetrics() {
    return this.eventBus.getMetrics();
  }

  public async disconnect(): Promise<void> {
    await this.eventBus.disconnect();
  }
}

// Singleton instance
let aiEventsInstance: AIEvents | null = null;

export function getAIEvents(): AIEvents {
  if (!aiEventsInstance) {
    aiEventsInstance = new AIEvents();
  }
  return aiEventsInstance;
}
