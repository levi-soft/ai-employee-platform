
import { createLogger } from '@ai-platform/shared-utils';
import { AIRequest, AIResponse } from '../types/ai.types';
import { BaseProvider } from './base-provider';

const logger = createLogger('openai-integration');

export interface OpenAIConfig {
  apiKey: string;
  baseURL?: string;
  organization?: string;
  maxRetries?: number;
  timeout?: number;
}

export class OpenAIIntegration extends BaseProvider {
  private config: OpenAIConfig;
  private baseURL: string;

  constructor(config: OpenAIConfig) {
    super('openai', 'OpenAI');
    this.config = {
      maxRetries: 3,
      timeout: 30000,
      ...config,
    };
    this.baseURL = config.baseURL || 'https://api.openai.com/v1';
  }

  async processRequest(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      logger.info('Processing OpenAI request', {
        requestId,
        model: request.model,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        stream: request.stream,
      });

      // Format messages for OpenAI API
      const messages = this.formatMessages(request.messages);

      // Build request payload
      const payload = {
        model: request.model || 'gpt-4',
        messages,
        temperature: request.temperature || 0.7,
        max_tokens: request.maxTokens || 1000,
        stream: request.stream || false,
        top_p: request.topP || 1,
        frequency_penalty: request.frequencyPenalty || 0,
        presence_penalty: request.presencePenalty || 0,
        ...(request.stop && { stop: request.stop }),
        user: request.userId?.toString(),
      };

      // Send request to OpenAI API
      const response = await this.sendRequest('/chat/completions', payload, requestId);
      const endTime = Date.now();

      // Handle streaming response
      if (request.stream) {
        return this.handleStreamingResponse(response, requestId, startTime);
      }

      // Handle regular response
      const result = await response.json();
      const aiResponse: AIResponse = {
        id: result.id,
        model: result.model,
        provider: this.providerId,
        content: result.choices?.[0]?.message?.content || '',
        usage: {
          promptTokens: result.usage?.prompt_tokens || 0,
          completionTokens: result.usage?.completion_tokens || 0,
          totalTokens: result.usage?.total_tokens || 0,
        },
        finishReason: result.choices?.[0]?.finish_reason || 'stop',
        responseTime: endTime - startTime,
        metadata: {
          requestId,
          timestamp: new Date().toISOString(),
          model: result.model,
          systemFingerprint: result.system_fingerprint,
        },
      };

      logger.info('OpenAI request completed', {
        requestId,
        responseTime: aiResponse.responseTime,
        tokenCount: aiResponse.usage.totalTokens,
      });

      return aiResponse;
    } catch (error) {
      const endTime = Date.now();
      logger.error('OpenAI request failed', {
        requestId,
        error: error.message,
        responseTime: endTime - startTime,
      });

      throw this.handleError(error, requestId);
    }
  }

  async healthCheck(): Promise<{ status: string; responseTime: number; details?: any }> {
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000), // 5 second timeout for health checks
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json();
        return {
          status: 'healthy',
          responseTime,
          details: {
            availableModels: data.data?.length || 0,
            rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
          },
        };
      } else {
        return {
          status: 'degraded',
          responseTime,
          details: {
            statusCode: response.status,
            statusText: response.statusText,
          },
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        details: {
          error: error.message,
        },
      };
    }
  }

  private async sendRequest(endpoint: string, payload: any, requestId: string): Promise<Response> {
    const url = `${this.baseURL}${endpoint}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      'User-Agent': 'AI-Employee-Platform/1.0',
    };

    if (this.config.organization) {
      headers['OpenAI-Organization'] = this.config.organization;
    }

    return headers;
  }

  private formatMessages(messages: any[]): any[] {
    return messages.map(msg => ({
      role: msg.role || 'user',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      ...(msg.name && { name: msg.name }),
    }));
  }

  private async handleStreamingResponse(response: Response, requestId: string, startTime: number): Promise<AIResponse> {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let content = '';
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let model = '';
    let finishReason = 'stop';

    if (!reader) {
      throw new Error('Stream reader not available');
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              if (parsed.choices?.[0]?.delta?.content) {
                content += parsed.choices[0].delta.content;
              }
              if (parsed.model) model = parsed.model;
              if (parsed.choices?.[0]?.finish_reason) {
                finishReason = parsed.choices[0].finish_reason;
              }
              if (parsed.usage) usage = parsed.usage;
            } catch (e) {
              // Skip invalid JSON chunks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const endTime = Date.now();
    return {
      id: requestId,
      model,
      provider: this.providerId,
      content,
      usage,
      finishReason,
      responseTime: endTime - startTime,
      metadata: {
        requestId,
        timestamp: new Date().toISOString(),
        model,
        streaming: true,
      },
    };
  }

  private handleError(error: any, requestId: string): Error {
    let message = 'Unknown OpenAI error';
    let statusCode = 500;

    if (error.name === 'TimeoutError') {
      message = 'OpenAI request timeout';
      statusCode = 408;
    } else if (error.message?.includes('401')) {
      message = 'OpenAI authentication failed';
      statusCode = 401;
    } else if (error.message?.includes('429')) {
      message = 'OpenAI rate limit exceeded';
      statusCode = 429;
    } else if (error.message?.includes('500')) {
      message = 'OpenAI server error';
      statusCode = 500;
    } else if (error.message) {
      message = error.message;
    }

    const customError = new Error(message);
    (customError as any).statusCode = statusCode;
    (customError as any).requestId = requestId;
    (customError as any).provider = 'openai';

    return customError;
  }

  private generateRequestId(): string {
    return `openai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default OpenAIIntegration;
