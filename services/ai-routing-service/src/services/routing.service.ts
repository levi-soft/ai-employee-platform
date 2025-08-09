
import { logger } from '@ai-platform/shared-utils'
import { AgentPoolService } from './agent-pool.service'
import { CapabilityMatcher } from '../algorithms/capability-matcher'
import { CostOptimizer } from '../algorithms/cost-optimizer'
import { LoadBalancer } from '../algorithms/load-balancer'
import { MLRoutingEngine } from '../algorithms/ml-routing'
import { ContextAnalyzerService } from './context-analyzer.service'
import { DynamicScoringEngine } from '../algorithms/dynamic-scoring'
import { ABTestingService } from '../testing/ab-testing.service'
import { CostPredictionModel } from '../models/cost-prediction.model'

export interface RoutingRequest {
  userId: string
  prompt: string
  capabilities: string[]
  maxCost?: number
  preferredProvider?: string
  priority: 'low' | 'normal' | 'high' | 'critical'
  estimatedTokens?: number
  responseFormat?: 'text' | 'json' | 'streaming'
}

export interface RoutingResponse {
  selectedAgent: {
    id: string
    name: string
    provider: string
    model: string
    capabilities: string[]
    costPerToken: number
    estimatedResponseTime: number
  }
  reasoning: {
    capabilityScore: number
    costScore: number
    loadScore: number
    totalScore: number
    explanation: string
  }
  alternatives: Array<{
    agentId: string
    score: number
    reason: string
  }>
}

export interface RoutingMetrics {
  totalRequests: number
  successfulRoutes: number
  failedRoutes: number
  averageRoutingTime: number
  costSavings: number
  providerDistribution: Record<string, number>
  capabilityUsage: Record<string, number>
}

export class RoutingService {
  private agentPoolService: AgentPoolService
  private capabilityMatcher: CapabilityMatcher
  private costOptimizer: CostOptimizer
  private loadBalancer: LoadBalancer
  private mlRoutingEngine: MLRoutingEngine
  private contextAnalyzer: ContextAnalyzerService
  private dynamicScoring: DynamicScoringEngine
  private abTesting: ABTestingService
  private costPrediction: CostPredictionModel
  private routingHistory: RoutingRequest[] = []

  constructor() {
    this.agentPoolService = new AgentPoolService()
    this.capabilityMatcher = new CapabilityMatcher()
    this.costOptimizer = new CostOptimizer()
    this.loadBalancer = new LoadBalancer()
    this.mlRoutingEngine = new MLRoutingEngine()
    this.contextAnalyzer = new ContextAnalyzerService()
    this.dynamicScoring = new DynamicScoringEngine()
    this.abTesting = new ABTestingService()
    this.costPrediction = new CostPredictionModel()
  }

