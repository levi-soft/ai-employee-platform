
import { logger } from '@ai-platform/shared-utils'

export interface CostPredictionInput {
  prompt: string
  estimatedTokens?: number
  capabilities: string[]
  priority: 'low' | 'normal' | 'high' | 'critical'
  maxCost?: number
  userId?: string
  context?: {
    complexity: number
    domain: string
    urgency: string
  }
}

export interface CostPredictionOutput {
  predictions: ProviderCostPrediction[]
  recommendations: CostRecommendation[]
  budgetAnalysis: BudgetAnalysis
  riskAssessment: RiskAssessment
  confidence: number
  modelVersion: string
}

export interface ProviderCostPrediction {
  provider: string
  model: string
  agentId: string
  predictedCost: number
  costBreakdown: {
    inputTokens: number
    outputTokens: number
    baseTokenCost: number
    computeCost: number
    priorityMultiplier: number
    demandSurcharge: number
    volumeDiscount: number
    finalCost: number
  }
  costRange: {
    minimum: number
    expected: number
    maximum: number
    confidence: number
  }
  factors: CostFactor[]
}

export interface CostFactor {
  name: string
  impact: number // -1 to 1, negative reduces cost, positive increases cost
  confidence: number
  description: string
}

export interface CostRecommendation {
  type: 'provider_switch' | 'timing_optimization' | 'request_optimization' | 'budget_adjustment'
  title: string
  description: string
  potentialSavings: number
  implementationEffort: 'low' | 'medium' | 'high'
  tradeoffs: string[]
  priority: number
}

export interface BudgetAnalysis {
  currentBudget?: number
  projectedSpend: number
  remainingBudget?: number
  burnRate: number
  budgetUtilization: number
  daysRemaining?: number
  budgetStatus: 'under_budget' | 'on_track' | 'over_budget' | 'critical'
  alerts: BudgetAlert[]
}

export interface BudgetAlert {
  type: 'warning' | 'critical' | 'info'
  message: string
  threshold: number
  currentValue: number
  recommendedAction: string
}

export interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high' | 'critical'
  riskFactors: Array<{
    factor: string
    severity: 'low' | 'medium' | 'high'
    probability: number
    impact: string
    mitigation: string
  }>
  probabilityDistribution: {
    p10: number // 10th percentile cost
    p50: number // Median cost
    p90: number // 90th percentile cost
    p99: number // 99th percentile cost
  }
}

export interface HistoricalCostData {
  userId?: string
  provider: string
  model: string
  timestamp: Date
  actualCost: number
  predictedCost: number
  tokens: {
    input: number
    output: number
    total: number
  }
  request: {
    complexity: number
    capabilities: string[]
    priority: string
    responseTime: number
  }
}

export interface CostModel {
  version: string
  trainedAt: Date
  accuracy: number
  features: ModelFeature[]
  coefficients: Record<string, number>
  intercept: number
}

export interface ModelFeature {
  name: string
  type: 'numerical' | 'categorical' | 'boolean'
  importance: number
  description: string
}

export class CostPredictionModel {
  private models: Map<string, CostModel> = new Map()
  private historicalData: HistoricalCostData[] = []
  private providerPricing: Map<string, ProviderPricing> = new Map()
  private demandModels: Map<string, DemandModel> = new Map()
  private lastModelUpdate: Date = new Date()

  constructor() {
    this.initializePricingData()
    this.initializeCostModels()
    logger.info('Cost Prediction Model initialized')
  }

