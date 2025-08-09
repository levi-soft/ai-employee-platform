
import { logger } from '@ai-platform/shared-utils';
import { aiRoutingConfig } from '../config/config';
import { AIAgent, PricingModel, DemandMetrics, PricingRule } from '../types';
import { RedisCache } from '../cache/request-cache.service';

export interface DynamicPricingStrategy {
  id: string;
  name: string;
  type: 'demand_based' | 'time_based' | 'quality_based' | 'competition_based' | 'hybrid';
  isActive: boolean;
  weight: number; // 0-1, for hybrid strategies
  parameters: PricingParameters;
  constraints: PricingConstraints;
}

export interface PricingParameters {
  baseMultiplier: number;
  maxMultiplier: number;
  minMultiplier: number;
  sensitivityFactor: number;
  adjustmentSpeed: number; // How quickly prices adjust
  demandThresholds: DemandThreshold[];
  timeBasedRules: TimeBasedRule[];
  qualityBasedRules: QualityBasedRule[];
}

export interface PricingConstraints {
  maxPriceIncrease: number; // Maximum increase per adjustment
  maxPriceDecrease: number; // Maximum decrease per adjustment
  adjustmentFrequency: number; // Minutes between adjustments
  minimumMargin: number; // Minimum profit margin
  customerTierExceptions: string[]; // Premium users exempt from increases
}

export interface DemandThreshold {
  utilizationLevel: number; // 0-1
  priceMultiplier: number;
  description: string;
}

export interface TimeBasedRule {
  timeRange: { start: number; end: number }; // Hours in 24h format
  daysOfWeek: number[]; // 0-6, Sunday = 0
  priceMultiplier: number;
  description: string;
}

export interface QualityBasedRule {
  qualityRange: { min: number; max: number }; // 0-1
  priceMultiplier: number;
  description: string;
}

export interface PricingAdjustment {
  agentId: string;
  timestamp: Date;
  previousMultiplier: number;
  newMultiplier: number;
  reason: string;
  strategy: string;
  impact: PricingImpact;
  validUntil: Date;
}

export interface PricingImpact {
  expectedDemandChange: number; // Percentage change
  expectedRevenueChange: number; // Percentage change
  affectedUsers: number;
  competitivePosition: 'better' | 'same' | 'worse';
}

export interface MarketConditions {
  timestamp: Date;
  overallDemand: number; // 0-1
  competitorPricing: Map<string, number>;
  systemLoad: number; // 0-1
  qualityMetrics: Map<string, number>; // Agent ID -> Quality Score
  timeOfDay: number; // 0-23
  dayOfWeek: number; // 0-6
  seasonalFactor: number; // Seasonal demand multiplier
}

export interface PricingRecommendation {
  agentId: string;
  currentMultiplier: number;
  recommendedMultiplier: number;
  confidence: number; // 0-1
  reasoning: string[];
  expectedImpact: PricingImpact;
  riskLevel: 'low' | 'medium' | 'high';
  urgency: 'immediate' | 'normal' | 'when_convenient';
}

export class DynamicPricingService {
  private cache: RedisCache;
  private strategies: Map<string, DynamicPricingStrategy> = new Map();
  private currentPricing: Map<string, number> = new Map(); // Agent ID -> Current Multiplier
  private adjustmentHistory: Map<string, PricingAdjustment[]> = new Map();

  constructor() {
    this.cache = new RedisCache({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    });
    this.initializePricingStrategies();
    this.startPricingLoop();
  }

  /**
   * Get current pricing multiplier for an agent
   */
  public async getPricingMultiplier(agentId: string): Promise<number> {
    try {
      // Check cache first
      const cacheKey = `pricing_multiplier:${agentId}`;
      let multiplier = await this.cache.get<number>(cacheKey);
      
      if (multiplier === null || multiplier === undefined) {
        // Calculate fresh multiplier
        multiplier = await this.calculatePricingMultiplier(agentId);
        await this.cache.set(cacheKey, multiplier, 300); // Cache for 5 minutes
      }
      
      this.currentPricing.set(agentId, multiplier);
      return multiplier;
      
    } catch (error) {
      logger.error('Failed to get pricing multiplier', {
        agentId,
        error: error.message
      });
      return 1.0; // Default multiplier
    }
  }