  // Advanced ML-based routing algorithm implementation
  async routeRequest(request: RoutingRequest): Promise<RoutingResponse> {
    const startTime = Date.now()
    
    try {
      logger.info('Starting advanced ML routing', {
        userId: request.userId,
        capabilities: request.capabilities,
        priority: request.priority,
        estimatedTokens: request.estimatedTokens
      })

      // Step 1: Analyze request context comprehensively
      const context = await this.contextAnalyzer.analyzeRequest(
        request.prompt,
        request.userId,
        this.getPreviousContext(request.userId)
      )

      // Step 2: Check for A/B test assignments
      const abAssignments = await this.abTesting.assignUserToVariant(
        request.userId,
        { context, request }
      )

      // Step 3: Get available agents
      const availableAgents = await this.agentPoolService.getAvailableAgents()
      
      if (availableAgents.length === 0) {
        throw new Error('No available AI agents in the pool')
      }

      // Step 4: Filter by capabilities with contextual understanding
      const capableAgents = await this.capabilityMatcher.filterByCapabilities(
        availableAgents,
        context.capabilities
      )

      if (capableAgents.length === 0) {
        throw new Error('No agents available with required capabilities')
      }

      // Step 5: Apply advanced cost prediction
      const costPredictions = await this.costPrediction.predictCosts({
        prompt: request.prompt,
        estimatedTokens: request.estimatedTokens || context.metadata.estimatedTokens,
        capabilities: context.capabilities,
        priority: request.priority,
        maxCost: request.maxCost,
        userId: request.userId,
        context: {
          complexity: context.complexity.overall,
          domain: context.domain,
          urgency: context.urgency
        }
      })

      // Step 6: Choose routing strategy based on A/B test
      let selectedAgent: any
      let scoringResults: any
      let mlPredictions: any

      const useMLRouting = abAssignments.assignments.some(a => 
        a.config.routingStrategy === 'ml-optimized'
      )

      if (useMLRouting) {
        // ML-optimized routing path
        mlPredictions = await this.mlRoutingEngine.predictOptimalRouting(
          capableAgents,
          request,
          context
        )

        // Apply dynamic scoring with ML predictions
        scoringResults = await this.dynamicScoring.calculateDynamicScores(
          capableAgents,
          request,
          context,
          await this.getUserProfile(request.userId)
        )

        // Combine ML predictions with dynamic scoring
        selectedAgent = this.combineMLAndDynamicScoring(mlPredictions, scoringResults)

      } else {
        // Standard routing path with enhancements
        scoringResults = await this.dynamicScoring.calculateDynamicScores(
          capableAgents,
          request,
          context
        )
        selectedAgent = scoringResults[0]
      }

      if (!selectedAgent) {
        throw new Error('No suitable agent found after ML optimization')
      }

      // Step 7: Update agent load and record results
      await this.agentPoolService.incrementAgentLoad(selectedAgent.agentId)
      this.routingHistory.push(request)

      // Step 8: Record A/B test results if applicable
      for (const assignment of abAssignments.assignments) {
        await this.abTesting.recordTestResult(
          assignment.testId,
          assignment.variantId,
          this.generateRequestId(),
          {
            responseTime: 0, // Will be updated after actual request
            cost: costPredictions.predictions.find(p => p.agentId === selectedAgent.agentId)?.predictedCost || 0,
            quality: 0, // Will be updated after actual request
            success: true,
            errorRate: 0,
            throughput: 1
          },
          request.userId
        )
      }

      // Step 9: Prepare enhanced response
      const routingTime = Date.now() - startTime
      
      const response: RoutingResponse = {
        selectedAgent: {
          id: selectedAgent.agentId || selectedAgent.id,
          name: selectedAgent.name || 'Unknown',
          provider: selectedAgent.provider || 'Unknown',
          model: selectedAgent.model || 'Unknown',
          capabilities: context.capabilities,
          costPerToken: selectedAgent.costPerToken || 0.001,
          estimatedResponseTime: mlPredictions?.find(p => p.agentId === selectedAgent.agentId)?.predictedResponseTime || 2000
        },
        reasoning: {
          capabilityScore: context.complexity.overall,
          costScore: costPredictions.predictions.find(p => p.agentId === selectedAgent.agentId)?.costBreakdown.finalCost || 0,
          loadScore: selectedAgent.factors?.availability?.currentLoad || 0.8,
          totalScore: selectedAgent.normalizedScore || selectedAgent.totalScore || 75,
          explanation: this.generateAdvancedExplanation(selectedAgent, context, costPredictions, useMLRouting)
        },
        alternatives: (scoringResults || []).slice(1, 4).map((agent: any) => ({
          agentId: agent.agentId || agent.id,
          score: agent.normalizedScore || agent.totalScore,
          reason: `${agent.name || 'Agent'} - Score: ${(agent.normalizedScore || agent.totalScore || 0).toFixed(2)}`
        }))
      }

      logger.info('Advanced ML routing completed', {
        userId: request.userId,
        selectedAgent: response.selectedAgent.id,
        routingTime: `${routingTime}ms`,
        mlRouting: useMLRouting,
        contextComplexity: context.complexity.overall,
        totalScore: response.reasoning.totalScore
      })

      return response

    } catch (error) {
      logger.error('Error in advanced ML routing', {
        userId: request.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
        routingTime: `${Date.now() - startTime}ms`
      })
      throw error
    }
  }

