
import { logger } from '@ai-platform/shared-utils'

export interface ScoringFactors {
  performance: PerformanceFactor
  cost: CostFactor
  availability: AvailabilityFactor
  quality: QualityFactor
  context: ContextFactor
  user: UserFactor
  temporal: TemporalFactor
  strategic: StrategicFactor
}

export interface PerformanceFactor {
  responseTime: number
  throughput: number
  reliability: number
  successRate: number
  weight: number
}

export interface CostFactor {
  tokenCost: number
  computeCost: number
  opportunityCost: number
  budgetAlignment: number
  weight: number
}

export interface AvailabilityFactor {
  currentLoad: number
  queueLength: number
  healthStatus: number
  capacity: number
  weight: number
}

export interface QualityFactor {
  outputQuality: number
  accuracyScore: number
  consistencyScore: number
  userSatisfaction: number
  weight: number
}

export interface ContextFactor {
  capabilityMatch: number
  domainExpertise: number
  complexityAlignment: number
  specialization: number
  weight: number
}

export interface UserFactor {
  preferences: number
  history: number
  feedback: number
  loyalty: number
  weight: number
}

export interface TemporalFactor {
  timeOfDay: number
  urgency: number
  seasonality: number
  trends: number
  weight: number
}

export interface StrategicFactor {
  diversification: number
  exploration: number
  costOptimization: number
  qualityImprovement: number
  weight: number
}

export interface DynamicScore {
  agentId: string
  totalScore: number
  normalizedScore: number
  confidence: number
  factors: ScoringFactors
  reasoning: ScoringReasoning
  alternatives: AlternativeScore[]
}

export interface ScoringReasoning {
  primaryFactors: string[]
  strengths: string[]
  weaknesses: string[]
  riskFactors: string[]
  recommendations: string[]
}

export interface AlternativeScore {
  agentId: string
  score: number
  reason: string
  tradeoffs: string[]
}

export interface ScoringConfig {
  weights: Record<keyof ScoringFactors, number>
  thresholds: {
    minimumScore: number
    confidenceThreshold: number
    qualityThreshold: number
    costThreshold: number
  }
  adaptationRate: number
  explorationRate: number
}

export class DynamicScoringEngine {
  private config: ScoringConfig
  private scoringHistory: Array<{
    agentId: string
    score: DynamicScore
    actualOutcome: any
    timestamp: Date
  }> = []
  private adaptationMetrics: Map<string, number> = new Map()
  private lastUpdate: Date = new Date()

  constructor(config?: Partial<ScoringConfig>) {
    this.config = {
      weights: {
        performance: 0.25,
        cost: 0.20,
        availability: 0.15,
        quality: 0.20,
        context: 0.10,
        user: 0.05,
        temporal: 0.03,
        strategic: 0.02
      },
      thresholds: {
        minimumScore: 0.3,
        confidenceThreshold: 0.7,
        qualityThreshold: 0.8,
        costThreshold: 0.6
      },
      adaptationRate: 0.1,
      explorationRate: 0.05,
      ...config
    }

    logger.info('Dynamic Scoring Engine initialized', {
      weights: this.config.weights,
      thresholds: this.config.thresholds
    })
  }