  // Main prediction method
  async predictCosts(input: CostPredictionInput): Promise<CostPredictionOutput> {
    try {
      const startTime = Date.now()

      logger.info('Starting cost prediction', {
        userId: input.userId,
        capabilities: input.capabilities,
        estimatedTokens: input.estimatedTokens,
        priority: input.priority
      })

      // Predict token counts if not provided
      const tokenEstimate = await this.estimateTokens(input.prompt, input.context)
      const tokens = input.estimatedTokens || tokenEstimate

      // Get available providers/models
      const availableProviders = await this.getAvailableProviders(input.capabilities)

      // Generate predictions for each provider
      const predictions = await Promise.all(
        availableProviders.map(provider => this.predictProviderCost(provider, tokens, input))
      )

      // Sort by expected cost
      predictions.sort((a, b) => a.predictedCost - b.predictedCost)

      // Generate recommendations
      const recommendations = await this.generateRecommendations(predictions, input)

      // Analyze budget impact
      const budgetAnalysis = await this.analyzeBudgetImpact(predictions, input.userId)

      // Assess risks
      const riskAssessment = await this.assessRisks(predictions, input)

      // Calculate overall confidence
      const confidence = this.calculateOverallConfidence(predictions)

      const result: CostPredictionOutput = {
        predictions,
        recommendations,
        budgetAnalysis,
        riskAssessment,
        confidence,
        modelVersion: 'v2.1'
      }

      const predictionTime = Date.now() - startTime
      logger.info('Cost prediction completed', {
        userId: input.userId,
        providersAnalyzed: predictions.length,
        bestOption: predictions[0]?.provider,
        bestCost: predictions[0]?.predictedCost,
        predictionTime: `${predictionTime}ms`
      })

      return result

    } catch (error) {
      logger.error('Error predicting costs', {
        userId: input.userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Cost prediction failed')
    }
  }

  // Estimate token count from prompt
  private async estimateTokens(prompt: string, context?: any): Promise<number> {
    try {
      // Basic token estimation (more sophisticated in production)
      const words = prompt.split(/\s+/).length
      let baseTokens = Math.ceil(words * 1.3) // Rough approximation

      // Adjust based on complexity
      if (context?.complexity) {
        const complexityMultiplier = 1 + (context.complexity / 100) * 0.5
        baseTokens = Math.ceil(baseTokens * complexityMultiplier)
      }

      // Add estimated output tokens
      const outputTokens = Math.ceil(baseTokens * 1.5) // Assume response is 1.5x input length

      return baseTokens + outputTokens

    } catch (error) {
      logger.error('Error estimating tokens', { error })
      return 1500 // Default estimate
    }
  }

  // Get available providers for capabilities
  private async getAvailableProviders(capabilities: string[]): Promise<Array<{
    provider: string
    model: string
    agentId: string
    capabilities: string[]
  }>> {
    try {
      // This would typically query the agent pool
      const providers = [
        { provider: 'openai', model: 'gpt-4', agentId: 'gpt4-001', capabilities: ['text-generation', 'reasoning', 'code-generation'] },
        { provider: 'openai', model: 'gpt-3.5-turbo', agentId: 'gpt35-001', capabilities: ['text-generation', 'translation', 'summarization'] },
        { provider: 'claude', model: 'claude-3-opus', agentId: 'claude-opus-001', capabilities: ['text-generation', 'reasoning', 'analysis'] },
        { provider: 'claude', model: 'claude-3-sonnet', agentId: 'claude-sonnet-001', capabilities: ['text-generation', 'creative', 'analysis'] },
        { provider: 'claude', model: 'claude-3-haiku', agentId: 'claude-haiku-001', capabilities: ['text-generation', 'summarization'] },
        { provider: 'gemini', model: 'gemini-pro', agentId: 'gemini-001', capabilities: ['text-generation', 'math', 'reasoning'] },
        { provider: 'ollama', model: 'llama2-7b', agentId: 'ollama-001', capabilities: ['text-generation', 'general-query'] }
      ]

      // Filter by capability match
      return providers.filter(p => 
        capabilities.some(cap => p.capabilities.includes(cap))
      )

    } catch (error) {
      logger.error('Error getting available providers', { error })
      return []
    }
  }

  // Predict cost for a specific provider
  private async predictProviderCost(
    provider: { provider: string; model: string; agentId: string; capabilities: string[] },
    tokens: number,
    input: CostPredictionInput
  ): Promise<ProviderCostPrediction> {
    try {
      const pricing = this.providerPricing.get(`${provider.provider}:${provider.model}`)
      if (!pricing) {
        throw new Error(`No pricing data for ${provider.provider}:${provider.model}`)
      }

      // Calculate base token costs
      const inputTokens = Math.ceil(tokens * 0.4) // Rough estimate
      const outputTokens = tokens - inputTokens
      const baseTokenCost = (inputTokens * pricing.inputTokenPrice) + (outputTokens * pricing.outputTokenPrice)

      // Calculate compute cost
      const computeCost = this.calculateComputeCost(provider.model, tokens, input)

      // Apply multipliers
      const priorityMultiplier = this.getPriorityMultiplier(input.priority)
      const demandSurcharge = await this.calculateDemandSurcharge(provider, input)
      const volumeDiscount = await this.calculateVolumeDiscount(input.userId, provider)

      const finalCost = (baseTokenCost + computeCost) * priorityMultiplier * (1 + demandSurcharge) * (1 - volumeDiscount)

      // Calculate cost range with uncertainty
      const costRange = this.calculateCostRange(finalCost, provider, input)

      // Identify cost factors
      const factors = await this.identifyCostFactors(provider, input, tokens)

      return {
        provider: provider.provider,
        model: provider.model,
        agentId: provider.agentId,
        predictedCost: finalCost,
        costBreakdown: {
          inputTokens,
          outputTokens,
          baseTokenCost,
          computeCost,
          priorityMultiplier,
          demandSurcharge,
          volumeDiscount,
          finalCost
        },
        costRange,
        factors
      }

    } catch (error) {
      logger.error('Error predicting provider cost', {
        provider: provider.provider,
        model: provider.model,
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      // Return default prediction
      return {
        provider: provider.provider,
        model: provider.model,
        agentId: provider.agentId,
        predictedCost: tokens * 0.001, // Default $0.001 per token
        costBreakdown: {
          inputTokens: Math.ceil(tokens * 0.4),
          outputTokens: Math.ceil(tokens * 0.6),
          baseTokenCost: tokens * 0.001,
          computeCost: 0,
          priorityMultiplier: 1,
          demandSurcharge: 0,
          volumeDiscount: 0,
          finalCost: tokens * 0.001
        },
        costRange: {
          minimum: tokens * 0.0008,
          expected: tokens * 0.001,
          maximum: tokens * 0.0012,
          confidence: 0.6
        },
        factors: []
      }
    }
  }

  // Calculate compute cost based on model complexity
  private calculateComputeCost(model: string, tokens: number, input: CostPredictionInput): number {
    const computeCosts = {
      'gpt-4': 0.0001,
      'gpt-3.5-turbo': 0.00003,
      'claude-3-opus': 0.00008,
      'claude-3-sonnet': 0.00004,
      'claude-3-haiku': 0.00001,
      'gemini-pro': 0.00005,
      'llama2-7b': 0.00001
    }

    const baseComputeCost = computeCosts[model as keyof typeof computeCosts] || 0.00005

    // Adjust for complexity
    const complexityMultiplier = input.context?.complexity ? 1 + (input.context.complexity / 100) : 1

    return baseComputeCost * tokens * complexityMultiplier
  }

  // Get priority multiplier
  private getPriorityMultiplier(priority: string): number {
    const multipliers = {
      low: 0.8,
      normal: 1.0,
      high: 1.3,
      critical: 1.8
    }
    return multipliers[priority as keyof typeof multipliers] || 1.0
  }

  // Calculate demand surcharge
  private async calculateDemandSurcharge(
    provider: { provider: string; model: string },
    input: CostPredictionInput
  ): Promise<number> {
    try {
      const demandModel = this.demandModels.get(`${provider.provider}:${provider.model}`)
      if (!demandModel) return 0

      const currentHour = new Date().getHours()
      const currentLoad = demandModel.loadByHour[currentHour] || 0.5

      // Higher load = higher surcharge
      return Math.min(0.5, currentLoad * 0.3) // Max 50% surcharge

    } catch (error) {
      logger.error('Error calculating demand surcharge', { provider, error })
      return 0
    }
  }

  // Calculate volume discount
  private async calculateVolumeDiscount(
    userId?: string,
    provider?: { provider: string; model: string }
  ): Promise<number> {
    try {
      if (!userId || !provider) return 0

      // Get user's historical usage
      const userHistory = this.historicalData.filter(h => 
        h.userId === userId &&
        h.provider === provider.provider &&
        h.model === provider.model &&
        h.timestamp > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
      )

      const totalSpend = userHistory.reduce((sum, h) => sum + h.actualCost, 0)

      // Volume discount tiers
      if (totalSpend > 1000) return 0.15 // 15% discount for $1000+ spend
      if (totalSpend > 500) return 0.10   // 10% discount for $500+ spend
      if (totalSpend > 100) return 0.05   // 5% discount for $100+ spend

      return 0

    } catch (error) {
      logger.error('Error calculating volume discount', { userId, provider, error })
      return 0
    }
  }

  // Calculate cost range with uncertainty
  private calculateCostRange(
    expectedCost: number,
    provider: { provider: string; model: string },
    input: CostPredictionInput
  ): { minimum: number; expected: number; maximum: number; confidence: number } {
    try {
      // Base uncertainty varies by provider
      const uncertaintyRates = {
        openai: 0.15,
        claude: 0.20,
        gemini: 0.25,
        ollama: 0.10
      }

      const baseUncertainty = uncertaintyRates[provider.provider as keyof typeof uncertaintyRates] || 0.20

      // Adjust uncertainty based on factors
      let adjustedUncertainty = baseUncertainty

      if (input.context?.complexity && input.context.complexity > 80) {
        adjustedUncertainty *= 1.3 // High complexity = more uncertainty
      }

      if (input.priority === 'critical') {
        adjustedUncertainty *= 0.8 // Critical requests are more predictable due to priority access
      }

      const minimum = expectedCost * (1 - adjustedUncertainty)
      const maximum = expectedCost * (1 + adjustedUncertainty * 1.5)
      const confidence = Math.max(0.6, 1 - adjustedUncertainty)

      return {
        minimum,
        expected: expectedCost,
        maximum,
        confidence
      }

    } catch (error) {
      logger.error('Error calculating cost range', { provider, error })
      return {
        minimum: expectedCost * 0.8,
        expected: expectedCost,
        maximum: expectedCost * 1.2,
        confidence: 0.7
      }
    }
  }

  // Identify factors affecting cost
  private async identifyCostFactors(
    provider: { provider: string; model: string },
    input: CostPredictionInput,
    tokens: number
  ): Promise<CostFactor[]> {
    const factors: CostFactor[] = []

    try {
      // Token count factor
      if (tokens > 5000) {
        factors.push({
          name: 'High Token Count',
          impact: 0.3,
          confidence: 0.9,
          description: 'Large request increases cost significantly'
        })
      }

      // Complexity factor
      if (input.context?.complexity && input.context.complexity > 70) {
        factors.push({
          name: 'High Complexity',
          impact: 0.2,
          confidence: 0.8,
          description: 'Complex requests require more compute resources'
        })
      }

      // Priority factor
      if (input.priority === 'critical') {
        factors.push({
          name: 'Critical Priority',
          impact: 0.8,
          confidence: 0.95,
          description: 'Critical priority incurs premium pricing'
        })
      } else if (input.priority === 'low') {
        factors.push({
          name: 'Low Priority',
          impact: -0.2,
          confidence: 0.85,
          description: 'Low priority requests get discounted rates'
        })
      }

      // Time of day factor
      const hour = new Date().getHours()
      if (hour >= 9 && hour <= 17) {
        factors.push({
          name: 'Peak Hours',
          impact: 0.15,
          confidence: 0.7,
          description: 'Business hours have higher demand and pricing'
        })
      } else if (hour >= 0 && hour <= 6) {
        factors.push({
          name: 'Off-Peak Hours',
          impact: -0.1,
          confidence: 0.6,
          description: 'Night hours offer lower rates'
        })
      }

      // Provider-specific factors
      if (provider.provider === 'openai' && provider.model === 'gpt-4') {
        factors.push({
          name: 'Premium Model',
          impact: 0.5,
          confidence: 0.9,
          description: 'GPT-4 is a premium model with higher costs'
        })
      }

      if (provider.provider === 'ollama') {
        factors.push({
          name: 'Open Source Model',
          impact: -0.6,
          confidence: 0.85,
          description: 'Open source models offer significant cost savings'
        })
      }

      // Volume discount factor
      const volumeDiscount = await this.calculateVolumeDiscount(input.userId, provider)
      if (volumeDiscount > 0) {
        factors.push({
          name: 'Volume Discount',
          impact: -volumeDiscount,
          confidence: 0.95,
          description: `${Math.round(volumeDiscount * 100)}% discount for high volume usage`
        })
      }

    } catch (error) {
      logger.error('Error identifying cost factors', { provider, error })
    }

    return factors
  }

  // Generate cost optimization recommendations
  private async generateRecommendations(
    predictions: ProviderCostPrediction[],
    input: CostPredictionInput
  ): Promise<CostRecommendation[]> {
    const recommendations: CostRecommendation[] = []

    try {
      if (predictions.length === 0) return recommendations

      const cheapest = predictions[0]
      const mostExpensive = predictions[predictions.length - 1]

      // Provider switching recommendation
      if (predictions.length > 1) {
        const savings = mostExpensive.predictedCost - cheapest.predictedCost
        if (savings > 0.01) { // Significant savings
          recommendations.push({
            type: 'provider_switch',
            title: `Switch to ${cheapest.provider} ${cheapest.model}`,
            description: `Save up to $${savings.toFixed(4)} per request by using ${cheapest.provider} instead of ${mostExpensive.provider}`,
            potentialSavings: savings,
            implementationEffort: 'low',
            tradeoffs: ['May have different response characteristics', 'Ensure capability compatibility'],
            priority: savings > 0.1 ? 1 : 2
          })
        }
      }

      // Priority optimization
      if (input.priority === 'critical') {
        const normalPriorityPrediction = await this.predictProviderCost(
          { provider: cheapest.provider, model: cheapest.model, agentId: cheapest.agentId, capabilities: [] },
          input.estimatedTokens || 1500,
          { ...input, priority: 'normal' }
        )
        
        const savings = cheapest.predictedCost - normalPriorityPrediction.predictedCost
        if (savings > 0.005) {
          recommendations.push({
            type: 'request_optimization',
            title: 'Consider Normal Priority',
            description: `Reducing priority from critical to normal could save $${savings.toFixed(4)}`,
            potentialSavings: savings,
            implementationEffort: 'low',
            tradeoffs: ['Longer response time', 'Lower queue priority'],
            priority: 3
          })
        }
      }

      // Timing optimization
      const hour = new Date().getHours()
      if (hour >= 9 && hour <= 17) {
        recommendations.push({
          type: 'timing_optimization',
          title: 'Schedule for Off-Peak Hours',
          description: 'Non-urgent requests scheduled for night hours (11PM-6AM) can save 10-15%',
          potentialSavings: cheapest.predictedCost * 0.125,
          implementationEffort: 'medium',
          tradeoffs: ['Delayed results', 'Requires request scheduling'],
          priority: 4
        })
      }

      // Budget optimization
      if (input.maxCost && cheapest.predictedCost > input.maxCost) {
        recommendations.push({
          type: 'budget_adjustment',
          title: 'Increase Budget or Simplify Request',
          description: `Current request exceeds budget by $${(cheapest.predictedCost - input.maxCost).toFixed(4)}`,
          potentialSavings: 0,
          implementationEffort: 'high',
          tradeoffs: ['Higher costs', 'Reduced request scope'],
          priority: 1
        })
      }

      // Volume optimization
      const userHistory = this.historicalData.filter(h => h.userId === input.userId)
      if (userHistory.length > 0) {
        const monthlySpend = userHistory
          .filter(h => h.timestamp > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
          .reduce((sum, h) => sum + h.actualCost, 0)

        if (monthlySpend > 80 && monthlySpend < 100) {
          recommendations.push({
            type: 'request_optimization',
            title: 'Volume Discount Opportunity',
            description: `Spending $${(100 - monthlySpend).toFixed(2)} more this month unlocks 5% volume discount`,
            potentialSavings: monthlySpend * 0.05,
            implementationEffort: 'low',
            tradeoffs: ['Higher upfront cost', 'Requires additional usage'],
            priority: 3
          })
        }
      }

      // Sort by priority and potential savings
      recommendations.sort((a, b) => a.priority - b.priority || b.potentialSavings - a.potentialSavings)

    } catch (error) {
      logger.error('Error generating recommendations', { error })
    }

    return recommendations
  }

  // Analyze budget impact
  private async analyzeBudgetImpact(
    predictions: ProviderCostPrediction[],
    userId?: string
  ): Promise<BudgetAnalysis> {
    try {
      const cheapestCost = predictions[0]?.predictedCost || 0

      if (!userId) {
        return {
          projectedSpend: cheapestCost,
          burnRate: 0,
          budgetUtilization: 0,
          budgetStatus: 'on_track',
          alerts: []
        }
      }

      // Get user's historical spending
      const userHistory = this.historicalData.filter(h => h.userId === userId)
      const last30Days = userHistory.filter(h => 
        h.timestamp > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      )

      const monthlySpend = last30Days.reduce((sum, h) => sum + h.actualCost, 0)
      const dailyAverage = monthlySpend / 30
      const projectedMonthlySpend = dailyAverage * 30

      // Assume $200 monthly budget (would be retrieved from user settings)
      const currentBudget = 200
      const remainingBudget = currentBudget - monthlySpend
      const budgetUtilization = monthlySpend / currentBudget
      
      const daysInMonth = new Date().getDate()
      const daysRemaining = 30 - daysInMonth
      const burnRate = dailyAverage

      let budgetStatus: BudgetAnalysis['budgetStatus'] = 'on_track'
      if (budgetUtilization > 0.9) budgetStatus = 'critical'
      else if (budgetUtilization > 0.8) budgetStatus = 'over_budget'
      else if (projectedMonthlySpend > currentBudget) budgetStatus = 'over_budget'

      const alerts: BudgetAlert[] = []

      if (budgetUtilization > 0.8) {
        alerts.push({
          type: 'warning',
          message: `You've used ${Math.round(budgetUtilization * 100)}% of your monthly budget`,
          threshold: 0.8,
          currentValue: budgetUtilization,
          recommendedAction: 'Consider switching to lower-cost providers'
        })
      }

      if (remainingBudget < dailyAverage * 7) {
        alerts.push({
          type: 'critical',
          message: 'Budget may be exhausted within a week at current usage rate',
          threshold: dailyAverage * 7,
          currentValue: remainingBudget,
          recommendedAction: 'Reduce usage or increase budget'
        })
      }

      return {
        currentBudget,
        projectedSpend: projectedMonthlySpend,
        remainingBudget,
        burnRate,
        budgetUtilization,
        daysRemaining,
        budgetStatus,
        alerts
      }

    } catch (error) {
      logger.error('Error analyzing budget impact', { userId, error })
      return {
        projectedSpend: 0,
        burnRate: 0,
        budgetUtilization: 0,
        budgetStatus: 'on_track',
        alerts: []
      }
    }
  }

  // Assess cost risks
  private async assessRisks(
    predictions: ProviderCostPrediction[],
    input: CostPredictionInput
  ): Promise<RiskAssessment> {
    try {
      const riskFactors: RiskAssessment['riskFactors'] = []

      // Cost variance risk
      const costs = predictions.map(p => p.predictedCost)
      const avgCost = costs.reduce((sum, cost) => sum + cost, 0) / costs.length
      const costVariance = costs.reduce((sum, cost) => sum + Math.pow(cost - avgCost, 2), 0) / costs.length
      
      if (costVariance > avgCost * 0.5) {
        riskFactors.push({
          factor: 'High Cost Variance',
          severity: 'medium',
          probability: 0.7,
          impact: 'Actual costs may vary significantly from predictions',
          mitigation: 'Set stricter budget limits and monitor usage closely'
        })
      }

      // Budget overrun risk
      if (input.maxCost && predictions[0]?.predictedCost > input.maxCost * 0.9) {
        riskFactors.push({
          factor: 'Budget Overrun Risk',
          severity: 'high',
          probability: 0.8,
          impact: 'Request may exceed allocated budget',
          mitigation: 'Consider lower-cost providers or reduce request scope'
        })
      }

      // Complexity risk
      if (input.context?.complexity && input.context.complexity > 80) {
        riskFactors.push({
          factor: 'High Complexity Processing',
          severity: 'medium',
          probability: 0.6,
          impact: 'Complex requests may require multiple attempts or longer processing',
          mitigation: 'Allow for additional budget buffer and extended timeouts'
        })
      }

      // Provider availability risk
      const providerRisk = this.assessProviderRisks(predictions)
      riskFactors.push(...providerRisk)

      // Calculate overall risk
      const avgSeverity = riskFactors.length > 0 
        ? riskFactors.reduce((sum, r) => sum + this.severityToNumber(r.severity), 0) / riskFactors.length 
        : 1

      let overallRisk: RiskAssessment['overallRisk'] = 'low'
      if (avgSeverity > 2.5) overallRisk = 'critical'
      else if (avgSeverity > 2) overallRisk = 'high'
      else if (avgSeverity > 1.5) overallRisk = 'medium'

      // Calculate probability distribution
      const p10 = predictions[0]?.costRange.minimum || 0
      const p50 = avgCost
      const p90 = Math.max(...predictions.map(p => p.costRange.maximum))
      const p99 = p90 * 1.2

      return {
        overallRisk,
        riskFactors,
        probabilityDistribution: { p10, p50, p90, p99 }
      }

    } catch (error) {
      logger.error('Error assessing risks', { error })
      return {
        overallRisk: 'medium',
        riskFactors: [],
        probabilityDistribution: { p10: 0, p50: 0, p90: 0, p99: 0 }
      }
    }
  }

  // Helper method to assess provider-specific risks
  private assessProviderRisks(predictions: ProviderCostPrediction[]): RiskAssessment['riskFactors'] {
    const risks: RiskAssessment['riskFactors'] = []

    predictions.forEach(prediction => {
      // Provider-specific reliability risks
      const reliabilityScores = {
        openai: 0.95,
        claude: 0.92,
        gemini: 0.88,
        ollama: 0.85
      }

      const reliability = reliabilityScores[prediction.provider as keyof typeof reliabilityScores] || 0.8

      if (reliability < 0.9) {
        risks.push({
          factor: `${prediction.provider} Reliability`,
          severity: 'low',
          probability: 1 - reliability,
          impact: 'Provider may experience downtime or degraded performance',
          mitigation: 'Have fallback providers configured'
        })
      }

      // Cost prediction confidence risks
      if (prediction.costRange.confidence < 0.7) {
        risks.push({
          factor: `${prediction.provider} Cost Uncertainty`,
          severity: 'medium',
          probability: 1 - prediction.costRange.confidence,
          impact: 'Actual costs may differ significantly from predictions',
          mitigation: 'Monitor actual costs and adjust models'
        })
      }
    })

    return risks
  }

  // Helper to convert severity to number
  private severityToNumber(severity: string): number {
    const severityMap = { low: 1, medium: 2, high: 3 }
    return severityMap[severity as keyof typeof severityMap] || 2
  }

  // Calculate overall prediction confidence
  private calculateOverallConfidence(predictions: ProviderCostPrediction[]): number {
    if (predictions.length === 0) return 0.5

    const avgConfidence = predictions.reduce((sum, p) => sum + p.costRange.confidence, 0) / predictions.length
    return Math.max(0.3, Math.min(1.0, avgConfidence))
  }

  // Learn from actual costs to improve predictions
  async learnFromActualCost(
    userId: string,
    provider: string,
    model: string,
    predictedCost: number,
    actualCost: number,
    tokens: { input: number; output: number },
    requestData: any
  ): Promise<void> {
    try {
      const historicalEntry: HistoricalCostData = {
        userId,
        provider,
        model,
        timestamp: new Date(),
        actualCost,
        predictedCost,
        tokens: {
          input: tokens.input,
          output: tokens.output,
          total: tokens.input + tokens.output
        },
        request: {
          complexity: requestData.complexity || 50,
          capabilities: requestData.capabilities || [],
          priority: requestData.priority || 'normal',
          responseTime: requestData.responseTime || 0
        }
      }

      this.historicalData.push(historicalEntry)

      // Limit historical data size
      if (this.historicalData.length > 10000) {
        this.historicalData = this.historicalData.slice(-8000)
      }

      // Update models periodically
      if (this.historicalData.length % 100 === 0) {
        await this.updateCostModels()
      }

      logger.info('Cost learning data recorded', {
        userId,
        provider: `${provider}:${model}`,
        accuracy: Math.abs(predictedCost - actualCost) / actualCost,
        actualCost,
        predictedCost
      })

    } catch (error) {
      logger.error('Error learning from actual cost', {
        userId,
        provider: `${provider}:${model}`,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  // Initialize pricing data
  private initializePricingData(): void {
    try {
      // OpenAI pricing
      this.providerPricing.set('openai:gpt-4', {
        provider: 'openai',
        model: 'gpt-4',
        inputTokenPrice: 0.00003,
        outputTokenPrice: 0.00006,
        lastUpdated: new Date()
      })

      this.providerPricing.set('openai:gpt-3.5-turbo', {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        inputTokenPrice: 0.0000015,
        outputTokenPrice: 0.000002,
        lastUpdated: new Date()
      })

      // Claude pricing
      this.providerPricing.set('claude:claude-3-opus', {
        provider: 'claude',
        model: 'claude-3-opus',
        inputTokenPrice: 0.000015,
        outputTokenPrice: 0.000075,
        lastUpdated: new Date()
      })

      this.providerPricing.set('claude:claude-3-sonnet', {
        provider: 'claude',
        model: 'claude-3-sonnet',
        inputTokenPrice: 0.000003,
        outputTokenPrice: 0.000015,
        lastUpdated: new Date()
      })

      this.providerPricing.set('claude:claude-3-haiku', {
        provider: 'claude',
        model: 'claude-3-haiku',
        inputTokenPrice: 0.00000025,
        outputTokenPrice: 0.00000125,
        lastUpdated: new Date()
      })

      // Gemini pricing
      this.providerPricing.set('gemini:gemini-pro', {
        provider: 'gemini',
        model: 'gemini-pro',
        inputTokenPrice: 0.0000005,
        outputTokenPrice: 0.0000015,
        lastUpdated: new Date()
      })

      // Ollama (self-hosted)
      this.providerPricing.set('ollama:llama2-7b', {
        provider: 'ollama',
        model: 'llama2-7b',
        inputTokenPrice: 0.0000001,
        outputTokenPrice: 0.0000001,
        lastUpdated: new Date()
      })

      logger.info('Provider pricing data initialized', {
        providers: this.providerPricing.size
      })

    } catch (error) {
      logger.error('Error initializing pricing data', { error })
    }
  }

  // Initialize demand models
  private initializeCostModels(): void {
    try {
      // Initialize demand models (hourly load patterns)
      const providers = ['openai:gpt-4', 'openai:gpt-3.5-turbo', 'claude:claude-3-opus', 'gemini:gemini-pro']
      
      providers.forEach(provider => {
        this.demandModels.set(provider, {
          loadByHour: this.generateDemandPattern(),
          lastUpdated: new Date()
        })
      })

      logger.info('Demand models initialized', {
        models: this.demandModels.size
      })

    } catch (error) {
      logger.error('Error initializing demand models', { error })
    }
  }

  // Generate realistic demand pattern for 24 hours
  private generateDemandPattern(): number[] {
    const pattern: number[] = []
    
    for (let hour = 0; hour < 24; hour++) {
      let load = 0.3 // Base load
      
      // Business hours peak
      if (hour >= 9 && hour <= 17) {
        load += 0.4
      }
      
      // Evening usage
      if (hour >= 19 && hour <= 22) {
        load += 0.2
      }
      
      // Add some randomization
      load += (Math.random() - 0.5) * 0.1
      load = Math.max(0.1, Math.min(0.9, load))
      
      pattern.push(load)
    }
    
    return pattern
  }

  // Update cost models based on historical data
  private async updateCostModels(): Promise<void> {
    try {
      if (this.historicalData.length < 100) return

      const recentData = this.historicalData.slice(-500)
      
      // Calculate model accuracy
      let totalError = 0
      let validPredictions = 0

      recentData.forEach(data => {
        if (data.actualCost > 0 && data.predictedCost > 0) {
          const error = Math.abs(data.actualCost - data.predictedCost) / data.actualCost
          totalError += error
          validPredictions++
        }
      })

      const accuracy = validPredictions > 0 ? 1 - (totalError / validPredictions) : 0.8

      this.lastModelUpdate = new Date()

      logger.info('Cost models updated', {
        historicalDataSize: this.historicalData.length,
        modelAccuracy: Math.round(accuracy * 100) + '%',
        validPredictions
      })

    } catch (error) {
      logger.error('Error updating cost models', { error })
    }
  }

  // Get model performance metrics
  async getModelMetrics(): Promise<{
    accuracy: number
    predictions: number
    lastUpdate: Date
    providerAccuracy: Record<string, number>
  }> {
    try {
      const recentData = this.historicalData.slice(-1000)
      
      let totalError = 0
      let validPredictions = 0
      const providerErrors: Record<string, { error: number; count: number }> = {}

      recentData.forEach(data => {
        if (data.actualCost > 0 && data.predictedCost > 0) {
          const error = Math.abs(data.actualCost - data.predictedCost) / data.actualCost
          totalError += error
          validPredictions++

          const providerKey = `${data.provider}:${data.model}`
          if (!providerErrors[providerKey]) {
            providerErrors[providerKey] = { error: 0, count: 0 }
          }
          providerErrors[providerKey].error += error
          providerErrors[providerKey].count++
        }
      })

      const accuracy = validPredictions > 0 ? 1 - (totalError / validPredictions) : 0.8

      const providerAccuracy: Record<string, number> = {}
      Object.entries(providerErrors).forEach(([provider, data]) => {
        if (data.count > 0) {
          providerAccuracy[provider] = 1 - (data.error / data.count)
        }
      })

      return {
        accuracy,
        predictions: this.historicalData.length,
        lastUpdate: this.lastModelUpdate,
        providerAccuracy
      }

    } catch (error) {
      logger.error('Error getting model metrics', { error })
      throw new Error('Failed to get model metrics')
    }
  }
}

// Types for internal use
interface ProviderPricing {
  provider: string
  model: string
  inputTokenPrice: number
  outputTokenPrice: number
  lastUpdated: Date
}

interface DemandModel {
  loadByHour: number[] // 24-hour load pattern
  lastUpdated: Date
}
