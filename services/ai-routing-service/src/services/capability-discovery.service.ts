
import { EventEmitter } from 'events';
import { logger } from '@ai-platform/shared-utils';
import { AIAgent, AgentCapability } from './agent-registry.service';
import { AIProviderType } from '../types/ai-types';

export interface CapabilityMatch {
  agent: AIAgent;
  matchScore: number;
  matchedCapabilities: AgentCapability[];
  reasoning: string[];
  confidence: number;
}

export interface CapabilityQuery {
  requiredCapabilities: string[];
  preferredCapabilities?: string[];
  dataTypes: string[];
  complexity: 'low' | 'medium' | 'high';
  context?: {
    domain?: string;
    language?: string;
    format?: string;
    constraints?: Record<string, any>;
  };
  performance?: {
    maxLatency?: number;
    minAccuracy?: number;
    maxCost?: number;
  };
}

export interface CapabilityProfile {
  capability: string;
  description: string;
  category: string;
  dataTypes: string[];
  agents: {
    agentId: string;
    agentName: string;
    provider: string;
    confidence: number;
    performance: {
      averageLatency: number;
      accuracy: number;
      cost: number;
    };
  }[];
  metadata: {
    totalAgents: number;
    averageConfidence: number;
    popularProviders: string[];
    lastUpdated: Date;
  };
}

export interface DiscoveryMetrics {
  totalQueries: number;
  averageMatchScore: number;
  topCapabilities: Record<string, number>;
  agentUtilization: Record<string, number>;
  performanceMetrics: {
    averageDiscoveryTime: number;
    cacheHitRate: number;
    successRate: number;
  };
}

export class CapabilityDiscoveryService extends EventEmitter {
  private capabilityProfiles: Map<string, CapabilityProfile> = new Map();
  private queryCache: Map<string, CapabilityMatch[]> = new Map();
  private metrics: DiscoveryMetrics;
  private lastCacheCleanup = Date.now();
  
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly CACHE_CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes

  constructor() {
    super();
    this.metrics = {
      totalQueries: 0,
      averageMatchScore: 0,
      topCapabilities: {},
      agentUtilization: {},
      performanceMetrics: {
        averageDiscoveryTime: 0,
        cacheHitRate: 0,
        successRate: 0
      }
    };
    
    this.initializeKnownCapabilities();
  }

  /**
   * Initialize known capability categories and descriptions
   */
  private initializeKnownCapabilities(): void {
    const knownCapabilities = [
      {
        name: 'text-generation',
        description: 'Generate human-like text content',
        category: 'generation',
        dataTypes: ['text']
      },
      {
        name: 'code-generation',
        description: 'Generate and review code in various programming languages',
        category: 'development',
        dataTypes: ['text', 'code']
      },
      {
        name: 'translation',
        description: 'Translate text between different languages',
        category: 'language',
        dataTypes: ['text']
      },
      {
        name: 'summarization',
        description: 'Create concise summaries of longer content',
        category: 'analysis',
        dataTypes: ['text', 'document']
      },
      {
        name: 'question-answering',
        description: 'Answer questions based on provided context',
        category: 'analysis',
        dataTypes: ['text', 'document']
      },
      {
        name: 'sentiment-analysis',
        description: 'Analyze emotional tone and sentiment in text',
        category: 'analysis',
        dataTypes: ['text']
      },
      {
        name: 'image-generation',
        description: 'Generate images from text descriptions',
        category: 'generation',
        dataTypes: ['text', 'image']
      },
      {
        name: 'image-analysis',
        description: 'Analyze and describe images',
        category: 'vision',
        dataTypes: ['image', 'text']
      },
      {
        name: 'data-analysis',
        description: 'Analyze structured and unstructured data',
        category: 'analysis',
        dataTypes: ['json', 'csv', 'text']
      },
      {
        name: 'conversation',
        description: 'Engage in natural dialogue and conversation',
        category: 'interaction',
        dataTypes: ['text']
      },
      {
        name: 'reasoning',
        description: 'Perform logical reasoning and problem solving',
        category: 'cognition',
        dataTypes: ['text']
      },
      {
        name: 'multimodal',
        description: 'Process multiple types of input simultaneously',
        category: 'integration',
        dataTypes: ['text', 'image', 'audio', 'video']
      }
    ];

    knownCapabilities.forEach(cap => {
      this.capabilityProfiles.set(cap.name, {
        capability: cap.name,
        description: cap.description,
        category: cap.category,
        dataTypes: cap.dataTypes,
        agents: [],
        metadata: {
          totalAgents: 0,
          averageConfidence: 0,
          popularProviders: [],
          lastUpdated: new Date()
        }
      });
    });
  }

