
import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import { logger } from '@ai-platform/shared-utils';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

export interface AIAgent {
  id: string;
  name: string;
  description: string;
  type: 'llm' | 'tool' | 'multimodal' | 'custom';
  category: string;
  provider: string;
  model: string;
  version: string;
  capabilities: AgentCapability[];
  configuration: AgentConfiguration;
  deployment: AgentDeployment;
  metadata: AgentMetadata;
  status: 'active' | 'inactive' | 'maintenance' | 'deprecated';
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentCapability {
  name: string;
  description: string;
  type: 'input' | 'output' | 'processing';
  dataTypes: string[];
  parameters?: Record<string, any>;
  constraints?: Record<string, any>;
}

export interface AgentConfiguration {
  maxTokens: number;
  temperature: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  timeout: number;
  retries: number;
  rateLimits: {
    requestsPerMinute: number;
    tokensPerMinute: number;
    concurrentRequests: number;
  };
  custom?: Record<string, any>;
}

export interface AgentDeployment {
  environment: 'development' | 'staging' | 'production';
  region: string;
  endpoint?: string;
  healthCheckUrl?: string;
  scalingConfig: {
    minInstances: number;
    maxInstances: number;
    targetUtilization: number;
  };
  resources: {
    cpu?: string;
    memory?: string;
    gpu?: string;
  };
}

export interface AgentMetadata {
  creator: string;
  organization?: string;
  tags: string[];
  documentation?: string;
  examples?: any[];
  license?: string;
  pricing?: {
    model: 'free' | 'subscription' | 'pay-per-use';
    cost?: number;
    currency?: string;
  };
  performance: {
    averageResponseTime: number;
    accuracy?: number;
    throughput?: number;
    uptime?: number;
  };
}

export interface AgentRegistryConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
  sync: {
    interval: number; // milliseconds
    batchSize: number;
  };
  validation: {
    enableHealthChecks: boolean;
    healthCheckTimeout: number;
    capabilityValidation: boolean;
  };
}

export class AgentRegistryService extends EventEmitter {
  private prisma: PrismaClient;
  private redis: Redis;
  private config: AgentRegistryConfig;
  private agentCache: Map<string, AIAgent> = new Map();
  private syncInterval?: NodeJS.Timeout;
  private isSyncing = false;

  private readonly AGENT_KEY_PREFIX = 'ai:agent:';
  private readonly AGENTS_LIST_KEY = 'ai:agents:list';
  private readonly AGENT_CAPABILITIES_KEY = 'ai:agents:capabilities';
  private readonly AGENT_METRICS_KEY = 'ai:agents:metrics';

  constructor(config: AgentRegistryConfig) {
    super();
    this.prisma = new PrismaClient();
    this.redis = new Redis(config.redis);
    this.config = config;
  }

  /**
   * Start the agent registry service
   */
  async start(): Promise<void> {
    try {
      // Load existing agents from database
      await this.loadAgentsFromDatabase();
      
      // Start periodic sync
      await this.startPeriodicSync();
      
      // Register default agents
      await this.registerDefaultAgents();
      
      logger.info('Agent registry service started', {
        agentCount: this.agentCache.size,
        syncInterval: this.config.sync.interval
      });
      
      this.emit('serviceStarted', {
        agentCount: this.agentCache.size
      });
      
    } catch (error) {
      logger.error('Failed to start agent registry service', { error });
      throw error;
    }
  }

  /**
   * Stop the agent registry service
   */
  async stop(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
    }
    
    await this.prisma.$disconnect();
    await this.redis.quit();
    
