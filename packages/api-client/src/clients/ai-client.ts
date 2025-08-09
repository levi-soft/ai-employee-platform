
// AI services API client
import { BaseAPIClient } from './base-client';
import {
  AIAgent,
  AIRequest,
  AIRequestCreate,
  AIRequestResponse,
  AIAgentListParams,
  AIRequestListParams,
  UsageAnalytics,
  PaginatedResponse
} from '@ai-platform/shared-types';
import { API_ROUTES } from '@ai-platform/shared-types';
import type { StreamOptions } from '../types';

export class AIClient extends BaseAPIClient {
  // AI Agent management
  async getAgents(params?: AIAgentListParams): Promise<PaginatedResponse<AIAgent>> {
    return this.getPaginated<AIAgent>(API_ROUTES.AI_AGENTS.LIST, params);
  }

  async getAgent(id: string): Promise<AIAgent> {
    const response = await this.get<AIAgent>(
      API_ROUTES.AI_AGENTS.GET.replace(':id', id)
    );
    return response.data!;
  }

  async createAgent(agentData: Omit<AIAgent, 'id' | 'createdAt' | 'updatedAt'>): Promise<AIAgent> {
    const response = await this.post<AIAgent>(API_ROUTES.AI_AGENTS.CREATE, agentData);
    return response.data!;
  }

  async updateAgent(id: string, agentData: Partial<AIAgent>): Promise<AIAgent> {
    const response = await this.patch<AIAgent>(
      API_ROUTES.AI_AGENTS.UPDATE.replace(':id', id),
      agentData
    );
    return response.data!;
  }

  async deleteAgent(id: string): Promise<void> {
    await this.delete(API_ROUTES.AI_AGENTS.DELETE.replace(':id', id));
  }

  async getAgentHealth(id: string): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    responseTime: number;
    lastChecked: Date;
  }> {
    const response = await this.get<{
      status: 'healthy' | 'degraded' | 'unhealthy';
      responseTime: number;
      lastChecked: string;
    }>(API_ROUTES.AI_AGENTS.HEALTH.replace(':id', id));
    
    return {
      ...response.data!,
      lastChecked: new Date(response.data!.lastChecked),
    };
  }

  // AI Request management
  async getRequests(params?: AIRequestListParams): Promise<PaginatedResponse<AIRequest>> {
    return this.getPaginated<AIRequest>(API_ROUTES.AI_REQUESTS.LIST, params);
  }

  async getRequest(id: string): Promise<AIRequest> {
    const response = await this.get<AIRequest>(
      API_ROUTES.AI_REQUESTS.GET.replace(':id', id)
    );
    return response.data!;
  }

  async createRequest(requestData: AIRequestCreate): Promise<AIRequestResponse> {
    const response = await this.post<AIRequestResponse>(
      API_ROUTES.AI_REQUESTS.CREATE, 
      requestData
    );
    return response.data!;
  }

  async cancelRequest(id: string): Promise<void> {
    await this.post(API_ROUTES.AI_REQUESTS.CANCEL.replace(':id', id));
  }

  // Streaming AI requests
  async streamRequest(
    requestData: AIRequestCreate,
    options: StreamOptions
  ): Promise<void> {
    return this.stream(API_ROUTES.AI_REQUESTS.STREAM, {
      ...options,
      data: requestData,
      method: 'POST',
    });
  }

  // Convenience methods for different AI capabilities
  async generateText(
    prompt: string,
    options: {
      agentId?: string;
      maxTokens?: number;
      temperature?: number;
      stream?: boolean;
      onProgress?: (chunk: string) => void;
    } = {}
  ): Promise<AIRequestResponse | void> {
    const requestData: AIRequestCreate = {
      prompt,
      capabilities: ['text-generation'],
      ...options,
    };

    if (options.stream) {
      return this.streamRequest(requestData, {
        onProgress: options.onProgress,
      });
    }

    return this.createRequest(requestData);
  }

  async generateCode(
    prompt: string,
    options: {
      agentId?: string;
      language?: string;
      maxTokens?: number;
    } = {}
  ): Promise<AIRequestResponse> {
    const requestData: AIRequestCreate = {
      prompt,
      capabilities: ['code-generation'],
      metadata: {
        language: options.language,
      },
      ...options,
    };

    return this.createRequest(requestData);
  }

  async analyzeData(
    data: any,
    prompt: string,
    options: {
      agentId?: string;
      format?: 'json' | 'text' | 'chart';
    } = {}
  ): Promise<AIRequestResponse> {
    const requestData: AIRequestCreate = {
      prompt,
      capabilities: ['data-analysis'],
      metadata: {
        inputData: data,
        outputFormat: options.format || 'text',
      },
      agentId: options.agentId,
    };

    return this.createRequest(requestData);
  }

  async translateText(
    text: string,
    targetLanguage: string,
    sourceLanguage?: string,
    options: {
      agentId?: string;
    } = {}
  ): Promise<AIRequestResponse> {
    const requestData: AIRequestCreate = {
      prompt: `Translate the following text to ${targetLanguage}: ${text}`,
      capabilities: ['translation'],
      metadata: {
        targetLanguage,
        sourceLanguage,
      },
      ...options,
    };

    return this.createRequest(requestData);
  }

  async summarizeText(
    text: string,
    options: {
      agentId?: string;
      length?: 'short' | 'medium' | 'long';
      format?: 'paragraph' | 'bullets' | 'key-points';
    } = {}
  ): Promise<AIRequestResponse> {
    const requestData: AIRequestCreate = {
      prompt: `Summarize the following text: ${text}`,
      capabilities: ['summarization'],
      metadata: {
        summaryLength: options.length || 'medium',
        summaryFormat: options.format || 'paragraph',
      },
      agentId: options.agentId,
    };

    return this.createRequest(requestData);
  }

  // Analytics and reporting
  async getUsageAnalytics(
    options: {
      dateFrom?: Date;
      dateTo?: Date;
      userId?: string;
      agentId?: string;
    } = {}
  ): Promise<UsageAnalytics> {
    const params = {
      ...(options.dateFrom && { dateFrom: options.dateFrom.toISOString() }),
      ...(options.dateTo && { dateTo: options.dateTo.toISOString() }),
      ...(options.userId && { userId: options.userId }),
      ...(options.agentId && { agentId: options.agentId }),
    };

    const response = await this.get<UsageAnalytics>('/ai/analytics', { params });
    return response.data!;
  }

  async getRequestMetrics(
    timeRange: '1h' | '24h' | '7d' | '30d' = '24h'
  ): Promise<{
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    requestsPerHour: Array<{ hour: string; count: number }>;
  }> {
    const response = await this.get<{
      totalRequests: number;
      successfulRequests: number;
      failedRequests: number;
      averageResponseTime: number;
      requestsPerHour: Array<{ hour: string; count: number }>;
    }>('/ai/metrics', { params: { timeRange } });
    
    return response.data!;
  }

  // Agent recommendations
  async getRecommendedAgent(
    capabilities: string[],
    options: {
      maxCost?: number;
      minResponseTime?: number;
      preferredProviders?: string[];
    } = {}
  ): Promise<{
    agent: AIAgent;
    score: number;
    reasoning: string;
  }> {
    const response = await this.post<{
      agent: AIAgent;
      score: number;
      reasoning: string;
    }>('/ai/agents/recommend', {
      capabilities,
      ...options,
    });
    
    return response.data!;
  }
}