  /**
   * Discover agents that match the given capability requirements
   */
  async discoverCapabilities(
    query: CapabilityQuery,
    availableAgents: AIAgent[]
  ): Promise<CapabilityMatch[]> {
    const startTime = Date.now();
    
    try {
      // Check cache first
      const cacheKey = this.generateCacheKey(query);
      const cachedResult = this.queryCache.get(cacheKey);
      
      if (cachedResult) {
        this.metrics.performanceMetrics.cacheHitRate = 
          (this.metrics.performanceMetrics.cacheHitRate * 0.9) + (1 * 0.1);
        
        logger.debug('Capability discovery cache hit', { 
          cacheKey,
          resultCount: cachedResult.length 
        });
        
        return cachedResult;
      }

      // Perform capability discovery
      const matches = await this.performCapabilityMatching(query, availableAgents);
      
      // Cache the results
      this.queryCache.set(cacheKey, matches);
      setTimeout(() => this.queryCache.delete(cacheKey), this.CACHE_TTL);
      
      // Update metrics
      const discoveryTime = Date.now() - startTime;
      this.updateMetrics(query, matches, discoveryTime, false);
      
      // Clean up cache periodically
      this.cleanupCacheIfNeeded();
      
      logger.info('Capability discovery completed', {
        query: {
          requiredCapabilities: query.requiredCapabilities,
          dataTypes: query.dataTypes,
          complexity: query.complexity
        },
        resultCount: matches.length,
        discoveryTime
      });
      
      this.emit('capabilityDiscovered', {
        query,
        matches,
        discoveryTime
      });
      
      return matches;
      
    } catch (error) {
      logger.error('Capability discovery failed', { error, query });
      throw error;
    }
  }

  /**
   * Perform the actual capability matching algorithm
   */
  private async performCapabilityMatching(
    query: CapabilityQuery,
    availableAgents: AIAgent[]
  ): Promise<CapabilityMatch[]> {
    const matches: CapabilityMatch[] = [];
    
    for (const agent of availableAgents) {
      // Skip inactive agents unless explicitly allowed
      if (agent.status !== 'active') {
        continue;
      }
      
      const match = await this.evaluateAgentMatch(agent, query);
      
      if (match.matchScore > 0) {
        matches.push(match);
      }
    }
    
    // Sort by match score (descending)
    matches.sort((a, b) => b.matchScore - a.matchScore);
    
    // Apply performance and constraint filters
    const filteredMatches = this.applyConstraintFilters(matches, query);
    
    return filteredMatches;
  }

  /**
   * Evaluate how well an agent matches the capability query
   */
  private async evaluateAgentMatch(
    agent: AIAgent, 
    query: CapabilityQuery
  ): Promise<CapabilityMatch> {
    let matchScore = 0;
    const matchedCapabilities: AgentCapability[] = [];
    const reasoning: string[] = [];
    let confidence = 0;

    // Check required capabilities
    const requiredMatches = query.requiredCapabilities.map(reqCap => {
      const agentCap = agent.capabilities.find(cap => 
        cap.name === reqCap || 
        this.isCapabilitySimilar(cap.name, reqCap)
      );
      
      if (agentCap) {
        matchedCapabilities.push(agentCap);
        matchScore += 10; // High weight for required capabilities
        reasoning.push(`Matches required capability: ${reqCap}`);
        return true;
      }
      return false;
    });
    
    const requiredMatchRatio = requiredMatches.filter(Boolean).length / query.requiredCapabilities.length;
    
    // If not all required capabilities are met, heavily penalize
    if (requiredMatchRatio < 1.0) {
      matchScore *= requiredMatchRatio;
      reasoning.push(`Missing ${(1 - requiredMatchRatio) * 100}% of required capabilities`);
    }
    
    // Check preferred capabilities
    if (query.preferredCapabilities) {
      for (const prefCap of query.preferredCapabilities) {
        const agentCap = agent.capabilities.find(cap => 
          cap.name === prefCap || 
          this.isCapabilitySimilar(cap.name, prefCap)
        );
        
        if (agentCap) {
          matchedCapabilities.push(agentCap);
          matchScore += 5; // Medium weight for preferred capabilities
          reasoning.push(`Matches preferred capability: ${prefCap}`);
        }
      }
    }
    
    // Check data type compatibility
    const dataTypeMatches = query.dataTypes.every(dataType =>
      agent.capabilities.some(cap => cap.dataTypes.includes(dataType))
    );
    
    if (dataTypeMatches) {
      matchScore += 5;
      reasoning.push('All data types supported');
    } else {
      matchScore -= 5;
      reasoning.push('Some data types not supported');
    }
    
    // Complexity matching
    const complexityScore = this.evaluateComplexityMatch(agent, query.complexity);
    matchScore += complexityScore;
    reasoning.push(`Complexity match score: ${complexityScore}`);
    
    // Context matching
    if (query.context) {
      const contextScore = this.evaluateContextMatch(agent, query.context);
      matchScore += contextScore;
      reasoning.push(`Context match score: ${contextScore}`);
    }
    
    // Provider-specific bonuses
    const providerScore = this.evaluateProviderScore(agent, query);
    matchScore += providerScore;
    reasoning.push(`Provider score: ${providerScore}`);
    
    // Calculate confidence based on various factors
    confidence = Math.min(1.0, 
      requiredMatchRatio * 0.4 +
      (matchedCapabilities.length / (agent.capabilities.length || 1)) * 0.3 +
      (agent.metadata.performance.uptime || 0.5) * 0.2 +
      Math.min(1.0, matchScore / 50) * 0.1
    );
    
    return {
      agent,
      matchScore: Math.max(0, matchScore),
      matchedCapabilities,
      reasoning,
      confidence
    };
  }

