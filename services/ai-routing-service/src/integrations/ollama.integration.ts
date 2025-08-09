
import { createLogger } from '@ai-platform/shared-utils';
import { AIRequest, AIResponse } from '../types/ai.types';
import { BaseProvider } from './base-provider';

const logger = createLogger('ollama-integration');

export interface OllamaConfig {
  baseURL: string;
  maxRetries?: number;
  timeout?: number;
  defaultModel?: string;
}

export class OllamaIntegration extends BaseProvider {
  private config: OllamaConfig;
  private baseURL: string;

  constructor(config: OllamaConfig) {
    super('ollama', 'Ollama Local LLM');
    this.config = {
      maxRetries: 3,
      timeout: 60000, // Longer timeout for local models
      defaultModel: 'llama2',
      ...config,
    };
    this.baseURL = config.baseURL.replace(/\/$/, ''); // Remove trailing slash
  }

  async processRequest(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      logger.info('Processing Ollama request', {
        requestId,
        model: request.model,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        stream: request.stream,
      });

      // Format prompt for Ollama
      const prompt = this.formatPrompt(request.messages);
      const model = request.model || this.config.defaultModel;

      // Build request payload for Ollama
      const payload = {
        model,
        prompt,
        stream: request.stream || false,
        options: {
          temperature: request.temperature || 0.7,
          top_p: request.topP || 1,
          num_predict: request.maxTokens || 1000,
          ...(request.stop && { stop: Array.isArray(request.stop) ? request.stop : [request.stop] }),
          repeat_penalty: request.frequencyPenalty ? 1 + request.frequencyPenalty : 1.1,
        },
        context: [], // Context can be used for conversation history
      };

      // Send request to Ollama API
      const response = await this.sendRequest('/api/generate', payload, requestId);
      const endTime = Date.now();

      // Handle streaming response
      if (request.stream) {
        return this.handleStreamingResponse(response, requestId, startTime, model);
      }

      // Handle regular response
      const result = await response.json();
      const aiResponse: AIResponse = {
        id: requestId,
        model: result.model || model,
        provider: this.providerId,
        content: result.response || '',
        usage: this.calculateUsage(prompt, result.response || ''),
        finishReason: result.done ? 'stop' : 'length',
        responseTime: endTime - startTime,
        metadata: {
          requestId,
          timestamp: new Date().toISOString(),
          model: result.model || model,
          totalDuration: result.total_duration,
          loadDuration: result.load_duration,
          promptEvalCount: result.prompt_eval_count,
          evalCount: result.eval_count,
          evalDuration: result.eval_duration,
        },
      };

      logger.info('Ollama request completed', {
        requestId,
        responseTime: aiResponse.responseTime,
        tokenCount: aiResponse.usage.totalTokens,
        model: aiResponse.model,
      });

      return aiResponse;
    } catch (error) {
      const endTime = Date.now();
      logger.error('Ollama request failed', {
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
      // Check if Ollama is running and get available models
      const response = await fetch(`${this.baseURL}/api/tags`, {
        method: 'GET',
        headers: {
          'User-Agent': 'AI-Employee-Platform/1.0',
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout for health checks
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json();
        return {
          status: 'healthy',
          responseTime,
          details: {
            availableModels: data.models?.length || 0,
            models: data.models?.map((m: any) => m.name).slice(0, 5) || [],
            serverVersion: response.headers.get('server'),
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
          suggestion: 'Make sure Ollama is running and accessible',
        },
      };
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseURL}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        const data = await response.json();
        return data.models?.map((m: any) => m.name) || [];
      }
    } catch (error) {
      logger.error('Failed to fetch Ollama models', { error: error.message });
    }
    
    return [];
  }

  async pullModel(modelName: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/api/pull`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: modelName }),
        signal: AbortSignal.timeout(300000), // 5 minutes for model pull
      });

      return response.ok;
    } catch (error) {
      logger.error('Failed to pull Ollama model', { modelName, error: error.message });
      return false;
    }
  }

  private async sendRequest(endpoint: string, payload: any, requestId: string): Promise<Response> {
    const url = `${this.baseURL}${endpoint}`;
    
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
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return response;
  }

  private formatPrompt(messages: any[]): string {
    // Convert conversation messages to a single prompt
    let prompt = '';
    
    for (const message of messages) {
      const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      
      if (message.role === 'system') {
        prompt += `System: ${content}\n\n`;
      } else if (message.role === 'user') {
        prompt += `Human: ${content}\n\n`;
      } else if (message.role === 'assistant') {
        prompt += `Assistant: ${content}\n\n`;
      }
    }
    
    // Add final prompt for assistant response
    if (!prompt.endsWith('Assistant: ')) {
      prompt += 'Assistant: ';
    }
    
    return prompt;
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
    let totalDuration = 0;
    let evalCount = 0;
    let done = false;

    if (!reader) {
      throw new Error('Stream reader not available');
    }

    try {
      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            
            if (parsed.response) {
              content += parsed.response;
            }
            
            if (parsed.done) {
              done = parsed.done;
              totalDuration = parsed.total_duration || 0;
              evalCount = parsed.eval_count || 0;
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
      usage: this.calculateUsage('', content),
      finishReason: done ? 'stop' : 'length',
      responseTime: endTime - startTime,
      metadata: {
        requestId,
        timestamp: new Date().toISOString(),
        model,
        streaming: true,
        totalDuration,
        evalCount,
      },
    };
  }

  private calculateUsage(prompt: string, response: string) {
    // Rough token estimation (actual tokenization would be more accurate)
    const promptTokens = Math.ceil(prompt.length / 4);
    const completionTokens = Math.ceil(response.length / 4);
    
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };
  }

  private handleError(error: any, requestId: string): Error {
    let message = 'Unknown Ollama error';
    let statusCode = 500;

    if (error.name === 'TimeoutError') {
      message = 'Ollama request timeout';
      statusCode = 408;
    } else if (error.message?.includes('ECONNREFUSED')) {
      message = 'Ollama server not reachable';
      statusCode = 503;
    } else if (error.message?.includes('404')) {
      message = 'Ollama model not found';
      statusCode = 404;
    } else if (error.message?.includes('500')) {
      message = 'Ollama server error';
      statusCode = 500;
    } else if (error.message) {
      message = error.message;
    }

    const customError = new Error(message);
    (customError as any).statusCode = statusCode;
    (customError as any).requestId = requestId;
    (customError as any).provider = 'ollama';

    return customError;
  }

  private generateRequestId(): string {
    return `ollama_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default OllamaIntegration;
