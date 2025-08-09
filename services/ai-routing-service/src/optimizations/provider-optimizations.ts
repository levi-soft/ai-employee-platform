
import { logger } from '@ai-platform/shared-utils';
import { AIProviderType } from '../types/ai-types';

export interface OptimizationConfig {
  providerId: string;
  providerType: AIProviderType;
  optimizations: {
    tokenization: TokenizationOptimization;
    caching: CachingOptimization;
    batching: BatchingOptimization;
    streaming: StreamingOptimization;
    requestFormatting: RequestFormattingOptimization;
  };
  performance: {
    maxTokens: number;
    timeoutMs: number;
    retryAttempts: number;
    concurrentRequests: number;
  };
}

export interface TokenizationOptimization {
  enabled: boolean;
  strategy: 'precise' | 'estimated' | 'conservative';
  overhead: number; // Token overhead percentage
  compressionRatio: number;
  maxContextLength: number;
}

export interface CachingOptimization {
  enabled: boolean;
  ttl: number; // Time to live in seconds
  cacheKey: 'exact' | 'semantic' | 'parameterized';
  hitRateThreshold: number;
}

export interface BatchingOptimization {
  enabled: boolean;
  maxBatchSize: number;
  maxWaitTime: number; // milliseconds
  compatibilityCheck: boolean;
}

export interface StreamingOptimization {
  enabled: boolean;
  bufferSize: number;
  flushInterval: number; // milliseconds
  compressionEnabled: boolean;
}

export interface RequestFormattingOptimization {
  enabled: boolean;
  templateCaching: boolean;
  parameterOptimization: boolean;
  headerOptimization: boolean;
}

export class ProviderOptimizations {
  private optimizationConfigs: Map<string, OptimizationConfig> = new Map();
  private performanceMetrics: Map<string, ProviderPerformanceMetrics> = new Map();

  constructor() {
    this.initializeDefaultConfigurations();
  }