  /**
   * Check if two capabilities are similar
   */
  private isCapabilitySimilar(cap1: string, cap2: string): boolean {
    // Simple similarity check - can be enhanced with NLP
    const synonyms: Record<string, string[]> = {
      'text-generation': ['content-generation', 'writing', 'text-creation'],
      'code-generation': ['programming', 'coding', 'development'],
      'translation': ['language-translation', 'localization'],
      'summarization': ['summary', 'abstract', 'condensation'],
      'question-answering': ['qa', 'q&a', 'question-response'],
      'sentiment-analysis': ['emotion-detection', 'mood-analysis'],
      'image-generation': ['image-creation', 'visual-generation'],
      'image-analysis': ['image-understanding', 'visual-analysis', 'computer-vision'],
      'conversation': ['chat', 'dialogue', 'discussion'],
      'reasoning': ['logic', 'problem-solving', 'inference']
    };
    
    // Check direct synonyms
    const cap1Synonyms = synonyms[cap1] || [];
    const cap2Synonyms = synonyms[cap2] || [];
    
    return cap1Synonyms.includes(cap2) || 
           cap2Synonyms.includes(cap1) ||
           cap1.includes(cap2) || 
           cap2.includes(cap1);
  }

  /**
   * Evaluate how well agent complexity matches query complexity
   */
  private evaluateComplexityMatch(agent: AIAgent, queryComplexity: string): number {
    const modelComplexity = this.estimateModelComplexity(agent);
    
    const complexityMap = { low: 1, medium: 2, high: 3 };
    const agentLevel = complexityMap[modelComplexity];
    const queryLevel = complexityMap[queryComplexity as keyof typeof complexityMap];
    
    if (agentLevel === queryLevel) {
      return 3; // Perfect match
    } else if (Math.abs(agentLevel - queryLevel) === 1) {
      return 1; // Close match
    } else {
      return -2; // Poor match
    }
  }

  /**
   * Estimate model complexity based on agent properties
   */
  private estimateModelComplexity(agent: AIAgent): 'low' | 'medium' | 'high' {
    // Simple heuristic - can be enhanced
    if (agent.model.includes('gpt-4') || agent.model.includes('claude-3')) {
      return 'high';
    } else if (agent.model.includes('gpt-3.5') || agent.model.includes('gemini-pro')) {
      return 'medium';
    } else {
      return 'low';
    }
  }

  /**
   * Evaluate context matching
   */
  private evaluateContextMatch(agent: AIAgent, context: NonNullable<CapabilityQuery['context']>): number {
    let score = 0;
    
    // Domain matching
    if (context.domain) {
      if (agent.metadata.tags.includes(context.domain)) {
        score += 3;
      } else if (agent.category === context.domain) {
        score += 2;
      }
    }
    
    // Language matching
    if (context.language) {
      // Assume all agents support English, check for other languages
      if (context.language === 'en' || agent.metadata.tags.includes('multilingual')) {
        score += 1;
      }
    }
    
    // Format matching
    if (context.format) {
      if (agent.capabilities.some(cap => cap.dataTypes.includes(context.format!))) {
        score += 2;
      }
    }
    
    return score;
  }

