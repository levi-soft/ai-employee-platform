
import { logger } from '@ai-platform/shared-utils'

export interface CapabilityMatch {
  agentId: string
  matchScore: number
  matchedCapabilities: string[]
  missingCapabilities: string[]
  extraCapabilities: string[]
}

export interface CapabilityRequirement {
  capability: string
  importance: 'required' | 'preferred' | 'optional'
  weight: number
}

export class CapabilityMatcher {
  private capabilityHierarchy: Record<string, string[]> = {}
  private capabilityWeights: Record<string, number> = {}

  constructor() {
    this.initializeCapabilityMappings()
  }

  // Initialize capability hierarchy and weights
  private initializeCapabilityMappings(): void {
    // Define capability hierarchy (parent -> children relationships)
    this.capabilityHierarchy = {
      'text-generation': ['creative-writing', 'technical-writing', 'code-generation', 'translation'],
      'analysis': ['data-analysis', 'sentiment-analysis', 'content-analysis', 'code-analysis'],
      'reasoning': ['logical-reasoning', 'mathematical-reasoning', 'problem-solving'],
      'conversation': ['chat', 'dialogue', 'qa', 'customer-support'],
      'multimodal': ['image-understanding', 'image-generation', 'document-analysis'],
      'specialized': ['legal-analysis', 'medical-analysis', 'financial-analysis', 'research']
    }

    // Define capability weights (higher = more important/complex)
    this.capabilityWeights = {
      // Text generation capabilities
      'text-generation': 1.0,
      'creative-writing': 1.2,
      'technical-writing': 1.3,
      'code-generation': 1.5,
      'translation': 1.1,
      
      // Analysis capabilities
      'analysis': 1.0,
      'data-analysis': 1.4,
      'sentiment-analysis': 1.1,
      'content-analysis': 1.2,
      'code-analysis': 1.4,
      
      // Reasoning capabilities
      'reasoning': 1.3,
      'logical-reasoning': 1.4,
      'mathematical-reasoning': 1.5,
      'problem-solving': 1.3,
      
      // Conversation capabilities
      'conversation': 0.9,
      'chat': 0.8,
      'dialogue': 0.9,
      'qa': 1.0,
      'customer-support': 1.1,
      
      // Multimodal capabilities
      'multimodal': 1.6,
      'image-understanding': 1.5,
      'image-generation': 1.7,
      'document-analysis': 1.4,
      
      // Specialized capabilities
      'specialized': 1.8,
      'legal-analysis': 2.0,
      'medical-analysis': 2.0,
      'financial-analysis': 1.8,
      'research': 1.6
    }

    logger.info('Capability matching system initialized', {
      hierarchyCount: Object.keys(this.capabilityHierarchy).length,
      totalCapabilities: Object.keys(this.capabilityWeights).length
    })
  }

  // Filter agents by required capabilities
  async filterByCapabilities(agents: any[], requiredCapabilities: string[]): Promise<any[]> {
    if (requiredCapabilities.length === 0) {
      return agents
    }

    const filteredAgents = agents.filter(agent => {
      const agentCapabilities = agent.capabilities || []
      return this.hasRequiredCapabilities(agentCapabilities, requiredCapabilities)
    })

    logger.info('Agents filtered by capabilities', {
      originalCount: agents.length,
      filteredCount: filteredAgents.length,
      requiredCapabilities
    })

    return filteredAgents
  }

  // Calculate capability matching score for an agent
  async calculateCapabilityScore(agent: any, requestedCapabilities: string[]): Promise<number> {
    if (requestedCapabilities.length === 0) {
      return 100 // Perfect score if no specific capabilities requested
    }

    const agentCapabilities = agent.capabilities || []
    const match = this.matchCapabilities(agentCapabilities, requestedCapabilities)
    
    const score = this.calculateMatchScore(match, requestedCapabilities.length)
    
    logger.debug('Capability score calculated', {
      agentId: agent.id,
      agentName: agent.name,
      score,
      matchedCount: match.matchedCapabilities.length,
      missingCount: match.missingCapabilities.length
    })

    return score
  }

