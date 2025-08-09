
import { createLogger } from '@ai-platform/shared-utils';
import { AIRequest, AIResponse } from '../types/ai.types';
import { BaseProvider } from './base-provider';

const logger = createLogger('gemini-integration');

export interface GeminiConfig {
  apiKey: string;
  baseURL?: string;
  maxRetries?: number;
  timeout?: number;
}

export class GeminiIntegration extends BaseProvider {
  private config: GeminiConfig;
  private baseURL: string;

  constructor(config: GeminiConfig) {
    super('gemini', 'Google Gemini');
    this.config = {
      maxRetries: 3,
      timeout: 30000,
      ...config,
    };
    this.baseURL = config.baseURL || 'https://generativelanguage.googleapis.com';
  }

  async processRequest(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      logger.info('Processing Gemini request', {
        requestId,
        model: request.model,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        stream: request.stream,
      });

      // Format messages for Gemini API
      const contents = this.formatMessages(request.messages);
      const model = request.model || 'gemini-pro';

      // Build request payload for Gemini
      const payload = {
        contents,
        generationConfig: {
          temperature: request.temperature || 0.7,
          topP: request.topP || 1,
          maxOutputTokens: request.maxTokens || 1000,
          ...(request.stop && { stopSequences: Array.isArray(request.stop) ? request.stop : [request.stop] }),
        },
        safetySettings: [
          {
            category: 'HARM_CATEGORY_HARASSMENT',
            threshold: 'BLOCK_MEDIUM_AND_ABOVE',
          },
          {
            category: 'HARM_CATEGORY_HATE_SPEECH',
            threshold: 'BLOCK_MEDIUM_AND_ABOVE',
          },
          {
            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
            threshold: 'BLOCK_MEDIUM_AND_ABOVE',
          },
          {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
            threshold: 'BLOCK_MEDIUM_AND_ABOVE',
          },
        ],
      };

      // Send request to Gemini API
      const endpoint = request.stream 
        ? `/v1beta/models/${model}:streamGenerateContent`
        : `/v1beta/models/${model}:generateContent`;
        
      const response = await this.sendRequest(endpoint, payload, requestId);
      const endTime = Date.now();

      // Handle streaming response
      if (request.stream) {
        return this.handleStreamingResponse(response, requestId, startTime, model);
      }

      // Handle regular response
      const result = await response.json();
      const candidate = result.candidates?.[0];
      
      if (!candidate) {
        throw new Error('No candidates returned from Gemini API');
      }

      const aiResponse: AIResponse = {
        id: requestId,
        model,
        provider: this.providerId,
        content: candidate.content?.parts?.[0]?.text || '',
        usage: {
          promptTokens: result.usageMetadata?.promptTokenCount || 0,
          completionTokens: result.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: result.usageMetadata?.totalTokenCount || 0,
        },
        finishReason: this.mapFinishReason(candidate.finishReason),
        responseTime: endTime - startTime,
        metadata: {
          requestId,
          timestamp: new Date().toISOString(),
          model,
          safetyRatings: candidate.safetyRatings,
        },
      };

      logger.info('Gemini request completed', {
        requestId,
        responseTime: aiResponse.responseTime,
        tokenCount: aiResponse.usage.totalTokens,
      });

      return aiResponse;
    } catch (error) {
      const endTime = Date.now();
      logger.error('Gemini request failed', {
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
      // Get available models as a health check
      const response = await fetch(`${this.baseURL}/v1beta/models?key=${this.config.apiKey}`, {
        method: 'GET',
        headers: {
          'User-Agent': 'AI-Employee-Platform/1.0',
        },
        signal: AbortSignal.timeout(5000), // 5 second timeout for health checks
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json();
        return {
          status: 'healthy',
          responseTime,
          details: {
            availableModels: data.models?.length || 0,
            models: data.models?.slice(0, 3).map((m: any) => m.name) || [],
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
    const url = `${this.baseURL}${endpoint}?key=${this.config.apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AI-Employee-Platform/1.0',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response;
  }

  private formatMessages(messages: any[]): any[] {
    const contents: any[] = [];
    
    for (const msg of messages) {
      // Gemini doesn't have a system role, so we'll add system messages as user messages with a prefix
      let role = msg.role;
      let content = msg.content;
      
      if (role === 'system') {
        role = 'user';
        content = `[System] ${content}`;
      } else if (role === 'assistant') {
        role = 'model';
      }

      contents.push({
        role,
        parts: [
          {
            text: typeof content === 'string' ? content : JSON.stringify(content),
          },
        ],
      });
    }

    return contents;
  }

  private async handleStreamingResponse(
    response: Response, 
    requestId: string, 
    startTime: number, 
    model: string
  ): Promise<AIResponse> {
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let content = '';
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finishReason = 'stop';
    let safetyRatings: any[] = [];

    if (!reader) {
      throw new Error('Stream reader not available');
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        
        // Gemini streaming format is JSON objects separated by newlines
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            
            if (parsed.candidates?.[0]) {
              const candidate = parsed.candidates[0];
              
              if (candidate.content?.parts?.[0]?.text) {
                content += candidate.content.parts[0].text;
              }
              
              if (candidate.finishReason) {
                finishReason = this.mapFinishReason(candidate.finishReason);
              }
              
              if (candidate.safetyRatings) {
                safetyRatings = candidate.safetyRatings;
              }
            }
            
            if (parsed.usageMetadata) {
              usage = {
                promptTokens: parsed.usageMetadata.promptTokenCount || 0,
                completionTokens: parsed.usageMetadata.candidatesTokenCount || 0,
                totalTokens: parsed.usageMetadata.totalTokenCount || 0,
              };
            }
          } catch (e) {
            // Skip invalid JSON chunks
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
        safetyRatings,
      },
    };
  }

  private mapFinishReason(geminiReason: string): string {
    const reasonMap: Record<string, string> = {
      'FINISH_REASON_STOP': 'stop',
      'FINISH_REASON_MAX_TOKENS': 'length',
      'FINISH_REASON_SAFETY': 'content_filter',
      'FINISH_REASON_RECITATION': 'content_filter',
      'FINISH_REASON_OTHER': 'other',
      'STOP': 'stop',
      'MAX_TOKENS': 'length',
    };
    
    return reasonMap[geminiReason] || 'stop';
  }

  private handleError(error: any, requestId: string): Error {
    let message = 'Unknown Gemini error';
    let statusCode = 500;

    if (error.name === 'TimeoutError') {
      message = 'Gemini request timeout';
      statusCode = 408;
    } else if (error.message?.includes('401') || error.message?.includes('403')) {
      message = 'Gemini authentication failed';
      statusCode = 401;
    } else if (error.message?.includes('429')) {
      message = 'Gemini rate limit exceeded';
      statusCode = 429;
    } else if (error.message?.includes('500')) {
      message = 'Gemini server error';
      statusCode = 500;
    } else if (error.message) {
      message = error.message;
    }

    const customError = new Error(message);
    (customError as any).statusCode = statusCode;
    (customError as any).requestId = requestId;
    (customError as any).provider = 'gemini';

    return customError;
  }

  private generateRequestId(): string {
    return `gemini_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default GeminiIntegration;
