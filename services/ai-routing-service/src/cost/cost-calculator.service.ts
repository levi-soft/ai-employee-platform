
import { logger } from '@ai-platform/shared-utils';
import { aiRoutingConfig } from '../config/config';
import { AIRequest, AIAgent, Transaction, TransactionType } from '../types';
import { RedisCache } from '../cache/request-cache.service';

export interface CostCalculation {
  requestId: string;
  agentId: string;
  userId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  timestamp: Date;
  currency: string;
  costBreakdown: CostBreakdown;
  metadata: CostMetadata;
}

export interface CostBreakdown {
  baseCost: number;
  surcharges: {
    name: string;
    amount: number;
    percentage?: number;
  }[];
  discounts: {
    name: string;
    amount: number;
    percentage?: number;
  }[];
  taxes: {
    name: string;
    amount: number;
    rate: number;
  }[];
  finalCost: number;
}

export interface CostMetadata {
  agentName: string;
  model: string;
  provider: string;
  region: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  complexity: 'simple' | 'medium' | 'complex' | 'expert';
  duration: number; // milliseconds
  qualityScore?: number;
  costEfficiencyScore?: number;
}

export interface PricingTier {
  id: string;
  name: string;
  inputCostPerToken: number;
  outputCostPerToken: number;
  minimumCharge: number;
  volumeDiscounts: VolumeDiscount[];
  conditions: PricingCondition[];
}

export interface VolumeDiscount {
  minTokens: number;
  maxTokens?: number;
  discountPercentage: number;
  description: string;
}

export interface PricingCondition {
  type: 'user_tier' | 'time_of_day' | 'agent_load' | 'quality_requirement';
  value: string | number;
  operator: 'equals' | 'greater_than' | 'less_than' | 'in_range';
  modifier: number; // multiplier or percentage
}

export class CostCalculatorService {
  private cache: RedisCache;
  private pricingTiers: Map<string, PricingTier> = new Map();

  constructor() {
    this.cache = new RedisCache({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    });
    this.initializePricingTiers();
  }