  // Match capabilities between agent and request
  private matchCapabilities(agentCapabilities: string[], requestedCapabilities: string[]): CapabilityMatch {
    const matchedCapabilities: string[] = []
    const missingCapabilities: string[] = []
    const extraCapabilities: string[] = []

    // Find direct matches and hierarchical matches
    requestedCapabilities.forEach(requested => {
      const hasDirectMatch = agentCapabilities.includes(requested)
      const hasHierarchicalMatch = this.hasHierarchicalMatch(agentCapabilities, requested)

      if (hasDirectMatch || hasHierarchicalMatch) {
        matchedCapabilities.push(requested)
      } else {
        missingCapabilities.push(requested)
      }
    })

    // Find extra capabilities the agent has
    agentCapabilities.forEach(agentCap => {
      if (!requestedCapabilities.includes(agentCap) && 
          !this.isHierarchicalMatch(requestedCapabilities, agentCap)) {
        extraCapabilities.push(agentCap)
      }
    })

    const matchScore = this.calculateRawMatchScore(
      matchedCapabilities,
      missingCapabilities,
      extraCapabilities
    )

    return {
      agentId: '',
      matchScore,
      matchedCapabilities,
      missingCapabilities,
      extraCapabilities
    }
  }

  // Check if agent has required capabilities (with hierarchy support)
  private hasRequiredCapabilities(agentCapabilities: string[], requiredCapabilities: string[]): boolean {
    return requiredCapabilities.every(required => {
      return agentCapabilities.includes(required) || 
             this.hasHierarchicalMatch(agentCapabilities, required)
    })
  }

  // Check for hierarchical capability match
  private hasHierarchicalMatch(agentCapabilities: string[], requestedCapability: string): boolean {
    // Check if agent has parent capability that includes requested capability
    for (const [parent, children] of Object.entries(this.capabilityHierarchy)) {
      if (children.includes(requestedCapability) && agentCapabilities.includes(parent)) {
        return true
      }
    }

    // Check if requested capability is a parent and agent has specific children
    const childCapabilities = this.capabilityHierarchy[requestedCapability] || []
    return childCapabilities.some(child => agentCapabilities.includes(child))
  }

  // Check if capability is hierarchically related
  private isHierarchicalMatch(requestedCapabilities: string[], agentCapability: string): boolean {
    return requestedCapabilities.some(requested => {
      return this.hasHierarchicalMatch([agentCapability], requested)
    })
  }

  // Calculate raw match score based on matched, missing, and extra capabilities
  private calculateRawMatchScore(
    matched: string[],
    missing: string[],
    extra: string[]
  ): number {
    let score = 0

    // Add points for matched capabilities (weighted by importance)
    matched.forEach(capability => {
      const weight = this.capabilityWeights[capability] || 1.0
      score += 20 * weight
    })

    // Subtract points for missing capabilities (critical penalty)
    missing.forEach(capability => {
      const weight = this.capabilityWeights[capability] || 1.0
      score -= 30 * weight
    })

    // Small bonus for extra capabilities (shows versatility)
    extra.forEach(capability => {
      const weight = this.capabilityWeights[capability] || 1.0
      score += 2 * weight
    })

    return Math.max(0, score)
  }

  // Calculate final match score (0-100)
  private calculateMatchScore(match: CapabilityMatch, totalRequested: number): number {
    if (totalRequested === 0) return 100

    const baseScore = (match.matchedCapabilities.length / totalRequested) * 100
    
    // Apply penalty for missing critical capabilities
    const missingPenalty = match.missingCapabilities.length * 20
    
    // Apply small bonus for extra capabilities
    const extraBonus = Math.min(match.extraCapabilities.length * 2, 10)
    
    const finalScore = Math.max(0, Math.min(100, baseScore - missingPenalty + extraBonus))
    
    return Math.round(finalScore * 100) / 100
  }

  // Get optimal agents for specific capabilities
  async getOptimalAgentsForCapabilities(agents: any[], capabilities: string[]): Promise<any[]> {
    const scoredAgents = await Promise.all(
      agents.map(async agent => {
        const score = await this.calculateCapabilityScore(agent, capabilities)
        return { ...agent, capabilityScore: score }
      })
    )

    return scoredAgents
      .filter(agent => agent.capabilityScore >= 70) // Only high-scoring agents
      .sort((a, b) => b.capabilityScore - a.capabilityScore)
  }