  /**
   * Initialize default optimization configurations for each provider
   */
  private initializeDefaultConfigurations(): void {
    // OpenAI Optimizations
    this.optimizationConfigs.set('openai-gpt-4', {
      providerId: 'openai-gpt-4',
      providerType: 'openai',
      optimizations: {
        tokenization: {
          enabled: true,
          strategy: 'precise',
          overhead: 0.05,
          compressionRatio: 0.85,
          maxContextLength: 128000
        },
        caching: {
          enabled: true,
          ttl: 3600,
          cacheKey: 'semantic',
          hitRateThreshold: 0.7
        },
        batching: {
          enabled: false, // OpenAI doesn't support native batching
          maxBatchSize: 1,
          maxWaitTime: 0,
          compatibilityCheck: false
        },
        streaming: {
          enabled: true,
          bufferSize: 1024,
          flushInterval: 50,
          compressionEnabled: true
        },
        requestFormatting: {
          enabled: true,
          templateCaching: true,
          parameterOptimization: true,
          headerOptimization: true
        }
      },
      performance: {
        maxTokens: 128000,
        timeoutMs: 120000,
        retryAttempts: 3,
        concurrentRequests: 100
      }
    });

    this.optimizationConfigs.set('openai-gpt-3.5', {
      providerId: 'openai-gpt-3.5',
      providerType: 'openai',
      optimizations: {
        tokenization: {
          enabled: true,
          strategy: 'precise',
          overhead: 0.05,
          compressionRatio: 0.9,
          maxContextLength: 16384
        },
        caching: {
          enabled: true,
          ttl: 1800,
          cacheKey: 'exact',
          hitRateThreshold: 0.8
        },
        batching: {
          enabled: false,
          maxBatchSize: 1,
          maxWaitTime: 0,
          compatibilityCheck: false
        },
        streaming: {
          enabled: true,
          bufferSize: 512,
          flushInterval: 25,
          compressionEnabled: true
        },
        requestFormatting: {
          enabled: true,
          templateCaching: true,
          parameterOptimization: true,
          headerOptimization: true
        }
      },
      performance: {
        maxTokens: 4096,
        timeoutMs: 60000,
        retryAttempts: 3,
        concurrentRequests: 200
      }
    });

    // Claude Optimizations
    this.optimizationConfigs.set('claude-3-sonnet', {
      providerId: 'claude-3-sonnet',
      providerType: 'claude',
      optimizations: {
        tokenization: {
          enabled: true,
          strategy: 'conservative',
          overhead: 0.08,
          compressionRatio: 0.88,
          maxContextLength: 200000
        },
        caching: {
          enabled: true,
          ttl: 2400,
          cacheKey: 'semantic',
          hitRateThreshold: 0.75
        },
        batching: {
          enabled: false,
          maxBatchSize: 1,
          maxWaitTime: 0,
          compatibilityCheck: false
        },
        streaming: {
          enabled: true,
          bufferSize: 2048,
          flushInterval: 75,
          compressionEnabled: true
        },
        requestFormatting: {
          enabled: true,
          templateCaching: true,
          parameterOptimization: true,
          headerOptimization: true
        }
      },
      performance: {
        maxTokens: 200000,
        timeoutMs: 180000,
        retryAttempts: 2,
        concurrentRequests: 50
      }
    });

    // Gemini Optimizations
    this.optimizationConfigs.set('gemini-pro', {
      providerId: 'gemini-pro',
      providerType: 'gemini',
      optimizations: {
        tokenization: {
          enabled: true,
          strategy: 'estimated',
          overhead: 0.10,
          compressionRatio: 0.82,
          maxContextLength: 30720
        },
        caching: {
          enabled: true,
          ttl: 1200,
          cacheKey: 'parameterized',
          hitRateThreshold: 0.65
        },
        batching: {
          enabled: true,
          maxBatchSize: 5,
          maxWaitTime: 100,
          compatibilityCheck: true
        },
        streaming: {
          enabled: false, // Gemini streaming has different implementation
          bufferSize: 0,
          flushInterval: 0,
          compressionEnabled: false
        },
        requestFormatting: {
          enabled: true,
          templateCaching: true,
          parameterOptimization: true,
          headerOptimization: false
        }
      },
      performance: {
        maxTokens: 30720,
        timeoutMs: 90000,
        retryAttempts: 3,
        concurrentRequests: 75
      }
    });

    // Ollama Optimizations
    this.optimizationConfigs.set('ollama-mistral', {
      providerId: 'ollama-mistral',
      providerType: 'ollama',
      optimizations: {
        tokenization: {
          enabled: true,
          strategy: 'conservative',
          overhead: 0.15,
          compressionRatio: 0.8,
          maxContextLength: 4096
        },
        caching: {
          enabled: true,
          ttl: 600,
          cacheKey: 'exact',
          hitRateThreshold: 0.9
        },
        batching: {
          enabled: true,
          maxBatchSize: 3,
          maxWaitTime: 200,
          compatibilityCheck: true
        },
        streaming: {
          enabled: true,
          bufferSize: 256,
          flushInterval: 100,
          compressionEnabled: false
        },
        requestFormatting: {
          enabled: true,
          templateCaching: false,
          parameterOptimization: true,
          headerOptimization: false
        }
      },
      performance: {
        maxTokens: 4096,
        timeoutMs: 30000,
        retryAttempts: 2,
        concurrentRequests: 20
      }
    });
  }

  /**
   * Get optimization configuration for a provider
   */
  getOptimizationConfig(providerId: string): OptimizationConfig | null {
    return this.optimizationConfigs.get(providerId) || null;
  }

  /**
   * Optimize request parameters based on provider-specific configurations
   */
  optimizeRequest(providerId: string, request: any): any {
    const config = this.optimizationConfigs.get(providerId);
    if (!config) {
      logger.warn('No optimization config found for provider', { providerId });
      return request;
    }

    let optimizedRequest = { ...request };

    try {
      // Apply tokenization optimizations
      if (config.optimizations.tokenization.enabled) {
        optimizedRequest = this.optimizeTokenization(optimizedRequest, config.optimizations.tokenization);
      }

      // Apply request formatting optimizations
      if (config.optimizations.requestFormatting.enabled) {
        optimizedRequest = this.optimizeRequestFormatting(optimizedRequest, config);
      }

      // Apply streaming optimizations
      if (config.optimizations.streaming.enabled && optimizedRequest.stream) {
        optimizedRequest = this.optimizeStreaming(optimizedRequest, config.optimizations.streaming);
      }

      logger.debug('Request optimized', { 
        providerId, 
        originalSize: JSON.stringify(request).length,
        optimizedSize: JSON.stringify(optimizedRequest).length
      });

      return optimizedRequest;

    } catch (error) {
      logger.error('Error optimizing request', { providerId, error });
      return request; // Return original request on error
    }
  }