  /**
   * Calculate optimal pricing multiplier for an agent
   */
  private async calculatePricingMultiplier(agentId: string): Promise<number> {
    try {
      const marketConditions = await this.getCurrentMarketConditions();
      const agentMetrics = await this.getAgentMetrics(agentId);
      
      let finalMultiplier = 1.0;
      let totalWeight = 0;
      
      // Apply each active pricing strategy
      for (const strategy of this.strategies.values()) {
        if (!strategy.isActive) continue;
        
        const strategyMultiplier = await this.calculateStrategyMultiplier(
          strategy,
          agentId,
          marketConditions,
          agentMetrics
        );
        
        finalMultiplier += (strategyMultiplier - 1.0) * strategy.weight;
        totalWeight += strategy.weight;
      }
      
      // Normalize if using hybrid strategies
      if (totalWeight > 1) {
        finalMultiplier = 1.0 + (finalMultiplier - 1.0) / totalWeight;
      }
      
      // Apply constraints
      const constrainedMultiplier = await this.applyConstraints(
        agentId,
        finalMultiplier,
        marketConditions
      );
      
      return constrainedMultiplier;
      
    } catch (error) {
      logger.error('Failed to calculate pricing multiplier', {
        agentId,
        error: error.message
      });
      return 1.0;
    }
  }