  /**
   * Evaluate provider-specific scoring
   */
  private evaluateProviderScore(agent: AIAgent, query: CapabilityQuery): number {
    let score = 0;
    
    // Provider reputation (simplified)
    const providerScores: Record<string, number> = {
      'openai': 5,
      'claude': 4,
      'gemini': 3,
      'ollama': 2
    };
    
    score += providerScores[agent.provider] || 0;
    
    // Performance-based scoring
    if (agent.metadata.performance.uptime && agent.metadata.performance.uptime > 0.99) {
      score += 2;
    }
    
    if (agent.metadata.performance.accuracy && agent.metadata.performance.accuracy > 0.9) {
      score += 2;
    }
    
    return score;
  }

  /**
   * Apply constraint filters to matches
   */
  private applyConstraintFilters(
    matches: CapabilityMatch[], 
    query: CapabilityQuery
  ): CapabilityMatch[] {
    let filteredMatches = [...matches];
    
    if (query.performance) {
      // Filter by latency
      if (query.performance.maxLatency) {
        filteredMatches = filteredMatches.filter(match =>
          match.agent.metadata.performance.averageResponseTime <= query.performance!.maxLatency!
        );
      }
      
      // Filter by accuracy
      if (query.performance.minAccuracy) {
        filteredMatches = filteredMatches.filter(match =>
          (match.agent.metadata.performance.accuracy || 0) >= query.performance!.minAccuracy!
        );
      }
      
      // Filter by cost (if pricing info available)
      if (query.performance.maxCost && match.agent.metadata.pricing) {
        filteredMatches = filteredMatches.filter(match =>
          (match.agent.metadata.pricing?.cost || 0) <= query.performance!.maxCost!
        );
      }
    }
    
    return filteredMatches;
  }

  /**
   * Generate cache key for query
   */
  private generateCacheKey(query: CapabilityQuery): string {
    const keyData = {
      required: query.requiredCapabilities.sort(),
      preferred: query.preferredCapabilities?.sort() || [],
      dataTypes: query.dataTypes.sort(),
      complexity: query.complexity,
      context: query.context || {},
      performance: query.performance || {}
    };
    
    return Buffer.from(JSON.stringify(keyData)).toString('base64');
  }

  /**
   * Update discovery metrics
   */
  private updateMetrics(
    query: CapabilityQuery,
    matches: CapabilityMatch[],
    discoveryTime: number,
    wasCacheHit: boolean
  ): void {
    this.metrics.totalQueries++;
    
    // Update average match score
    const averageMatchScore = matches.length > 0 
      ? matches.reduce((sum, match) => sum + match.matchScore, 0) / matches.length
      : 0;
    
    this.metrics.averageMatchScore = 
      (this.metrics.averageMatchScore * 0.9) + (averageMatchScore * 0.1);
    
    // Update top capabilities
    for (const cap of query.requiredCapabilities) {
      this.metrics.topCapabilities[cap] = (this.metrics.topCapabilities[cap] || 0) + 1;
    }
    
    // Update agent utilization
    for (const match of matches) {
      const agentKey = `${match.agent.provider}:${match.agent.model}`;
      this.metrics.agentUtilization[agentKey] = (this.metrics.agentUtilization[agentKey] || 0) + 1;
    }
    
    // Update performance metrics
    this.metrics.performanceMetrics.averageDiscoveryTime = 
      (this.metrics.performanceMetrics.averageDiscoveryTime * 0.9) + (discoveryTime * 0.1);
    
    if (!wasCacheHit) {
      this.metrics.performanceMetrics.cacheHitRate = 
        (this.metrics.performanceMetrics.cacheHitRate * 0.9) + (0 * 0.1);
    }
    
    this.metrics.performanceMetrics.successRate = 
      (this.metrics.performanceMetrics.successRate * 0.9) + ((matches.length > 0 ? 1 : 0) * 0.1);
  }

  /**
   * Clean up cache periodically
   */
  private cleanupCacheIfNeeded(): void {
    const now = Date.now();
    if (now - this.lastCacheCleanup > this.CACHE_CLEANUP_INTERVAL) {
      const initialSize = this.queryCache.size;
      
      // Clear all cache entries (they have individual TTL)
      // In a more sophisticated implementation, you'd check individual TTLs
      this.queryCache.clear();
      
      this.lastCacheCleanup = now;
      
      logger.debug('Cache cleanup performed', {
        entriesRemoved: initialSize,
        currentSize: this.queryCache.size
      });
    }
  }