  /**
   * Apply tokenization optimizations
   */
  private optimizeTokenization(request: any, config: TokenizationOptimization): any {
    if (!request.messages || !Array.isArray(request.messages)) {
      return request;
    }

    const optimizedMessages = request.messages.map((message: any) => {
      if (typeof message.content === 'string') {
        // Apply text compression strategies
        let optimizedContent = message.content;

        if (config.strategy === 'precise') {
          // Remove extra whitespace and normalize
          optimizedContent = optimizedContent
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .trim();
        } else if (config.strategy === 'conservative') {
          // Light optimization to preserve formatting
          optimizedContent = optimizedContent
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        }

        // Check context length limits
        const estimatedTokens = Math.ceil(optimizedContent.length / 4); // Rough estimation
        if (estimatedTokens > config.maxContextLength) {
          const maxChars = Math.floor(config.maxContextLength * 3.8); // Conservative character limit
          optimizedContent = optimizedContent.substring(0, maxChars) + '...';
        }

        return {
          ...message,
          content: optimizedContent
        };
      }
      return message;
    });

    return {
      ...request,
      messages: optimizedMessages
    };
  }

  /**
   * Apply request formatting optimizations
   */
  private optimizeRequestFormatting(request: any, config: OptimizationConfig): any {
    const formatting = config.optimizations.requestFormatting;
    let optimizedRequest = { ...request };

    if (formatting.parameterOptimization) {
      // Remove unnecessary parameters based on provider type
      switch (config.providerType) {
        case 'openai':
          // Remove unsupported parameters
          delete optimizedRequest.top_k;
          delete optimizedRequest.repetition_penalty;
          break;
          
        case 'claude':
          // Optimize for Claude's parameter names
          if (optimizedRequest.max_tokens) {
            optimizedRequest.max_tokens = Math.min(optimizedRequest.max_tokens, config.performance.maxTokens);
          }
          break;
          
        case 'gemini':
          // Convert to Gemini format
          if (optimizedRequest.messages) {
            optimizedRequest.contents = this.convertToGeminiFormat(optimizedRequest.messages);
            delete optimizedRequest.messages;
          }
          break;
          
        case 'ollama':
          // Optimize for local model parameters
          optimizedRequest.options = {
            ...optimizedRequest.options,
            num_predict: optimizedRequest.max_tokens || 1000,
            temperature: optimizedRequest.temperature || 0.7
          };
          break;
      }
    }

    return optimizedRequest;
  }

