
import { logger } from '@ai-platform/shared-utils';
import { aiRoutingConfig } from '../config/config';
import { AIRequest, AIAgent, UsagePattern, CostForecast } from '../types';
import { CostCalculatorService, CostCalculation } from './cost-calculator.service';
import { RedisCache } from '../cache/request-cache.service';

export interface PredictionModel {
  id: string;
  name: string;
  type: 'linear' | 'polynomial' | 'exponential' | 'ml_regression';
  accuracy: number;
  lastUpdated: Date;
  parameters: ModelParameters;
}

export interface ModelParameters {
  coefficients: number[];
  intercept: number;
  features: string[];
  scalingFactors?: Record<string, { mean: number; std: number }>;
}

export interface CostPrediction {
  requestId?: string;
  userId: string;
  agentId: string;
  predictedCost: number;
  confidenceInterval: {
    lower: number;
    upper: number;
    confidence: number;
  };
  costRange: {
    minimum: number;
    maximum: number;
    mostLikely: number;
  };
  factors: PredictionFactor[];
  timeframe: 'immediate' | 'hour' | 'day' | 'week' | 'month';
  accuracy: number;
  modelUsed: string;
  metadata: PredictionMetadata;
}

export interface PredictionFactor {
  name: string;
  impact: number; // -1 to 1, negative means cost reduction
  confidence: number; // 0 to 1
  description: string;
}

export interface PredictionMetadata {
  basedOnRequests: number;
  historicalPeriod: string;
  seasonalityFactor: number;
  trendFactor: number;
  volatility: number;
  dataQuality: number;
}

export interface BudgetPrediction {
  userId: string;
  currentBudget: number;
  projectedSpend: number;
  budgetUtilization: number;
  daysUntilBudgetExhausted: number;
  recommendedBudget: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  alerts: BudgetAlert[];
  optimizationOpportunities: OptimizationOpportunity[];
}

export interface BudgetAlert {
  type: 'overspend_risk' | 'budget_exceeded' | 'unusual_spike' | 'optimization_available';
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  threshold: number;
  currentValue: number;
  recommendedAction: string;
}

export interface OptimizationOpportunity {
  type: 'agent_switch' | 'timing_optimization' | 'batch_processing' | 'cache_utilization';
  potentialSavings: number;
  savingsPercentage: number;
  effort: 'low' | 'medium' | 'high';
  description: string;
  implementation: string;
}

export class CostPredictorService {
  private cache: RedisCache;
  private costCalculator: CostCalculatorService;
  private models: Map<string, PredictionModel> = new Map();

  constructor(costCalculator: CostCalculatorService) {
    this.costCalculator = costCalculator;
    this.cache = new RedisCache({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    });
    this.initializePredictionModels();
  }

  /**
   * Predict cost for a single request before execution
   */
  public async predictRequestCost(
    request: AIRequest,
    agent: AIAgent
  ): Promise<CostPrediction> {
    try {
      const features = await this.extractFeatures(request, agent);
      const model = await this.getBestModel(agent.id, request.type || 'general');
      
      const basePrediction = await this.runPredictionModel(model, features);
      const historicalContext = await this.getHistoricalContext(request.userId, agent.id);
      
      // Adjust prediction based on historical patterns
      const adjustedPrediction = this.adjustForContext(basePrediction, historicalContext);
      
      // Calculate confidence intervals
      const confidenceInterval = this.calculateConfidenceInterval(
        adjustedPrediction,
        model.accuracy,
        historicalContext.volatility
      );
      
      // Identify prediction factors
      const factors = await this.identifyPredictionFactors(request, agent, features);
      
      const prediction: CostPrediction = {
        requestId: request.id,
        userId: request.userId,
        agentId: agent.id,
        predictedCost: adjustedPrediction,
        confidenceInterval,
        costRange: {
          minimum: confidenceInterval.lower * 0.8,
          maximum: confidenceInterval.upper * 1.2,
          mostLikely: adjustedPrediction
        },
        factors,
        timeframe: 'immediate',
        accuracy: model.accuracy,
        modelUsed: model.name,
        metadata: {
          basedOnRequests: historicalContext.requestCount,
          historicalPeriod: '30 days',
          seasonalityFactor: historicalContext.seasonalityFactor,
          trendFactor: historicalContext.trendFactor,
          volatility: historicalContext.volatility,
          dataQuality: historicalContext.dataQuality
        }
      };
      
      // Cache prediction for validation later
      await this.cachePrediction(prediction);
      
      logger.info('Cost prediction generated', {
        requestId: request.id,
        predictedCost: prediction.predictedCost,
        confidence: prediction.confidenceInterval.confidence,
        modelAccuracy: model.accuracy
      });
      
      return prediction;
      
    } catch (error) {
      logger.error('Failed to predict request cost', {
        requestId: request.id,
        agentId: agent.id,
        error: error.message
      });
      
      // Return fallback prediction
      return this.getFallbackPrediction(request, agent);
    }
  }

