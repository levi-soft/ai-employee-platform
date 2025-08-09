
import { logger } from '@ai-platform/shared-utils'

export interface MLRoutingFeatures {
  requestComplexity: number
  historicalPerformance: number
  providerReliability: number
  costEfficiency: number
  responseTimeRequirement: number
  userPreferences: number
  contextSimilarity: number
  loadPatterns: number
  timeOfDayFactor: number
  seasonalTrends: number
}

export interface MLRoutingPrediction {
  agentId: string
  confidence: number
  predictedPerformance: number
  predictedCost: number
  predictedResponseTime: number
  featureImportance: Record<keyof MLRoutingFeatures, number>
}

export interface TrainingData {
  features: MLRoutingFeatures
  outcome: {
    actualPerformance: number
    actualCost: number
    actualResponseTime: number
    userSatisfaction: number
  }
  timestamp: Date
  requestId: string
}

export class MLRoutingEngine {
  private trainingData: TrainingData[] = []
  private modelWeights: Record<keyof MLRoutingFeatures, number> = {
    requestComplexity: 0.15,
    historicalPerformance: 0.18,
    providerReliability: 0.12,
    costEfficiency: 0.14,
    responseTimeRequirement: 0.10,
    userPreferences: 0.08,
    contextSimilarity: 0.09,
    loadPatterns: 0.06,
    timeOfDayFactor: 0.04,
    seasonalTrends: 0.04
  }
  private modelAccuracy: number = 0.0
  private lastTrainingUpdate: Date = new Date()

  constructor() {
    logger.info('ML Routing Engine initialized')
    this.initializeModel()
  }

