
import { PrismaClient, AIAgent } from '@prisma/client'
import { logger } from '@ai-platform/shared-utils'

const prisma = new PrismaClient()

export interface AgentHealth {
  id: string
  name: string
  status: 'healthy' | 'degraded' | 'unhealthy' | 'offline'
  responseTime: number
  errorRate: number
  lastHealthCheck: Date
  consecutiveFailures: number
}

export interface AgentLoadInfo {
  id: string
  currentLoad: number
  maxConcurrency: number
  queueLength: number
  averageResponseTime: number
  requestsPerMinute: number
}

export interface AgentPoolStats {
  totalAgents: number
  healthyAgents: number
  degradedAgents: number
  unhealthyAgents: number
  offlineAgents: number
  averageLoad: number
  totalCapacity: number
  utilizationRate: number
}

export class AgentPoolService {
  private agentHealthMap = new Map<string, AgentHealth>()
  private agentLoadMap = new Map<string, AgentLoadInfo>()
  private healthCheckInterval: NodeJS.Timeout | null = null

  constructor() {
    this.initializeHealthMonitoring()
  }

  // Initialize health monitoring system
  private initializeHealthMonitoring() {
    // Start periodic health checks every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks()
    }, 30000)

    logger.info('Agent pool health monitoring initialized')
  }

  // Get all available agents from the pool
  async getAvailableAgents(): Promise<any[]> {
    try {
      const agents = await prisma.aIAgent.findMany({
        where: {
          isActive: true
        },
        include: {
          _count: {
            select: {
              aiRequests: true
            }
          }
        }
      })

      // Enhance agents with health and load information
      const enhancedAgents = agents.map(agent => {
        const health = this.agentHealthMap.get(agent.id) || {
          id: agent.id,
          name: agent.name,
          status: 'healthy',
          responseTime: 1000,
          errorRate: 0,
          lastHealthCheck: new Date(),
          consecutiveFailures: 0
        }

        const load = this.agentLoadMap.get(agent.id) || {
          id: agent.id,
          currentLoad: 0,
          maxConcurrency: this.getMaxConcurrency(agent.provider),
          queueLength: 0,
          averageResponseTime: this.getAverageResponseTime(agent.provider),
          requestsPerMinute: 0
        }

        return {
          id: agent.id,
          name: agent.name,
          provider: agent.provider,
          model: agent.model,
          capabilities: this.parseCapabilities(agent.capabilities),
          costPerToken: agent.costPerToken,
          maxTokens: agent.maxTokens,
          isActive: agent.isActive,
          totalRequests: agent._count.aiRequests,
          health,
          load,
          averageResponseTime: load.averageResponseTime,
          isAvailable: this.isAgentAvailable(health, load)
        }
      })

      // Filter only available agents
      return enhancedAgents.filter(agent => agent.isAvailable)

    } catch (error) {
      logger.error('Error getting available agents', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to get available agents')
    }
  }

  // Get agent by ID with detailed information
  async getAgentById(agentId: string): Promise<any | null> {
    try {
      const agent = await prisma.aIAgent.findUnique({
        where: { id: agentId },
        include: {
          _count: {
            select: {
              aiRequests: true
            }
          }
        }
      })

      if (!agent) {
        return null
      }

      const health = this.agentHealthMap.get(agent.id)
      const load = this.agentLoadMap.get(agent.id)

      return {
        ...agent,
        capabilities: this.parseCapabilities(agent.capabilities),
        health,
        load,
        isAvailable: health && load ? this.isAgentAvailable(health, load) : false
      }

    } catch (error) {
      logger.error('Error getting agent by ID', {
        agentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to get agent information')
    }
  }

  // Add new agent to the pool
  async addAgent(agentData: {
    name: string
    provider: string
    model: string
    capabilities: string[]
    costPerToken: number
    maxTokens: number
    apiEndpoint?: string
    apiKey?: string
  }) {
    try {
      const newAgent = await prisma.aIAgent.create({
        data: {
          name: agentData.name,
          provider: agentData.provider,
          model: agentData.model,
          capabilities: JSON.stringify(agentData.capabilities),
          costPerToken: agentData.costPerToken,
          maxTokens: agentData.maxTokens,
          apiEndpoint: agentData.apiEndpoint,
          apiKey: agentData.apiKey,
          isActive: true
        }
      })

      // Initialize health and load tracking
      this.initializeAgentMonitoring(newAgent.id, newAgent.name, newAgent.provider)

      logger.info('New agent added to pool', {
        agentId: newAgent.id,
        name: newAgent.name,
        provider: newAgent.provider,
        model: newAgent.model
      })

      return newAgent

    } catch (error) {
      logger.error('Error adding agent to pool', {
        name: agentData.name,
        provider: agentData.provider,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to add agent to pool')
    }
  }

  // Remove agent from the pool
  async removeAgent(agentId: string): Promise<boolean> {
    try {
      await prisma.aIAgent.update({
        where: { id: agentId },
        data: { isActive: false }
      })

      // Remove from monitoring maps
      this.agentHealthMap.delete(agentId)
      this.agentLoadMap.delete(agentId)

      logger.info('Agent removed from pool', { agentId })
      return true

    } catch (error) {
      logger.error('Error removing agent from pool', {
        agentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return false
    }
  }

  // Update agent load (increment when request starts)
  async incrementAgentLoad(agentId: string): Promise<void> {
    const load = this.agentLoadMap.get(agentId)
    if (load) {
      load.currentLoad++
      load.requestsPerMinute++
      this.agentLoadMap.set(agentId, load)
    }
  }

  // Decrement agent load (when request completes)
  async decrementAgentLoad(agentId: string, responseTime: number): Promise<void> {
    const load = this.agentLoadMap.get(agentId)
    if (load) {
      load.currentLoad = Math.max(0, load.currentLoad - 1)
      
      // Update moving average for response time
      load.averageResponseTime = (load.averageResponseTime * 0.8) + (responseTime * 0.2)
      
      this.agentLoadMap.set(agentId, load)
    }
  }

  // Get agents by capability
  async getAgentsByCapability(capability: string): Promise<any[]> {
    try {
      const availableAgents = await this.getAvailableAgents()
      return availableAgents.filter(agent => 
        agent.capabilities.includes(capability)
      )
    } catch (error) {
      logger.error('Error getting agents by capability', {
        capability,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to get agents by capability')
    }
  }

  // Get agents by provider
  async getAgentsByProvider(provider: string): Promise<any[]> {
    try {
      const availableAgents = await this.getAvailableAgents()
      return availableAgents.filter(agent => agent.provider === provider)
    } catch (error) {
      logger.error('Error getting agents by provider', {
        provider,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to get agents by provider')
    }
  }

  // Get pool statistics
  async getPoolStats(): Promise<AgentPoolStats> {
    try {
      const allAgents = await prisma.aIAgent.findMany({
        where: { isActive: true }
      })

      let healthyAgents = 0
      let degradedAgents = 0
      let unhealthyAgents = 0
      let offlineAgents = 0
      let totalLoad = 0
      let totalCapacity = 0

      allAgents.forEach(agent => {
        const health = this.agentHealthMap.get(agent.id)
        const load = this.agentLoadMap.get(agent.id)

        if (health) {
          switch (health.status) {
            case 'healthy': healthyAgents++; break
            case 'degraded': degradedAgents++; break
            case 'unhealthy': unhealthyAgents++; break
            case 'offline': offlineAgents++; break
          }
        } else {
          offlineAgents++
        }

        if (load) {
          totalLoad += load.currentLoad
          totalCapacity += load.maxConcurrency
        }
      })

      return {
        totalAgents: allAgents.length,
        healthyAgents,
        degradedAgents,
        unhealthyAgents,
        offlineAgents,
        averageLoad: totalCapacity > 0 ? totalLoad / allAgents.length : 0,
        totalCapacity,
        utilizationRate: totalCapacity > 0 ? (totalLoad / totalCapacity) * 100 : 0
      }

    } catch (error) {
      logger.error('Error getting pool statistics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to get pool statistics')
    }
  }

  // Perform health checks on all agents
  private async performHealthChecks(): Promise<void> {
    try {
      const agents = await prisma.aIAgent.findMany({
        where: { isActive: true }
      })

      const healthCheckPromises = agents.map(agent => 
        this.checkAgentHealth(agent.id, agent.name, agent.provider, agent.apiEndpoint)
      )

      await Promise.allSettled(healthCheckPromises)
      
      // Reset requests per minute counter
      this.agentLoadMap.forEach((load, agentId) => {
        load.requestsPerMinute = 0
        this.agentLoadMap.set(agentId, load)
      })

    } catch (error) {
      logger.error('Error performing health checks', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  // Check individual agent health
  private async checkAgentHealth(
    agentId: string, 
    name: string, 
    provider: string, 
    apiEndpoint?: string
  ): Promise<void> {
    const startTime = Date.now()
    let status: AgentHealth['status'] = 'healthy'
    let errorRate = 0

    try {
      // Simulate health check based on provider
      await this.simulateProviderHealthCheck(provider, apiEndpoint)
      
    } catch (error) {
      status = 'unhealthy'
      errorRate = 1.0
    }

    const responseTime = Date.now() - startTime
    const existingHealth = this.agentHealthMap.get(agentId)

    // Update health information
    const health: AgentHealth = {
      id: agentId,
      name,
      status,
      responseTime,
      errorRate,
      lastHealthCheck: new Date(),
      consecutiveFailures: status === 'unhealthy' 
        ? (existingHealth?.consecutiveFailures || 0) + 1
        : 0
    }

    // Determine status based on consecutive failures
    if (health.consecutiveFailures >= 3) {
      health.status = 'offline'
    } else if (health.consecutiveFailures >= 1) {
      health.status = 'degraded'
    }

    this.agentHealthMap.set(agentId, health)
  }

  // Simulate provider health check
  private async simulateProviderHealthCheck(provider: string, apiEndpoint?: string): Promise<void> {
    // Simulate different response times and failure rates for different providers
    const providerConfigs = {
      openai: { avgResponseTime: 500, failureRate: 0.01 },
      anthropic: { avgResponseTime: 600, failureRate: 0.02 },
      google: { avgResponseTime: 400, failureRate: 0.01 },
      ollama: { avgResponseTime: 200, failureRate: 0.05 }
    }

    const config = providerConfigs[provider as keyof typeof providerConfigs] || 
                  providerConfigs.openai

    // Simulate response time
    await new Promise(resolve => 
      setTimeout(resolve, config.avgResponseTime + (Math.random() * 200))
    )

    // Simulate failure
    if (Math.random() < config.failureRate) {
      throw new Error(`Health check failed for ${provider}`)
    }
  }

  // Initialize monitoring for a new agent
  private initializeAgentMonitoring(agentId: string, name: string, provider: string): void {
    this.agentHealthMap.set(agentId, {
      id: agentId,
      name,
      status: 'healthy',
      responseTime: this.getAverageResponseTime(provider),
      errorRate: 0,
      lastHealthCheck: new Date(),
      consecutiveFailures: 0
    })

    this.agentLoadMap.set(agentId, {
      id: agentId,
      currentLoad: 0,
      maxConcurrency: this.getMaxConcurrency(provider),
      queueLength: 0,
      averageResponseTime: this.getAverageResponseTime(provider),
      requestsPerMinute: 0
    })
  }

  // Get max concurrency based on provider
  private getMaxConcurrency(provider: string): number {
    const concurrencyMap = {
      openai: 50,
      anthropic: 30,
      google: 40,
      ollama: 10
    }
    return concurrencyMap[provider as keyof typeof concurrencyMap] || 20
  }

  // Get average response time based on provider
  private getAverageResponseTime(provider: string): number {
    const responseTimeMap = {
      openai: 1000,
      anthropic: 1200,
      google: 800,
      ollama: 500
    }
    return responseTimeMap[provider as keyof typeof responseTimeMap] || 1000
  }

  // Parse capabilities from JSON string
  private parseCapabilities(capabilities: string | null): string[] {
    if (!capabilities) return []
    try {
      return JSON.parse(capabilities)
    } catch {
      return []
    }
  }

  // Check if agent is available for requests
  private isAgentAvailable(health: AgentHealth, load: AgentLoadInfo): boolean {
    return health.status === 'healthy' || health.status === 'degraded' &&
           load.currentLoad < load.maxConcurrency
  }

  // Health check for the entire pool service
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy'
    details: Record<string, any>
  }> {
    try {
      const stats = await this.getPoolStats()
      
      const healthyRatio = stats.healthyAgents / stats.totalAgents
      let status: 'healthy' | 'degraded' | 'unhealthy'

      if (healthyRatio >= 0.8) {
        status = 'healthy'
      } else if (healthyRatio >= 0.5) {
        status = 'degraded'
      } else {
        status = 'unhealthy'
      }

      return {
        status,
        details: {
          ...stats,
          healthyRatio: `${(healthyRatio * 100).toFixed(1)}%`,
          monitoringActive: this.healthCheckInterval !== null
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

  // Cleanup monitoring resources
  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
    
    this.agentHealthMap.clear()
    this.agentLoadMap.clear()
    
    logger.info('Agent pool service destroyed')
  }
}
