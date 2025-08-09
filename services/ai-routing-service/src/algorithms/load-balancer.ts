
import { logger } from '@ai-platform/shared-utils'

export interface LoadBalancingStrategy {
  name: string
  description: string
  calculate: (agents: any[]) => any[]
}

export interface LoadMetrics {
  agentId: string
  currentLoad: number
  averageResponseTime: number
  successRate: number
  queueLength: number
  lastUpdated: Date
}

export class LoadBalancer {
  private requestQueues = new Map<string, any[]>()
  private responseTimeHistory = new Map<string, number[]>()
  private strategies: Record<string, LoadBalancingStrategy>

  constructor() {
    this.initializeStrategies()
    logger.info('Load balancer initialized')
  }

  // Initialize load balancing strategies
  private initializeStrategies(): void {
    this.strategies = {
      'round-robin': {
        name: 'Round Robin',
        description: 'Distribute requests evenly across all agents',
        calculate: this.roundRobinBalance.bind(this)
      },
      'least-connections': {
        name: 'Least Connections',
        description: 'Route to agent with fewest active connections',
        calculate: this.leastConnectionsBalance.bind(this)
      },
      'weighted-round-robin': {
        name: 'Weighted Round Robin',
        description: 'Distribute based on agent capacity and performance',
        calculate: this.weightedRoundRobinBalance.bind(this)
      },
      'response-time': {
        name: 'Response Time Based',
        description: 'Route to agent with best response time',
        calculate: this.responseTimeBalance.bind(this)
      },
      'adaptive': {
        name: 'Adaptive Load Balancing',
        description: 'Dynamic routing based on multiple factors',
        calculate: this.adaptiveBalance.bind(this)
      }
    }
  }