    logger.info('Agent registry service stopped');
    this.emit('serviceStopped');
  }

  /**
   * Register a new AI agent
   */
  async registerAgent(agentData: Omit<AIAgent, 'id' | 'createdAt' | 'updatedAt'>): Promise<AIAgent> {
    const agentId = uuidv4();
    const now = new Date();
    
    const agent: AIAgent = {
      id: agentId,
      ...agentData,
      createdAt: now,
      updatedAt: now
    };

    try {
      // Validate agent configuration
      await this.validateAgent(agent);
      
      // Save to database
      await this.prisma.aIAgent.create({
        data: {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          type: agent.type,
          category: agent.category,
          provider: agent.provider,
          model: agent.model,
          version: agent.version,
          capabilities: JSON.stringify(agent.capabilities),
          configuration: JSON.stringify(agent.configuration),
          deployment: JSON.stringify(agent.deployment),
          metadata: JSON.stringify(agent.metadata),
          status: agent.status,
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt
        }
      });
      
      // Update cache
      this.agentCache.set(agent.id, agent);
      
      // Update Redis
      await this.updateAgentInRedis(agent);
      
      // Update agent lists
      await this.updateAgentLists();
      
      logger.info('Agent registered successfully', {
        agentId: agent.id,
        name: agent.name,
        provider: agent.provider,
        model: agent.model
      });
      
      this.emit('agentRegistered', { agent });
      
      return agent;
      
    } catch (error) {
      logger.error('Failed to register agent', {
        agentName: agentData.name,
        error
      });
      throw error;
    }
  }

  /**
   * Validate agent configuration
   */
  private async validateAgent(agent: AIAgent): Promise<void> {
    // Basic validation
    if (!agent.name || !agent.provider || !agent.model) {
      throw new Error('Agent name, provider, and model are required');
    }

    // Check for duplicate names
    const existingAgent = Array.from(this.agentCache.values())
      .find(a => a.name === agent.name && a.provider === agent.provider);
    
    if (existingAgent) {
      throw new Error(`Agent with name '${agent.name}' already exists for provider '${agent.provider}'`);
    }

    // Validate capabilities
    if (!agent.capabilities || agent.capabilities.length === 0) {
      throw new Error('Agent must have at least one capability');
    }

    // Validate configuration
    if (!agent.configuration.maxTokens || agent.configuration.maxTokens <= 0) {
      throw new Error('Agent must have valid maxTokens configuration');
    }

    if (!agent.configuration.rateLimits) {
      throw new Error('Agent must have rate limits configured');
    }

    // Health check validation if enabled
    if (this.config.validation.enableHealthChecks && agent.deployment.healthCheckUrl) {
      await this.performHealthCheck(agent);
    }

    // Capability validation if enabled
    if (this.config.validation.capabilityValidation) {
      await this.validateCapabilities(agent);
    }
  }

  /**
   * Perform health check on agent
   */
  private async performHealthCheck(agent: AIAgent): Promise<void> {
    if (!agent.deployment.healthCheckUrl) {
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(), 
        this.config.validation.healthCheckTimeout
      );

      const response = await fetch(agent.deployment.healthCheckUrl, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Health check failed with status ${response.status}`);
      }

      logger.debug('Agent health check passed', {
        agentId: agent.id,
        healthCheckUrl: agent.deployment.healthCheckUrl
      });

    } catch (error) {
      logger.error('Agent health check failed', {
        agentId: agent.id,
        error
      });
      throw new Error(`Agent health check failed: ${error}`);
    }
  }

  /**
   * Validate agent capabilities
   */
  private async validateCapabilities(agent: AIAgent): Promise<void> {
    for (const capability of agent.capabilities) {
      // Validate capability structure
      if (!capability.name || !capability.type || !capability.dataTypes) {
        throw new Error(`Invalid capability structure: ${capability.name}`);
      }

      // Validate data types
      const validDataTypes = [
        'text', 'image', 'audio', 'video', 'json', 'xml', 'csv', 'pdf', 'binary'
      ];
      
      for (const dataType of capability.dataTypes) {
        if (!validDataTypes.includes(dataType)) {
          throw new Error(`Invalid data type '${dataType}' in capability '${capability.name}'`);
        }
      }

      // Additional provider-specific validation could go here
    }
  }

  /**
   * Update agent information
   */
  async updateAgent(agentId: string, updates: Partial<Omit<AIAgent, 'id' | 'createdAt'>>): Promise<AIAgent> {
    const existingAgent = this.agentCache.get(agentId);
    if (!existingAgent) {
      throw new Error(`Agent with ID ${agentId} not found`);
    }

    const updatedAgent: AIAgent = {
      ...existingAgent,
      ...updates,
      id: agentId,
      createdAt: existingAgent.createdAt,
      updatedAt: new Date()
    };

    try {
      // Validate updated agent
      await this.validateAgent(updatedAgent);
      
      // Update in database
      await this.prisma.aIAgent.update({
        where: { id: agentId },
        data: {
          name: updatedAgent.name,
          description: updatedAgent.description,
          type: updatedAgent.type,
          category: updatedAgent.category,
          provider: updatedAgent.provider,
          model: updatedAgent.model,
          version: updatedAgent.version,
          capabilities: JSON.stringify(updatedAgent.capabilities),
          configuration: JSON.stringify(updatedAgent.configuration),
          deployment: JSON.stringify(updatedAgent.deployment),
          metadata: JSON.stringify(updatedAgent.metadata),
          status: updatedAgent.status,
          updatedAt: updatedAgent.updatedAt
        }
      });
      
      // Update cache
      this.agentCache.set(agentId, updatedAgent);
      
      // Update Redis
      await this.updateAgentInRedis(updatedAgent);
      
      logger.info('Agent updated successfully', {
        agentId,
        name: updatedAgent.name
      });
      
      this.emit('agentUpdated', { agent: updatedAgent, previousAgent: existingAgent });
      
      return updatedAgent;
      
    } catch (error) {
      logger.error('Failed to update agent', { agentId, error });
      throw error;
    }
  }

  /**
   * Unregister an agent
   */
  async unregisterAgent(agentId: string): Promise<void> {
    const agent = this.agentCache.get(agentId);
    if (!agent) {
      throw new Error(`Agent with ID ${agentId} not found`);
    }

    try {
      // Remove from database
      await this.prisma.aIAgent.delete({
        where: { id: agentId }
      });
      
      // Remove from cache
      this.agentCache.delete(agentId);
      
      // Remove from Redis
      await this.redis.del(`${this.AGENT_KEY_PREFIX}${agentId}`);
      
      // Update agent lists
      await this.updateAgentLists();
      
      logger.info('Agent unregistered successfully', {
        agentId,
        name: agent.name
      });
      
      this.emit('agentUnregistered', { agent });
      
    } catch (error) {
      logger.error('Failed to unregister agent', { agentId, error });
      throw error;
    }
  }

  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<AIAgent | null> {
    let agent = this.agentCache.get(agentId);
    
    if (!agent) {
      // Try to load from Redis
      const agentData = await this.redis.get(`${this.AGENT_KEY_PREFIX}${agentId}`);
      if (agentData) {
        agent = JSON.parse(agentData);
        if (agent) {
          this.agentCache.set(agentId, agent);
        }
      }
    }
    
    if (!agent) {
      // Try to load from database
      const dbAgent = await this.prisma.aIAgent.findUnique({
        where: { id: agentId }
      });
      
      if (dbAgent) {
        agent = this.convertDbAgentToAgent(dbAgent);
        this.agentCache.set(agentId, agent);
        await this.updateAgentInRedis(agent);
      }
    }
    
    return agent || null;
  }

  /**
   * Get agents by criteria
   */
  async getAgents(criteria: {
    provider?: string;
    type?: string;
    category?: string;
    status?: string;
    capabilities?: string[];
    tags?: string[];
    limit?: number;
    offset?: number;
  } = {}): Promise<AIAgent[]> {
    let agents = Array.from(this.agentCache.values());
    
    // Apply filters
    if (criteria.provider) {
      agents = agents.filter(a => a.provider === criteria.provider);
    }
    
    if (criteria.type) {
      agents = agents.filter(a => a.type === criteria.type);
    }
    
    if (criteria.category) {
      agents = agents.filter(a => a.category === criteria.category);
    }
    
    if (criteria.status) {
      agents = agents.filter(a => a.status === criteria.status);
    }
    
    if (criteria.capabilities && criteria.capabilities.length > 0) {
      agents = agents.filter(agent => 
        criteria.capabilities!.every(cap => 
          agent.capabilities.some(agentCap => agentCap.name === cap)
        )
      );
    }
    
    if (criteria.tags && criteria.tags.length > 0) {
      agents = agents.filter(agent =>
        criteria.tags!.some(tag => agent.metadata.tags.includes(tag))
      );
    }
    
    // Apply pagination
    const offset = criteria.offset || 0;
    const limit = criteria.limit || 100;
    
    return agents.slice(offset, offset + limit);
  }

  /**
   * Search agents by text
   */
  async searchAgents(query: string, options: {
    limit?: number;
    includeInactive?: boolean;
  } = {}): Promise<AIAgent[]> {
    const searchTerms = query.toLowerCase().split(' ');
    let agents = Array.from(this.agentCache.values());
    
    // Filter by status if needed
    if (!options.includeInactive) {
      agents = agents.filter(a => a.status === 'active');
    }
    
    // Score and filter agents based on search relevance
    const scoredAgents = agents.map(agent => {
      let score = 0;
      const searchText = `${agent.name} ${agent.description} ${agent.category} ${agent.metadata.tags.join(' ')}`.toLowerCase();
      
      for (const term of searchTerms) {
        if (agent.name.toLowerCase().includes(term)) score += 3;
        if (agent.description.toLowerCase().includes(term)) score += 2;
        if (agent.category.toLowerCase().includes(term)) score += 2;
        if (agent.metadata.tags.some(tag => tag.toLowerCase().includes(term))) score += 1;
        if (searchText.includes(term)) score += 1;
      }
      
      return { agent, score };
    }).filter(item => item.score > 0);
    
    // Sort by score and return agents
    scoredAgents.sort((a, b) => b.score - a.score);
    
    const limit = options.limit || 50;
    return scoredAgents.slice(0, limit).map(item => item.agent);
  }

  /**
   * Get agent statistics
   */
  async getAgentStatistics(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byProvider: Record<string, number>;
    byType: Record<string, number>;
    byCategory: Record<string, number>;
  }> {
    const agents = Array.from(this.agentCache.values());
    
    const stats = {
      total: agents.length,
      byStatus: {} as Record<string, number>,
      byProvider: {} as Record<string, number>,
      byType: {} as Record<string, number>,
      byCategory: {} as Record<string, number>
    };
    
    agents.forEach(agent => {
      // Count by status
      stats.byStatus[agent.status] = (stats.byStatus[agent.status] || 0) + 1;
      
      // Count by provider
      stats.byProvider[agent.provider] = (stats.byProvider[agent.provider] || 0) + 1;
      
      // Count by type
      stats.byType[agent.type] = (stats.byType[agent.type] || 0) + 1;
      
      // Count by category
      stats.byCategory[agent.category] = (stats.byCategory[agent.category] || 0) + 1;
    });
    
    return stats;
  }

  /**
   * Load agents from database
   */
  private async loadAgentsFromDatabase(): Promise<void> {
    try {
      const dbAgents = await this.prisma.aIAgent.findMany();
      
      for (const dbAgent of dbAgents) {
        const agent = this.convertDbAgentToAgent(dbAgent);
        this.agentCache.set(agent.id, agent);
        await this.updateAgentInRedis(agent);
      }
      
      logger.info('Agents loaded from database', { count: dbAgents.length });
      
    } catch (error) {
      logger.error('Failed to load agents from database', { error });
      throw error;
    }
  }

  /**
   * Convert database agent to AIAgent interface
   */
  private convertDbAgentToAgent(dbAgent: any): AIAgent {
    return {
      id: dbAgent.id,
      name: dbAgent.name,
      description: dbAgent.description,
      type: dbAgent.type,
      category: dbAgent.category,
      provider: dbAgent.provider,
      model: dbAgent.model,
      version: dbAgent.version,
      capabilities: JSON.parse(dbAgent.capabilities || '[]'),
      configuration: JSON.parse(dbAgent.configuration || '{}'),
      deployment: JSON.parse(dbAgent.deployment || '{}'),
      metadata: JSON.parse(dbAgent.metadata || '{}'),
      status: dbAgent.status,
      createdAt: dbAgent.createdAt,
      updatedAt: dbAgent.updatedAt
    };
  }

  /**
   * Update agent in Redis
   */
  private async updateAgentInRedis(agent: AIAgent): Promise<void> {
    const agentKey = `${this.AGENT_KEY_PREFIX}${agent.id}`;
    
    await this.redis.setex(
      agentKey,
      3600, // 1 hour expiry
      JSON.stringify(agent)
    );
  }

  /**
   * Update agent lists in Redis
   */
  private async updateAgentLists(): Promise<void> {
    const agents = Array.from(this.agentCache.values());
    const agentIds = agents.map(a => a.id);
    
    // Update agents list
    if (agentIds.length > 0) {
      await this.redis.del(this.AGENTS_LIST_KEY);
      await this.redis.sadd(this.AGENTS_LIST_KEY, ...agentIds);
      await this.redis.expire(this.AGENTS_LIST_KEY, 3600);
    }
    
    // Update capabilities index
    const capabilitiesMap: Record<string, string[]> = {};
    agents.forEach(agent => {
      agent.capabilities.forEach(cap => {
        if (!capabilitiesMap[cap.name]) {
          capabilitiesMap[cap.name] = [];
        }
        capabilitiesMap[cap.name].push(agent.id);
      });
    });
    
    await this.redis.del(this.AGENT_CAPABILITIES_KEY);
    for (const [capability, agentIds] of Object.entries(capabilitiesMap)) {
      await this.redis.hset(this.AGENT_CAPABILITIES_KEY, capability, JSON.stringify(agentIds));
    }
    await this.redis.expire(this.AGENT_CAPABILITIES_KEY, 3600);
  }

  /**
   * Start periodic sync
   */
  private async startPeriodicSync(): Promise<void> {
    this.syncInterval = setInterval(
      () => this.syncWithDatabase(),
      this.config.sync.interval
    );
    
    logger.debug('Periodic sync started', {
      interval: this.config.sync.interval
    });
  }

  /**
   * Sync with database periodically
   */
  private async syncWithDatabase(): Promise<void> {
    if (this.isSyncing) {
      return;
    }
    
    this.isSyncing = true;
    
    try {
      const lastUpdate = new Date(Date.now() - this.config.sync.interval);
      
      const updatedAgents = await this.prisma.aIAgent.findMany({
        where: {
          updatedAt: {
            gte: lastUpdate
          }
        }
      });
      
      for (const dbAgent of updatedAgents) {
        const agent = this.convertDbAgentToAgent(dbAgent);
        this.agentCache.set(agent.id, agent);
        await this.updateAgentInRedis(agent);
      }
      
      if (updatedAgents.length > 0) {
        await this.updateAgentLists();
        logger.debug('Synced updated agents', { count: updatedAgents.length });
      }
      
    } catch (error) {
      logger.error('Database sync failed', { error });
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Register default agents
   */
  private async registerDefaultAgents(): Promise<void> {
    const defaultAgents = [
      {
        name: 'GPT-4 Turbo',
        description: 'Advanced language model with enhanced reasoning capabilities',
        type: 'llm' as const,
        category: 'text-generation',
        provider: 'openai',
        model: 'gpt-4-turbo',
        version: '1.0.0',
        capabilities: [
          {
            name: 'text-generation',
            description: 'Generate human-like text responses',
            type: 'processing' as const,
            dataTypes: ['text']
          },
          {
            name: 'code-generation',
            description: 'Generate and review code',
            type: 'processing' as const,
            dataTypes: ['text']
          }
        ],
        configuration: {
          maxTokens: 128000,
          temperature: 0.7,
          timeout: 120000,
          retries: 3,
          rateLimits: {
            requestsPerMinute: 3500,
            tokensPerMinute: 10000,
            concurrentRequests: 100
          }
        },
        deployment: {
          environment: 'production' as const,
          region: 'us-east-1',
          scalingConfig: {
            minInstances: 1,
            maxInstances: 10,
            targetUtilization: 0.7
          },
          resources: {}
        },
        metadata: {
          creator: 'system',
          tags: ['text', 'code', 'reasoning'],
          performance: {
            averageResponseTime: 2500,
            accuracy: 0.95,
            uptime: 0.999
          }
        },
        status: 'active' as const
      },
      // Add more default agents here if needed
    ];

    for (const agentData of defaultAgents) {
      // Check if agent already exists
      const existingAgents = await this.getAgents({
        provider: agentData.provider,
        name: agentData.name
      });
      
      if (existingAgents.length === 0) {
        try {
          await this.registerAgent(agentData);
        } catch (error) {
          logger.warn('Failed to register default agent', {
            agentName: agentData.name,
            error
          });
        }
      }
    }
  }
}