  /**
   * Update capability profiles based on agent registry changes
   */
  async updateCapabilityProfiles(agents: AIAgent[]): Promise<void> {
    // Reset agent lists in profiles
    this.capabilityProfiles.forEach(profile => {
      profile.agents = [];
    });
    
    // Rebuild profiles from current agents
    for (const agent of agents) {
      if (agent.status !== 'active') {
        continue;
      }
      
      for (const capability of agent.capabilities) {
        let profile = this.capabilityProfiles.get(capability.name);
        
        if (!profile) {
          // Create new profile for unknown capability
          profile = {
            capability: capability.name,
            description: capability.description,
            category: 'custom',
            dataTypes: capability.dataTypes,
            agents: [],
            metadata: {
              totalAgents: 0,
              averageConfidence: 0,
              popularProviders: [],
              lastUpdated: new Date()
            }
          };
          this.capabilityProfiles.set(capability.name, profile);
        }
        
        // Add agent to profile
        profile.agents.push({
          agentId: agent.id,
          agentName: agent.name,
          provider: agent.provider,
          confidence: 0.8, // Default confidence - could be calculated
          performance: {
            averageLatency: agent.metadata.performance.averageResponseTime,
            accuracy: agent.metadata.performance.accuracy || 0.8,
            cost: agent.metadata.pricing?.cost || 0.01
          }
        });
      }
    }
    
    // Update profile metadata
    this.capabilityProfiles.forEach(profile => {
      profile.metadata.totalAgents = profile.agents.length;
      profile.metadata.averageConfidence = profile.agents.length > 0
        ? profile.agents.reduce((sum, agent) => sum + agent.confidence, 0) / profile.agents.length
        : 0;
      
      // Find popular providers
      const providerCounts: Record<string, number> = {};
      profile.agents.forEach(agent => {
        providerCounts[agent.provider] = (providerCounts[agent.provider] || 0) + 1;
      });
      
      profile.metadata.popularProviders = Object.entries(providerCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([provider]) => provider);
      
      profile.metadata.lastUpdated = new Date();
    });
    
    logger.info('Capability profiles updated', {
      profileCount: this.capabilityProfiles.size,
      totalAgents: agents.length
    });
    
    this.emit('capabilityProfilesUpdated', {
      profileCount: this.capabilityProfiles.size,
      agents: agents.length
    });
  }

  /**
   * Get capability profile by name
   */
  getCapabilityProfile(capabilityName: string): CapabilityProfile | null {
    return this.capabilityProfiles.get(capabilityName) || null;
  }

  /**
   * Get all capability profiles
   */
  getAllCapabilityProfiles(): CapabilityProfile[] {
    return Array.from(this.capabilityProfiles.values());
  }

  /**
   * Get discovery metrics
   */
  getDiscoveryMetrics(): DiscoveryMetrics {
    return { ...this.metrics };
  }

  /**
   * Clear cache manually
   */
  clearCache(): void {
    this.queryCache.clear();
    logger.info('Capability discovery cache cleared');
  }

  /**
   * Get capability recommendations for a given context
   */
  async getCapabilityRecommendations(context: {
    domain?: string;
    useCase?: string;
    dataTypes?: string[];
    performance?: 'speed' | 'accuracy' | 'cost';
  }): Promise<string[]> {
    const recommendations: string[] = [];
    
    // Domain-specific recommendations
    const domainCapabilities: Record<string, string[]> = {
      'content': ['text-generation', 'summarization', 'translation'],
      'development': ['code-generation', 'debugging', 'documentation'],
      'analysis': ['data-analysis', 'sentiment-analysis', 'question-answering'],
      'creative': ['image-generation', 'text-generation', 'multimodal'],
      'support': ['conversation', 'question-answering', 'sentiment-analysis']
    };
    
    if (context.domain && domainCapabilities[context.domain]) {
      recommendations.push(...domainCapabilities[context.domain]);
    }
    
    // Data type-specific recommendations
    if (context.dataTypes) {
      if (context.dataTypes.includes('image')) {
        recommendations.push('image-analysis', 'image-generation', 'multimodal');
      }
      if (context.dataTypes.includes('text')) {
        recommendations.push('text-generation', 'summarization', 'translation');
      }
      if (context.dataTypes.includes('code')) {
        recommendations.push('code-generation', 'debugging');
      }
    }
    
    // Performance-specific recommendations
    if (context.performance === 'speed') {
      // Recommend faster models (simplified)
      const profiles = Array.from(this.capabilityProfiles.values())
        .filter(p => p.agents.some(a => a.performance.averageLatency < 2000))
        .map(p => p.capability);
      recommendations.push(...profiles);
    }
    
    // Remove duplicates and return top recommendations
    return [...new Set(recommendations)].slice(0, 10);
  }
}