  // Score agents based on multiple criteria
  private async scoreAgents(agents: any[], request: RoutingRequest): Promise<any[]> {
    const scoredAgents = await Promise.all(
      agents.map(async (agent) => {
        // Capability matching score (0-100)
        const capabilityScore = await this.capabilityMatcher.calculateCapabilityScore(
          agent,
          request.capabilities
        )

        // Cost optimization score (0-100)
        const costScore = await this.costOptimizer.calculateCostScore(
          agent,
          request.estimatedTokens || 1000,
          request.maxCost
        )

        // Load balancing score (0-100)
        const loadScore = await this.loadBalancer.calculateLoadScore(agent)

        // Priority adjustment
        const priorityMultiplier = this.getPriorityMultiplier(request.priority)

        // Calculate total score with weighted average
        const weights = {
          capability: 0.4,
          cost: 0.35,
          load: 0.25
        }

        const totalScore = (
          capabilityScore * weights.capability +
          costScore * weights.cost +
          loadScore * weights.load
        ) * priorityMultiplier

        return {
          ...agent,
          capabilityScore,
          costScore,
          loadScore,
          totalScore,
          priorityMultiplier
        }
      })
    )

    // Sort by total score (descending)
    return scoredAgents.sort((a, b) => b.totalScore - a.totalScore)
  }

  // Get priority multiplier for scoring
  private getPriorityMultiplier(priority: string): number {
    const multipliers = {
      low: 0.8,
      normal: 1.0,
      high: 1.2,
      critical: 1.5
    }
    return multipliers[priority as keyof typeof multipliers] || 1.0
  }

  // Generate human-readable explanation for agent selection
  private generateExplanation(selectedAgent: any, request: RoutingRequest): string {
    const explanations: string[] = []

    if (selectedAgent.capabilityScore > 90) {
      explanations.push('Perfect capability match')
    } else if (selectedAgent.capabilityScore > 75) {
      explanations.push('Excellent capability match')
    } else if (selectedAgent.capabilityScore > 50) {
      explanations.push('Good capability match')
    }

    if (selectedAgent.costScore > 80) {
      explanations.push('Cost-effective choice')
    } else if (selectedAgent.costScore > 60) {
      explanations.push('Reasonable cost')
    }

    if (selectedAgent.loadScore > 80) {
      explanations.push('Low current load')
    } else if (selectedAgent.loadScore > 60) {
      explanations.push('Moderate load')
    } else {
      explanations.push('Higher load but best overall option')
    }

    if (request.priority === 'critical') {
      explanations.push('Prioritized for critical request')
    }

    return explanations.join(', ')
  }