  // Analyze capability gaps in the agent pool
  async analyzeCapabilityGaps(agents: any[]): Promise<{
    wellCoveredCapabilities: string[]
    underCoveredCapabilities: string[]
    missingCapabilities: string[]
    recommendedAgents: string[]
  }> {
    const allKnownCapabilities = Object.keys(this.capabilityWeights)
    const agentCapabilities = new Set<string>()
    const capabilityCoverage: Record<string, number> = {}

    // Collect all agent capabilities
    agents.forEach(agent => {
      const capabilities = agent.capabilities || []
      capabilities.forEach((cap: string) => {
        agentCapabilities.add(cap)
        capabilityCoverage[cap] = (capabilityCoverage[cap] || 0) + 1
      })
    })

    // Categorize capabilities by coverage
    const wellCovered: string[] = []
    const underCovered: string[] = []
    const missing: string[] = []

    allKnownCapabilities.forEach(capability => {
      const coverage = capabilityCoverage[capability] || 0
      
      if (coverage === 0) {
        missing.push(capability)
      } else if (coverage < 2) {
        underCovered.push(capability)
      } else {
        wellCovered.push(capability)
      }
    })

    // Recommend agent types based on gaps
    const recommendedAgents = this.generateAgentRecommendations(missing, underCovered)

    logger.info('Capability gap analysis completed', {
      totalAgents: agents.length,
      wellCovered: wellCovered.length,
      underCovered: underCovered.length,
      missing: missing.length,
      recommendations: recommendedAgents.length
    })

    return {
      wellCoveredCapabilities: wellCovered,
      underCoveredCapabilities: underCovered,
      missingCapabilities: missing,
      recommendedAgents
    }
  }

  // Generate agent recommendations based on capability gaps
  private generateAgentRecommendations(missing: string[], underCovered: string[]): string[] {
    const recommendations: string[] = []

    // Recommend agents for missing capabilities
    const highPriorityMissing = missing.filter(cap => 
      (this.capabilityWeights[cap] || 1.0) >= 1.5
    )

    highPriorityMissing.forEach(capability => {
      switch (capability) {
        case 'code-generation':
          recommendations.push('Specialized coding agent (e.g., Claude-3 or GPT-4 with code focus)')
          break
        case 'mathematical-reasoning':
          recommendations.push('Mathematical reasoning specialist (e.g., GPT-4 with math plugins)')
          break
        case 'image-generation':
          recommendations.push('Image generation model (e.g., DALL-E, Midjourney API)')
          break
        case 'legal-analysis':
          recommendations.push('Legal-specialized LLM with legal training data')
          break
        case 'medical-analysis':
          recommendations.push('Medical-domain specialized model with safety guardrails')
          break
        default:
          recommendations.push(`Specialized agent for ${capability}`)
      }
    })

    return recommendations
  }

  // Get capability requirements analysis
  async getCapabilityRequirements(description: string): Promise<CapabilityRequirement[]> {
    const requirements: CapabilityRequirement[] = []
    const keywords = description.toLowerCase()

    // Analyze description for capability keywords
    const capabilityKeywords: Record<string, string[]> = {
      'code-generation': ['code', 'programming', 'develop', 'script', 'function', 'algorithm'],
      'analysis': ['analyze', 'review', 'examine', 'study', 'investigate'],
      'creative-writing': ['write', 'create', 'story', 'creative', 'content'],
      'translation': ['translate', 'language', 'convert'],
      'mathematical-reasoning': ['math', 'calculate', 'solve', 'equation', 'formula'],
      'conversation': ['chat', 'talk', 'discuss', 'conversation'],
      'research': ['research', 'find', 'information', 'data', 'facts']
    }

    // Determine required capabilities based on keywords
    Object.entries(capabilityKeywords).forEach(([capability, words]) => {
      const matchCount = words.filter(word => keywords.includes(word)).length
      
      if (matchCount > 0) {
        const importance = matchCount >= 2 ? 'required' : 'preferred'
        const weight = (this.capabilityWeights[capability] || 1.0) * matchCount
        
        requirements.push({
          capability,
          importance,
          weight
        })
      }
    })

    // Sort by weight (descending)
    requirements.sort((a, b) => b.weight - a.weight)

    return requirements
  }

  // Validate agent capabilities format
  validateCapabilities(capabilities: string[]): {
    valid: string[]
    invalid: string[]
    warnings: string[]
  } {
    const valid: string[] = []
    const invalid: string[] = []
    const warnings: string[] = []

    capabilities.forEach(capability => {
      const normalized = capability.toLowerCase().trim()
      
      if (!normalized) {
        invalid.push(capability)
        return
      }

      // Check if it's a known capability
      if (this.capabilityWeights.hasOwnProperty(normalized)) {
        valid.push(normalized)
      } else {
        // Check if it might be a hierarchical match
        const hasHierarchicalMatch = Object.values(this.capabilityHierarchy)
          .some(children => children.includes(normalized))
        
        if (hasHierarchicalMatch) {
          valid.push(normalized)
        } else {
          warnings.push(`Unknown capability: ${capability}`)
          valid.push(normalized) // Include it anyway but with warning
        }
      }
    })

    return { valid, invalid, warnings }
  }
}