  // Calculate dynamic scores for all agents
  async calculateDynamicScores(
    agents: any[],
    request: any,
    context: any,
    userProfile?: any
  ): Promise<DynamicScore[]> {
    try {
      const startTime = Date.now()
      
      logger.info('Calculating dynamic scores', {
        agentCount: agents.length,
        requestComplexity: context?.complexity?.overall || 'unknown',
        userId: request.userId
      })

      const scores: DynamicScore[] = []

      for (const agent of agents) {
        const score = await this.calculateAgentScore(agent, request, context, userProfile)
        scores.push(score)
      }

      // Sort by normalized score (descending)
      scores.sort((a, b) => b.normalizedScore - a.normalizedScore)

      // Add alternatives to each score
      scores.forEach((score, index) => {
        score.alternatives = this.generateAlternatives(scores, index)
      })

      const calculationTime = Date.now() - startTime
      logger.info('Dynamic scoring completed', {
        agentCount: agents.length,
        bestScore: scores[0]?.normalizedScore || 0,
        calculationTime: `${calculationTime}ms`
      })

      return scores

    } catch (error) {
      logger.error('Error calculating dynamic scores', {
        agentCount: agents.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Dynamic scoring calculation failed')
    }
  }

  // Calculate score for a single agent
  private async calculateAgentScore(
    agent: any,
    request: any,
    context: any,
    userProfile?: any
  ): Promise<DynamicScore> {
    try {
      // Extract all scoring factors
      const factors = await this.extractScoringFactors(agent, request, context, userProfile)

      // Calculate weighted total score
      let totalScore = 0
      for (const [factorName, factor] of Object.entries(factors) as Array<[keyof ScoringFactors, any]>) {
        const factorScore = this.calculateFactorScore(factor)
        const weightedScore = factorScore * this.config.weights[factorName]
        totalScore += weightedScore
      }

      // Normalize score (0-100)
      const normalizedScore = Math.max(0, Math.min(100, totalScore * 100))

      // Calculate confidence based on data quality
      const confidence = this.calculateConfidence(factors, agent, context)

      // Generate reasoning
      const reasoning = this.generateReasoning(factors, normalizedScore, confidence)

      // Apply strategic adjustments (exploration, diversification, etc.)
      const adjustedScore = this.applyStrategicAdjustments(
        normalizedScore,
        agent,
        factors.strategic
      )

      return {
        agentId: agent.id,
        totalScore: totalScore,
        normalizedScore: adjustedScore,
        confidence,
        factors,
        reasoning,
        alternatives: [] // Will be populated later
      }

    } catch (error) {
      logger.error('Error calculating agent score', {
        agentId: agent.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      return this.getDefaultScore(agent.id)
    }
  }

  // Extract all scoring factors for an agent
  private async extractScoringFactors(
    agent: any,
    request: any,
    context: any,
    userProfile?: any
  ): Promise<ScoringFactors> {
    try {
      const [
        performance,
        cost,
        availability,
        quality,
        contextFactor,
        userFactor,
        temporal,
        strategic
      ] = await Promise.all([
        this.extractPerformanceFactor(agent, request),
        this.extractCostFactor(agent, request, context),
        this.extractAvailabilityFactor(agent),
        this.extractQualityFactor(agent, context),
        this.extractContextFactor(agent, context),
        this.extractUserFactor(agent, request, userProfile),
        this.extractTemporalFactor(agent, request),
        this.extractStrategicFactor(agent, context)
      ])

      return {
        performance,
        cost,
        availability,
        quality,
        context: contextFactor,
        user: userFactor,
        temporal,
        strategic
      }

    } catch (error) {
      logger.error('Error extracting scoring factors', { agentId: agent.id, error })
      return this.getDefaultFactors()
    }
  }

  // Extract performance factors
  private async extractPerformanceFactor(agent: any, request: any): Promise<PerformanceFactor> {
    try {
      // Get historical performance data
      const history = this.scoringHistory.filter(h => h.agentId === agent.id)
      
      let responseTime = 0.8 // Default
      let throughput = 0.7
      let reliability = 0.85
      let successRate = 0.9

      if (history.length > 0) {
        const recentHistory = history.slice(-20) // Last 20 requests
        
        responseTime = this.calculateAverageResponseTime(recentHistory) / 3000 // Normalize to 3s baseline
        responseTime = Math.max(0.1, Math.min(1, 1 - responseTime)) // Invert (faster = higher score)
        
        throughput = this.calculateThroughput(recentHistory)
        reliability = this.calculateReliability(recentHistory)
        successRate = this.calculateSuccessRate(recentHistory)
      }

      // Apply current load adjustment
      const currentLoad = agent.currentLoad || 0
      const loadPenalty = Math.min(0.3, currentLoad * 0.4)
      responseTime = Math.max(0.1, responseTime - loadPenalty)

      return {
        responseTime,
        throughput,
        reliability,
        successRate,
        weight: this.config.weights.performance
      }

    } catch (error) {
      logger.error('Error extracting performance factor', { agentId: agent.id, error })
      return {
        responseTime: 0.7,
        throughput: 0.7,
        reliability: 0.8,
        successRate: 0.85,
        weight: this.config.weights.performance
      }
    }
  }

  // Extract cost factors
  private async extractCostFactor(agent: any, request: any, context: any): Promise<CostFactor> {
    try {
      const estimatedTokens = request.estimatedTokens || context?.metadata?.estimatedTokens || 1000
      const costPerToken = agent.costPerToken || 0.001
      
      // Token cost (normalized against $0.01 baseline)
      const tokenCost = Math.max(0.1, Math.min(1, 1 - (costPerToken * estimatedTokens) / 0.01))
      
      // Compute cost (based on model complexity)
      const modelComplexity = this.getModelComplexity(agent.model)
      const computeCost = Math.max(0.1, 1 - (modelComplexity / 10))
      
      // Opportunity cost (cost of not choosing alternatives)
      const opportunityCost = 0.7 // Would be calculated based on alternatives
      
      // Budget alignment
      const maxCost = request.maxCost || 1.0
      const estimatedCost = costPerToken * estimatedTokens
      const budgetAlignment = estimatedCost <= maxCost ? 1.0 : maxCost / estimatedCost

      return {
        tokenCost,
        computeCost,
        opportunityCost,
        budgetAlignment,
        weight: this.config.weights.cost
      }

    } catch (error) {
      logger.error('Error extracting cost factor', { agentId: agent.id, error })
      return {
        tokenCost: 0.7,
        computeCost: 0.8,
        opportunityCost: 0.7,
        budgetAlignment: 0.9,
        weight: this.config.weights.cost
      }
    }
  }

  // Extract availability factors
  private async extractAvailabilityFactor(agent: any): Promise<AvailabilityFactor> {
    try {
      const currentLoad = agent.currentLoad || 0
      const queueLength = agent.queueLength || 0
      const healthStatus = agent.status === 'healthy' ? 1.0 : 
                          agent.status === 'degraded' ? 0.6 : 0.1
      const capacity = agent.capacity || 100

      // Normalize load (invert: lower load = higher score)
      const loadScore = Math.max(0.1, 1 - (currentLoad / capacity))
      
      // Normalize queue length
      const queueScore = Math.max(0.1, 1 - (queueLength / 50))

      return {
        currentLoad: loadScore,
        queueLength: queueScore,
        healthStatus,
        capacity: Math.min(1, capacity / 100),
        weight: this.config.weights.availability
      }

    } catch (error) {
      logger.error('Error extracting availability factor', { agentId: agent.id, error })
      return {
        currentLoad: 0.8,
        queueLength: 0.9,
        healthStatus: 0.9,
        capacity: 0.8,
        weight: this.config.weights.availability
      }
    }
  }

  // Extract quality factors
  private async extractQualityFactor(agent: any, context: any): Promise<QualityFactor> {
    try {
      // Historical quality metrics
      const history = this.scoringHistory.filter(h => h.agentId === agent.id)
      
      let outputQuality = 0.8
      let accuracyScore = 0.85
      let consistencyScore = 0.8
      let userSatisfaction = 0.75

      if (history.length > 0) {
        const recentHistory = history.slice(-15)
        
        outputQuality = this.calculateAverageQuality(recentHistory)
        accuracyScore = this.calculateAccuracy(recentHistory)
        consistencyScore = this.calculateConsistency(recentHistory)
        userSatisfaction = this.calculateUserSatisfaction(recentHistory)
      }

      // Adjust based on context complexity
      const complexityAlignment = this.assessComplexityAlignment(agent, context)
      outputQuality *= complexityAlignment
      accuracyScore *= complexityAlignment

      return {
        outputQuality,
        accuracyScore,
        consistencyScore,
        userSatisfaction,
        weight: this.config.weights.quality
      }

    } catch (error) {
      logger.error('Error extracting quality factor', { agentId: agent.id, error })
      return {
        outputQuality: 0.8,
        accuracyScore: 0.8,
        consistencyScore: 0.8,
        userSatisfaction: 0.75,
        weight: this.config.weights.quality
      }
    }
  }

  // Extract context factors
  private async extractContextFactor(agent: any, context: any): Promise<ContextFactor> {
    try {
      const agentCapabilities = agent.capabilities || []
      const requiredCapabilities = context?.capabilities || []
      
      // Capability match score
      const capabilityMatch = this.calculateCapabilityMatch(agentCapabilities, requiredCapabilities)
      
      // Domain expertise
      const domainExpertise = this.assessDomainExpertise(agent, context?.domain)
      
      // Complexity alignment  
      const complexityAlignment = this.assessComplexityAlignment(agent, context)
      
      // Specialization score
      const specialization = this.calculateSpecialization(agent, context)

      return {
        capabilityMatch,
        domainExpertise,
        complexityAlignment,
        specialization,
        weight: this.config.weights.context
      }

    } catch (error) {
      logger.error('Error extracting context factor', { agentId: agent.id, error })
      return {
        capabilityMatch: 0.7,
        domainExpertise: 0.6,
        complexityAlignment: 0.7,
        specialization: 0.6,
        weight: this.config.weights.context
      }
    }
  }

  // Extract user factors
  private async extractUserFactor(
    agent: any,
    request: any,
    userProfile?: any
  ): Promise<UserFactor> {
    try {
      if (!userProfile || !request.userId) {
        return {
          preferences: 0.5,
          history: 0.5,
          feedback: 0.5,
          loyalty: 0.5,
          weight: this.config.weights.user
        }
      }

      // User preferences for this agent
      const preferences = this.calculateUserPreferences(userProfile, agent)
      
      // Historical usage
      const history = this.calculateUserHistory(request.userId, agent.id)
      
      // User feedback scores
      const feedback = this.calculateUserFeedback(request.userId, agent.id)
      
      // User loyalty to provider/agent type
      const loyalty = this.calculateUserLoyalty(userProfile, agent)

      return {
        preferences,
        history,
        feedback,
        loyalty,
        weight: this.config.weights.user
      }

    } catch (error) {
      logger.error('Error extracting user factor', { agentId: agent.id, error })
      return {
        preferences: 0.5,
        history: 0.5,
        feedback: 0.5,
        loyalty: 0.5,
        weight: this.config.weights.user
      }
    }
  }

  // Extract temporal factors
  private async extractTemporalFactor(agent: any, request: any): Promise<TemporalFactor> {
    try {
      const now = new Date()
      const hour = now.getHours()
      const priority = request.priority || 'normal'
      
      // Time of day factor
      const timeOfDay = this.getTimeOfDayFactor(hour)
      
      // Urgency mapping
      const urgencyMap = {
        'low': 0.3,
        'normal': 0.6,
        'high': 0.8,
        'critical': 1.0
      }
      const urgency = urgencyMap[priority as keyof typeof urgencyMap] || 0.6
      
      // Seasonal trends
      const seasonality = this.getSeasonalityFactor(now)
      
      // Current trends (provider popularity, etc.)
      const trends = this.getTrendsFactor(agent)

      return {
        timeOfDay,
        urgency,
        seasonality,
        trends,
        weight: this.config.weights.temporal
      }

    } catch (error) {
      logger.error('Error extracting temporal factor', { agentId: agent.id, error })
      return {
        timeOfDay: 0.8,
        urgency: 0.6,
        seasonality: 0.9,
        trends: 0.7,
        weight: this.config.weights.temporal
      }
    }
  }

  // Extract strategic factors
  private async extractStrategicFactor(agent: any, context: any): Promise<StrategicFactor> {
    try {
      // Diversification (encourage using different providers)
      const diversification = this.calculateDiversificationScore(agent)
      
      // Exploration (try less-used agents occasionally)
      const exploration = this.calculateExplorationScore(agent)
      
      // Cost optimization opportunities
      const costOptimization = this.calculateCostOptimizationOpportunity(agent, context)
      
      // Quality improvement potential
      const qualityImprovement = this.calculateQualityImprovementPotential(agent, context)

      return {
        diversification,
        exploration,
        costOptimization,
        qualityImprovement,
        weight: this.config.weights.strategic
      }

    } catch (error) {
      logger.error('Error extracting strategic factor', { agentId: agent.id, error })
      return {
        diversification: 0.5,
        exploration: 0.3,
        costOptimization: 0.7,
        qualityImprovement: 0.6,
        weight: this.config.weights.strategic
      }
    }
  }

  // Calculate overall factor score
  private calculateFactorScore(factor: any): number {
    try {
      const values = Object.entries(factor)
        .filter(([key]) => key !== 'weight')
        .map(([, value]) => value as number)

      if (values.length === 0) return 0.5

      // Weighted average of all factor components
      return values.reduce((sum, value) => sum + value, 0) / values.length

    } catch (error) {
      logger.error('Error calculating factor score', { error })
      return 0.5
    }
  }

  // Calculate confidence in the score
  private calculateConfidence(factors: ScoringFactors, agent: any, context: any): number {
    try {
      // Base confidence on data availability and quality
      let confidence = 0.6

      // Historical data quality
      const history = this.scoringHistory.filter(h => h.agentId === agent.id)
      if (history.length > 10) {
        confidence += 0.2
      } else if (history.length > 5) {
        confidence += 0.1
      }

      // Context match confidence
      const contextMatch = factors.context.capabilityMatch
      confidence += contextMatch * 0.15

      // Quality consistency
      const qualityVariance = this.calculateQualityVariance(agent.id)
      confidence += (1 - qualityVariance) * 0.05

      return Math.max(0.3, Math.min(1.0, confidence))

    } catch (error) {
      logger.error('Error calculating confidence', { agentId: agent.id, error })
      return 0.6
    }
  }

  // Generate human-readable reasoning
  private generateReasoning(
    factors: ScoringFactors,
    score: number,
    confidence: number
  ): ScoringReasoning {
    try {
      const primaryFactors: string[] = []
      const strengths: string[] = []
      const weaknesses: string[] = []
      const riskFactors: string[] = []
      const recommendations: string[] = []

      // Identify primary factors (highest weighted contributions)
      const factorContributions = Object.entries(factors).map(([name, factor]) => ({
        name,
        contribution: this.calculateFactorScore(factor) * this.config.weights[name as keyof ScoringFactors]
      })).sort((a, b) => b.contribution - a.contribution)

      primaryFactors.push(...factorContributions.slice(0, 3).map(f => f.name))

      // Identify strengths (scores > 0.8)
      if (factors.performance.responseTime > 0.8) strengths.push('Fast response time')
      if (factors.quality.outputQuality > 0.8) strengths.push('High output quality')
      if (factors.cost.tokenCost > 0.8) strengths.push('Cost-effective')
      if (factors.availability.currentLoad > 0.8) strengths.push('Low current load')

      // Identify weaknesses (scores < 0.4)
      if (factors.performance.reliability < 0.4) weaknesses.push('Reliability concerns')
      if (factors.availability.healthStatus < 0.4) weaknesses.push('Health issues')
      if (factors.cost.budgetAlignment < 0.4) weaknesses.push('Budget constraints')
      if (factors.quality.consistencyScore < 0.4) weaknesses.push('Inconsistent quality')

      // Risk factors
      if (confidence < 0.5) riskFactors.push('Low prediction confidence')
      if (factors.availability.healthStatus < 0.7) riskFactors.push('Provider health issues')
      if (factors.performance.reliability < 0.6) riskFactors.push('Reliability risks')

      // Recommendations
      if (score > 80) {
        recommendations.push('Excellent choice for this request')
      } else if (score > 60) {
        recommendations.push('Good option with acceptable trade-offs')
      } else {
        recommendations.push('Consider alternatives for better results')
      }

      if (weaknesses.length > 0) {
        recommendations.push(`Monitor ${weaknesses[0].toLowerCase()}`)
      }

      return {
        primaryFactors,
        strengths,
        weaknesses,
        riskFactors,
        recommendations
      }

    } catch (error) {
      logger.error('Error generating reasoning', { error })
      return {
        primaryFactors: ['performance', 'cost', 'quality'],
        strengths: ['Available for routing'],
        weaknesses: [],
        riskFactors: [],
        recommendations: ['Monitor performance closely']
      }
    }
  }

  // Apply strategic adjustments to score
  private applyStrategicAdjustments(
    score: number,
    agent: any,
    strategicFactor: StrategicFactor
  ): number {
    try {
      let adjustedScore = score

      // Exploration bonus (encourage trying different agents)
      if (Math.random() < this.config.explorationRate) {
        const explorationBonus = strategicFactor.exploration * 5
        adjustedScore += explorationBonus
      }

      // Diversification adjustment
      const diversificationAdjustment = strategicFactor.diversification * 2
      adjustedScore += diversificationAdjustment

      // Cost optimization bonus
      const costBonus = strategicFactor.costOptimization * 3
      adjustedScore += costBonus

      return Math.max(0, Math.min(100, adjustedScore))

    } catch (error) {
      logger.error('Error applying strategic adjustments', { agentId: agent.id, error })
      return score
    }
  }

  // Generate alternative scores
  private generateAlternatives(scores: DynamicScore[], currentIndex: number): AlternativeScore[] {
    try {
      const alternatives: AlternativeScore[] = []
      const current = scores[currentIndex]

      // Get next best alternatives
      const otherScores = scores.filter((_, i) => i !== currentIndex).slice(0, 3)

      otherScores.forEach(alternative => {
        const scoreDiff = current.normalizedScore - alternative.normalizedScore
        const reason = scoreDiff > 20 
          ? 'Significantly lower score'
          : scoreDiff > 10
          ? 'Moderately lower score'
          : 'Comparable alternative'

        const tradeoffs: string[] = []
        
        // Identify key tradeoffs
        if (alternative.factors.cost.tokenCost > current.factors.cost.tokenCost) {
          tradeoffs.push('Lower cost')
        }
        if (alternative.factors.performance.responseTime > current.factors.performance.responseTime) {
          tradeoffs.push('Faster response')
        }
        if (alternative.factors.quality.outputQuality > current.factors.quality.outputQuality) {
          tradeoffs.push('Higher quality')
        }

        alternatives.push({
          agentId: alternative.agentId,
          score: alternative.normalizedScore,
          reason,
          tradeoffs
        })
      })

      return alternatives

    } catch (error) {
      logger.error('Error generating alternatives', { error })
      return []
    }
  }

  // Helper methods for calculations
  private calculateAverageResponseTime(history: any[]): number {
    if (history.length === 0) return 2000
    
    const times = history.map(h => h.actualOutcome?.responseTime || 2000)
    return times.reduce((sum, time) => sum + time, 0) / times.length
  }

  private calculateThroughput(history: any[]): number {
    // Calculate requests per minute capability
    if (history.length === 0) return 0.7
    
    // Simple calculation based on recent history
    return Math.min(1, history.length / 20)
  }

  private calculateReliability(history: any[]): number {
    if (history.length === 0) return 0.8
    
    const successful = history.filter(h => h.actualOutcome?.success !== false).length
    return successful / history.length
  }

  private calculateSuccessRate(history: any[]): number {
    return this.calculateReliability(history) // Same calculation for now
  }

  private getModelComplexity(model: string): number {
    const complexityMap: Record<string, number> = {
      'gpt-4': 9,
      'gpt-3.5-turbo': 6,
      'claude-3-opus': 9,
      'claude-3-sonnet': 7,
      'claude-3-haiku': 5,
      'gemini-pro': 7,
      'ollama': 4
    }
    
    return complexityMap[model?.toLowerCase()] || 5
  }

  private calculateAverageQuality(history: any[]): number {
    if (history.length === 0) return 0.8
    
    const qualities = history.map(h => h.actualOutcome?.quality || 0.8)
    return qualities.reduce((sum, q) => sum + q, 0) / qualities.length
  }

  private calculateAccuracy(history: any[]): number {
    if (history.length === 0) return 0.85
    
    const accuracies = history.map(h => h.actualOutcome?.accuracy || 0.85)
    return accuracies.reduce((sum, a) => sum + a, 0) / accuracies.length
  }

  private calculateConsistency(history: any[]): number {
    if (history.length < 3) return 0.8
    
    const qualities = history.map(h => h.actualOutcome?.quality || 0.8)
    const mean = qualities.reduce((sum, q) => sum + q, 0) / qualities.length
    const variance = qualities.reduce((sum, q) => sum + Math.pow(q - mean, 2), 0) / qualities.length
    
    return Math.max(0.1, 1 - variance) // Lower variance = higher consistency
  }

  private calculateUserSatisfaction(history: any[]): number {
    if (history.length === 0) return 0.75
    
    const satisfactions = history.map(h => h.actualOutcome?.userSatisfaction || 0.75)
    return satisfactions.reduce((sum, s) => sum + s, 0) / satisfactions.length
  }

  private assessComplexityAlignment(agent: any, context: any): number {
    try {
      const agentComplexity = this.getModelComplexity(agent.model)
      const requestComplexity = (context?.complexity?.overall || 50) / 10 // Normalize to 0-10
      
      // Perfect match = 1.0, decreasing as difference increases
      const difference = Math.abs(agentComplexity - requestComplexity)
      return Math.max(0.3, 1 - (difference / 10))
      
    } catch (error) {
      return 0.7
    }
  }

  private calculateCapabilityMatch(agentCaps: string[], requiredCaps: string[]): number {
    if (requiredCaps.length === 0) return 1.0
    if (agentCaps.length === 0) return 0.0
    
    const matches = requiredCaps.filter(cap => agentCaps.includes(cap)).length
    return matches / requiredCaps.length
  }

  private assessDomainExpertise(agent: any, domain: string): number {
    const domainExpertise: Record<string, Record<string, number>> = {
      'technology': {
        'gpt-4': 0.9,
        'claude-3-opus': 0.85,
        'gpt-3.5-turbo': 0.8
      },
      'creative': {
        'gpt-4': 0.9,
        'claude-3-opus': 0.95,
        'claude-3-sonnet': 0.85
      },
      'business': {
        'gpt-4': 0.85,
        'claude-3-opus': 0.8,
        'gemini-pro': 0.8
      }
    }
    
    return domainExpertise[domain]?.[agent.model] || 0.7
  }

  private calculateSpecialization(agent: any, context: any): number {
    // Calculate how specialized the agent is for this specific type of request
    const agentCaps = agent.capabilities || []
    const requiredCaps = context?.capabilities || []
    
    if (requiredCaps.length === 0) return 0.5
    
    // Higher specialization for agents with more focused capabilities
    const capabilityOverlap = this.calculateCapabilityMatch(agentCaps, requiredCaps)
    const specializationFactor = requiredCaps.length / Math.max(1, agentCaps.length)
    
    return Math.min(1, capabilityOverlap * specializationFactor)
  }

  private calculateUserPreferences(userProfile: any, agent: any): number {
    // This would analyze user's historical preferences
    return 0.6 + (Math.random() * 0.3) // Simulated
  }

  private calculateUserHistory(userId: string, agentId: string): number {
    const userHistory = this.scoringHistory.filter(h => 
      h.score.agentId === agentId && 
      h.actualOutcome?.userId === userId
    )
    
    if (userHistory.length === 0) return 0.5
    
    // Positive bias for frequently used agents
    return Math.min(1, 0.5 + (userHistory.length / 20))
  }

  private calculateUserFeedback(userId: string, agentId: string): number {
    // This would calculate average user feedback scores
    return 0.7 + (Math.random() * 0.2) // Simulated
  }

  private calculateUserLoyalty(userProfile: any, agent: any): number {
    // This would analyze user loyalty to specific providers
    return 0.6 + (Math.random() * 0.3) // Simulated
  }

  private getTimeOfDayFactor(hour: number): number {
    // Peak hours might have different performance characteristics
    if (hour >= 9 && hour <= 17) {
      return 0.8 // Business hours
    } else if (hour >= 18 && hour <= 22) {
      return 0.9 // Evening
    } else {
      return 1.0 // Off-peak
    }
  }

  private getSeasonalityFactor(date: Date): number {
    const month = date.getMonth()
    // Simple seasonal adjustment
    if (month >= 5 && month <= 7) return 0.9 // Summer
    if (month >= 11 || month <= 1) return 0.9 // Winter holidays
    return 1.0
  }

  private getTrendsFactor(agent: any): number {
    // This would analyze current trends in provider usage
    return 0.7 + (Math.random() * 0.2) // Simulated
  }

  private calculateDiversificationScore(agent: any): number {
    // Encourage using different providers for diversity
    const recentUsage = this.scoringHistory
      .slice(-50)
      .filter(h => h.agentId === agent.id).length
    
    return Math.max(0.1, 1 - (recentUsage / 25)) // Less recent usage = higher diversity score
  }

  private calculateExplorationScore(agent: any): number {
    // Encourage trying less-used agents
    const totalUsage = this.scoringHistory.filter(h => h.agentId === agent.id).length
    return Math.max(0.1, 1 - (totalUsage / 100)) // Less total usage = higher exploration score
  }

  private calculateCostOptimizationOpportunity(agent: any, context: any): number {
    const costPerToken = agent.costPerToken || 0.001
    const complexity = context?.complexity?.overall || 50
    
    // Higher score for cost-effective agents with appropriate complexity
    const costEfficiency = Math.max(0.1, 1 - (costPerToken / 0.01))
    const complexityMatch = this.assessComplexityAlignment(agent, context)
    
    return (costEfficiency + complexityMatch) / 2
  }

  private calculateQualityImprovementPotential(agent: any, context: any): number {
    // This would calculate potential for quality improvements
    const modelComplexity = this.getModelComplexity(agent.model)
    const requestComplexity = (context?.complexity?.overall || 50) / 10
    
    // Higher potential if agent is more capable than required
    return Math.min(1, modelComplexity / Math.max(1, requestComplexity))
  }

  private calculateQualityVariance(agentId: string): number {
    const history = this.scoringHistory.filter(h => h.agentId === agentId)
    if (history.length < 3) return 0.2 // Default low variance
    
    const qualities = history.map(h => h.actualOutcome?.quality || 0.8)
    const mean = qualities.reduce((sum, q) => sum + q, 0) / qualities.length
    const variance = qualities.reduce((sum, q) => sum + Math.pow(q - mean, 2), 0) / qualities.length
    
    return Math.min(1, variance)
  }

  // Get default score for error cases
  private getDefaultScore(agentId: string): DynamicScore {
    return {
      agentId,
      totalScore: 0.5,
      normalizedScore: 50,
      confidence: 0.5,
      factors: this.getDefaultFactors(),
      reasoning: {
        primaryFactors: ['performance', 'cost', 'availability'],
        strengths: ['Available'],
        weaknesses: ['Limited data'],
        riskFactors: ['Insufficient history'],
        recommendations: ['Monitor performance closely']
      },
      alternatives: []
    }
  }

  // Get default factors for error cases
  private getDefaultFactors(): ScoringFactors {
    return {
      performance: {
        responseTime: 0.7,
        throughput: 0.7,
        reliability: 0.8,
        successRate: 0.85,
        weight: this.config.weights.performance
      },
      cost: {
        tokenCost: 0.7,
        computeCost: 0.8,
        opportunityCost: 0.7,
        budgetAlignment: 0.9,
        weight: this.config.weights.cost
      },
      availability: {
        currentLoad: 0.8,
        queueLength: 0.9,
        healthStatus: 0.9,
        capacity: 0.8,
        weight: this.config.weights.availability
      },
      quality: {
        outputQuality: 0.8,
        accuracyScore: 0.8,
        consistencyScore: 0.8,
        userSatisfaction: 0.75,
        weight: this.config.weights.quality
      },
      context: {
        capabilityMatch: 0.7,
        domainExpertise: 0.6,
        complexityAlignment: 0.7,
        specialization: 0.6,
        weight: this.config.weights.context
      },
      user: {
        preferences: 0.5,
        history: 0.5,
        feedback: 0.5,
        loyalty: 0.5,
        weight: this.config.weights.user
      },
      temporal: {
        timeOfDay: 0.8,
        urgency: 0.6,
        seasonality: 0.9,
        trends: 0.7,
        weight: this.config.weights.temporal
      },
      strategic: {
        diversification: 0.5,
        exploration: 0.3,
        costOptimization: 0.7,
        qualityImprovement: 0.6,
        weight: this.config.weights.strategic
      }
    }
  }

  // Learn from actual outcomes to improve scoring
  async learnFromOutcome(agentId: string, actualOutcome: any): Promise<void> {
    try {
      const recentScore = this.scoringHistory.find(h => 
        h.agentId === agentId && 
        Date.now() - h.timestamp.getTime() < 300000 // Within 5 minutes
      )

      if (recentScore) {
        recentScore.actualOutcome = actualOutcome
        
        // Update adaptation metrics
        this.updateAdaptationMetrics(recentScore)
        
        // Periodically adapt weights
        if (this.scoringHistory.length % 50 === 0) {
          await this.adaptWeights()
        }
      }

      logger.info('Learning from outcome', {
        agentId,
        outcome: actualOutcome.success ? 'success' : 'failure',
        responseTime: actualOutcome.responseTime
      })

    } catch (error) {
      logger.error('Error learning from outcome', { agentId, error })
    }
  }

  // Update adaptation metrics
  private updateAdaptationMetrics(scoredRequest: any): void {
    try {
      const predicted = scoredRequest.score.normalizedScore / 100
      const actual = scoredRequest.actualOutcome.quality || 0.8
      
      const error = Math.abs(predicted - actual)
      const agentId = scoredRequest.agentId
      
      // Update running error metrics
      const currentError = this.adaptationMetrics.get(agentId) || 0.2
      const updatedError = (currentError * 0.9) + (error * 0.1) // Exponential smoothing
      
      this.adaptationMetrics.set(agentId, updatedError)
      
    } catch (error) {
      logger.error('Error updating adaptation metrics', { error })
    }
  }

  // Adapt weights based on learning
  private async adaptWeights(): Promise<void> {
    try {
      const recentHistory = this.scoringHistory.slice(-100)
      if (recentHistory.length < 20) return
      
      // Calculate prediction accuracy for each factor
      const factorAccuracies: Record<keyof ScoringFactors, number[]> = {} as any
      
      for (const factorName of Object.keys(this.config.weights) as Array<keyof ScoringFactors>) {
        factorAccuracies[factorName] = []
      }
      
      recentHistory.forEach(history => {
        if (!history.actualOutcome) return
        
        const predicted = history.score.normalizedScore / 100
        const actual = history.actualOutcome.quality || 0.8
        const accuracy = 1 - Math.abs(predicted - actual)
        
        // Distribute accuracy to factors based on their contribution
        for (const factorName of Object.keys(this.config.weights) as Array<keyof ScoringFactors>) {
          factorAccuracies[factorName].push(accuracy)
        }
      })
      
      // Update weights based on factor performance
      for (const factorName of Object.keys(this.config.weights) as Array<keyof ScoringFactors>) {
        const accuracies = factorAccuracies[factorName]
        if (accuracies.length === 0) continue
        
        const avgAccuracy = accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length
        const currentWeight = this.config.weights[factorName]
        
        // Adjust weight based on performance (small adjustments)
        const adjustment = (avgAccuracy - 0.8) * this.config.adaptationRate * 0.1
        const newWeight = Math.max(0.01, Math.min(0.5, currentWeight + adjustment))
        
        this.config.weights[factorName] = newWeight
      }
      
      // Normalize weights to sum to 1
      const totalWeight = Object.values(this.config.weights).reduce((sum, w) => sum + w, 0)
      for (const factorName of Object.keys(this.config.weights) as Array<keyof ScoringFactors>) {
        this.config.weights[factorName] /= totalWeight
      }
      
      this.lastUpdate = new Date()
      
      logger.info('Weights adapted based on learning', {
        newWeights: this.config.weights,
        historySizeUsed: recentHistory.length
      })
      
    } catch (error) {
      logger.error('Error adapting weights', { error })
    }
  }

  // Get scoring engine metrics
  async getScoringMetrics(): Promise<{
    totalScores: number
    averageAccuracy: number
    adaptationMetrics: Record<string, number>
    currentWeights: Record<keyof ScoringFactors, number>
    lastUpdate: Date
  }> {
    try {
      const recentHistory = this.scoringHistory.slice(-100)
      
      let totalAccuracy = 0
      let accuracyCount = 0
      
      recentHistory.forEach(history => {
        if (history.actualOutcome) {
          const predicted = history.score.normalizedScore / 100
          const actual = history.actualOutcome.quality || 0.8
          const accuracy = 1 - Math.abs(predicted - actual)
          totalAccuracy += accuracy
          accuracyCount++
        }
      })
      
      const averageAccuracy = accuracyCount > 0 ? totalAccuracy / accuracyCount : 0.8
      
      return {
        totalScores: this.scoringHistory.length,
        averageAccuracy,
        adaptationMetrics: Object.fromEntries(this.adaptationMetrics),
        currentWeights: { ...this.config.weights },
        lastUpdate: this.lastUpdate
      }
      
    } catch (error) {
      logger.error('Error getting scoring metrics', { error })
      throw new Error('Failed to get scoring metrics')
    }
  }
}