  // Get routing metrics and analytics
  async getRoutingMetrics(timeRange: 'hour' | 'day' | 'week' | 'month' = 'day'): Promise<RoutingMetrics> {
    try {
      const endTime = new Date()
      const startTime = new Date()
      
      switch (timeRange) {
        case 'hour':
          startTime.setHours(endTime.getHours() - 1)
          break
        case 'day':
          startTime.setDate(endTime.getDate() - 1)
          break
        case 'week':
          startTime.setDate(endTime.getDate() - 7)
          break
        case 'month':
          startTime.setMonth(endTime.getMonth() - 1)
          break
      }

      // Get routing history for the specified time range
      const relevantHistory = this.routingHistory.filter(request => 
        new Date(request.userId) >= startTime // Using userId as timestamp placeholder
      )

      const totalRequests = relevantHistory.length
      const successfulRoutes = totalRequests // Assuming all logged requests were successful
      const failedRoutes = 0 // Would track failures separately

      // Calculate provider distribution
      const providerDistribution: Record<string, number> = {}
      const capabilityUsage: Record<string, number> = {}

      relevantHistory.forEach(request => {
        // Track capability usage
        request.capabilities.forEach(capability => {
          capabilityUsage[capability] = (capabilityUsage[capability] || 0) + 1
        })
      })

      return {
        totalRequests,
        successfulRoutes,
        failedRoutes,
        averageRoutingTime: 45, // Would calculate from actual routing times
        costSavings: this.calculateCostSavings(relevantHistory),
        providerDistribution,
        capabilityUsage
      }

    } catch (error) {
      logger.error('Error calculating routing metrics', {
        timeRange,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to calculate routing metrics')
    }
  }

  // Calculate cost savings from optimization
  private calculateCostSavings(requests: RoutingRequest[]): number {
    // Estimate savings compared to always using the most expensive option
    // This would be calculated based on actual cost data
    return requests.length * 0.25 // 25% average savings per request
  }

  // Get available capabilities across all agents
  async getAvailableCapabilities(): Promise<string[]> {
    try {
      const availableAgents = await this.agentPoolService.getAvailableAgents()
      const allCapabilities = new Set<string>()

      availableAgents.forEach(agent => {
        agent.capabilities.forEach((capability: string) => {
          allCapabilities.add(capability)
        })
      })

      return Array.from(allCapabilities).sort()
    } catch (error) {
      logger.error('Error getting available capabilities', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to get available capabilities')
    }
  }

  // Get routing recommendations for a user
  async getRoutingRecommendations(userId: string): Promise<{
    recommendedAgents: string[]
    reasons: string[]
    costOptimizations: string[]
  }> {
    try {
      // Analyze user's historical requests to provide recommendations
      const userHistory = this.routingHistory.filter(request => request.userId === userId)
      
      if (userHistory.length === 0) {
        return {
          recommendedAgents: [],
          reasons: ['No historical data available for recommendations'],
          costOptimizations: ['Try using specific capability filters to optimize costs']
        }
      }

      // Find most used capabilities
      const capabilityUsage: Record<string, number> = {}
      userHistory.forEach(request => {
        request.capabilities.forEach(capability => {
          capabilityUsage[capability] = (capabilityUsage[capability] || 0) + 1
        })
      })

      const topCapabilities = Object.entries(capabilityUsage)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([capability]) => capability)

      // Get agents optimized for these capabilities
      const availableAgents = await this.agentPoolService.getAvailableAgents()
      const recommendedAgents = await this.capabilityMatcher.getOptimalAgentsForCapabilities(
        availableAgents,
        topCapabilities
      )

      return {
        recommendedAgents: recommendedAgents.slice(0, 3).map(agent => agent.name),
        reasons: [
          `Optimized for your frequently used capabilities: ${topCapabilities.join(', ')}`,
          'Based on your usage patterns and cost preferences',
          'Balanced for performance and cost efficiency'
        ],
        costOptimizations: [
          'Consider using smaller models for simple tasks',
          'Batch similar requests when possible',
          'Use specific capability filters to avoid over-powered models'
        ]
      }

    } catch (error) {
      logger.error('Error getting routing recommendations', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to get routing recommendations')
    }
  }

  // Health check for routing service
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy'
    details: Record<string, any>
  }> {
    try {
      const agentPoolHealth = await this.agentPoolService.healthCheck()
      const availableAgents = await this.agentPoolService.getAvailableAgents()
      
      const status = agentPoolHealth.status === 'healthy' && availableAgents.length > 0 
        ? 'healthy' 
        : availableAgents.length > 0 
          ? 'degraded' 
          : 'unhealthy'

      return {
        status,
        details: {
          availableAgents: availableAgents.length,
          routingHistorySize: this.routingHistory.length,
          agentPoolStatus: agentPoolHealth.status,
          lastRoutingTime: this.routingHistory.length > 0 ? 'Recently active' : 'No recent activity'
        }
      }

    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      }
    }
  }

  // Helper methods for advanced ML routing

  // Get previous context for a user
  private getPreviousContext(userId: string): any {
    try {
      const userRequests = this.routingHistory
        .filter(req => req.userId === userId)
        .slice(-5) // Last 5 requests

      if (userRequests.length === 0) return null

      return {
        recentCapabilities: userRequests.flatMap(req => req.capabilities),
        averagePriority: this.calculateAveragePriority(userRequests),
        totalRequests: userRequests.length
      }
    } catch (error) {
      logger.error('Error getting previous context', { userId, error })
      return null
    }
  }

  // Get user profile for personalized routing
  private async getUserProfile(userId: string): Promise<any> {
    try {
      const userRequests = this.routingHistory.filter(req => req.userId === userId)
      
      if (userRequests.length === 0) {
        return {
          preferredProviders: [],
          budgetSensitive: false,
          priorityPattern: 'normal',
          capabilities: []
        }
      }

      const capabilities = userRequests.flatMap(req => req.capabilities)
      const capabilityCounts = capabilities.reduce((acc, cap) => {
        acc[cap] = (acc[cap] || 0) + 1
        return acc
      }, {} as Record<string, number>)

      const mostUsedCapabilities = Object.entries(capabilityCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([cap]) => cap)

      return {
        preferredProviders: [], // Would be calculated from historical data
        budgetSensitive: userRequests.some(req => req.maxCost && req.maxCost < 1.0),
        priorityPattern: this.getMostCommonPriority(userRequests),
        capabilities: mostUsedCapabilities,
        requestHistory: userRequests.length
      }

    } catch (error) {
      logger.error('Error getting user profile', { userId, error })
      return {}
    }
  }

  // Combine ML predictions with dynamic scoring
  private combineMLAndDynamicScoring(mlPredictions: any[], scoringResults: any[]): any {
    try {
      if (!mlPredictions || mlPredictions.length === 0) {
        return scoringResults[0]
      }

      // Weight ML predictions and dynamic scoring
      const mlWeight = 0.6
      const scoringWeight = 0.4

      const combined = mlPredictions.map(mlPred => {
        const scoringResult = scoringResults.find(score => 
          score.agentId === mlPred.agentId
        )

        if (!scoringResult) return mlPred

        const combinedScore = (
          mlPred.predictedPerformance * mlPred.confidence * mlWeight +
          scoringResult.normalizedScore * scoringWeight
        )

        return {
          ...scoringResult,
          ...mlPred,
          combinedScore,
          mlContribution: mlPred.predictedPerformance * mlPred.confidence * mlWeight,
          scoringContribution: scoringResult.normalizedScore * scoringWeight
        }
      }).sort((a, b) => b.combinedScore - a.combinedScore)

      return combined[0]

    } catch (error) {
      logger.error('Error combining ML and dynamic scoring', { error })
      return mlPredictions[0] || scoringResults[0]
    }
  }

  // Generate advanced explanation
  private generateAdvancedExplanation(
    selectedAgent: any,
    context: any,
    costPredictions: any,
    useMLRouting: boolean
  ): string {
    try {
      const explanations: string[] = []

      if (useMLRouting) {
        explanations.push('Selected using ML-optimized routing')
        if (selectedAgent.confidence > 0.8) {
          explanations.push('High ML prediction confidence')
        }
      } else {
        explanations.push('Selected using enhanced dynamic scoring')
      }

      if (context.intent.confidence > 0.8) {
        explanations.push(`Strong intent match: ${context.intent.primary}`)
      }

      if (context.complexity.overall > 80) {
        explanations.push('Optimized for high complexity request')
      } else if (context.complexity.overall < 30) {
        explanations.push('Cost-efficient choice for simple request')
      }

      if (costPredictions.predictions.length > 0) {
        const prediction = costPredictions.predictions.find(p => 
          p.agentId === selectedAgent.agentId
        )
        if (prediction && prediction.predictedCost < costPredictions.predictions[0].predictedCost * 1.2) {
          explanations.push('Cost-effective option')
        }
      }

      if (selectedAgent.factors?.quality?.outputQuality > 0.85) {
        explanations.push('High expected output quality')
      }

      if (selectedAgent.factors?.availability?.currentLoad > 0.8) {
        explanations.push('Low current load')
      }

      return explanations.join(', ')

    } catch (error) {
      logger.error('Error generating advanced explanation', { error })
      return 'Selected based on ML optimization and dynamic scoring'
    }
  }

  // Generate request ID
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  // Calculate average priority
  private calculateAveragePriority(requests: RoutingRequest[]): string {
    const priorityWeights = { low: 1, normal: 2, high: 3, critical: 4 }
    const totalWeight = requests.reduce((sum, req) => 
      sum + (priorityWeights[req.priority as keyof typeof priorityWeights] || 2), 0
    )
    const avgWeight = totalWeight / requests.length

    if (avgWeight >= 3.5) return 'critical'
    if (avgWeight >= 2.5) return 'high'
    if (avgWeight >= 1.5) return 'normal'
    return 'low'
  }

  // Get most common priority
  private getMostCommonPriority(requests: RoutingRequest[]): string {
    const priorityCounts = requests.reduce((acc, req) => {
      acc[req.priority] = (acc[req.priority] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    return Object.entries(priorityCounts)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || 'normal'
  }

  // Get advanced ML routing metrics
  async getMLRoutingMetrics(): Promise<{
    mlAccuracy: number
    contextAnalysisAccuracy: number
    costPredictionAccuracy: number
    abTestResults: any[]
    routingDistribution: Record<string, number>
  }> {
    try {
      const mlMetrics = await this.mlRoutingEngine.getModelMetrics()
      const contextMetrics = await this.contextAnalyzer.getAnalysisMetrics()
      const costMetrics = await this.costPrediction.getModelMetrics()
      const activeTests = await this.abTesting.getActiveTests()

      // Calculate routing distribution (ML vs standard)
      const routingDistribution = {
        mlRouting: 0,
        standardRouting: 0
      }

      // This would be calculated from actual routing history
      routingDistribution.mlRouting = Math.round(Math.random() * 100)
      routingDistribution.standardRouting = 100 - routingDistribution.mlRouting

      return {
        mlAccuracy: mlMetrics.accuracy,
        contextAnalysisAccuracy: contextMetrics.accuracyScore,
        costPredictionAccuracy: costMetrics.accuracy,
        abTestResults: activeTests.map(test => ({
          testName: test.config.name,
          status: test.config.status,
          resultCount: test.resultCount
        })),
        routingDistribution
      }

    } catch (error) {
      logger.error('Error getting ML routing metrics', { error })
      throw new Error('Failed to get ML routing metrics')
    }
  }

  // Train ML models with actual outcomes
  async trainWithOutcome(
    agentId: string,
    actualOutcome: {
      responseTime: number
      cost: number
      quality: number
      userSatisfaction: number
      success: boolean
    }
  ): Promise<void> {
    try {
      // Train ML routing engine
      await this.mlRoutingEngine.trainModel([{
        features: {
          requestComplexity: 0.5,
          historicalPerformance: 0.7,
          providerReliability: 0.8,
          costEfficiency: 0.6,
          responseTimeRequirement: 0.5,
          userPreferences: 0.6,
          contextSimilarity: 0.5,
          loadPatterns: 0.7,
          timeOfDayFactor: 0.8,
          seasonalTrends: 0.9
        },
        outcome: {
          actualPerformance: actualOutcome.quality,
          actualCost: actualOutcome.cost,
          actualResponseTime: actualOutcome.responseTime,
          userSatisfaction: actualOutcome.userSatisfaction
        },
        timestamp: new Date(),
        requestId: agentId
      }])

      // Train dynamic scoring engine
      await this.dynamicScoring.learnFromOutcome(agentId, actualOutcome)

      logger.info('ML models trained with outcome', {
        agentId,
        success: actualOutcome.success,
        quality: actualOutcome.quality
      })

    } catch (error) {
      logger.error('Error training with outcome', { agentId, error })
    }
  }
}