  /**
   * Calculate real-time cost for an AI request
   */
  public async calculateRequestCost(
    request: AIRequest,
    agent: AIAgent,
    response: any
  ): Promise<CostCalculation> {
    try {
      const startTime = Date.now();
      
      // Extract token usage from response
      const tokenUsage = this.extractTokenUsage(response);
      
      // Get pricing tier for agent
      const pricingTier = await this.getPricingTier(agent, request);
      
      // Calculate base costs
      const baseCosts = this.calculateBaseCosts(tokenUsage, pricingTier);
      
      // Apply modifiers (surcharges, discounts, volume discounts)
      const modifiedCosts = await this.applyModifiers(
        baseCosts,
        request,
        agent,
        tokenUsage
      );
      
      // Calculate taxes
      const taxes = await this.calculateTaxes(modifiedCosts, request.userId);
      
      // Build cost calculation
      const costCalculation: CostCalculation = {
        requestId: request.id,
        agentId: agent.id,
        userId: request.userId,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
        inputCost: baseCosts.inputCost,
        outputCost: baseCosts.outputCost,
        totalCost: modifiedCosts.finalCost + taxes.totalTax,
        timestamp: new Date(),
        currency: 'USD',
        costBreakdown: {
          baseCost: baseCosts.inputCost + baseCosts.outputCost,
          surcharges: modifiedCosts.surcharges,
          discounts: modifiedCosts.discounts,
          taxes: taxes.breakdown,
          finalCost: modifiedCosts.finalCost + taxes.totalTax
        },
        metadata: {
          agentName: agent.name,
          model: agent.model,
          provider: agent.provider,
          region: agent.region || 'us-east-1',
          priority: request.priority || 'normal',
          complexity: this.assessComplexity(request),
          duration: Date.now() - startTime,
          qualityScore: response.qualityScore,
          costEfficiencyScore: this.calculateCostEfficiencyScore(
            modifiedCosts.finalCost,
            response.qualityScore || 0.8
          )
        }
      };
      
      // Cache the calculation
      await this.cacheCalculation(costCalculation);
      
      logger.info('Cost calculated successfully', {
        requestId: request.id,
        totalCost: costCalculation.totalCost,
        tokens: costCalculation.totalTokens,
        efficiency: costCalculation.metadata.costEfficiencyScore
      });
      
      return costCalculation;
      
    } catch (error) {
      logger.error('Failed to calculate request cost', {
        requestId: request.id,
        agentId: agent.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Calculate bulk cost for multiple requests
   */
  public async calculateBulkCosts(
    requests: { request: AIRequest; agent: AIAgent; response: any }[]
  ): Promise<CostCalculation[]> {
    try {
      const calculations = await Promise.all(
        requests.map(({ request, agent, response }) =>
          this.calculateRequestCost(request, agent, response)
        )
      );
      
      // Apply bulk discounts if applicable
      const bulkDiscountedCalculations = await this.applyBulkDiscounts(calculations);
      
      return bulkDiscountedCalculations;
      
    } catch (error) {
      logger.error('Failed to calculate bulk costs', { error: error.message });
      throw error;
    }
  }

  /**
   * Get cost estimate before request execution
   */
  public async getEstimate(
    request: AIRequest,
    agent: AIAgent,
    estimatedTokens: { input: number; output: number }
  ): Promise<Omit<CostCalculation, 'requestId' | 'timestamp'> & { isEstimate: true }> {
    const pricingTier = await this.getPricingTier(agent, request);
    const baseCosts = this.calculateBaseCosts({
      inputTokens: estimatedTokens.input,
      outputTokens: estimatedTokens.output,
      totalTokens: estimatedTokens.input + estimatedTokens.output
    }, pricingTier);
    
    // Simplified estimate without complex modifiers
    const estimatedCost = baseCosts.inputCost + baseCosts.outputCost;
    const estimatedTotalWithTax = estimatedCost * 1.08; // Approximate tax
    
    return {
      agentId: agent.id,
      userId: request.userId,
      inputTokens: estimatedTokens.input,
      outputTokens: estimatedTokens.output,
      totalTokens: estimatedTokens.input + estimatedTokens.output,
      inputCost: baseCosts.inputCost,
      outputCost: baseCosts.outputCost,
      totalCost: estimatedTotalWithTax,
      currency: 'USD',
      costBreakdown: {
        baseCost: estimatedCost,
        surcharges: [],
        discounts: [],
        taxes: [{ name: 'Estimated Tax', amount: estimatedTotalWithTax - estimatedCost, rate: 0.08 }],
        finalCost: estimatedTotalWithTax
      },
      metadata: {
        agentName: agent.name,
        model: agent.model,
        provider: agent.provider,
        region: agent.region || 'us-east-1',
        priority: request.priority || 'normal',
        complexity: this.assessComplexity(request),
        duration: 0,
        costEfficiencyScore: 0.8
      },
      isEstimate: true as const
    };
  }

  /**
   * Initialize pricing tiers for different agents and models
   */
  private initializePricingTiers(): void {
    // GPT-4 Pricing
    this.pricingTiers.set('gpt-4', {
      id: 'gpt-4',
      name: 'GPT-4 Premium',
      inputCostPerToken: 0.03 / 1000,
      outputCostPerToken: 0.06 / 1000,
      minimumCharge: 0.01,
      volumeDiscounts: [
        { minTokens: 100000, discountPercentage: 5, description: '5% off for 100k+ tokens' },
        { minTokens: 500000, discountPercentage: 10, description: '10% off for 500k+ tokens' },
        { minTokens: 1000000, discountPercentage: 15, description: '15% off for 1M+ tokens' }
      ],
      conditions: [
        { type: 'user_tier', value: 'premium', operator: 'equals', modifier: 0.9 },
        { type: 'time_of_day', value: 2, operator: 'less_than', modifier: 0.8 }, // Off-peak hours
        { type: 'agent_load', value: 0.8, operator: 'greater_than', modifier: 1.2 } // High load surcharge
      ]
    });

    // GPT-3.5 Pricing
    this.pricingTiers.set('gpt-3.5-turbo', {
      id: 'gpt-3.5-turbo',
      name: 'GPT-3.5 Turbo',
      inputCostPerToken: 0.001 / 1000,
      outputCostPerToken: 0.002 / 1000,
      minimumCharge: 0.001,
      volumeDiscounts: [
        { minTokens: 200000, discountPercentage: 5, description: '5% off for 200k+ tokens' },
        { minTokens: 1000000, discountPercentage: 10, description: '10% off for 1M+ tokens' }
      ],
      conditions: [
        { type: 'user_tier', value: 'premium', operator: 'equals', modifier: 0.95 }
      ]
    });

    // Claude-3 Pricing
    this.pricingTiers.set('claude-3', {
      id: 'claude-3',
      name: 'Claude-3 Sonnet',
      inputCostPerToken: 0.015 / 1000,
      outputCostPerToken: 0.075 / 1000,
      minimumCharge: 0.005,
      volumeDiscounts: [
        { minTokens: 150000, discountPercentage: 7, description: '7% off for 150k+ tokens' }
      ],
      conditions: []
    });
  }

  /**
   * Extract token usage from AI response
   */
  private extractTokenUsage(response: any): { inputTokens: number; outputTokens: number; totalTokens: number } {
    // Handle different response formats from various AI providers
    if (response.usage) {
      return {
        inputTokens: response.usage.prompt_tokens || 0,
        outputTokens: response.usage.completion_tokens || 0,
        totalTokens: response.usage.total_tokens || 0
      };
    }
    
    if (response.token_count) {
      return {
        inputTokens: response.token_count.input || 0,
        outputTokens: response.token_count.output || 0,
        totalTokens: response.token_count.total || 0
      };
    }
    
    // Fallback estimation based on text length
    const inputTokens = Math.ceil((response.prompt?.length || 0) / 4);
    const outputTokens = Math.ceil((response.text?.length || response.content?.length || 0) / 4);
    
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens
    };
  }

  /**
   * Get appropriate pricing tier for agent and request
   */
  private async getPricingTier(agent: AIAgent, request: AIRequest): Promise<PricingTier> {
    const cacheKey = `pricing_tier:${agent.model}`;
    
    let tier = await this.cache.get<PricingTier>(cacheKey);
    if (!tier) {
      tier = this.pricingTiers.get(agent.model) || this.getDefaultPricingTier();
      await this.cache.set(cacheKey, tier, 3600); // Cache for 1 hour
    }
    
    return tier;
  }

  /**
   * Calculate base costs without modifiers
   */
  private calculateBaseCosts(
    tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number },
    tier: PricingTier
  ): { inputCost: number; outputCost: number } {
    const inputCost = Math.max(
      tokenUsage.inputTokens * tier.inputCostPerToken,
      tier.minimumCharge * 0.4
    );
    
    const outputCost = Math.max(
      tokenUsage.outputTokens * tier.outputCostPerToken,
      tier.minimumCharge * 0.6
    );
    
    return { inputCost, outputCost };
  }

  /**
   * Apply modifiers like surcharges, discounts, and volume discounts
   */
  private async applyModifiers(
    baseCosts: { inputCost: number; outputCost: number },
    request: AIRequest,
    agent: AIAgent,
    tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number }
  ): Promise<{
    finalCost: number;
    surcharges: { name: string; amount: number; percentage?: number }[];
    discounts: { name: string; amount: number; percentage?: number }[];
  }> {
    let finalCost = baseCosts.inputCost + baseCosts.outputCost;
    const surcharges: { name: string; amount: number; percentage?: number }[] = [];
    const discounts: { name: string; amount: number; percentage?: number }[] = [];
    
    const tier = await this.getPricingTier(agent, request);
    
    // Apply pricing conditions
    for (const condition of tier.conditions) {
      const applies = await this.checkCondition(condition, request, agent);
      if (applies) {
        const adjustment = finalCost * (condition.modifier - 1);
        if (adjustment > 0) {
          surcharges.push({
            name: `${condition.type} surcharge`,
            amount: adjustment,
            percentage: (condition.modifier - 1) * 100
          });
        } else {
          discounts.push({
            name: `${condition.type} discount`,
            amount: Math.abs(adjustment),
            percentage: (1 - condition.modifier) * 100
          });
        }
        finalCost *= condition.modifier;
      }
    }
    
    // Apply volume discounts
    for (const volumeDiscount of tier.volumeDiscounts) {
      if (tokenUsage.totalTokens >= volumeDiscount.minTokens &&
          (!volumeDiscount.maxTokens || tokenUsage.totalTokens <= volumeDiscount.maxTokens)) {
        const discountAmount = finalCost * (volumeDiscount.discountPercentage / 100);
        discounts.push({
          name: volumeDiscount.description,
          amount: discountAmount,
          percentage: volumeDiscount.discountPercentage
        });
        finalCost -= discountAmount;
        break; // Apply only the first matching volume discount
      }
    }
    
    // Apply priority surcharges
    if (request.priority === 'high') {
      const surcharge = finalCost * 0.25;
      surcharges.push({
        name: 'High priority surcharge',
        amount: surcharge,
        percentage: 25
      });
      finalCost += surcharge;
    } else if (request.priority === 'critical') {
      const surcharge = finalCost * 0.50;
      surcharges.push({
        name: 'Critical priority surcharge',
        amount: surcharge,
        percentage: 50
      });
      finalCost += surcharge;
    }
    
    return { finalCost, surcharges, discounts };
  }

  /**
   * Calculate applicable taxes
   */
  private async calculateTaxes(
    costs: { finalCost: number },
    userId: string
  ): Promise<{ totalTax: number; breakdown: { name: string; amount: number; rate: number }[] }> {
    // Simplified tax calculation - in practice, this would integrate with tax service
    const taxRate = 0.08; // 8% tax rate
    const taxAmount = costs.finalCost * taxRate;
    
    return {
      totalTax: taxAmount,
      breakdown: [
        { name: 'Service Tax', amount: taxAmount, rate: taxRate }
      ]
    };
  }

  /**
   * Check if a pricing condition applies
   */
  private async checkCondition(
    condition: PricingCondition,
    request: AIRequest,
    agent: AIAgent
  ): Promise<boolean> {
    switch (condition.type) {
      case 'user_tier':
        // Check user tier from database or cache
        const userTier = await this.getUserTier(request.userId);
        return condition.operator === 'equals' && userTier === condition.value;
      
      case 'time_of_day':
        const hour = new Date().getHours();
        switch (condition.operator) {
          case 'less_than': return hour < condition.value;
          case 'greater_than': return hour > condition.value;
          default: return false;
        }
      
      case 'agent_load':
        const load = await this.getAgentLoad(agent.id);
        switch (condition.operator) {
          case 'less_than': return load < condition.value;
          case 'greater_than': return load > condition.value;
          default: return false;
        }
      
      default:
        return false;
    }
  }

  /**
   * Assess complexity of request
   */
  private assessComplexity(request: AIRequest): 'simple' | 'medium' | 'complex' | 'expert' {
    const contentLength = request.prompt?.length || request.input?.length || 0;
    const hasAttachments = request.files && request.files.length > 0;
    const isCodeGeneration = request.type?.includes('code') || false;
    
    if (contentLength > 5000 || hasAttachments || isCodeGeneration) {
      return 'expert';
    } else if (contentLength > 2000) {
      return 'complex';
    } else if (contentLength > 500) {
      return 'medium';
    }
    return 'simple';
  }

  /**
   * Calculate cost efficiency score
   */
  private calculateCostEfficiencyScore(cost: number, qualityScore: number): number {
    // Higher quality per dollar is better
    if (cost <= 0) return 0;
    const efficiency = (qualityScore * 100) / (cost * 1000); // Normalize to reasonable range
    return Math.min(Math.max(efficiency, 0), 1); // Clamp between 0 and 1
  }

  /**
   * Cache cost calculation for analytics
   */
  private async cacheCalculation(calculation: CostCalculation): Promise<void> {
    const cacheKey = `cost_calculation:${calculation.requestId}`;
    await this.cache.set(cacheKey, calculation, 86400); // Cache for 24 hours
    
    // Also add to analytics queue
    await this.cache.lpush('cost_analytics_queue', JSON.stringify({
      ...calculation,
      calculatedAt: new Date().toISOString()
    }));
  }

  /**
   * Apply bulk discounts for multiple requests
   */
  private async applyBulkDiscounts(calculations: CostCalculation[]): Promise<CostCalculation[]> {
    if (calculations.length < 10) return calculations;
    
    const bulkDiscountPercentage = calculations.length >= 100 ? 15 : 
                                  calculations.length >= 50 ? 10 : 5;
    
    return calculations.map(calc => {
      const discountAmount = calc.totalCost * (bulkDiscountPercentage / 100);
      return {
        ...calc,
        totalCost: calc.totalCost - discountAmount,
        costBreakdown: {
          ...calc.costBreakdown,
          discounts: [
            ...calc.costBreakdown.discounts,
            {
              name: `Bulk discount (${calculations.length} requests)`,
              amount: discountAmount,
              percentage: bulkDiscountPercentage
            }
          ],
          finalCost: calc.totalCost - discountAmount
        }
      };
    });
  }

  /**
   * Get default pricing tier for unknown models
   */
  private getDefaultPricingTier(): PricingTier {
    return {
      id: 'default',
      name: 'Default Pricing',
      inputCostPerToken: 0.002 / 1000,
      outputCostPerToken: 0.004 / 1000,
      minimumCharge: 0.005,
      volumeDiscounts: [],
      conditions: []
    };
  }

  /**
   * Get user tier from cache/database
   */
  private async getUserTier(userId: string): Promise<string> {
    const cacheKey = `user_tier:${userId}`;
    let tier = await this.cache.get<string>(cacheKey);
    if (!tier) {
      // In practice, fetch from database
      tier = 'standard';
      await this.cache.set(cacheKey, tier, 3600);
    }
    return tier;
  }

  /**
   * Get current agent load
   */
  private async getAgentLoad(agentId: string): Promise<number> {
    const cacheKey = `agent_load:${agentId}`;
    const load = await this.cache.get<number>(cacheKey);
    return load || 0.5; // Default to 50% load
  }

  /**
   * Get cost calculation by request ID
   */
  public async getCostCalculation(requestId: string): Promise<CostCalculation | null> {
    const cacheKey = `cost_calculation:${requestId}`;
    return await this.cache.get<CostCalculation>(cacheKey);
  }

  /**
   * Get cost statistics for a user
   */
  public async getUserCostStats(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalCost: number;
    requestCount: number;
    averageCost: number;
    totalTokens: number;
    averageTokens: number;
    costByAgent: Record<string, number>;
    costByDay: Record<string, number>;
  }> {
    // In practice, this would query a database
    // For now, return calculated stats from cache
    const stats = {
      totalCost: 0,
      requestCount: 0,
      averageCost: 0,
      totalTokens: 0,
      averageTokens: 0,
      costByAgent: {} as Record<string, number>,
      costByDay: {} as Record<string, number>
    };
    
    return stats;
  }
}
