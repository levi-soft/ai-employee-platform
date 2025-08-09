
import { logger } from '@ai-platform/shared-utils';
import { aiRoutingConfig } from '../config/config';
import { AIRequest, AIAgent, OptimizationRecommendation, CostOptimizationStrategy } from '../types';
import { CostCalculatorService, CostCalculation } from './cost-calculator.service';
import { CostPredictorService, CostPrediction } from './cost-predictor.service';
import { RedisCache } from '../cache/request-cache.service';

export interface OptimizationResult {
  requestId: string;
  userId: string;
  originalCost: number;
  optimizedCost: number;
  savings: number;
  savingsPercentage: number;
  recommendations: OptimizationRecommendation[];
  appliedStrategies: CostOptimizationStrategy[];
  riskAssessment: RiskAssessment;
  implementationComplexity: 'low' | 'medium' | 'high';
  estimatedImplementationTime: number; // minutes
}

export interface RiskAssessment {
  qualityImpact: 'none' | 'minimal' | 'moderate' | 'significant';
  performanceImpact: 'improved' | 'same' | 'slightly_worse' | 'worse';
  reliabilityImpact: 'improved' | 'same' | 'reduced';
  overallRisk: 'low' | 'medium' | 'high';
  mitigation: string[];
}

export interface AgentOptimization {
  originalAgent: AIAgent;
  recommendedAgent: AIAgent;
  costReduction: number;
  qualityDifference: number;
  suitabilityScore: number;
  switchComplexity: 'easy' | 'moderate' | 'complex';
}

export interface UsageOptimization {
  type: 'batching' | 'caching' | 'scheduling' | 'preprocessing';
  description: string;
  potentialSavings: number;
  implementationGuide: string[];
  prerequisites: string[];
  timeToImplement: number;
}

export interface CostOptimizationInsight {
  userId: string;
  timeframe: 'day' | 'week' | 'month';
  totalPotentialSavings: number;
  savingsPercentage: number;
  topRecommendations: OptimizationRecommendation[];
  quickWins: OptimizationRecommendation[];
  longTermOptimizations: OptimizationRecommendation[];
  riskProfile: 'conservative' | 'moderate' | 'aggressive';
  generatedAt: Date;
  validUntil: Date;
}

export class OptimizationEngine {
  private costCalculator: CostCalculatorService;
  private costPredictor: CostPredictorService;
  private cache: RedisCache;
  private optimizationStrategies: Map<string, CostOptimizationStrategy> = new Map();

  constructor(
    costCalculator: CostCalculatorService,
    costPredictor: CostPredictorService
  ) {
    this.costCalculator = costCalculator;
    this.costPredictor = costPredictor;
    this.cache = new RedisCache({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    });
    this.initializeOptimizationStrategies();
  }