  /**
   * Generate pricing recommendations for all agents
   */
  public async generatePricingRecommendations(): Promise<PricingRecommendation[]> {
    try {
      const recommendations: PricingRecommendation[] = [];
      const marketConditions = await this.getCurrentMarketConditions();
      const allAgents = await this.getAllActiveAgents();
      
      for (const agent of allAgents) {
        try {
          const currentMultiplier = this.currentPricing.get(agent.id) || 1.0;
          const recommendedMultiplier = await this.calculatePricingMultiplier(agent.id);
          
          if (Math.abs(currentMultiplier - recommendedMultiplier) > 0.05) {
            const reasoning = await this.generatePricingReasoning(
              agent.id,
              currentMultiplier,
              recommendedMultiplier,
              marketConditions
            );
            
            const expectedImpact = await this.estimatePricingImpact(
              agent.id,
              currentMultiplier,
              recommendedMultiplier
            );
            
            const riskLevel = this.assessPricingRisk(
              currentMultiplier,
              recommendedMultiplier,
              expectedImpact
            );
            
            const urgency = this.determinePricingUrgency(
              currentMultiplier,
              recommendedMultiplier,
              marketConditions
            );
            
            recommendations.push({
              agentId: agent.id,
              currentMultiplier,
              recommendedMultiplier,
              confidence: 0.8, // Simplified confidence calculation
              reasoning,
              expectedImpact,
              riskLevel,
              urgency
            });
          }
        } catch (error) {
          logger.warn('Failed to generate recommendation for agent', {
            agentId: agent.id,
            error: error.message
          });
        }
      }
      
      // Sort by expected revenue impact
      recommendations.sort((a, b) => b.expectedImpact.expectedRevenueChange - a.expectedImpact.expectedRevenueChange);
      
      logger.info('Generated pricing recommendations', {
        recommendationCount: recommendations.length,
        averageRevenueImpact: recommendations.reduce((sum, r) => sum + r.expectedImpact.expectedRevenueChange, 0) / recommendations.length
      });
      
      return recommendations;
      
    } catch (error) {
      logger.error('Failed to generate pricing recommendations', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Apply pricing adjustment for an agent
   */
  public async applyPricingAdjustment(
    agentId: string,
    newMultiplier: number,
    reason: string,
    strategy: string
  ): Promise<PricingAdjustment> {
    try {
      const previousMultiplier = this.currentPricing.get(agentId) || 1.0;
      
      // Validate adjustment constraints
      const constrainedMultiplier = await this.applyConstraints(
        agentId,
        newMultiplier,
        await this.getCurrentMarketConditions()
      );
      
      // Create adjustment record
      const adjustment: PricingAdjustment = {
        agentId,
        timestamp: new Date(),
        previousMultiplier,
        newMultiplier: constrainedMultiplier,
        reason,
        strategy,
        impact: await this.estimatePricingImpact(agentId, previousMultiplier, constrainedMultiplier),
        validUntil: new Date(Date.now() + 60 * 60 * 1000) // Valid for 1 hour
      };
      
      // Apply the adjustment
      this.currentPricing.set(agentId, constrainedMultiplier);
      
      // Cache the new multiplier
      const cacheKey = `pricing_multiplier:${agentId}`;
      await this.cache.set(cacheKey, constrainedMultiplier, 300);
      
      // Store adjustment history
      if (!this.adjustmentHistory.has(agentId)) {
        this.adjustmentHistory.set(agentId, []);
      }
      this.adjustmentHistory.get(agentId)!.push(adjustment);
      
      // Keep only recent history (last 100 adjustments)
      const history = this.adjustmentHistory.get(agentId)!;
      if (history.length > 100) {
        this.adjustmentHistory.set(agentId, history.slice(-100));
      }
      
      logger.info('Applied pricing adjustment', {
        agentId,
        previousMultiplier,
        newMultiplier: constrainedMultiplier,
        reason,
        strategy,
        revenueImpact: adjustment.impact.expectedRevenueChange
      });
      
      return adjustment;
      
    } catch (error) {
      logger.error('Failed to apply pricing adjustment', {
        agentId,
        newMultiplier,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get pricing analytics for dashboard
   */
  public async getPricingAnalytics(): Promise<{
    avgPriceMultiplier: number;
    totalAdjustmentsToday: number;
    revenueImpact: number;
    topPerformingStrategies: Array<{
      strategyId: string;
      revenueImpact: number;
      adjustmentCount: number;
    }>;
    agentPricing: Array<{
      agentId: string;
      currentMultiplier: number;
      recentTrend: 'up' | 'down' | 'stable';
      demandLevel: number;
    }>;
  }> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Calculate average pricing multiplier
      const allMultipliers = Array.from(this.currentPricing.values());
      const avgPriceMultiplier = allMultipliers.reduce((sum, mult) => sum + mult, 0) / allMultipliers.length || 1.0;
      
      // Count adjustments today
      let totalAdjustmentsToday = 0;
      let totalRevenueImpact = 0;
      const strategyImpacts = new Map<string, { revenue: number; count: number }>();
      
      for (const adjustments of this.adjustmentHistory.values()) {
        const todayAdjustments = adjustments.filter(adj => adj.timestamp >= today);
        totalAdjustmentsToday += todayAdjustments.length;
        
        for (const adj of todayAdjustments) {
          totalRevenueImpact += adj.impact.expectedRevenueChange;
          
          const strategyStats = strategyImpacts.get(adj.strategy) || { revenue: 0, count: 0 };
          strategyStats.revenue += adj.impact.expectedRevenueChange;
          strategyStats.count += 1;
          strategyImpacts.set(adj.strategy, strategyStats);
        }
      }
      
      // Top performing strategies
      const topPerformingStrategies = Array.from(strategyImpacts.entries())
        .map(([strategyId, stats]) => ({
          strategyId,
          revenueImpact: stats.revenue,
          adjustmentCount: stats.count
        }))
        .sort((a, b) => b.revenueImpact - a.revenueImpact)
        .slice(0, 5);
      
      // Agent pricing status
      const agentPricing = [];
      for (const [agentId, currentMultiplier] of this.currentPricing.entries()) {
        const recentHistory = this.adjustmentHistory.get(agentId)?.slice(-5) || [];
        let trend: 'up' | 'down' | 'stable' = 'stable';
        
        if (recentHistory.length >= 2) {
          const recent = recentHistory[recentHistory.length - 1];
          const previous = recentHistory[recentHistory.length - 2];
          if (recent.newMultiplier > previous.newMultiplier) trend = 'up';
          else if (recent.newMultiplier < previous.newMultiplier) trend = 'down';
        }
        
        const demandLevel = await this.getAgentDemandLevel(agentId);
        
        agentPricing.push({
          agentId,
          currentMultiplier,
          recentTrend: trend,
          demandLevel
        });
      }
      
      return {
        avgPriceMultiplier,
        totalAdjustmentsToday,
        revenueImpact: totalRevenueImpact,
        topPerformingStrategies,
        agentPricing
      };
      
    } catch (error) {
      logger.error('Failed to get pricing analytics', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Initialize default pricing strategies
   */
  private initializePricingStrategies(): void {
    // Demand-based pricing strategy
    this.strategies.set('demand_based', {
      id: 'demand_based',
      name: 'Demand-Based Pricing',
      type: 'demand_based',
      isActive: true,
      weight: 0.4,
      parameters: {
        baseMultiplier: 1.0,
        maxMultiplier: 2.0,
        minMultiplier: 0.7,
        sensitivityFactor: 0.5,
        adjustmentSpeed: 0.1,
        demandThresholds: [
          { utilizationLevel: 0.9, priceMultiplier: 1.5, description: 'High demand surge' },
          { utilizationLevel: 0.7, priceMultiplier: 1.2, description: 'Moderate demand' },
          { utilizationLevel: 0.3, priceMultiplier: 0.9, description: 'Low demand discount' }
        ],
        timeBasedRules: [],
        qualityBasedRules: []
      },
      constraints: {
        maxPriceIncrease: 0.2,
        maxPriceDecrease: 0.15,
        adjustmentFrequency: 15,
        minimumMargin: 0.1,
        customerTierExceptions: ['premium', 'enterprise']
      }
    });
    
    // Time-based pricing strategy
    this.strategies.set('time_based', {
      id: 'time_based',
      name: 'Time-Based Pricing',
      type: 'time_based',
      isActive: true,
      weight: 0.3,
      parameters: {
        baseMultiplier: 1.0,
        maxMultiplier: 1.3,
        minMultiplier: 0.8,
        sensitivityFactor: 0.3,
        adjustmentSpeed: 0.05,
        demandThresholds: [],
        timeBasedRules: [
          { timeRange: { start: 9, end: 17 }, daysOfWeek: [1, 2, 3, 4, 5], priceMultiplier: 1.1, description: 'Business hours premium' },
          { timeRange: { start: 23, end: 6 }, daysOfWeek: [0, 1, 2, 3, 4, 5, 6], priceMultiplier: 0.85, description: 'Off-hours discount' },
          { timeRange: { start: 0, end: 23 }, daysOfWeek: [0, 6], priceMultiplier: 0.95, description: 'Weekend discount' }
        ],
        qualityBasedRules: []
      },
      constraints: {
        maxPriceIncrease: 0.1,
        maxPriceDecrease: 0.1,
        adjustmentFrequency: 60,
        minimumMargin: 0.05,
        customerTierExceptions: ['premium']
      }
    });
    
    // Quality-based pricing strategy
    this.strategies.set('quality_based', {
      id: 'quality_based',
      name: 'Quality-Based Pricing',
      type: 'quality_based',
      isActive: true,
      weight: 0.3,
      parameters: {
        baseMultiplier: 1.0,
        maxMultiplier: 1.4,
        minMultiplier: 0.9,
        sensitivityFactor: 0.4,
        adjustmentSpeed: 0.08,
        demandThresholds: [],
        timeBasedRules: [],
        qualityBasedRules: [
          { qualityRange: { min: 0.9, max: 1.0 }, priceMultiplier: 1.2, description: 'Premium quality surcharge' },
          { qualityRange: { min: 0.8, max: 0.9 }, priceMultiplier: 1.0, description: 'Standard quality pricing' },
          { qualityRange: { min: 0.6, max: 0.8 }, priceMultiplier: 0.95, description: 'Quality improvement discount' }
        ]
      },
      constraints: {
        maxPriceIncrease: 0.15,
        maxPriceDecrease: 0.1,
        adjustmentFrequency: 30,
        minimumMargin: 0.08,
        customerTierExceptions: []
      }
    });
  }

  /**
   * Start the automated pricing loop
   */
  private startPricingLoop(): void {
    setInterval(async () => {
      try {
        await this.updateAllPricing();
      } catch (error) {
        logger.error('Error in pricing loop', { error: error.message });
      }
    }, 5 * 60 * 1000); // Run every 5 minutes
  }

  /**
   * Update pricing for all agents
   */
  private async updateAllPricing(): Promise<void> {
    try {
      const recommendations = await this.generatePricingRecommendations();
      
      for (const recommendation of recommendations) {
        if (recommendation.urgency === 'immediate' && recommendation.riskLevel !== 'high') {
          await this.applyPricingAdjustment(
            recommendation.agentId,
            recommendation.recommendedMultiplier,
            recommendation.reasoning.join('; '),
            'automated'
          );
        }
      }
      
      logger.info('Completed pricing update cycle', {
        recommendationCount: recommendations.length,
        appliedCount: recommendations.filter(r => r.urgency === 'immediate' && r.riskLevel !== 'high').length
      });
      
    } catch (error) {
      logger.error('Failed to update pricing', { error: error.message });
    }
  }

  // Helper methods (simplified implementations)
  private async getCurrentMarketConditions(): Promise<MarketConditions> {
    return {
      timestamp: new Date(),
      overallDemand: 0.6,
      competitorPricing: new Map(),
      systemLoad: 0.5,
      qualityMetrics: new Map(),
      timeOfDay: new Date().getHours(),
      dayOfWeek: new Date().getDay(),
      seasonalFactor: 1.0
    };
  }

  private async getAgentMetrics(agentId: string): Promise<any> {
    return {
      utilization: 0.6,
      qualityScore: 0.85,
      responseTime: 2000,
      errorRate: 0.02
    };
  }

  private async calculateStrategyMultiplier(
    strategy: DynamicPricingStrategy,
    agentId: string,
    marketConditions: MarketConditions,
    agentMetrics: any
  ): Promise<number> {
    switch (strategy.type) {
      case 'demand_based':
        return this.calculateDemandBasedMultiplier(strategy, agentMetrics.utilization);
      case 'time_based':
        return this.calculateTimeBasedMultiplier(strategy, marketConditions);
      case 'quality_based':
        return this.calculateQualityBasedMultiplier(strategy, agentMetrics.qualityScore);
      default:
        return 1.0;
    }
  }

  private calculateDemandBasedMultiplier(strategy: DynamicPricingStrategy, utilization: number): number {
    for (const threshold of strategy.parameters.demandThresholds) {
      if (utilization >= threshold.utilizationLevel) {
        return threshold.priceMultiplier;
      }
    }
    return strategy.parameters.baseMultiplier;
  }

  private calculateTimeBasedMultiplier(strategy: DynamicPricingStrategy, conditions: MarketConditions): number {
    for (const rule of strategy.parameters.timeBasedRules) {
      const inTimeRange = conditions.timeOfDay >= rule.timeRange.start && conditions.timeOfDay <= rule.timeRange.end;
      const inDayRange = rule.daysOfWeek.includes(conditions.dayOfWeek);
      
      if (inTimeRange && inDayRange) {
        return rule.priceMultiplier;
      }
    }
    return strategy.parameters.baseMultiplier;
  }

  private calculateQualityBasedMultiplier(strategy: DynamicPricingStrategy, qualityScore: number): number {
    for (const rule of strategy.parameters.qualityBasedRules) {
      if (qualityScore >= rule.qualityRange.min && qualityScore <= rule.qualityRange.max) {
        return rule.priceMultiplier;
      }
    }
    return strategy.parameters.baseMultiplier;
  }

  private async applyConstraints(
    agentId: string,
    multiplier: number,
    marketConditions: MarketConditions
  ): Promise<number> {
    const currentMultiplier = this.currentPricing.get(agentId) || 1.0;
    
    // Find most restrictive constraint
    let maxIncrease = Number.MAX_VALUE;
    let maxDecrease = Number.MAX_VALUE;
    
    for (const strategy of this.strategies.values()) {
      if (strategy.isActive) {
        maxIncrease = Math.min(maxIncrease, strategy.constraints.maxPriceIncrease);
        maxDecrease = Math.min(maxDecrease, strategy.constraints.maxPriceDecrease);
      }
    }
    
    // Apply constraints
    if (multiplier > currentMultiplier) {
      return Math.min(multiplier, currentMultiplier + maxIncrease);
    } else {
      return Math.max(multiplier, currentMultiplier - maxDecrease);
    }
  }

  private async getAllActiveAgents(): Promise<AIAgent[]> {
    // In practice, fetch from database
    return [
      { id: 'gpt-4', name: 'GPT-4', model: 'gpt-4', provider: 'openai', reliability: 0.95 } as AIAgent,
      { id: 'gpt-3.5', name: 'GPT-3.5', model: 'gpt-3.5-turbo', provider: 'openai', reliability: 0.92 } as AIAgent,
      { id: 'claude-3', name: 'Claude-3', model: 'claude-3-sonnet', provider: 'anthropic', reliability: 0.93 } as AIAgent
    ];
  }

  private async generatePricingReasoning(
    agentId: string,
    current: number,
    recommended: number,
    conditions: MarketConditions
  ): Promise<string[]> {
    const reasoning: string[] = [];
    
    if (recommended > current) {
      reasoning.push(`Demand level is ${(conditions.overallDemand * 100).toFixed(0)}% - premium pricing justified`);
      if (conditions.timeOfDay >= 9 && conditions.timeOfDay <= 17) {
        reasoning.push('Peak business hours - applying time-based premium');
      }
    } else {
      reasoning.push(`Lower demand detected - reducing price to increase utilization`);
      if (conditions.timeOfDay < 6 || conditions.timeOfDay > 22) {
        reasoning.push('Off-peak hours - applying discount to stimulate demand');
      }
    }
    
    return reasoning;
  }

  private async estimatePricingImpact(
    agentId: string,
    currentMultiplier: number,
    newMultiplier: number
  ): Promise<PricingImpact> {
    const priceChangePercentage = ((newMultiplier - currentMultiplier) / currentMultiplier) * 100;
    
    // Simplified elasticity model
    const demandElasticity = -0.8; // 1% price increase reduces demand by 0.8%
    const expectedDemandChange = priceChangePercentage * demandElasticity;
    const expectedRevenueChange = priceChangePercentage + expectedDemandChange;
    
    return {
      expectedDemandChange,
      expectedRevenueChange,
      affectedUsers: Math.floor(Math.random() * 100) + 50, // Simplified
      competitivePosition: newMultiplier > currentMultiplier ? 'worse' : 'better'
    };
  }

  private assessPricingRisk(
    current: number,
    recommended: number,
    impact: PricingImpact
  ): 'low' | 'medium' | 'high' {
    const changePercentage = Math.abs((recommended - current) / current) * 100;
    
    if (changePercentage > 20 || Math.abs(impact.expectedDemandChange) > 15) {
      return 'high';
    } else if (changePercentage > 10 || Math.abs(impact.expectedDemandChange) > 8) {
      return 'medium';
    }
    return 'low';
  }

  private determinePricingUrgency(
    current: number,
    recommended: number,
    conditions: MarketConditions
  ): 'immediate' | 'normal' | 'when_convenient' {
    const changePercentage = Math.abs((recommended - current) / current) * 100;
    
    if (conditions.overallDemand > 0.8 && changePercentage > 5) {
      return 'immediate';
    } else if (changePercentage > 10) {
      return 'normal';
    }
    return 'when_convenient';
  }

  private async getAgentDemandLevel(agentId: string): Promise<number> {
    // In practice, calculate from recent request volume
    return Math.random() * 0.4 + 0.3; // 0.3 to 0.7
  }
}
