
import { logger } from '@ai-platform/shared-utils'

export interface CostEstimate {
  agentId: string
  baseCost: number
  adjustedCost: number
  tokens: number
  factors: {
    volumeDiscount: number
    priorityMultiplier: number
    timeOfDayMultiplier: number
    loyaltyDiscount: number
  }
}

export interface CostOptimizationStrategy {
  name: string
  description: string
  estimatedSavings: number
  applicableScenarios: string[]
}

export class CostOptimizer {
  private costHistory: Map<string, number[]> = new Map()
  private userVolumeTracking: Map<string, { requests: number, lastReset: Date }> = new Map()
  private peakHours = [9, 10, 11, 14, 15, 16] // Business hours with higher costs

  constructor() {
    logger.info('Cost optimization engine initialized')
  }

  // Calculate cost score for an agent (0-100, higher is better/cheaper)
  async calculateCostScore(
    agent: any, 
    estimatedTokens: number, 
    maxCost?: number,
    userId?: string
  ): Promise<number> {
    try {
      const estimate = await this.calculateCostEstimate(agent, estimatedTokens, userId)
      
      // If max cost is specified, check if this agent exceeds it
      if (maxCost && estimate.adjustedCost > maxCost) {
        return 0 // Not affordable
      }

      // Calculate score based on cost efficiency
      const baseCostScore = this.calculateBaseCostScore(estimate.adjustedCost, estimatedTokens)
      const efficiencyBonus = this.calculateEfficiencyBonus(agent, estimate)
      const volumeBonus = estimate.factors.volumeDiscount * 10
      const loyaltyBonus = estimate.factors.loyaltyDiscount * 15

      const totalScore = Math.min(100, 
        baseCostScore + efficiencyBonus + volumeBonus + loyaltyBonus
      )

      logger.debug('Cost score calculated', {
        agentId: agent.id,
        agentName: agent.name,
        adjustedCost: estimate.adjustedCost,
        score: totalScore,
        factors: estimate.factors
      })

      return Math.round(totalScore * 100) / 100

    } catch (error) {
      logger.error('Error calculating cost score', {
        agentId: agent.id,
        estimatedTokens,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return 0
    }
  }

  // Calculate detailed cost estimate for an agent
  async calculateCostEstimate(
    agent: any, 
    estimatedTokens: number,
    userId?: string
  ): Promise<CostEstimate> {
    const baseCost = agent.costPerToken * estimatedTokens

    // Calculate cost adjustment factors
    const volumeDiscount = userId ? this.calculateVolumeDiscount(userId) : 0
    const priorityMultiplier = 1.0 // Will be set by caller based on priority
    const timeOfDayMultiplier = this.calculateTimeOfDayMultiplier()
    const loyaltyDiscount = userId ? this.calculateLoyaltyDiscount(userId) : 0

    // Apply adjustments
    let adjustedCost = baseCost
    adjustedCost *= (1 - volumeDiscount)
    adjustedCost *= priorityMultiplier
    adjustedCost *= timeOfDayMultiplier
    adjustedCost *= (1 - loyaltyDiscount)

    return {
      agentId: agent.id,
      baseCost,
      adjustedCost: Math.round(adjustedCost * 10000) / 10000, // Round to 4 decimal places
      tokens: estimatedTokens,
      factors: {
        volumeDiscount,
        priorityMultiplier,
        timeOfDayMultiplier,
        loyaltyDiscount
      }
    }
  }

  // Calculate base cost score (lower cost = higher score)
  private calculateBaseCostScore(cost: number, tokens: number): number {
    const costPerToken = cost / tokens
    
    // Define cost tiers (per token in cents)
    const costTiers = [
      { max: 0.0001, score: 95 },  // Ultra-cheap models
      { max: 0.0005, score: 85 },  // Cheap models
      { max: 0.001, score: 70 },   // Mid-tier models
      { max: 0.005, score: 50 },   // Expensive models
      { max: 0.01, score: 25 },    // Very expensive models
      { max: Infinity, score: 0 }  // Extremely expensive models
    ]

    for (const tier of costTiers) {
      if (costPerToken <= tier.max) {
        return tier.score
      }
    }

    return 0
  }

  // Calculate efficiency bonus based on agent performance/cost ratio
  private calculateEfficiencyBonus(agent: any, estimate: CostEstimate): number {
    // Consider agent's average response time and cost
    const responseTimeScore = Math.max(0, 10 - (agent.averageResponseTime || 1000) / 1000) // Better for faster responses
    const efficiencyRatio = (agent.averageResponseTime || 1000) / estimate.adjustedCost
    
    return Math.min(15, responseTimeScore + (efficiencyRatio > 1000 ? 5 : 0))
  }

  // Calculate volume discount based on user's recent usage
  private calculateVolumeDiscount(userId: string): number {
    const userVolume = this.getUserVolume(userId)
    
    if (userVolume.requests >= 100) {
      return 0.15 // 15% discount for power users
    } else if (userVolume.requests >= 50) {
      return 0.10 // 10% discount for regular users
    } else if (userVolume.requests >= 20) {
      return 0.05 // 5% discount for moderate users
    }
    
    return 0
  }

  // Calculate time-of-day multiplier
  private calculateTimeOfDayMultiplier(): number {
    const currentHour = new Date().getHours()
    
    if (this.peakHours.includes(currentHour)) {
      return 1.1 // 10% higher cost during peak hours
    } else if (currentHour < 6 || currentHour > 22) {
      return 0.9 // 10% discount during off-peak hours
    }
    
    return 1.0 // Normal cost
  }

  // Calculate loyalty discount (placeholder - would be based on user history)
  private calculateLoyaltyDiscount(userId: string): number {
    // This would be calculated based on user's history, subscription status, etc.
    // For now, simulate based on user ID hash
    const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    
    if (hash % 10 === 0) {
      return 0.05 // 5% loyalty discount for some users
    }
    
    return 0
  }

  // Get or initialize user volume tracking
  private getUserVolume(userId: string): { requests: number, lastReset: Date } {
    const now = new Date()
    const userVolume = this.userVolumeTracking.get(userId) || { requests: 0, lastReset: now }
    
    // Reset monthly counter
    if (now.getMonth() !== userVolume.lastReset.getMonth() || 
        now.getFullYear() !== userVolume.lastReset.getFullYear()) {
      userVolume.requests = 0
      userVolume.lastReset = now
      this.userVolumeTracking.set(userId, userVolume)
    }
    
    return userVolume
  }

  // Track a request for cost optimization
  async trackRequest(userId: string, agentId: string, actualCost: number): Promise<void> {
    // Update user volume
    const userVolume = this.getUserVolume(userId)
    userVolume.requests++
    this.userVolumeTracking.set(userId, userVolume)

    // Update agent cost history
    const history = this.costHistory.get(agentId) || []
    history.push(actualCost)
    
    // Keep only last 100 costs for moving average
    if (history.length > 100) {
      history.shift()
    }
    
    this.costHistory.set(agentId, history)

    logger.debug('Request cost tracked', {
      userId,
      agentId,
      actualCost,
      userTotalRequests: userVolume.requests
    })
  }

  // Get cost optimization strategies for a user
  async getCostOptimizationStrategies(userId: string): Promise<CostOptimizationStrategy[]> {
    const userVolume = this.getUserVolume(userId)
    const strategies: CostOptimizationStrategy[] = []

    // Volume-based strategies
    if (userVolume.requests < 20) {
      strategies.push({
        name: 'Batch Requests',
        description: 'Group similar requests together to reduce per-request overhead',
        estimatedSavings: 10,
        applicableScenarios: ['Multiple similar tasks', 'Content generation batches']
      })
    }

    // Time-based strategies
    strategies.push({
      name: 'Off-Peak Usage',
      description: 'Schedule non-urgent requests during off-peak hours (before 6 AM or after 10 PM)',
      estimatedSavings: 10,
      applicableScenarios: ['Batch processing', 'Content generation', 'Analysis tasks']
    })

    // Model selection strategies
    strategies.push({
      name: 'Right-Size Models',
      description: 'Use smaller, faster models for simple tasks and reserve powerful models for complex requests',
      estimatedSavings: 25,
      applicableScenarios: ['Simple Q&A', 'Basic text generation', 'Classification tasks']
    })

    // Token optimization strategies
    strategies.push({
      name: 'Optimize Prompts',
      description: 'Use concise prompts and limit response length to reduce token usage',
      estimatedSavings: 15,
      applicableScenarios: ['All request types']
    })

    return strategies
  }

  // Analyze cost trends for an agent
  async analyzeCostTrends(agentId: string): Promise<{
    averageCost: number
    trend: 'increasing' | 'decreasing' | 'stable'
    volatility: 'low' | 'medium' | 'high'
    recommendations: string[]
  }> {
    const history = this.costHistory.get(agentId) || []
    
    if (history.length < 5) {
      return {
        averageCost: 0,
        trend: 'stable',
        volatility: 'low',
        recommendations: ['Insufficient data for analysis - need more usage history']
      }
    }

    const averageCost = history.reduce((sum, cost) => sum + cost, 0) / history.length
    
    // Calculate trend
    const recentCosts = history.slice(-5)
    const olderCosts = history.slice(0, 5)
    const recentAvg = recentCosts.reduce((sum, cost) => sum + cost, 0) / recentCosts.length
    const olderAvg = olderCosts.reduce((sum, cost) => sum + cost, 0) / olderCosts.length
    
    let trend: 'increasing' | 'decreasing' | 'stable'
    const trendThreshold = 0.1 // 10% change threshold
    
    if (recentAvg > olderAvg * (1 + trendThreshold)) {
      trend = 'increasing'
    } else if (recentAvg < olderAvg * (1 - trendThreshold)) {
      trend = 'decreasing'
    } else {
      trend = 'stable'
    }

    // Calculate volatility
    const variance = history.reduce((sum, cost) => sum + Math.pow(cost - averageCost, 2), 0) / history.length
    const standardDeviation = Math.sqrt(variance)
    const coefficientOfVariation = standardDeviation / averageCost

    let volatility: 'low' | 'medium' | 'high'
    if (coefficientOfVariation < 0.1) {
      volatility = 'low'
    } else if (coefficientOfVariation < 0.3) {
      volatility = 'medium'
    } else {
      volatility = 'high'
    }

    // Generate recommendations
    const recommendations: string[] = []
    
    if (trend === 'increasing') {
      recommendations.push('Costs are trending upward - consider alternative models')
    }
    
    if (volatility === 'high') {
      recommendations.push('High cost volatility detected - investigate usage patterns')
    }
    
    if (averageCost > 0.01) {
      recommendations.push('High average cost per request - consider cheaper alternatives for simple tasks')
    }

    return {
      averageCost,
      trend,
      volatility,
      recommendations: recommendations.length > 0 ? recommendations : ['Cost patterns look healthy']
    }
  }

  // Calculate potential cost savings from optimization
  async calculatePotentialSavings(
    currentAgent: any,
    alternativeAgents: any[],
    estimatedTokens: number,
    userId?: string
  ): Promise<{
    currentCost: number
    bestAlternativeCost: number
    potentialSavings: number
    savingsPercentage: number
    recommendedAgent?: any
  }> {
    const currentEstimate = await this.calculateCostEstimate(currentAgent, estimatedTokens, userId)
    
    const alternativeEstimates = await Promise.all(
      alternativeAgents.map(async agent => ({
        agent,
        estimate: await this.calculateCostEstimate(agent, estimatedTokens, userId)
      }))
    )

    // Find the cheapest alternative
    const bestAlternative = alternativeEstimates.reduce((best, current) => 
      current.estimate.adjustedCost < best.estimate.adjustedCost ? current : best
    )

    const potentialSavings = Math.max(0, currentEstimate.adjustedCost - bestAlternative.estimate.adjustedCost)
    const savingsPercentage = currentEstimate.adjustedCost > 0 
      ? (potentialSavings / currentEstimate.adjustedCost) * 100
      : 0

    return {
      currentCost: currentEstimate.adjustedCost,
      bestAlternativeCost: bestAlternative.estimate.adjustedCost,
      potentialSavings,
      savingsPercentage: Math.round(savingsPercentage * 100) / 100,
      recommendedAgent: potentialSavings > 0 ? bestAlternative.agent : undefined
    }
  }

  // Get cost optimization metrics for reporting
  async getOptimizationMetrics(): Promise<{
    totalRequestsTracked: number
    averageSavingsPerRequest: number
    topSavingStrategies: string[]
    totalSavings: number
  }> {
    const totalRequests = Array.from(this.userVolumeTracking.values())
      .reduce((sum, volume) => sum + volume.requests, 0)

    // Calculate estimated savings (this would be more accurate with historical data)
    const estimatedSavingsPerRequest = 0.25 // $0.25 average savings per request
    const totalSavings = totalRequests * estimatedSavingsPerRequest

    return {
      totalRequestsTracked: totalRequests,
      averageSavingsPerRequest: estimatedSavingsPerRequest,
      topSavingStrategies: [
        'Right-sizing models for task complexity',
        'Off-peak hour usage',
        'Volume discounts for frequent users'
      ],
      totalSavings
    }
  }
}