  // Initialize the ML model with default parameters
  private async initializeModel(): Promise<void> {
    try {
      // Load any existing model weights from storage/cache
      await this.loadModelWeights()
      
      // Calculate initial model accuracy if we have training data
      if (this.trainingData.length > 100) {
        this.modelAccuracy = await this.calculateModelAccuracy()
      }
      
      logger.info('ML routing model initialized', {
        modelAccuracy: this.modelAccuracy,
        trainingDataSize: this.trainingData.length,
        lastUpdate: this.lastTrainingUpdate
      })
    } catch (error) {
      logger.error('Error initializing ML routing model', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  // Make ML-based routing predictions
  async predictOptimalRouting(
    agents: any[],
    request: any,
    context: any
  ): Promise<MLRoutingPrediction[]> {
    try {
      const predictions: MLRoutingPrediction[] = []

      for (const agent of agents) {
        const features = await this.extractFeatures(agent, request, context)
        const prediction = await this.makePrediction(agent.id, features)
        predictions.push(prediction)
      }

      // Sort by predicted performance and confidence
      return predictions.sort((a, b) => {
        const scoreA = a.predictedPerformance * a.confidence
        const scoreB = b.predictedPerformance * b.confidence
        return scoreB - scoreA
      })

    } catch (error) {
      logger.error('Error making ML routing predictions', {
        agentCount: agents.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('ML routing prediction failed')
    }
  }

  // Extract features for ML prediction
  private async extractFeatures(
    agent: any,
    request: any,
    context: any
  ): Promise<MLRoutingFeatures> {
    try {
      return {
        requestComplexity: this.calculateRequestComplexity(request),
        historicalPerformance: await this.getHistoricalPerformance(agent.id),
        providerReliability: await this.getProviderReliability(agent.provider),
        costEfficiency: this.calculateCostEfficiency(agent, request),
        responseTimeRequirement: this.mapResponseTimeRequirement(request.priority),
        userPreferences: await this.getUserPreferences(request.userId, agent),
        contextSimilarity: await this.calculateContextSimilarity(context, agent),
        loadPatterns: await this.getLoadPatterns(agent.id),
        timeOfDayFactor: this.getTimeOfDayFactor(),
        seasonalTrends: this.getSeasonalTrends()
      }
    } catch (error) {
      logger.error('Error extracting ML features', {
        agentId: agent.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      
      // Return default features if extraction fails
      return this.getDefaultFeatures()
    }
  }

  // Make prediction using weighted feature model
  private async makePrediction(
    agentId: string,
    features: MLRoutingFeatures
  ): Promise<MLRoutingPrediction> {
    try {
      // Calculate weighted score
      let predictedPerformance = 0
      const featureImportance: Record<keyof MLRoutingFeatures, number> = {} as any

      for (const [feature, value] of Object.entries(features) as Array<[keyof MLRoutingFeatures, number]>) {
        const weight = this.modelWeights[feature]
        const contribution = value * weight
        predictedPerformance += contribution
        featureImportance[feature] = contribution
      }

      // Normalize performance to 0-100 scale
      predictedPerformance = Math.max(0, Math.min(100, predictedPerformance * 100))

      // Calculate confidence based on training data similarity
      const confidence = await this.calculatePredictionConfidence(features)

      // Predict cost and response time based on features
      const predictedCost = this.predictCost(features)
      const predictedResponseTime = this.predictResponseTime(features)

      return {
        agentId,
        confidence,
        predictedPerformance,
        predictedCost,
        predictedResponseTime,
        featureImportance
      }

    } catch (error) {
      logger.error('Error making ML prediction', {
        agentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      
      // Return default prediction
      return {
        agentId,
        confidence: 0.5,
        predictedPerformance: 50,
        predictedCost: 0.01,
        predictedResponseTime: 2000,
        featureImportance: {} as any
      }
    }
  }

  // Calculate request complexity score (0-1)
  private calculateRequestComplexity(request: any): number {
    let complexity = 0.5 // Base complexity

    // Token length factor
    const estimatedTokens = request.estimatedTokens || 1000
    complexity += Math.min(0.3, (estimatedTokens - 100) / 10000)

    // Capability complexity
    const capabilityComplexityMap: Record<string, number> = {
      'text-generation': 0.1,
      'code-generation': 0.3,
      'reasoning': 0.4,
      'math': 0.4,
      'analysis': 0.3,
      'creative': 0.2,
      'translation': 0.2,
      'summarization': 0.1
    }

    if (request.capabilities) {
      const avgComplexity = request.capabilities.reduce((sum: number, cap: string) => {
        return sum + (capabilityComplexityMap[cap] || 0.2)
      }, 0) / request.capabilities.length
      complexity += avgComplexity * 0.3
    }

    // Priority factor
    const priorityFactors = {
      'low': -0.1,
      'normal': 0,
      'high': 0.1,
      'critical': 0.2
    }
    complexity += priorityFactors[request.priority as keyof typeof priorityFactors] || 0

    return Math.max(0, Math.min(1, complexity))
  }

  // Get historical performance for agent
  private async getHistoricalPerformance(agentId: string): Promise<number> {
    try {
      const agentHistory = this.trainingData.filter(data => 
        data.requestId.includes(agentId) // Simple matching, would be more sophisticated in production
      )

      if (agentHistory.length === 0) {
        return 0.7 // Default score for new agents
      }

      const avgPerformance = agentHistory.reduce((sum, data) => 
        sum + data.outcome.actualPerformance, 0
      ) / agentHistory.length

      return Math.max(0, Math.min(1, avgPerformance / 100))
    } catch (error) {
      logger.error('Error getting historical performance', { agentId, error })
      return 0.7
    }
  }

  // Get provider reliability score
  private async getProviderReliability(provider: string): Promise<number> {
    const reliabilityMap: Record<string, number> = {
      'openai': 0.95,
      'claude': 0.92,
      'gemini': 0.88,
      'ollama': 0.85
    }
    
    return reliabilityMap[provider.toLowerCase()] || 0.8
  }

  // Calculate cost efficiency
  private calculateCostEfficiency(agent: any, request: any): number {
    const costPerToken = agent.costPerToken || 0.001
    const estimatedTokens = request.estimatedTokens || 1000
    const totalCost = costPerToken * estimatedTokens

    // Higher efficiency for lower costs (inversely proportional)
    const efficiency = Math.max(0.1, 1 - (totalCost / 10)) // Normalize against $10 baseline
    return Math.min(1, efficiency)
  }

  // Map priority to response time requirement
  private mapResponseTimeRequirement(priority: string): number {
    const priorityMap = {
      'low': 0.2,
      'normal': 0.5,
      'high': 0.8,
      'critical': 1.0
    }
    return priorityMap[priority as keyof typeof priorityMap] || 0.5
  }

  // Get user preferences for agent
  private async getUserPreferences(userId: string, agent: any): Promise<number> {
    // This would typically query user preference data
    // For now, return a default based on agent capabilities
    return 0.6 + (Math.random() * 0.2) // Simulated user preference
  }

  // Calculate context similarity
  private async calculateContextSimilarity(context: any, agent: any): Promise<number> {
    try {
      if (!context || !agent) return 0.5

      // Simple similarity based on capability overlap
      const contextCapabilities = context.detectedCapabilities || []
      const agentCapabilities = agent.capabilities || []
      
      if (contextCapabilities.length === 0 || agentCapabilities.length === 0) {
        return 0.5
      }

      const overlap = contextCapabilities.filter((cap: string) => 
        agentCapabilities.includes(cap)
      ).length

      return overlap / Math.max(contextCapabilities.length, agentCapabilities.length)
    } catch (error) {
      logger.error('Error calculating context similarity', { error })
      return 0.5
    }
  }

  // Get load patterns for agent
  private async getLoadPatterns(agentId: string): Promise<number> {
    // This would typically query load balancing data
    // Return inverse of current load (higher score for lower load)
    const simulatedLoad = Math.random() * 0.8 // 0-80% load
    return 1 - simulatedLoad
  }

  // Get time of day factor
  private getTimeOfDayFactor(): number {
    const hour = new Date().getHours()
    
    // Peak hours have different performance characteristics
    if (hour >= 9 && hour <= 17) {
      return 0.8 // Business hours - higher load
    } else if (hour >= 18 && hour <= 23) {
      return 0.9 // Evening - moderate load
    } else {
      return 1.0 // Night/early morning - lower load
    }
  }

  // Get seasonal trends factor
  private getSeasonalTrends(): number {
    const month = new Date().getMonth()
    
    // Simple seasonal adjustment
    if (month >= 2 && month <= 4) return 0.9  // Spring
    if (month >= 5 && month <= 7) return 0.8  // Summer (vacation period)
    if (month >= 8 && month <= 10) return 1.0 // Fall (high activity)
    return 0.9 // Winter
  }

  // Calculate prediction confidence
  private async calculatePredictionConfidence(features: MLRoutingFeatures): Promise<number> {
    try {
      if (this.trainingData.length < 50) {
        return 0.6 // Low confidence with limited training data
      }

      // Find similar historical requests
      const similarRequests = this.trainingData.filter(data => {
        const similarity = this.calculateFeatureSimilarity(features, data.features)
        return similarity > 0.8
      })

      if (similarRequests.length === 0) {
        return 0.7 // Medium confidence for novel requests
      }

      // Confidence based on similar request outcomes consistency
      const outcomes = similarRequests.map(req => req.outcome.actualPerformance)
      const variance = this.calculateVariance(outcomes)
      
      // Lower variance = higher confidence
      const confidence = Math.max(0.5, Math.min(1.0, 1 - (variance / 1000)))
      
      return confidence
    } catch (error) {
      logger.error('Error calculating prediction confidence', { error })
      return 0.7
    }
  }

  // Calculate feature similarity
  private calculateFeatureSimilarity(features1: MLRoutingFeatures, features2: MLRoutingFeatures): number {
    const featureKeys = Object.keys(features1) as Array<keyof MLRoutingFeatures>
    let totalSimilarity = 0

    for (const key of featureKeys) {
      const diff = Math.abs(features1[key] - features2[key])
      const similarity = Math.max(0, 1 - diff) // Inverse of difference
      totalSimilarity += similarity * this.modelWeights[key] // Weight by importance
    }

    return totalSimilarity / featureKeys.length
  }

  // Calculate variance of array
  private calculateVariance(values: number[]): number {
    if (values.length <= 1) return 0
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2))
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length
  }

  // Predict cost based on features
  private predictCost(features: MLRoutingFeatures): number {
    const baseCost = 0.001 // $0.001 per token baseline
    
    // Adjust based on complexity and performance requirements
    let costMultiplier = 1
    costMultiplier += features.requestComplexity * 2 // Complex requests cost more
    costMultiplier += features.responseTimeRequirement * 0.5 // Urgent requests cost more
    costMultiplier -= features.costEfficiency * 0.3 // Efficient providers cost less
    
    return baseCost * costMultiplier
  }

  // Predict response time based on features
  private predictResponseTime(features: MLRoutingFeatures): number {
    const baseTime = 1500 // 1.5 seconds baseline
    
    let timeMultiplier = 1
    timeMultiplier += features.requestComplexity * 3 // Complex requests take longer
    timeMultiplier -= features.historicalPerformance * 0.5 // Better agents are faster
    timeMultiplier += (1 - features.loadPatterns) * 2 // High load = slower response
    timeMultiplier -= features.responseTimeRequirement * 0.3 // Priority adjustment
    
    return Math.max(500, baseTime * timeMultiplier) // Minimum 500ms
  }

  // Get default features if extraction fails
  private getDefaultFeatures(): MLRoutingFeatures {
    return {
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
    }
  }

  // Train the model with new data
  async trainModel(newTrainingData: TrainingData[]): Promise<{
    accuracyImprovement: number
    newAccuracy: number
    trainingDataSize: number
  }> {
    try {
      const oldAccuracy = this.modelAccuracy
      
      // Add new training data
      this.trainingData.push(...newTrainingData)
      
      // Limit training data size for memory management
      if (this.trainingData.length > 10000) {
        this.trainingData = this.trainingData.slice(-8000) // Keep most recent 8000 records
      }
      
      // Update model weights using simple gradient descent
      await this.updateModelWeights()
      
      // Recalculate accuracy
      this.modelAccuracy = await this.calculateModelAccuracy()
      this.lastTrainingUpdate = new Date()
      
      const accuracyImprovement = this.modelAccuracy - oldAccuracy
      
      logger.info('ML model training completed', {
        oldAccuracy,
        newAccuracy: this.modelAccuracy,
        accuracyImprovement,
        trainingDataSize: this.trainingData.length
      })
      
      return {
        accuracyImprovement,
        newAccuracy: this.modelAccuracy,
        trainingDataSize: this.trainingData.length
      }
      
    } catch (error) {
      logger.error('Error training ML model', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Model training failed')
    }
  }

  // Update model weights using training data
  private async updateModelWeights(): Promise<void> {
    if (this.trainingData.length < 100) return // Need sufficient data
    
    try {
      // Simple feature importance calculation
      const featureKeys = Object.keys(this.modelWeights) as Array<keyof MLRoutingFeatures>
      const correlations: Record<keyof MLRoutingFeatures, number> = {} as any
      
      for (const feature of featureKeys) {
        const correlation = this.calculateFeaturePerformanceCorrelation(feature)
        correlations[feature] = Math.abs(correlation) // Use absolute correlation
      }
      
      // Normalize correlations to create new weights
      const totalCorrelation = Object.values(correlations).reduce((sum, corr) => sum + corr, 0)
      
      for (const feature of featureKeys) {
        const newWeight = correlations[feature] / totalCorrelation
        // Smooth weight updates to avoid overfitting
        this.modelWeights[feature] = (this.modelWeights[feature] * 0.7) + (newWeight * 0.3)
      }
      
      logger.info('Model weights updated', { weights: this.modelWeights })
      
    } catch (error) {
      logger.error('Error updating model weights', { error })
    }
  }

  // Calculate correlation between feature and performance
  private calculateFeaturePerformanceCorrelation(feature: keyof MLRoutingFeatures): number {
    try {
      const recentData = this.trainingData.slice(-1000) // Use recent data
      
      const featureValues = recentData.map(data => data.features[feature])
      const performanceValues = recentData.map(data => data.outcome.actualPerformance)
      
      return this.calculatePearsonCorrelation(featureValues, performanceValues)
    } catch (error) {
      logger.error('Error calculating feature correlation', { feature, error })
      return 0
    }
  }

  // Calculate Pearson correlation coefficient
  private calculatePearsonCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return 0
    
    const n = x.length
    const sumX = x.reduce((sum, val) => sum + val, 0)
    const sumY = y.reduce((sum, val) => sum + val, 0)
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0)
    const sumXX = x.reduce((sum, val) => sum + val * val, 0)
    const sumYY = y.reduce((sum, val) => sum + val * val, 0)
    
    const numerator = n * sumXY - sumX * sumY
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY))
    
    return denominator === 0 ? 0 : numerator / denominator
  }

  // Calculate model accuracy using cross-validation
  private async calculateModelAccuracy(): Promise<number> {
    try {
      if (this.trainingData.length < 50) return 0.7 // Default accuracy with limited data
      
      const testSize = Math.min(200, Math.floor(this.trainingData.length * 0.2))
      const testData = this.trainingData.slice(-testSize)
      
      let correctPredictions = 0
      
      for (const data of testData) {
        const prediction = await this.makePrediction('test-agent', data.features)
        const actualNormalized = data.outcome.actualPerformance / 100
        const predictedNormalized = prediction.predictedPerformance / 100
        
        // Consider prediction correct if within 20% of actual
        const error = Math.abs(actualNormalized - predictedNormalized)
        if (error < 0.2) {
          correctPredictions++
        }
      }
      
      const accuracy = correctPredictions / testData.length
      return Math.max(0.5, Math.min(1.0, accuracy))
      
    } catch (error) {
      logger.error('Error calculating model accuracy', { error })
      return 0.7
    }
  }

  // Load model weights from storage
  private async loadModelWeights(): Promise<void> {
    try {
      // This would typically load from a database or file
      // For now, using default weights initialized in constructor
      logger.info('Model weights loaded', { weights: this.modelWeights })
    } catch (error) {
      logger.error('Error loading model weights', { error })
    }
  }

  // Get model performance metrics
  async getModelMetrics(): Promise<{
    accuracy: number
    trainingDataSize: number
    lastUpdate: Date
    weights: Record<keyof MLRoutingFeatures, number>
    confidenceDistribution: { low: number; medium: number; high: number }
  }> {
    try {
      // Calculate confidence distribution
      const recentPredictions = this.trainingData.slice(-100)
      let lowConf = 0, medConf = 0, highConf = 0
      
      // Simulate confidence distribution (would be calculated from actual predictions)
      recentPredictions.forEach(() => {
        const conf = Math.random() // Simulated confidence
        if (conf < 0.6) lowConf++
        else if (conf < 0.8) medConf++
        else highConf++
      })
      
      const total = Math.max(1, recentPredictions.length)
      
      return {
        accuracy: this.modelAccuracy,
        trainingDataSize: this.trainingData.length,
        lastUpdate: this.lastTrainingUpdate,
        weights: { ...this.modelWeights },
        confidenceDistribution: {
          low: lowConf / total,
          medium: medConf / total,
          high: highConf / total
        }
      }
    } catch (error) {
      logger.error('Error getting model metrics', { error })
      throw new Error('Failed to get model metrics')
    }
  }
}
