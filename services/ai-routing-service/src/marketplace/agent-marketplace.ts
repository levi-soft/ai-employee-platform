
import { Logger } from '@ai-platform/shared-utils';
import { 
  IAgentPackage, 
  IAgentReview, 
  IMarketplaceQuery, 
  CapabilityType,
  IAgentConfig 
} from '../../../../packages/ai-agent-sdk/src/types/agent-types';
import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

interface DatabaseAgentPackage {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  authorEmail?: string;
  tags: string;
  capabilities: string;
  pricingType: string;
  pricingCost?: number;
  pricingCurrency?: string;
  dependencies: string;
  minimumVersion?: string;
  repository?: string;
  documentation?: string;
  license?: string;
  downloadCount: number;
  rating: number;
  createdAt: Date;
  updatedAt: Date;
  verified: boolean;
  securityLevel: string;
  sandboxed: boolean;
  permissions: string;
}

/**
 * Agent Marketplace Service for managing, discovering, and distributing AI agents
 */
export class AgentMarketplaceService extends EventEmitter {
  private logger: Logger;
  private prisma: PrismaClient;
  private cache = new Map<string, any>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    super();
    this.logger = new Logger('AgentMarketplace');
    this.prisma = new PrismaClient();
  }

  /**
   * Search agents in the marketplace
   */
  async searchAgents(query: IMarketplaceQuery): Promise<{
    agents: IAgentPackage[];
    total: number;
    page: number;
    limit: number;
  }> {
    const cacheKey = `search:${JSON.stringify(query)}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const {
        query: searchQuery,
        capabilities,
        tags,
        author,
        pricing,
        minRating = 0,
        verified,
        limit = 20,
        offset = 0,
        sortBy = 'relevance',
        sortOrder = 'desc'
      } = query;

      // Build where clause
      const where: any = {};

      if (searchQuery) {
        where.OR = [
          { name: { contains: searchQuery, mode: 'insensitive' } },
          { description: { contains: searchQuery, mode: 'insensitive' } },
          { tags: { contains: searchQuery, mode: 'insensitive' } }
        ];
      }

      if (capabilities?.length) {
        const capabilityStrings = capabilities.map(cap => cap.toString());
        where.AND = capabilityStrings.map(cap => ({
          capabilities: { contains: cap }
        }));
      }

      if (tags?.length) {
        where.AND = (where.AND || []).concat(
          tags.map(tag => ({ tags: { contains: tag } }))
        );
      }

      if (author) {
        where.author = { contains: author, mode: 'insensitive' };
      }

      if (pricing) {
        where.pricingType = pricing;
      }

      if (minRating > 0) {
        where.rating = { gte: minRating };
      }

      if (verified !== undefined) {
        where.verified = verified;
      }

      // Build order by clause
      const orderBy: any = {};
      switch (sortBy) {
        case 'popularity':
          orderBy.downloadCount = sortOrder;
          break;
        case 'rating':
          orderBy.rating = sortOrder;
          break;
        case 'created':
          orderBy.createdAt = sortOrder;
          break;
        case 'updated':
          orderBy.updatedAt = sortOrder;
          break;
        default:
          orderBy.downloadCount = 'desc'; // Default relevance by popularity
      }

      // Execute query (simulated with in-memory data for now)
      const mockAgents = await this.getMockAgents();
      const filteredAgents = this.filterAgents(mockAgents, where);
      const sortedAgents = this.sortAgents(filteredAgents, orderBy);
      const paginatedAgents = sortedAgents.slice(offset, offset + limit);

      const result = {
        agents: paginatedAgents.map(agent => this.transformDatabaseAgentToPackage(agent)),
        total: filteredAgents.length,
        page: Math.floor(offset / limit) + 1,
        limit
      };

      this.setCache(cacheKey, result);
      return result;

    } catch (error) {
      this.logger.error('Failed to search agents', { error: error instanceof Error ? error.message : String(error) });
      throw new Error('Failed to search agents in marketplace');
    }
  }

  /**
   * Get agent details by ID
   */
  async getAgent(id: string): Promise<IAgentPackage | null> {
    const cacheKey = `agent:${id}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Simulate database query
      const mockAgents = await this.getMockAgents();
      const agent = mockAgents.find(a => a.id === id);

      if (!agent) {
        return null;
      }

      const result = this.transformDatabaseAgentToPackage(agent);
      this.setCache(cacheKey, result);
      return result;

    } catch (error) {
      this.logger.error('Failed to get agent', { 
        agentId: id, 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw new Error('Failed to get agent from marketplace');
    }
  }

  /**
   * Publish a new agent to the marketplace
   */
  async publishAgent(agentPackage: Omit<IAgentPackage, 'id' | 'createdAt' | 'updatedAt' | 'downloadCount' | 'rating'>): Promise<IAgentPackage> {
    try {
      this.logger.info('Publishing agent to marketplace', {
        name: agentPackage.name,
        version: agentPackage.version,
        author: agentPackage.author
      });

      // Validate agent package
      await this.validateAgentPackage(agentPackage);

      // Create agent record
      const newAgent: IAgentPackage = {
        ...agentPackage,
        id: this.generateAgentId(),
        downloadCount: 0,
        rating: 0,
        reviews: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // In a real implementation, this would be saved to database
      this.logger.info('Agent published successfully', {
        id: newAgent.id,
        name: newAgent.name,
        version: newAgent.version
      });

      this.emit('agentPublished', { agent: newAgent });
      this.clearCache(); // Clear cache after publishing

      return newAgent;

    } catch (error) {
      this.logger.error('Failed to publish agent', { 
        agentName: agentPackage.name,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error('Failed to publish agent to marketplace');
    }
  }

  /**
   * Update an existing agent
   */
  async updateAgent(id: string, updates: Partial<IAgentPackage>): Promise<IAgentPackage> {
    try {
      const existingAgent = await this.getAgent(id);
      if (!existingAgent) {
        throw new Error('Agent not found');
      }

      const updatedAgent: IAgentPackage = {
        ...existingAgent,
        ...updates,
        id,
        updatedAt: new Date()
      };

      // Validate updated package
      await this.validateAgentPackage(updatedAgent);

      this.logger.info('Agent updated successfully', { id, updates: Object.keys(updates) });
      this.emit('agentUpdated', { agent: updatedAgent, updates });
      this.clearCache();

      return updatedAgent;

    } catch (error) {
      this.logger.error('Failed to update agent', { 
        agentId: id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error('Failed to update agent in marketplace');
    }
  }

  /**
   * Delete an agent from the marketplace
   */
  async deleteAgent(id: string): Promise<void> {
    try {
      const agent = await this.getAgent(id);
      if (!agent) {
        throw new Error('Agent not found');
      }

      // In a real implementation, this would delete from database
      this.logger.info('Agent deleted successfully', { id, name: agent.name });
      this.emit('agentDeleted', { agentId: id, agent });
      this.clearCache();

    } catch (error) {
      this.logger.error('Failed to delete agent', { 
        agentId: id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error('Failed to delete agent from marketplace');
    }
  }

  /**
   * Download an agent (increment download count)
   */
  async downloadAgent(id: string, userId?: string): Promise<{
    agent: IAgentPackage;
    downloadUrl: string;
    config: IAgentConfig;
  }> {
    try {
      const agent = await this.getAgent(id);
      if (!agent) {
        throw new Error('Agent not found');
      }

      // Increment download count
      await this.updateAgent(id, { 
        downloadCount: (agent.downloadCount || 0) + 1 
      });

      // Generate download URL
      const downloadUrl = `${process.env.AGENT_CDN_URL || 'https://cdn.aiplatform.com'}/agents/${id}/${agent.version}`;

      // Generate agent configuration
      const config: IAgentConfig = {
        name: agent.name,
        version: agent.version,
        description: agent.description,
        author: agent.author,
        tags: agent.tags,
        sandboxed: agent.security?.sandboxed || true,
        securityLevel: agent.security?.level || 'medium',
        parameters: {}
      };

      this.logger.info('Agent downloaded', { 
        id, 
        name: agent.name, 
        userId,
        downloadCount: agent.downloadCount + 1
      });

      this.emit('agentDownloaded', { agent, userId });

      return { agent, downloadUrl, config };

    } catch (error) {
      this.logger.error('Failed to download agent', { 
        agentId: id,
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error('Failed to download agent from marketplace');
    }
  }

  /**
   * Add a review for an agent
   */
  async addReview(agentId: string, review: Omit<IAgentReview, 'id' | 'createdAt'>): Promise<IAgentReview> {
    try {
      const agent = await this.getAgent(agentId);
      if (!agent) {
        throw new Error('Agent not found');
      }

      const newReview: IAgentReview = {
        ...review,
        id: this.generateReviewId(),
        createdAt: new Date()
      };

      // Update agent rating
      const reviews = [...(agent.reviews || []), newReview];
      const averageRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

      await this.updateAgent(agentId, {
        reviews,
        rating: Math.round(averageRating * 10) / 10
      });

      this.logger.info('Review added', { 
        agentId, 
        reviewId: newReview.id,
        rating: newReview.rating
      });

      this.emit('reviewAdded', { agentId, review: newReview });

      return newReview;

    } catch (error) {
      this.logger.error('Failed to add review', { 
        agentId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error('Failed to add review');
    }
  }

  /**
   * Get trending agents
   */
  async getTrendingAgents(limit = 10): Promise<IAgentPackage[]> {
    const cacheKey = `trending:${limit}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await this.searchAgents({
        sortBy: 'popularity',
        sortOrder: 'desc',
        limit,
        offset: 0
      });

      this.setCache(cacheKey, result.agents);
      return result.agents;

    } catch (error) {
      this.logger.error('Failed to get trending agents', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Get featured agents
   */
  async getFeaturedAgents(limit = 5): Promise<IAgentPackage[]> {
    const cacheKey = `featured:${limit}`;
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await this.searchAgents({
        verified: true,
        minRating: 4.5,
        sortBy: 'rating',
        sortOrder: 'desc',
        limit,
        offset: 0
      });

      this.setCache(cacheKey, result.agents);
      return result.agents;

    } catch (error) {
      this.logger.error('Failed to get featured agents', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Validate agent package
   */
  private async validateAgentPackage(agentPackage: any): Promise<void> {
    const requiredFields = ['name', 'version', 'description', 'author', 'capabilities'];
    
    for (const field of requiredFields) {
      if (!agentPackage[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate version format
    const versionRegex = /^\d+\.\d+\.\d+$/;
    if (!versionRegex.test(agentPackage.version)) {
      throw new Error('Invalid version format. Use semantic versioning (x.y.z)');
    }

    // Validate capabilities
    if (!Array.isArray(agentPackage.capabilities) || agentPackage.capabilities.length === 0) {
      throw new Error('Agent must have at least one capability');
    }

    // Validate security settings
    if (agentPackage.security) {
      const validLevels = ['low', 'medium', 'high'];
      if (!validLevels.includes(agentPackage.security.level)) {
        throw new Error('Invalid security level');
      }
    }
  }

  /**
   * Transform database agent to package format
   */
  private transformDatabaseAgentToPackage(dbAgent: any): IAgentPackage {
    return {
      id: dbAgent.id,
      name: dbAgent.name,
      version: dbAgent.version,
      description: dbAgent.description,
      author: dbAgent.author,
      authorEmail: dbAgent.authorEmail,
      tags: dbAgent.tags ? dbAgent.tags.split(',') : [],
      capabilities: dbAgent.capabilities ? JSON.parse(dbAgent.capabilities) : [],
      pricing: {
        type: dbAgent.pricingType,
        cost: dbAgent.pricingCost,
        currency: dbAgent.pricingCurrency
      },
      dependencies: dbAgent.dependencies ? dbAgent.dependencies.split(',') : [],
      minimumVersion: dbAgent.minimumVersion,
      repository: dbAgent.repository,
      documentation: dbAgent.documentation,
      license: dbAgent.license,
      downloadCount: dbAgent.downloadCount || 0,
      rating: dbAgent.rating || 0,
      reviews: dbAgent.reviews || [],
      createdAt: dbAgent.createdAt,
      updatedAt: dbAgent.updatedAt,
      verified: dbAgent.verified || false,
      security: {
        level: dbAgent.securityLevel || 'medium',
        sandboxed: dbAgent.sandboxed !== false,
        permissions: dbAgent.permissions ? dbAgent.permissions.split(',') : []
      }
    };
  }

  // Mock data and helper methods
  private async getMockAgents(): Promise<any[]> {
    return [
      {
        id: 'agent-1',
        name: 'GPT-4 Code Assistant',
        version: '1.2.0',
        description: 'Advanced code generation and analysis agent powered by GPT-4',
        author: 'AI Platform Team',
        authorEmail: 'team@aiplatform.com',
        tags: 'code,programming,ai,gpt4',
        capabilities: JSON.stringify([
          { type: CapabilityType.CODE_GENERATION, level: 4 },
          { type: CapabilityType.TEXT_ANALYSIS, level: 3 }
        ]),
        pricingType: 'free',
        dependencies: '',
        repository: 'https://github.com/aiplatform/gpt4-code-assistant',
        documentation: 'https://docs.aiplatform.com/agents/gpt4-code-assistant',
        license: 'MIT',
        downloadCount: 1250,
        rating: 4.8,
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-08-01'),
        verified: true,
        securityLevel: 'high',
        sandboxed: true,
        permissions: 'code_execution,file_read'
      },
      {
        id: 'agent-2',
        name: 'Claude Content Writer',
        version: '2.1.1',
        description: 'Professional content writing agent with Claude 3.5 Sonnet',
        author: 'Content Pro Solutions',
        authorEmail: 'info@contentpro.com',
        tags: 'writing,content,marketing,claude',
        capabilities: JSON.stringify([
          { type: CapabilityType.CREATIVE_WRITING, level: 4 },
          { type: CapabilityType.TEXT_GENERATION, level: 4 },
          { type: CapabilityType.SUMMARIZATION, level: 3 }
        ]),
        pricingType: 'paid',
        pricingCost: 29.99,
        pricingCurrency: 'USD',
        dependencies: '',
        repository: 'https://github.com/contentpro/claude-writer',
        documentation: 'https://contentpro.com/docs/claude-writer',
        license: 'Commercial',
        downloadCount: 890,
        rating: 4.6,
        createdAt: new Date('2024-02-20'),
        updatedAt: new Date('2024-07-28'),
        verified: true,
        securityLevel: 'medium',
        sandboxed: true,
        permissions: 'text_generation'
      },
      {
        id: 'agent-3',
        name: 'Data Analysis Specialist',
        version: '3.0.2',
        description: 'Advanced data analysis and visualization agent',
        author: 'DataViz Inc',
        tags: 'data,analysis,visualization,charts',
        capabilities: JSON.stringify([
          { type: CapabilityType.DATA_ANALYSIS, level: 4 },
          { type: CapabilityType.CLASSIFICATION, level: 3 },
          { type: CapabilityType.EXTRACTION, level: 3 }
        ]),
        pricingType: 'subscription',
        pricingCost: 49.99,
        pricingCurrency: 'USD',
        dependencies: 'pandas,matplotlib',
        documentation: 'https://dataviz.com/docs/analysis-agent',
        license: 'Apache-2.0',
        downloadCount: 2100,
        rating: 4.9,
        createdAt: new Date('2023-11-10'),
        updatedAt: new Date('2024-08-05'),
        verified: true,
        securityLevel: 'medium',
        sandboxed: true,
        permissions: 'data_processing,file_read,file_write'
      }
    ];
  }

  private filterAgents(agents: any[], where: any): any[] {
    return agents.filter(agent => {
      // Simple filtering logic - in real implementation, this would be more sophisticated
      if (where.OR) {
        const searchMatches = where.OR.some((condition: any) => {
          if (condition.name?.contains) {
            return agent.name.toLowerCase().includes(condition.name.contains.toLowerCase());
          }
          if (condition.description?.contains) {
            return agent.description.toLowerCase().includes(condition.description.contains.toLowerCase());
          }
          if (condition.tags?.contains) {
            return agent.tags.toLowerCase().includes(condition.tags.contains.toLowerCase());
          }
          return false;
        });
        if (!searchMatches) return false;
      }

      if (where.verified !== undefined && agent.verified !== where.verified) {
        return false;
      }

      if (where.rating?.gte && agent.rating < where.rating.gte) {
        return false;
      }

      return true;
    });
  }

  private sortAgents(agents: any[], orderBy: any): any[] {
    const [field, direction] = Object.entries(orderBy)[0] as [string, 'asc' | 'desc'];
    
    return agents.sort((a, b) => {
      const valueA = a[field];
      const valueB = b[field];
      
      let comparison = 0;
      if (valueA < valueB) comparison = -1;
      if (valueA > valueB) comparison = 1;
      
      return direction === 'desc' ? -comparison : comparison;
    });
  }

  private generateAgentId(): string {
    return `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateReviewId(): string {
    return `review-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Cache management
  private getCached(key: string): any {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  private clearCache(): void {
    this.cache.clear();
  }
}