  /**
   * Convert messages to Gemini format
   */
  private convertToGeminiFormat(messages: any[]): any[] {
    return messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));
  }

  /**
   * Apply streaming optimizations
   */
  private optimizeStreaming(request: any, config: StreamingOptimization): any {
    return {
      ...request,
      stream: true,
      stream_options: {
        buffer_size: config.bufferSize,
        flush_interval: config.flushInterval,
        compression: config.compressionEnabled
      }
    };
  }

  /**
   * Analyze and update optimization settings based on performance metrics
   */
  async analyzeAndUpdateOptimizations(providerId: string, metrics: ProviderPerformanceMetrics): Promise<void> {
    this.performanceMetrics.set(providerId, metrics);
    
    const config = this.optimizationConfigs.get(providerId);
    if (!config) {
      return;
    }

    let updated = false;

    // Adjust caching based on hit rate
    if (metrics.cacheHitRate < config.optimizations.caching.hitRateThreshold) {
      if (config.optimizations.caching.cacheKey !== 'exact') {
        config.optimizations.caching.cacheKey = 'exact';
        updated = true;
        logger.info('Updated caching strategy to exact matching', { providerId });
      }
    } else if (metrics.cacheHitRate > 0.9 && config.optimizations.caching.cacheKey === 'exact') {
      config.optimizations.caching.cacheKey = 'semantic';
      updated = true;
      logger.info('Updated caching strategy to semantic matching', { providerId });
    }

    // Adjust tokenization strategy based on accuracy
    if (metrics.tokenAccuracy < 0.9 && config.optimizations.tokenization.strategy !== 'precise') {
      config.optimizations.tokenization.strategy = 'precise';
      updated = true;
      logger.info('Updated tokenization strategy to precise', { providerId });
    }

    // Adjust timeouts based on response times
    if (metrics.averageResponseTime > config.performance.timeoutMs * 0.8) {
      config.performance.timeoutMs = Math.min(
        config.performance.timeoutMs * 1.2,
        300000 // Max 5 minutes
      );
      updated = true;
      logger.info('Increased timeout threshold', { 
        providerId, 
        newTimeout: config.performance.timeoutMs 
      });
    }

    // Adjust concurrent requests based on error rate
    if (metrics.errorRate > 0.1) {
      config.performance.concurrentRequests = Math.max(
        Math.floor(config.performance.concurrentRequests * 0.8),
        1
      );
      updated = true;
      logger.info('Reduced concurrent request limit', {
        providerId,
        newLimit: config.performance.concurrentRequests
      });
    } else if (metrics.errorRate < 0.02 && metrics.averageResponseTime < 5000) {
      config.performance.concurrentRequests = Math.floor(
        config.performance.concurrentRequests * 1.1
      );
      updated = true;
      logger.info('Increased concurrent request limit', {
        providerId,
        newLimit: config.performance.concurrentRequests
      });
    }

    if (updated) {
      this.optimizationConfigs.set(providerId, config);
      logger.info('Optimization configuration updated', { providerId });
    }
  }

  /**
   * Get performance recommendations for a provider
   */
  getPerformanceRecommendations(providerId: string): string[] {
    const config = this.optimizationConfigs.get(providerId);
    const metrics = this.performanceMetrics.get(providerId);
    
    if (!config || !metrics) {
      return ['No data available for recommendations'];
    }

    const recommendations: string[] = [];

    // Cache recommendations
    if (metrics.cacheHitRate < 0.5) {
      recommendations.push('Consider improving cache key strategy or increasing cache TTL');
    }

    // Performance recommendations
    if (metrics.averageResponseTime > 10000) {
      recommendations.push('High response times detected, consider reducing request complexity');
    }

    // Error rate recommendations
    if (metrics.errorRate > 0.05) {
      recommendations.push('High error rate, consider implementing circuit breaker or reducing concurrent requests');
    }

    // Token optimization recommendations
    if (metrics.tokenAccuracy < 0.85) {
      recommendations.push('Token estimation accuracy is low, consider using precise tokenization strategy');
    }

    // Cost optimization recommendations
    if (metrics.averageCost > 0.1) {
      recommendations.push('High average cost per request, consider using more cost-effective models or optimizing prompts');
    }

    return recommendations.length > 0 ? recommendations : ['All metrics within optimal ranges'];
  }

  /**
   * Update optimization configuration for a provider
   */
  updateOptimizationConfig(providerId: string, updates: Partial<OptimizationConfig>): void {
    const currentConfig = this.optimizationConfigs.get(providerId);
    if (!currentConfig) {
      logger.warn('Cannot update config for unknown provider', { providerId });
      return;
    }

    const updatedConfig = {
      ...currentConfig,
      ...updates,
      optimizations: {
        ...currentConfig.optimizations,
        ...updates.optimizations
      },
      performance: {
        ...currentConfig.performance,
        ...updates.performance
      }
    };

    this.optimizationConfigs.set(providerId, updatedConfig);
    logger.info('Optimization configuration manually updated', { providerId });
  }

  /**
   * Get all optimization configurations
   */
  getAllOptimizationConfigs(): Record<string, OptimizationConfig> {
    const configs: Record<string, OptimizationConfig> = {};
    this.optimizationConfigs.forEach((config, providerId) => {
      configs[providerId] = { ...config };
    });
    return configs;
  }

  /**
   * Get performance metrics for all providers
   */
  getAllPerformanceMetrics(): Record<string, ProviderPerformanceMetrics> {
    const metrics: Record<string, ProviderPerformanceMetrics> = {};
    this.performanceMetrics.forEach((metric, providerId) => {
      metrics[providerId] = { ...metric };
    });
    return metrics;
  }
}

export interface ProviderPerformanceMetrics {
  averageResponseTime: number;
  errorRate: number;
  cacheHitRate: number;
  tokenAccuracy: number;
  averageCost: number;
  throughput: number;
  concurrentConnections: number;
  lastUpdated: Date;
}