  /**
   * Predict user's spending for upcoming period
   */
  public async predictUserSpending(
    userId: string,
    timeframe: 'hour' | 'day' | 'week' | 'month',
    options: { includeOptimizations?: boolean } = {}
  ): Promise<CostPrediction> {
    try {
      const userUsagePattern = await this.getUserUsagePattern(userId);
      const seasonalFactors = await this.getSeasonalFactors(userId, timeframe);
      
      let basePrediction = 0;
      const factors: PredictionFactor[] = [];
      
      // Predict based on historical usage patterns
      switch (timeframe) {
        case 'hour':
          basePrediction = userUsagePattern.averageHourlyCost;
          break;
        case 'day':
          basePrediction = userUsagePattern.averageDailyCost;
          break;
        case 'week':
          basePrediction = userUsagePattern.averageWeeklyCost;
          break;
        case 'month':
          basePrediction = userUsagePattern.averageMonthlyCost;
          break;
      }
      
      // Apply seasonal adjustments
      const seasonalAdjustment = seasonalFactors.multiplier;
      const adjustedPrediction = basePrediction * seasonalAdjustment;
      
      factors.push({
        name: 'Historical Usage',
        impact: 0.7,
        confidence: 0.8,
        description: `Based on ${userUsagePattern.historicalRequestCount} historical requests`
      });
      
      if (seasonalAdjustment !== 1.0) {
        factors.push({
          name: 'Seasonal Pattern',
          impact: seasonalAdjustment - 1,
          confidence: seasonalFactors.confidence,
          description: `${seasonalAdjustment > 1 ? 'Higher' : 'Lower'} usage expected for this ${timeframe}`
        });
      }
      
      // Apply growth trends
      const trendFactor = await this.getTrendFactor(userId, timeframe);
      const trendAdjustedPrediction = adjustedPrediction * trendFactor;
      
      if (trendFactor !== 1.0) {
        factors.push({
          name: 'Usage Trend',
          impact: trendFactor - 1,
          confidence: 0.7,
          description: `${trendFactor > 1 ? 'Growing' : 'Declining'} usage trend detected`
        });
      }
      
      // Include optimization opportunities if requested
      if (options.includeOptimizations) {
        const optimizationImpact = await this.calculateOptimizationImpact(userId);
        factors.push({
          name: 'Optimization Potential',
          impact: -optimizationImpact.potentialSavingsPercentage,
          confidence: optimizationImpact.confidence,
          description: `Up to ${(optimizationImpact.potentialSavingsPercentage * 100).toFixed(1)}% savings available`
        });
      }
      
      const finalPrediction = trendAdjustedPrediction;
      const volatility = userUsagePattern.costVolatility;
      
      const prediction: CostPrediction = {
        userId,
        agentId: 'mixed',
        predictedCost: finalPrediction,
        confidenceInterval: this.calculateConfidenceInterval(finalPrediction, 0.75, volatility),
        costRange: {
          minimum: finalPrediction * (1 - volatility),
          maximum: finalPrediction * (1 + volatility * 1.5),
          mostLikely: finalPrediction
        },
        factors,
        timeframe,
        accuracy: 0.75,
        modelUsed: 'Hybrid Usage Model',
        metadata: {
          basedOnRequests: userUsagePattern.historicalRequestCount,
          historicalPeriod: '90 days',
          seasonalityFactor: seasonalFactors.multiplier,
          trendFactor,
          volatility,
          dataQuality: userUsagePattern.dataQuality
        }
      };
      
      return prediction;
      
    } catch (error) {
      logger.error('Failed to predict user spending', {
        userId,
        timeframe,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Predict budget utilization and generate budget recommendations
   */
  public async predictBudgetUtilization(userId: string): Promise<BudgetPrediction> {
    try {
      const currentBudget = await this.getCurrentBudget(userId);
      const currentSpend = await this.getCurrentSpend(userId);
      const monthlyPrediction = await this.predictUserSpending(userId, 'month');
      
      const daysInMonth = new Date().getDate();
      const daysRemaining = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - daysInMonth;
      
      // Calculate projected spend for the remainder of the month
      const dailyProjection = monthlyPrediction.predictedCost / 30;
      const projectedAdditionalSpend = dailyProjection * daysRemaining;
      const totalProjectedSpend = currentSpend + projectedAdditionalSpend;
      
      const budgetUtilization = totalProjectedSpend / currentBudget;
      
      // Calculate days until budget exhaustion
      const dailyActualSpend = currentSpend / daysInMonth;
      const daysUntilBudgetExhausted = dailyActualSpend > 0 
        ? Math.max(0, (currentBudget - currentSpend) / dailyActualSpend)
        : Infinity;
      
      // Determine risk level
      let riskLevel: 'low' | 'medium' | 'high' | 'critical';
      if (budgetUtilization < 0.7) riskLevel = 'low';
      else if (budgetUtilization < 0.9) riskLevel = 'medium';
      else if (budgetUtilization < 1.1) riskLevel = 'high';
      else riskLevel = 'critical';
      
      // Generate alerts
      const alerts = await this.generateBudgetAlerts(
        budgetUtilization,
        daysUntilBudgetExhausted,
        currentBudget,
        totalProjectedSpend
      );
      
      // Find optimization opportunities
      const optimizationOpportunities = await this.findOptimizationOpportunities(userId);
      
      // Recommend optimal budget
      const recommendedBudget = this.calculateRecommendedBudget(
        totalProjectedSpend,
        monthlyPrediction.confidenceInterval.upper,
        optimizationOpportunities
      );
      
      const budgetPrediction: BudgetPrediction = {
        userId,
        currentBudget,
        projectedSpend: totalProjectedSpend,
        budgetUtilization,
        daysUntilBudgetExhausted,
        recommendedBudget,
        riskLevel,
        alerts,
        optimizationOpportunities
      };
      
      logger.info('Budget prediction generated', {
        userId,
        budgetUtilization,
        riskLevel,
        daysUntilExhausted: daysUntilBudgetExhausted,
        alertCount: alerts.length
      });
      
      return budgetPrediction;
      
    } catch (error) {
      logger.error('Failed to predict budget utilization', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Generate cost forecast for multiple agents/scenarios
   */
  public async generateCostForecast(
    userId: string,
    scenarios: Array<{
      name: string;
      agents: string[];
      expectedRequests: number;
      timeframe: 'day' | 'week' | 'month';
    }>
  ): Promise<CostForecast[]> {
    const forecasts: CostForecast[] = [];
    
    for (const scenario of scenarios) {
      try {
        const scenarioForecasts = await Promise.all(
          scenario.agents.map(agentId => 
            this.forecastAgentCosts(userId, agentId, scenario.expectedRequests, scenario.timeframe)
          )
        );
        
        const totalCost = scenarioForecasts.reduce((sum, f) => sum + f.predictedCost, 0);
        const avgConfidence = scenarioForecasts.reduce((sum, f) => sum + f.confidenceInterval.confidence, 0) / scenarioForecasts.length;
        
        const forecast: CostForecast = {
          id: `forecast_${scenario.name}_${Date.now()}`,
          name: scenario.name,
          userId,
          timeframe: scenario.timeframe,
          expectedRequests: scenario.expectedRequests,
          predictedCost: totalCost,
          confidence: avgConfidence,
          breakdown: scenarioForecasts.map(f => ({
            agentId: f.agentId,
            agentName: `Agent ${f.agentId}`,
            cost: f.predictedCost,
            requests: scenario.expectedRequests / scenario.agents.length
          })),
          factors: this.combinePredictionFactors(scenarioForecasts.map(f => f.factors).flat()),
          createdAt: new Date(),
          validUntil: new Date(Date.now() + (scenario.timeframe === 'day' ? 24 : scenario.timeframe === 'week' ? 7 * 24 : 30 * 24) * 60 * 60 * 1000)
        };
        
        forecasts.push(forecast);
        
      } catch (error) {
        logger.error('Failed to generate forecast for scenario', {
          scenario: scenario.name,
          error: error.message
        });
      }
    }
    
    return forecasts;
  }

  /**
   * Update prediction models based on actual costs
   */
  public async updateModelsWithActual(
    prediction: CostPrediction,
    actualCost: CostCalculation
  ): Promise<void> {
    try {
      const predictionError = Math.abs(prediction.predictedCost - actualCost.totalCost);
      const errorPercentage = predictionError / actualCost.totalCost;
      
      // Update model accuracy
      const model = this.models.get(prediction.modelUsed);
      if (model) {
        // Simple exponential moving average for accuracy
        const alpha = 0.1;
        model.accuracy = (1 - alpha) * model.accuracy + alpha * (1 - errorPercentage);
        model.lastUpdated = new Date();
        
        // Store training data for model improvement
        await this.storeTrainingData(prediction, actualCost);
      }
      
      logger.info('Model updated with actual cost', {
        requestId: prediction.requestId,
        predictedCost: prediction.predictedCost,
        actualCost: actualCost.totalCost,
        errorPercentage,
        newAccuracy: model?.accuracy
      });
      
    } catch (error) {
      logger.error('Failed to update models with actual cost', {
        requestId: prediction.requestId,
        error: error.message
      });
    }
  }

  /**
   * Initialize prediction models
   */
  private initializePredictionModels(): void {
    // Linear regression model for general predictions
    this.models.set('linear_general', {
      id: 'linear_general',
      name: 'Linear General Model',
      type: 'linear',
      accuracy: 0.75,
      lastUpdated: new Date(),
      parameters: {
        coefficients: [0.001, 0.002, 0.5, 1.2],
        intercept: 0.005,
        features: ['token_count', 'complexity', 'priority_multiplier', 'agent_cost_factor']
      }
    });
    
    // Polynomial model for complex requests
    this.models.set('polynomial_complex', {
      id: 'polynomial_complex',
      name: 'Polynomial Complex Model',
      type: 'polynomial',
      accuracy: 0.82,
      lastUpdated: new Date(),
      parameters: {
        coefficients: [0.001, 0.0001, 0.00001],
        intercept: 0.01,
        features: ['token_count', 'token_count_squared', 'complexity_interaction']
      }
    });
  }

  /**
   * Extract features from request for prediction
   */
  private async extractFeatures(
    request: AIRequest,
    agent: AIAgent
  ): Promise<Record<string, number>> {
    const contentLength = request.prompt?.length || request.input?.length || 0;
    const estimatedTokens = Math.ceil(contentLength / 4);
    
    return {
      token_count: estimatedTokens,
      complexity: this.getComplexityScore(request),
      priority_multiplier: this.getPriorityMultiplier(request.priority),
      agent_cost_factor: await this.getAgentCostFactor(agent.id),
      time_of_day_factor: this.getTimeOfDayFactor(),
      user_tier_multiplier: await this.getUserTierMultiplier(request.userId),
      historical_avg_cost: await this.getHistoricalAverageCost(request.userId, agent.id),
      token_count_squared: estimatedTokens * estimatedTokens,
      complexity_interaction: this.getComplexityScore(request) * estimatedTokens
    };
  }

  /**
   * Get the best prediction model for specific agent and request type
   */
  private async getBestModel(agentId: string, requestType: string): Promise<PredictionModel> {
    // Simple model selection logic - in practice, this could be more sophisticated
    if (requestType.includes('complex') || requestType.includes('code')) {
      return this.models.get('polynomial_complex') || this.models.get('linear_general')!;
    }
    return this.models.get('linear_general')!;
  }

  /**
   * Run prediction model with features
   */
  private async runPredictionModel(
    model: PredictionModel,
    features: Record<string, number>
  ): Promise<number> {
    let prediction = model.parameters.intercept;
    
    for (let i = 0; i < model.parameters.features.length; i++) {
      const featureName = model.parameters.features[i];
      const featureValue = features[featureName] || 0;
      prediction += model.parameters.coefficients[i] * featureValue;
    }
    
    return Math.max(prediction, 0.001); // Minimum cost
  }

  /**
   * Calculate confidence interval for prediction
   */
  private calculateConfidenceInterval(
    prediction: number,
    modelAccuracy: number,
    volatility: number
  ): { lower: number; upper: number; confidence: number } {
    const uncertainty = (1 - modelAccuracy) + volatility;
    const margin = prediction * uncertainty;
    
    return {
      lower: Math.max(0, prediction - margin),
      upper: prediction + margin,
      confidence: Math.min(modelAccuracy, 1 - volatility)
    };
  }

  /**
   * Get complexity score for request
   */
  private getComplexityScore(request: AIRequest): number {
    const contentLength = request.prompt?.length || request.input?.length || 0;
    const hasFiles = request.files && request.files.length > 0;
    const isCodeRequest = request.type?.includes('code') || false;
    
    let score = 1.0;
    if (contentLength > 1000) score += 0.5;
    if (contentLength > 5000) score += 1.0;
    if (hasFiles) score += 0.8;
    if (isCodeRequest) score += 1.2;
    
    return score;
  }

  /**
   * Get priority multiplier
   */
  private getPriorityMultiplier(priority?: string): number {
    switch (priority) {
      case 'low': return 0.8;
      case 'normal': return 1.0;
      case 'high': return 1.25;
      case 'critical': return 1.5;
      default: return 1.0;
    }
  }

  /**
   * Cache prediction for later validation
   */
  private async cachePrediction(prediction: CostPrediction): Promise<void> {
    if (prediction.requestId) {
      const cacheKey = `prediction:${prediction.requestId}`;
      await this.cache.set(cacheKey, prediction, 86400); // Cache for 24 hours
    }
  }

  /**
   * Get fallback prediction when main prediction fails
   */
  private getFallbackPrediction(request: AIRequest, agent: AIAgent): CostPrediction {
    const estimatedTokens = Math.ceil((request.prompt?.length || 0) / 4);
    const fallbackCost = estimatedTokens * 0.002; // Rough estimate
    
    return {
      requestId: request.id,
      userId: request.userId,
      agentId: agent.id,
      predictedCost: fallbackCost,
      confidenceInterval: { lower: fallbackCost * 0.5, upper: fallbackCost * 2, confidence: 0.5 },
      costRange: { minimum: fallbackCost * 0.3, maximum: fallbackCost * 3, mostLikely: fallbackCost },
      factors: [{ name: 'Fallback Estimate', impact: 1, confidence: 0.5, description: 'Basic token-based estimate' }],
      timeframe: 'immediate',
      accuracy: 0.5,
      modelUsed: 'Fallback Model',
      metadata: {
        basedOnRequests: 0,
        historicalPeriod: 'none',
        seasonalityFactor: 1,
        trendFactor: 1,
        volatility: 0.5,
        dataQuality: 0.3
      }
    };
  }

  // Additional helper methods would be implemented here...
  private async getAgentCostFactor(agentId: string): Promise<number> { return 1.0; }
  private getTimeOfDayFactor(): number { return 1.0; }
  private async getUserTierMultiplier(userId: string): Promise<number> { return 1.0; }
  private async getHistoricalAverageCost(userId: string, agentId: string): Promise<number> { return 0.01; }
  private async getHistoricalContext(userId: string, agentId: string): Promise<any> { 
    return { 
      requestCount: 100, 
      volatility: 0.2, 
      seasonalityFactor: 1.0, 
      trendFactor: 1.1, 
      dataQuality: 0.8 
    }; 
  }
  private adjustForContext(basePrediction: number, context: any): number { return basePrediction; }
  private async identifyPredictionFactors(request: AIRequest, agent: AIAgent, features: Record<string, number>): Promise<PredictionFactor[]> { 
    return []; 
  }
  private async getUserUsagePattern(userId: string): Promise<any> { 
    return { 
      averageHourlyCost: 0.5, 
      averageDailyCost: 5, 
      averageWeeklyCost: 30, 
      averageMonthlyCost: 120,
      historicalRequestCount: 1000,
      costVolatility: 0.3,
      dataQuality: 0.8
    }; 
  }
  private async getSeasonalFactors(userId: string, timeframe: string): Promise<any> { 
    return { multiplier: 1.0, confidence: 0.7 }; 
  }
  private async getTrendFactor(userId: string, timeframe: string): Promise<number> { return 1.0; }
  private async calculateOptimizationImpact(userId: string): Promise<any> { 
    return { potentialSavingsPercentage: 0.15, confidence: 0.8 }; 
  }
  private async getCurrentBudget(userId: string): Promise<number> { return 1000; }
  private async getCurrentSpend(userId: string): Promise<number> { return 300; }
  private async generateBudgetAlerts(utilization: number, daysUntil: number, budget: number, projected: number): Promise<BudgetAlert[]> { 
    return []; 
  }
  private async findOptimizationOpportunities(userId: string): Promise<OptimizationOpportunity[]> { 
    return []; 
  }
  private calculateRecommendedBudget(projected: number, upperBound: number, opportunities: OptimizationOpportunity[]): number { 
    return projected * 1.2; 
  }
  private async forecastAgentCosts(userId: string, agentId: string, requests: number, timeframe: string): Promise<any> { 
    return { agentId, predictedCost: requests * 0.01, confidenceInterval: { confidence: 0.8 }, factors: [] }; 
  }
  private combinePredictionFactors(factors: PredictionFactor[]): PredictionFactor[] { 
    return factors; 
  }
  private async storeTrainingData(prediction: CostPrediction, actual: CostCalculation): Promise<void> {}
}