  /**
   * Optimize cost for a single request
   */
  public async optimizeRequest(
    request: AIRequest,
    agents: AIAgent[]
  ): Promise<OptimizationResult> {
    try {
      const originalAgent = agents.find(a => a.id === request.agentId);
      if (!originalAgent) {
        throw new Error('Original agent not found');
      }

      // Get original cost prediction
      const originalPrediction = await this.costPredictor.predictRequestCost(request, originalAgent);
      
      // Find optimization opportunities
      const agentOptimizations = await this.findAgentOptimizations(request, originalAgent, agents);
      const usageOptimizations = await this.findUsageOptimizations(request);
      
      // Apply optimization strategies
      const appliedStrategies: CostOptimizationStrategy[] = [];
      const recommendations: OptimizationRecommendation[] = [];
      
      let bestCost = originalPrediction.predictedCost;
      let bestAgent = originalAgent;
      
      // Agent switching optimization
      if (agentOptimizations.length > 0) {
        const bestAgentOpt = agentOptimizations[0];
        if (bestAgentOpt.costReduction > 0 && bestAgentOpt.qualityDifference >= -0.1) {
          bestCost = originalPrediction.predictedCost - bestAgentOpt.costReduction;
          bestAgent = bestAgentOpt.recommendedAgent;
          
          recommendations.push({
            type: 'agent_switch',
            title: `Switch to ${bestAgent.name}`,
            description: `Reduce cost by $${bestAgentOpt.costReduction.toFixed(4)} with minimal quality impact`,
            potentialSavings: bestAgentOpt.costReduction,
            impact: 'immediate',
            effort: bestAgentOpt.switchComplexity,
            implementation: this.generateAgentSwitchImplementation(originalAgent, bestAgent),
            riskLevel: bestAgentOpt.qualityDifference < -0.05 ? 'medium' : 'low'
          });
          
          appliedStrategies.push({
            id: 'agent_switch',
            name: 'Agent Switching',
            description: 'Switch to more cost-effective agent',
            category: 'agent_selection'
          });
        }
      }
      
      // Usage pattern optimizations
      for (const usageOpt of usageOptimizations) {
        if (usageOpt.potentialSavings > 0.001) { // Only include meaningful savings
          recommendations.push({
            type: usageOpt.type as any,
            title: `${usageOpt.type.charAt(0).toUpperCase() + usageOpt.type.slice(1)} Optimization`,
            description: usageOpt.description,
            potentialSavings: usageOpt.potentialSavings,
            impact: usageOpt.timeToImplement < 10 ? 'immediate' : 'long_term',
            effort: usageOpt.timeToImplement < 5 ? 'low' : usageOpt.timeToImplement < 15 ? 'medium' : 'high',
            implementation: usageOpt.implementationGuide,
            riskLevel: 'low'
          });
          
          appliedStrategies.push({
            id: usageOpt.type,
            name: usageOpt.type.charAt(0).toUpperCase() + usageOpt.type.slice(1),
            description: usageOpt.description,
            category: 'usage_pattern'
          });
          
          bestCost -= usageOpt.potentialSavings;
        }
      }
      
      // Calculate total optimization
      const totalSavings = originalPrediction.predictedCost - bestCost;
      const savingsPercentage = (totalSavings / originalPrediction.predictedCost) * 100;
      
      // Risk assessment
      const riskAssessment = this.assessOptimizationRisk(
        recommendations,
        originalAgent,
        bestAgent
      );
      
      // Implementation complexity
      const implementationComplexity = this.calculateImplementationComplexity(recommendations);
      const estimatedTime = this.estimateImplementationTime(recommendations);
      
      const result: OptimizationResult = {
        requestId: request.id || `opt_${Date.now()}`,
        userId: request.userId,
        originalCost: originalPrediction.predictedCost,
        optimizedCost: bestCost,
        savings: totalSavings,
        savingsPercentage,
        recommendations,
        appliedStrategies,
        riskAssessment,
        implementationComplexity,
        estimatedImplementationTime: estimatedTime
      };
      
      // Cache optimization result
      await this.cacheOptimizationResult(result);
      
      logger.info('Request optimization completed', {
        requestId: request.id,
        originalCost: originalPrediction.predictedCost,
        optimizedCost: bestCost,
        savings: totalSavings,
        savingsPercentage,
        recommendationCount: recommendations.length
      });
      
      return result;
      
    } catch (error) {
      logger.error('Failed to optimize request', {
        requestId: request.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Generate cost optimization insights for a user
   */
  public async generateOptimizationInsights(
    userId: string,
    timeframe: 'day' | 'week' | 'month' = 'month'
  ): Promise<CostOptimizationInsight> {
    try {
      // Get user's usage patterns and costs
      const usageHistory = await this.getUserUsageHistory(userId, timeframe);
      const currentSpending = await this.getCurrentSpending(userId, timeframe);
      
      // Analyze optimization opportunities
      const agentOptimizations = await this.analyzeAgentUsageOptimizations(userId, usageHistory);
      const usagePatternOptimizations = await this.analyzeUsagePatternOptimizations(userId, usageHistory);
      const timingOptimizations = await this.analyzeTimingOptimizations(userId, usageHistory);
      
      // Combine all recommendations
      const allRecommendations = [
        ...agentOptimizations,
        ...usagePatternOptimizations,
        ...timingOptimizations
      ];
      
      // Sort by potential savings
      allRecommendations.sort((a, b) => b.potentialSavings - a.potentialSavings);
      
      // Categorize recommendations
      const quickWins = allRecommendations.filter(r => 
        r.effort === 'low' && r.impact === 'immediate'
      ).slice(0, 5);
      
      const longTermOptimizations = allRecommendations.filter(r => 
        r.effort === 'high' || r.impact === 'long_term'
      ).slice(0, 5);
      
      const topRecommendations = allRecommendations.slice(0, 10);
      
      // Calculate total potential savings
      const totalPotentialSavings = allRecommendations.reduce((sum, rec) => sum + rec.potentialSavings, 0);
      const savingsPercentage = (totalPotentialSavings / currentSpending) * 100;
      
      // Determine risk profile based on recommendations
      const riskProfile = this.determineRiskProfile(topRecommendations);
      
      const insights: CostOptimizationInsight = {
        userId,
        timeframe,
        totalPotentialSavings,
        savingsPercentage,
        topRecommendations,
        quickWins,
        longTermOptimizations,
        riskProfile,
        generatedAt: new Date(),
        validUntil: new Date(Date.now() + (timeframe === 'day' ? 24 : timeframe === 'week' ? 7 * 24 : 30 * 24) * 60 * 60 * 1000)
      };
      
      // Cache insights
      await this.cacheOptimizationInsights(insights);
      
      logger.info('Optimization insights generated', {
        userId,
        timeframe,
        totalSavings: totalPotentialSavings,
        savingsPercentage,
        recommendationCount: allRecommendations.length,
        quickWinCount: quickWins.length
      });
      
      return insights;
      
    } catch (error) {
      logger.error('Failed to generate optimization insights', {
        userId,
        timeframe,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Find optimal agent combinations for batch processing
   */
  public async optimizeBatchProcessing(
    requests: AIRequest[],
    availableAgents: AIAgent[]
  ): Promise<{
    batches: Array<{
      agent: AIAgent;
      requests: AIRequest[];
      estimatedCost: number;
      estimatedTime: number;
    }>;
    totalCost: number;
    totalSavings: number;
    optimization: OptimizationResult;
  }> {
    try {
      // Group similar requests
      const requestGroups = this.groupSimilarRequests(requests);
      
      // Find optimal agent for each group
      const batches = [];
      let totalCost = 0;
      let originalTotalCost = 0;
      
      for (const group of requestGroups) {
        const optimalAgent = await this.findOptimalAgentForBatch(group, availableAgents);
        
        // Calculate costs
        const batchCost = await this.estimateBatchCost(group, optimalAgent);
        const originalCosts = await Promise.all(
          group.map(req => this.costPredictor.predictRequestCost(req, optimalAgent))
        );
        const originalBatchCost = originalCosts.reduce((sum, pred) => sum + pred.predictedCost, 0);
        
        batches.push({
          agent: optimalAgent,
          requests: group,
          estimatedCost: batchCost,
          estimatedTime: this.estimateBatchTime(group, optimalAgent)
        });
        
        totalCost += batchCost;
        originalTotalCost += originalBatchCost;
      }
      
      const totalSavings = originalTotalCost - totalCost;
      
      // Create optimization result
      const optimization: OptimizationResult = {
        requestId: `batch_${Date.now()}`,
        userId: requests[0]?.userId || 'batch',
        originalCost: originalTotalCost,
        optimizedCost: totalCost,
        savings: totalSavings,
        savingsPercentage: (totalSavings / originalTotalCost) * 100,
        recommendations: [{
          type: 'batch_processing',
          title: 'Batch Processing Optimization',
          description: `Process ${requests.length} requests in ${batches.length} optimized batches`,
          potentialSavings: totalSavings,
          impact: 'immediate',
          effort: 'low',
          implementation: ['Group similar requests', 'Use optimal agents for each batch', 'Process in parallel'],
          riskLevel: 'low'
        }],
        appliedStrategies: [{
          id: 'batch_processing',
          name: 'Batch Processing',
          description: 'Optimize request grouping and agent selection',
          category: 'processing_optimization'
        }],
        riskAssessment: {
          qualityImpact: 'none',
          performanceImpact: 'improved',
          reliabilityImpact: 'improved',
          overallRisk: 'low',
          mitigation: ['Monitor batch completion rates', 'Implement batch size limits']
        },
        implementationComplexity: 'low',
        estimatedImplementationTime: 5
      };
      
      return {
        batches,
        totalCost,
        totalSavings,
        optimization
      };
      
    } catch (error) {
      logger.error('Failed to optimize batch processing', {
        requestCount: requests.length,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Real-time cost optimization for streaming requests
   */
  public async optimizeStreamingRequest(
    request: AIRequest,
    currentAgent: AIAgent,
    availableAgents: AIAgent[]
  ): Promise<{
    shouldSwitch: boolean;
    recommendedAgent?: AIAgent;
    costSavings: number;
    qualityImpact: number;
    reasoning: string;
  }> {
    try {
      // Get real-time agent performance and costs
      const agentPerformance = await this.getRealTimeAgentPerformance(availableAgents);
      
      // Calculate current cost trajectory
      const currentCostPrediction = await this.costPredictor.predictRequestCost(request, currentAgent);
      
      // Find best alternative
      let bestAgent = currentAgent;
      let bestCost = currentCostPrediction.predictedCost;
      let qualityImpact = 0;
      
      for (const agent of availableAgents) {
        if (agent.id === currentAgent.id) continue;
        
        const agentPrediction = await this.costPredictor.predictRequestCost(request, agent);
        const performance = agentPerformance.get(agent.id);
        
        if (performance && agentPrediction.predictedCost < bestCost) {
          const qualityDiff = (performance.qualityScore - agentPerformance.get(currentAgent.id)?.qualityScore) || 0;
          
          // Only switch if quality impact is acceptable
          if (qualityDiff >= -0.1) {
            bestAgent = agent;
            bestCost = agentPrediction.predictedCost;
            qualityImpact = qualityDiff;
          }
        }
      }
      
      const shouldSwitch = bestAgent.id !== currentAgent.id;
      const costSavings = currentCostPrediction.predictedCost - bestCost;
      
      return {
        shouldSwitch,
        recommendedAgent: shouldSwitch ? bestAgent : undefined,
        costSavings,
        qualityImpact,
        reasoning: shouldSwitch 
          ? `Switching to ${bestAgent.name} saves $${costSavings.toFixed(4)} with ${qualityImpact >= 0 ? 'improved' : 'minimal'} quality impact`
          : 'Current agent is optimal for this request'
      };
      
    } catch (error) {
      logger.error('Failed to optimize streaming request', {
        requestId: request.id,
        currentAgent: currentAgent.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Initialize optimization strategies
   */
  private initializeOptimizationStrategies(): void {
    const strategies: CostOptimizationStrategy[] = [
      {
        id: 'agent_switching',
        name: 'Agent Switching',
        description: 'Switch to more cost-effective agents while maintaining quality',
        category: 'agent_selection'
      },
      {
        id: 'request_batching',
        name: 'Request Batching',
        description: 'Group similar requests for batch processing',
        category: 'processing_optimization'
      },
      {
        id: 'cache_optimization',
        name: 'Cache Optimization',
        description: 'Improve cache hit rates to reduce duplicate processing',
        category: 'caching'
      },
      {
        id: 'timing_optimization',
        name: 'Timing Optimization',
        description: 'Process requests during off-peak hours for lower costs',
        category: 'scheduling'
      },
      {
        id: 'preprocessing',
        name: 'Request Preprocessing',
        description: 'Optimize request content to reduce processing costs',
        category: 'preprocessing'
      }
    ];
    
    strategies.forEach(strategy => {
      this.optimizationStrategies.set(strategy.id, strategy);
    });
  }

  /**
   * Find agent optimization opportunities
   */
  private async findAgentOptimizations(
    request: AIRequest,
    currentAgent: AIAgent,
    availableAgents: AIAgent[]
  ): Promise<AgentOptimization[]> {
    const optimizations: AgentOptimization[] = [];
    
    const currentPrediction = await this.costPredictor.predictRequestCost(request, currentAgent);
    
    for (const agent of availableAgents) {
      if (agent.id === currentAgent.id) continue;
      
      try {
        const agentPrediction = await this.costPredictor.predictRequestCost(request, agent);
        const costReduction = currentPrediction.predictedCost - agentPrediction.predictedCost;
        
        if (costReduction > 0) {
          const qualityDifference = await this.estimateQualityDifference(currentAgent, agent, request);
          const suitabilityScore = await this.calculateAgentSuitability(agent, request);
          
          optimizations.push({
            originalAgent: currentAgent,
            recommendedAgent: agent,
            costReduction,
            qualityDifference,
            suitabilityScore,
            switchComplexity: this.assessSwitchComplexity(currentAgent, agent)
          });
        }
      } catch (error) {
        logger.warn('Failed to evaluate agent optimization', {
          agentId: agent.id,
          error: error.message
        });
      }
    }
    
    return optimizations.sort((a, b) => b.costReduction - a.costReduction);
  }

  /**
   * Find usage pattern optimizations
   */
  private async findUsageOptimizations(request: AIRequest): Promise<UsageOptimization[]> {
    const optimizations: UsageOptimization[] = [];
    
    // Caching optimization
    const cacheableScore = await this.assessCacheability(request);
    if (cacheableScore > 0.7) {
      optimizations.push({
        type: 'caching',
        description: 'Implement aggressive caching for similar requests',
        potentialSavings: 0.003, // Estimated savings
        implementationGuide: [
          'Enable extended cache TTL for similar requests',
          'Implement semantic caching for related queries',
          'Use cache warming for predictable requests'
        ],
        prerequisites: ['Cache infrastructure setup'],
        timeToImplement: 10
      });
    }
    
    // Batching optimization
    if (request.priority !== 'critical' && request.priority !== 'high') {
      optimizations.push({
        type: 'batching',
        description: 'Process with similar requests in batches',
        potentialSavings: 0.002,
        implementationGuide: [
          'Queue non-urgent requests for batch processing',
          'Group by agent type and complexity',
          'Process batches during off-peak hours'
        ],
        prerequisites: ['Batch processing system'],
        timeToImplement: 15
      });
    }
    
    // Preprocessing optimization
    const contentLength = request.prompt?.length || request.input?.length || 0;
    if (contentLength > 2000) {
      optimizations.push({
        type: 'preprocessing',
        description: 'Optimize request content to reduce token usage',
        potentialSavings: 0.001,
        implementationGuide: [
          'Remove unnecessary whitespace and formatting',
          'Summarize lengthy context where appropriate',
          'Use more efficient prompt engineering'
        ],
        prerequisites: ['Content optimization pipeline'],
        timeToImplement: 5
      });
    }
    
    return optimizations;
  }

  /**
   * Assess optimization risk
   */
  private assessOptimizationRisk(
    recommendations: OptimizationRecommendation[],
    originalAgent: AIAgent,
    optimizedAgent: AIAgent
  ): RiskAssessment {
    let qualityImpact: 'none' | 'minimal' | 'moderate' | 'significant' = 'none';
    let performanceImpact: 'improved' | 'same' | 'slightly_worse' | 'worse' = 'same';
    let reliabilityImpact: 'improved' | 'same' | 'reduced' = 'same';
    
    // Assess based on agent change
    if (originalAgent.id !== optimizedAgent.id) {
      if (optimizedAgent.reliability < originalAgent.reliability * 0.9) {
        reliabilityImpact = 'reduced';
      } else if (optimizedAgent.reliability > originalAgent.reliability * 1.1) {
        reliabilityImpact = 'improved';
      }
      
      // Quality impact assessment (simplified)
      if (optimizedAgent.model !== originalAgent.model) {
        qualityImpact = 'minimal';
      }
    }
    
    // Assess based on recommendations
    const highRiskCount = recommendations.filter(r => r.riskLevel === 'high').length;
    const mediumRiskCount = recommendations.filter(r => r.riskLevel === 'medium').length;
    
    let overallRisk: 'low' | 'medium' | 'high';
    if (highRiskCount > 0 || mediumRiskCount > 2) {
      overallRisk = 'high';
    } else if (mediumRiskCount > 0) {
      overallRisk = 'medium';
    } else {
      overallRisk = 'low';
    }
    
    const mitigation: string[] = [];
    if (overallRisk !== 'low') {
      mitigation.push('Monitor quality metrics closely');
      mitigation.push('Implement gradual rollout');
      mitigation.push('Have rollback plan ready');
    }
    
    return {
      qualityImpact,
      performanceImpact,
      reliabilityImpact,
      overallRisk,
      mitigation
    };
  }

  // Additional helper methods would be implemented here...
  private calculateImplementationComplexity(recommendations: OptimizationRecommendation[]): 'low' | 'medium' | 'high' {
    const highEffortCount = recommendations.filter(r => r.effort === 'high').length;
    if (highEffortCount > 1) return 'high';
    if (highEffortCount === 1 || recommendations.filter(r => r.effort === 'medium').length > 2) return 'medium';
    return 'low';
  }

  private estimateImplementationTime(recommendations: OptimizationRecommendation[]): number {
    return recommendations.reduce((total, rec) => {
      switch (rec.effort) {
        case 'low': return total + 5;
        case 'medium': return total + 15;
        case 'high': return total + 30;
        default: return total + 10;
      }
    }, 0);
  }

  private generateAgentSwitchImplementation(original: AIAgent, recommended: AIAgent): string[] {
    return [
      `Change agent from ${original.name} to ${recommended.name}`,
      'Update request routing configuration',
      'Monitor response quality',
      'Validate cost savings'
    ];
  }

  private async cacheOptimizationResult(result: OptimizationResult): Promise<void> {
    const cacheKey = `optimization:${result.requestId}`;
    await this.cache.set(cacheKey, result, 3600); // Cache for 1 hour
  }

  private async cacheOptimizationInsights(insights: CostOptimizationInsight): Promise<void> {
    const cacheKey = `optimization_insights:${insights.userId}:${insights.timeframe}`;
    await this.cache.set(cacheKey, insights, insights.timeframe === 'day' ? 3600 : 86400); // Cache based on timeframe
  }

  // Simplified implementations of complex methods
  private async estimateQualityDifference(agent1: AIAgent, agent2: AIAgent, request: AIRequest): Promise<number> { return 0; }
  private async calculateAgentSuitability(agent: AIAgent, request: AIRequest): Promise<number> { return 0.8; }
  private assessSwitchComplexity(original: AIAgent, recommended: AIAgent): 'easy' | 'moderate' | 'complex' { return 'easy'; }
  private async assessCacheability(request: AIRequest): Promise<number> { return 0.5; }
  private async getUserUsageHistory(userId: string, timeframe: string): Promise<any> { return {}; }
  private async getCurrentSpending(userId: string, timeframe: string): Promise<number> { return 100; }
  private async analyzeAgentUsageOptimizations(userId: string, history: any): Promise<OptimizationRecommendation[]> { return []; }
  private async analyzeUsagePatternOptimizations(userId: string, history: any): Promise<OptimizationRecommendation[]> { return []; }
  private async analyzeTimingOptimizations(userId: string, history: any): Promise<OptimizationRecommendation[]> { return []; }
  private determineRiskProfile(recommendations: OptimizationRecommendation[]): 'conservative' | 'moderate' | 'aggressive' { return 'moderate'; }
  private groupSimilarRequests(requests: AIRequest[]): AIRequest[][] { return [requests]; }
  private async findOptimalAgentForBatch(requests: AIRequest[], agents: AIAgent[]): Promise<AIAgent> { return agents[0]; }
  private async estimateBatchCost(requests: AIRequest[], agent: AIAgent): Promise<number> { return requests.length * 0.01; }
  private estimateBatchTime(requests: AIRequest[], agent: AIAgent): number { return requests.length * 2; }
  private async getRealTimeAgentPerformance(agents: AIAgent[]): Promise<Map<string, any>> { return new Map(); }
}