  // Main load balancing function
  async balanceLoad(agents: any[], priority: string = 'normal'): Promise<any[]> {
    if (agents.length === 0) {
      return []
    }

    try {
      // Choose strategy based on priority and current conditions
      const strategyName = this.selectStrategy(agents, priority)
      const strategy = this.strategies[strategyName]
      
      if (!strategy) {
        logger.warn('Invalid strategy, falling back to least-connections', { strategyName })
        return this.leastConnectionsBalance(agents)
      }

      const balancedAgents = strategy.calculate(agents)

      logger.debug('Load balancing completed', {
        strategy: strategyName,
        inputAgents: agents.length,
        outputAgents: balancedAgents.length,
        priority
      })

      return balancedAgents

    } catch (error) {
      logger.error('Error in load balancing', {
        agentCount: agents.length,
        priority,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      
      // Fallback to simple least-connections
      return this.leastConnectionsBalance(agents)
    }
  }

  // Calculate load score for an agent (0-100, higher is better)
  async calculateLoadScore(agent: any): Promise<number> {
    try {
      const load = agent.load || {
        currentLoad: 0,
        maxConcurrency: 50,
        queueLength: 0,
        averageResponseTime: 1000,
        requestsPerMinute: 0
      }

      // Calculate utilization (lower is better)
      const utilizationRatio = load.currentLoad / load.maxConcurrency
      const utilizationScore = Math.max(0, 100 - (utilizationRatio * 100))

      // Calculate queue score (lower queue is better)
      const queueScore = Math.max(0, 100 - (load.queueLength * 10))

      // Calculate response time score (faster is better)
      const responseTimeScore = Math.max(0, 100 - (load.averageResponseTime / 100))

      // Calculate request rate score (moderate rate is better)
      const optimalRPM = 30 // Optimal requests per minute
      const rpmDiff = Math.abs(load.requestsPerMinute - optimalRPM)
      const rpmScore = Math.max(0, 100 - (rpmDiff * 2))

      // Weighted average
      const weights = {
        utilization: 0.4,
        queue: 0.3,
        responseTime: 0.2,
        requestRate: 0.1
      }

      const totalScore = 
        utilizationScore * weights.utilization +
        queueScore * weights.queue +
        responseTimeScore * weights.responseTime +
        rpmScore * weights.requestRate

      return Math.round(totalScore * 100) / 100

    } catch (error) {
      logger.error('Error calculating load score', {
        agentId: agent.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return 50 // Default middle score
    }
  }

  // Select appropriate load balancing strategy
  private selectStrategy(agents: any[], priority: string): string {
    // Critical priority requests get the best available agent
    if (priority === 'critical') {
      return 'response-time'
    }

    // High priority requests use adaptive balancing
    if (priority === 'high') {
      return 'adaptive'
    }

    // For large agent pools, use more sophisticated strategies
    if (agents.length > 10) {
      return 'adaptive'
    }

    // Default to least connections for simplicity
    return 'least-connections'
  }

  // Round Robin load balancing
  private roundRobinBalance(agents: any[]): any[] {
    // Simple round-robin - agents are already shuffled
    return [...agents].sort((a, b) => {
      const aLastUsed = this.getLastUsedTime(a.id)
      const bLastUsed = this.getLastUsedTime(b.id)
      return aLastUsed - bLastUsed
    })
  }

  // Least Connections load balancing
  private leastConnectionsBalance(agents: any[]): any[] {
    return [...agents].sort((a, b) => {
      const aLoad = (a.load?.currentLoad || 0)
      const bLoad = (b.load?.currentLoad || 0)
      
      if (aLoad !== bLoad) {
        return aLoad - bLoad
      }
      
      // Secondary sort by queue length
      const aQueue = (a.load?.queueLength || 0)
      const bQueue = (b.load?.queueLength || 0)
      return aQueue - bQueue
    })
  }

  // Weighted Round Robin load balancing
  private weightedRoundRobinBalance(agents: any[]): any[] {
    return [...agents].sort((a, b) => {
      // Calculate weights based on capacity and performance
      const aWeight = this.calculateAgentWeight(a)
      const bWeight = this.calculateAgentWeight(b)
      
      // Higher weight = higher priority
      return bWeight - aWeight
    })
  }

  // Response Time based load balancing
  private responseTimeBalance(agents: any[]): any[] {
    return [...agents].sort((a, b) => {
      const aResponseTime = a.load?.averageResponseTime || a.averageResponseTime || 1000
      const bResponseTime = b.load?.averageResponseTime || b.averageResponseTime || 1000
      
      // Faster response time = higher priority
      return aResponseTime - bResponseTime
    })
  }

  // Adaptive load balancing (combines multiple factors)
  private adaptiveBalance(agents: any[]): any[] {
    return [...agents].sort((a, b) => {
      const aScore = this.calculateAdaptiveScore(a)
      const bScore = this.calculateAdaptiveScore(b)
      
      // Higher score = higher priority
      return bScore - aScore
    })
  }

  // Calculate agent weight for weighted round robin
  private calculateAgentWeight(agent: any): number {
    const load = agent.load || {}
    const maxConcurrency = load.maxConcurrency || 50
    const currentLoad = load.currentLoad || 0
    const averageResponseTime = load.averageResponseTime || 1000
    
    // Available capacity (0-1)
    const availableCapacity = Math.max(0, (maxConcurrency - currentLoad) / maxConcurrency)
    
    // Response time factor (faster = higher weight)
    const responseTimeFactor = Math.max(0.1, 1000 / averageResponseTime)
    
    // Health factor
    const healthFactor = agent.health?.status === 'healthy' ? 1.0 : 
                        agent.health?.status === 'degraded' ? 0.7 : 0.3
    
    return availableCapacity * responseTimeFactor * healthFactor
  }

  // Calculate adaptive score combining multiple factors
  private calculateAdaptiveScore(agent: any): number {
    const load = agent.load || {}
    const health = agent.health || { status: 'healthy' }
    
    // Capacity score (0-100)
    const maxConcurrency = load.maxConcurrency || 50
    const currentLoad = load.currentLoad || 0
    const capacityScore = ((maxConcurrency - currentLoad) / maxConcurrency) * 100
    
    // Performance score (0-100)
    const averageResponseTime = load.averageResponseTime || 1000
    const performanceScore = Math.max(0, 100 - (averageResponseTime / 50))
    
    // Health score (0-100)
    const healthScore = health.status === 'healthy' ? 100 :
                       health.status === 'degraded' ? 70 :
                       health.status === 'unhealthy' ? 30 : 0
    
    // Queue score (0-100)
    const queueLength = load.queueLength || 0
    const queueScore = Math.max(0, 100 - (queueLength * 20))
    
    // Stability score based on error rate (0-100)
    const errorRate = health.errorRate || 0
    const stabilityScore = Math.max(0, 100 - (errorRate * 100))
    
    // Weighted combination
    const weights = {
      capacity: 0.3,
      performance: 0.25,
      health: 0.2,
      queue: 0.15,
      stability: 0.1
    }
    
    return (
      capacityScore * weights.capacity +
      performanceScore * weights.performance +
      healthScore * weights.health +
      queueScore * weights.queue +
      stabilityScore * weights.stability
    )
  }

  // Track request completion for load balancing
  async trackRequestCompletion(agentId: string, responseTime: number, success: boolean): Promise<void> {
    // Update response time history
    const history = this.responseTimeHistory.get(agentId) || []
    history.push(responseTime)
    
    // Keep only last 50 response times
    if (history.length > 50) {
      history.shift()
    }
    
    this.responseTimeHistory.set(agentId, history)
    
    // Remove request from queue if it exists
    const queue = this.requestQueues.get(agentId) || []
    if (queue.length > 0) {
      queue.shift()
      this.requestQueues.set(agentId, queue)
    }

    logger.debug('Request completion tracked', {
      agentId,
      responseTime,
      success,
      queueLength: queue.length
    })
  }

  // Add request to agent queue
  async queueRequest(agentId: string, request: any): Promise<void> {
    const queue = this.requestQueues.get(agentId) || []
    queue.push({
      ...request,
      queuedAt: new Date()
    })
    this.requestQueues.set(agentId, queue)
  }

  // Get current load metrics for an agent
  getLoadMetrics(agentId: string): LoadMetrics | null {
    const queue = this.requestQueues.get(agentId) || []
    const responseHistory = this.responseTimeHistory.get(agentId) || []
    
    if (responseHistory.length === 0) {
      return null
    }

    const averageResponseTime = responseHistory.reduce((sum, time) => sum + time, 0) / responseHistory.length
    
    // Calculate success rate (simplified - would track actual failures)
    const successRate = 0.95 // 95% success rate assumption
    
    return {
      agentId,
      currentLoad: queue.length,
      averageResponseTime,
      successRate,
      queueLength: queue.length,
      lastUpdated: new Date()
    }
  }

  // Get last used time for round robin
  private getLastUsedTime(agentId: string): number {
    const queue = this.requestQueues.get(agentId) || []
    return queue.length > 0 ? queue[queue.length - 1]?.queuedAt?.getTime() || 0 : 0
  }

  // Get load balancing statistics
  async getBalancingStats(): Promise<{
    totalRequests: number
    averageResponseTime: number
    balancingStrategies: Record<string, number>
    agentUtilization: Record<string, number>
  }> {
    const totalRequests = Array.from(this.requestQueues.values())
      .reduce((sum, queue) => sum + queue.length, 0)

    const allResponseTimes = Array.from(this.responseTimeHistory.values())
      .flat()
    
    const averageResponseTime = allResponseTimes.length > 0
      ? allResponseTimes.reduce((sum, time) => sum + time, 0) / allResponseTimes.length
      : 0

    // Strategy usage tracking (would be more detailed in production)
    const balancingStrategies = {
      'least-connections': 0.4,
      'adaptive': 0.3,
      'response-time': 0.2,
      'weighted-round-robin': 0.1
    }

    // Agent utilization calculation
    const agentUtilization: Record<string, number> = {}
    this.requestQueues.forEach((queue, agentId) => {
      agentUtilization[agentId] = queue.length
    })

    return {
      totalRequests,
      averageResponseTime: Math.round(averageResponseTime * 100) / 100,
      balancingStrategies,
      agentUtilization
    }
  }

  // Clean up old data
  cleanup(): void {
    // Remove old entries from queues and history
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours
    const now = Date.now()

    this.requestQueues.forEach((queue, agentId) => {
      const filteredQueue = queue.filter((request: any) => 
        now - new Date(request.queuedAt).getTime() < maxAge
      )
      this.requestQueues.set(agentId, filteredQueue)
    })

    logger.info('Load balancer cleanup completed')
  }
}
