
import { createLogger } from '@ai-platform/shared-utils';
import { AIRequest, AIResponse } from '../types/ai.types';
import { BaseProvider } from './base-provider';

const logger = createLogger('claude-integration');

export interface ClaudeConfig {
  apiKey: string;
  baseURL?: string;
  version?: string;
  maxRetries?: number;
  timeout?: number;
}

export class ClaudeIntegration extends BaseProvider {
  private config: ClaudeConfig;
  private baseURL: string;
  private version: string;

  constructor(config: ClaudeConfig) {
    super('claude', 'Anthropic Claude');
    this.config = {
      maxRetries: 3,
      timeout: 30000,
      version: '2023-06-01',
      ...config,
    };
    this.baseURL = config.baseURL || 'https://api.anthropic.com';
    this.version = this.config.version;
  }

  async processRequest(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      logger.info('Processing Claude request', {
        requestId,
        model: request.model,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        stream: request.stream,
      });

      // Convert messages format for Claude API
      const { system, messages } = this.formatMessages(request.messages);

      // Build request payload for Claude
      const payload = {
        model: request.model || 'claude-3-sonnet-20240229',
        messages,
        max_tokens: request.maxTokens || 1000,
        temperature: request.temperature || 0.7,
        stream: request.stream || false,
        top_p: request.topP || 1,
        ...(system && { system }),
        ...(request.stop && { stop_sequences: Array.isArray(request.stop) ? request.stop : [request.stop] }),
        metadata: {
          user_id: request.userId?.toString(),
        },
      };

      // Send request to Claude API
      const response = await this.sendRequest('/v1/messages', payload, requestId);
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
        content: result.content?.[0]?.text || '',
        usage: {
          promptTokens: result.usage?.input_tokens || 0,
          completionTokens: result.usage?.output_tokens || 0,
          totalTokens: (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0),
        },
        finishReason: result.stop_reason || 'stop',
        responseTime: endTime - startTime,
        metadata: {
          requestId,
          timestamp: new Date().toISOString(),
          model: result.model,
          role: result.role,
        },
      };

      logger.info('Claude request completed', {
        requestId,
        responseTime: aiResponse.responseTime,
        tokenCount: aiResponse.usage.totalTokens,
      });

      return aiResponse;
    } catch (error) {
      const endTime = Date.now();
      logger.error('Claude request failed', {
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
      // Claude doesn't have a models endpoint, so we'll send a minimal test message
      const testPayload = {
        model: 'claude-3-haiku-20240307', // Use fastest model for health check
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1,
      };

      const response = await fetch(`${this.baseURL}/v1/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(5000), // 5 second timeout for health checks
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json();
        return {
          status: 'healthy',
          responseTime,
          details: {
            model: data.model,
            rateLimitRemaining: response.headers.get('anthropic-ratelimit-requests-remaining'),
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
      throw new Error(`Claude API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'anthropic-version': this.version,
      'x-api-key': this.config.apiKey,
      'User-Agent': 'AI-Employee-Platform/1.0',
    };
  }

  private formatMessages(messages: any[]): { system?: string; messages: any[] } {
    let system = '';
    const formattedMessages: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content;
      } else {
        formattedMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      }
    }

    return { system: system || undefined, messages: formattedMessages };
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
              
              if (parsed.type === 'content_block_delta') {
                content += parsed.delta?.text || '';
              }
              
              if (parsed.type === 'message_start') {
                model = parsed.message?.model || '';
                usage.promptTokens = parsed.message?.usage?.input_tokens || 0;
              }
              
              if (parsed.type === 'message_delta') {
                if (parsed.delta?.stop_reason) {
                  finishReason = parsed.delta.stop_reason;
                }
                if (parsed.usage?.output_tokens) {
                  usage.completionTokens = parsed.usage.output_tokens;
                  usage.totalTokens = usage.promptTokens + usage.completionTokens;
                }
              }
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
    let message = 'Unknown Claude error';
    let statusCode = 500;

    if (error.name === 'TimeoutError') {
      message = 'Claude request timeout';
      statusCode = 408;
    } else if (error.message?.includes('401')) {
      message = 'Claude authentication failed';
      statusCode = 401;
    } else if (error.message?.includes('429')) {
      message = 'Claude rate limit exceeded';
      statusCode = 429;
    } else if (error.message?.includes('500')) {
      message = 'Claude server error';
      statusCode = 500;
    } else if (error.message) {
      message = error.message;
    }

    const customError = new Error(message);
    (customError as any).statusCode = statusCode;
    (customError as any).requestId = requestId;
    (customError as any).provider = 'claude';

    return customError;
  }

  private generateRequestId(): string {
    return `claude_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default ClaudeIntegration;
