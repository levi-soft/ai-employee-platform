
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';
import { IRoutingResult } from './request-router';
import { IPreprocessedRequest } from './request-preprocessor';

export interface IProcessedResponse {
  requestId: string;
  success: boolean;
  content: string;
  metadata: {
    processingTime: number;
    originalResponseTime: number;
    transformations: string[];
    qualityScore: number;
    outputTokens: number;
    inputTokens: number;
    actualCost: number;
    cached: boolean;
    streaming: boolean;
    model?: string;
    provider?: string;
    agent?: string;
    [key: string]: any;
  };
  error?: string;
  warnings?: string[];
  usage: {
    tokens: {
      input: number;
      output: number;
      total: number;
    };
    cost: number;
    duration: number;
  };
  context: {
    requestId: string;
    userId?: string;
    sessionId?: string;
    timestamp: string;
  };
}

export interface IResponseTransform {
  name: string;
  priority: number;
  condition: (response: any, request: IPreprocessedRequest) => boolean;
  transform: (response: any, request: IPreprocessedRequest, routing: IRoutingResult) => Promise<any>;
  postProcess?: (processedResponse: IProcessedResponse) => Promise<IProcessedResponse>;
}

export interface IStreamChunk {
  id: string;
  type: 'content' | 'metadata' | 'error' | 'done';
  data: any;
  timestamp: number;
}

/**
 * Advanced response processing service with transformations, quality assessment, and streaming support
 */
export class ResponseProcessorService extends EventEmitter {
  private logger: Logger;
  private transformations: Map<string, IResponseTransform> = new Map();
  private qualityMetrics = new Map<string, any>();
  private processingHistory = new Map<string, any[]>();

  constructor() {
    super();
    this.logger = new Logger('ResponseProcessor');
    this.initializeDefaultTransformations();
  }

  /**
   * Process a complete response
   */
  async processResponse(
    rawResponse: any,
    request: IPreprocessedRequest,
    routing: IRoutingResult
  ): Promise<IProcessedResponse> {
    const startTime = Date.now();
    const requestId = request.id;

    this.logger.info('Starting response processing', {
      requestId,
      provider: routing.selectedProvider?.name,
      agent: routing.selectedAgent?.name
    });

    try {
      let processedResponse = rawResponse;
      const transformations: string[] = [];

      // Apply transformations
      const applicableTransforms = this.getApplicableTransforms(rawResponse, request);
      
      for (const transform of applicableTransforms) {
        try {
          this.logger.debug('Applying transformation', {
            requestId,
            transformation: transform.name
          });

          processedResponse = await transform.transform(processedResponse, request, routing);
          transformations.push(transform.name);

        } catch (error) {
          this.logger.warn('Transformation failed', {
            requestId,
            transformation: transform.name,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Calculate quality score
      const qualityScore = await this.calculateQualityScore(processedResponse, request);

      // Extract tokens and cost information
      const usage = this.extractUsageInfo(processedResponse, rawResponse);

      // Build final processed response
      const finalResponse: IProcessedResponse = {
        requestId,
        success: this.isSuccessfulResponse(processedResponse),
        content: this.extractContent(processedResponse),
        metadata: {
          processingTime: Date.now() - startTime,
          originalResponseTime: rawResponse.metadata?.responseTime || 0,
          transformations,
          qualityScore,
          outputTokens: usage.tokens.output,
          inputTokens: usage.tokens.input,
          actualCost: usage.cost,
          cached: rawResponse.metadata?.cached || false,
          streaming: rawResponse.metadata?.streaming || false,
          model: routing.selectedProvider?.model || routing.selectedAgent?.name,
          provider: routing.selectedProvider?.name,
          agent: routing.selectedAgent?.name,
          ...processedResponse.metadata
        },
        error: processedResponse.error,
        warnings: this.extractWarnings(processedResponse),
        usage,
        context: {
          requestId,
          userId: request.context.userId,
          sessionId: request.context.sessionId,
          timestamp: new Date().toISOString()
        }
      };

      // Apply post-processing transformations
      let postProcessedResponse = finalResponse;
      for (const transform of applicableTransforms) {
        if (transform.postProcess) {
          try {
            postProcessedResponse = await transform.postProcess(postProcessedResponse);
          } catch (error) {
            this.logger.warn('Post-processing failed', {
              requestId,
              transformation: transform.name,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }

      // Record processing history
      this.recordProcessingHistory(requestId, {
        transformations,
        qualityScore,
        processingTime: postProcessedResponse.metadata.processingTime,
        success: postProcessedResponse.success
      });

      this.logger.info('Response processing completed', {
        requestId,
        transformations: transformations.length,
        qualityScore: Math.round(qualityScore * 100) / 100,
        processingTime: postProcessedResponse.metadata.processingTime
      });

      this.emit('responseProcessed', { 
        request, 
        routing, 
        response: postProcessedResponse 
      });

      return postProcessedResponse;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      this.logger.error('Response processing failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        processingTime
      });

      // Return failed response
      const failedResponse: IProcessedResponse = {
        requestId,
        success: false,
        content: '',
        error: error instanceof Error ? error.message : 'Response processing failed',
        metadata: {
          processingTime,
          originalResponseTime: 0,
          transformations: [],
          qualityScore: 0,
          outputTokens: 0,
          inputTokens: 0,
          actualCost: 0,
          cached: false,
          streaming: false
        },
        usage: {
          tokens: { input: 0, output: 0, total: 0 },
          cost: 0,
          duration: processingTime
        },
        context: {
          requestId,
          userId: request.context.userId,
          sessionId: request.context.sessionId,
          timestamp: new Date().toISOString()
        }
      };

      this.emit('processingError', { request, routing, error, response: failedResponse });
      return failedResponse;
    }
  }

  /**
   * Process streaming response
   */
  async *processStreamingResponse(
    responseStream: AsyncIterable<any>,
    request: IPreprocessedRequest,
    routing: IRoutingResult
  ): AsyncGenerator<IStreamChunk, IProcessedResponse, unknown> {
    const startTime = Date.now();
    const requestId = request.id;
    let accumulatedContent = '';
    let chunkCount = 0;

    this.logger.info('Starting streaming response processing', {
      requestId,
      provider: routing.selectedProvider?.name
    });

    try {
      for await (const chunk of responseStream) {
        chunkCount++;
        
        // Process individual chunk
        const processedChunk = await this.processChunk(chunk, request, routing);
        
        if (processedChunk.type === 'content') {
          accumulatedContent += processedChunk.data;
        }

        yield {
          id: `${requestId}-${chunkCount}`,
          type: processedChunk.type,
          data: processedChunk.data,
          timestamp: Date.now()
        };

        this.emit('chunkProcessed', { 
          requestId, 
          chunkNumber: chunkCount, 
          chunk: processedChunk 
        });
      }

      // Process final accumulated response
      const finalResponse = await this.processResponse(
        {
          content: accumulatedContent,
          success: true,
          metadata: {
            streaming: true,
            chunkCount,
            responseTime: Date.now() - startTime
          }
        },
        request,
        routing
      );

      this.logger.info('Streaming response processing completed', {
        requestId,
        chunkCount,
        totalTime: Date.now() - startTime
      });

      return finalResponse;

    } catch (error) {
      this.logger.error('Streaming response processing failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        chunkCount
      });

      throw error;
    }
  }

  /**
   * Process individual stream chunk
   */
  private async processChunk(
    chunk: any, 
    request: IPreprocessedRequest, 
    routing: IRoutingResult
  ): Promise<{ type: 'content' | 'metadata' | 'error' | 'done'; data: any }> {
    try {
      // Handle different chunk formats
      if (typeof chunk === 'string') {
        return { type: 'content', data: chunk };
      }

      if (chunk.choices && chunk.choices[0]) {
        const delta = chunk.choices[0].delta;
        if (delta?.content) {
          return { type: 'content', data: delta.content };
        }
        if (chunk.choices[0].finish_reason) {
          return { type: 'done', data: { reason: chunk.choices[0].finish_reason } };
        }
      }

      if (chunk.error) {
        return { type: 'error', data: chunk.error };
      }

      if (chunk.usage) {
        return { type: 'metadata', data: { usage: chunk.usage } };
      }

      // Default to metadata
      return { type: 'metadata', data: chunk };

    } catch (error) {
      this.logger.warn('Chunk processing error', {
        requestId: request.id,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return { type: 'error', data: { error: 'Chunk processing failed' } };
    }
  }

  /**
   * Get applicable transformations
   */
  private getApplicableTransforms(response: any, request: IPreprocessedRequest): IResponseTransform[] {
    const applicable: IResponseTransform[] = [];

    for (const transform of this.transformations.values()) {
      if (transform.condition(response, request)) {
        applicable.push(transform);
      }
    }

    // Sort by priority (higher first)
    return applicable.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Calculate response quality score
   */
  private async calculateQualityScore(response: any, request: IPreprocessedRequest): Promise<number> {
    let score = 5.0; // Base score out of 10

    try {
      const content = this.extractContent(response);
      const requestContent = request.normalizedRequest.content;

      // Content length appropriateness (0-2 points)
      const contentLength = content.length;
      const requestLength = requestContent.length;
      const lengthRatio = contentLength / requestLength;
      
      if (lengthRatio >= 0.1 && lengthRatio <= 3.0) {
        score += 2.0;
      } else if (lengthRatio >= 0.05 && lengthRatio <= 5.0) {
        score += 1.0;
      }

      // Content relevance (0-2 points)
      const relevanceScore = await this.calculateContentRelevance(content, requestContent);
      score += relevanceScore * 2;

      // Response completeness (0-1 point)
      if (content.length > 10 && !content.includes('...') && !content.endsWith('incomplete')) {
        score += 1.0;
      }

      // Error indicators (-2 points)
      if (response.error || content.toLowerCase().includes('error') || content.toLowerCase().includes('failed')) {
        score -= 2.0;
      }

      // Response time bonus/penalty (±0.5 points)
      const responseTime = response.metadata?.responseTime || 0;
      if (responseTime < 2000) {
        score += 0.5;
      } else if (responseTime > 30000) {
        score -= 0.5;
      }

    } catch (error) {
      this.logger.warn('Quality score calculation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      score = 5.0; // Fallback to neutral score
    }

    // Ensure score is within bounds
    return Math.max(0, Math.min(10, score));
  }

  /**
   * Calculate content relevance
   */
  private async calculateContentRelevance(content: string, requestContent: string): Promise<number> {
    try {
      // Simple keyword-based relevance (in production, this could use more sophisticated NLP)
      const contentWords = content.toLowerCase().split(/\s+/);
      const requestWords = requestContent.toLowerCase().split(/\s+/).filter(word => word.length > 3);
      
      if (requestWords.length === 0) {
        return 0.5; // Neutral relevance for very short requests
      }

      let matchCount = 0;
      for (const word of requestWords) {
        if (contentWords.some(cWord => cWord.includes(word) || word.includes(cWord))) {
          matchCount++;
        }
      }

      return Math.min(1.0, matchCount / requestWords.length);

    } catch (error) {
      return 0.5; // Fallback to neutral relevance
    }
  }

  /**
   * Extract content from response
   */
  private extractContent(response: any): string {
    if (typeof response === 'string') {
      return response;
    }

    if (response.content) {
      return String(response.content);
    }

    if (response.choices && response.choices[0]) {
      return String(response.choices[0].message?.content || response.choices[0].text || '');
    }

    if (response.text) {
      return String(response.text);
    }

    if (response.output) {
      return String(response.output);
    }

    return '';
  }

  /**
   * Extract usage information
   */
  private extractUsageInfo(processedResponse: any, rawResponse: any): {
    tokens: { input: number; output: number; total: number };
    cost: number;
    duration: number;
  } {
    const defaultUsage = {
      tokens: { input: 0, output: 0, total: 0 },
      cost: 0,
      duration: 0
    };

    try {
      // Try to extract from various response formats
      const usage = processedResponse.usage || rawResponse.usage || {};
      const metadata = processedResponse.metadata || rawResponse.metadata || {};

      const inputTokens = usage.prompt_tokens || usage.input_tokens || metadata.inputTokens || 0;
      const outputTokens = usage.completion_tokens || usage.output_tokens || metadata.outputTokens || 0;
      const totalTokens = usage.total_tokens || inputTokens + outputTokens;

      const cost = metadata.cost || metadata.actualCost || this.estimateCost(inputTokens, outputTokens);
      const duration = metadata.responseTime || metadata.processingTime || 0;

      return {
        tokens: {
          input: inputTokens,
          output: outputTokens,
          total: totalTokens
        },
        cost,
        duration
      };

    } catch (error) {
      this.logger.warn('Failed to extract usage info', {
        error: error instanceof Error ? error.message : String(error)
      });
      return defaultUsage;
    }
  }

  /**
   * Estimate cost based on token usage
   */
  private estimateCost(inputTokens: number, outputTokens: number): number {
    // Rough cost estimation (would be provider-specific in production)
    const inputCostPerToken = 0.00001; // $0.01 per 1K tokens
    const outputCostPerToken = 0.00003; // $0.03 per 1K tokens
    
    return (inputTokens * inputCostPerToken) + (outputTokens * outputCostPerToken);
  }

  /**
   * Check if response is successful
   */
  private isSuccessfulResponse(response: any): boolean {
    if (response.success === false) {
      return false;
    }

    if (response.error) {
      return false;
    }

    const content = this.extractContent(response);
    return content.length > 0;
  }

  /**
   * Extract warnings from response
   */
  private extractWarnings(response: any): string[] {
    const warnings: string[] = [];

    if (response.warnings && Array.isArray(response.warnings)) {
      warnings.push(...response.warnings);
    }

    if (response.metadata?.warnings && Array.isArray(response.metadata.warnings)) {
      warnings.push(...response.metadata.warnings);
    }

    // Check for common warning indicators
    const content = this.extractContent(response);
    if (content.includes('rate limit') || content.includes('quota exceeded')) {
      warnings.push('Rate limiting detected');
    }

    if (content.includes('truncated') || content.includes('...')) {
      warnings.push('Response may be truncated');
    }

    return warnings;
  }

  /**
   * Initialize default transformations
   */
  private initializeDefaultTransformations(): void {
    // Content formatting transformation
    this.addTransformation({
      name: 'content_formatting',
      priority: 10,
      condition: (response, request) => typeof this.extractContent(response) === 'string',
      transform: async (response, request, routing) => {
        const content = this.extractContent(response);
        const formattedContent = content
          .trim()
          .replace(/\n{3,}/g, '\n\n') // Normalize excessive line breaks
          .replace(/\s{3,}/g, '  '); // Normalize excessive spaces

        return {
          ...response,
          content: formattedContent
        };
      }
    });

    // Safety filtering transformation
    this.addTransformation({
      name: 'safety_filtering',
      priority: 20,
      condition: (response, request) => this.extractContent(response).length > 0,
      transform: async (response, request, routing) => {
        const content = this.extractContent(response);
        
        // Remove potentially harmful content patterns
        const safeContent = content
          .replace(/password\s*[:=]\s*\S+/gi, '[PASSWORD_REDACTED]')
          .replace(/api[_\-]?key\s*[:=]\s*\S+/gi, '[API_KEY_REDACTED]')
          .replace(/token\s*[:=]\s*\S+/gi, '[TOKEN_REDACTED]');

        return {
          ...response,
          content: safeContent,
          metadata: {
            ...response.metadata,
            safetyFiltered: safeContent !== content
          }
        };
      }
    });

    // Markdown enhancement transformation
    this.addTransformation({
      name: 'markdown_enhancement',
      priority: 5,
      condition: (response, request) => {
        const type = request.normalizedRequest.type;
        return ['code_generation', 'documentation', 'explanation'].includes(type);
      },
      transform: async (response, request, routing) => {
        const content = this.extractContent(response);
        
        // Simple markdown enhancements
        const enhancedContent = content
          .replace(/```(\w+)?\n(.*?)\n```/gs, (match, lang, code) => {
            const language = lang || 'text';
            return `\`\`\`${language}\n${code.trim()}\n\`\`\``;
          });

        return {
          ...response,
          content: enhancedContent,
          metadata: {
            ...response.metadata,
            markdownEnhanced: true
          }
        };
      }
    });

    // Performance metrics transformation
    this.addTransformation({
      name: 'performance_metrics',
      priority: 1,
      condition: (response, request) => true,
      transform: async (response, request, routing) => {
        const content = this.extractContent(response);
        const metrics = {
          characterCount: content.length,
          wordCount: content.split(/\s+/).filter(word => word.length > 0).length,
          lineCount: content.split('\n').length,
          processingLatency: Date.now() - new Date(request.context.timestamp || Date.now()).getTime()
        };

        return {
          ...response,
          metadata: {
            ...response.metadata,
            performanceMetrics: metrics
          }
        };
      }
    });
  }

  /**
   * Add transformation
   */
  addTransformation(transformation: IResponseTransform): void {
    this.transformations.set(transformation.name, transformation);
    this.logger.info('Response transformation added', {
      name: transformation.name,
      priority: transformation.priority
    });
  }

  /**
   * Remove transformation
   */
  removeTransformation(name: string): void {
    if (this.transformations.delete(name)) {
      this.logger.info('Response transformation removed', { name });
    }
  }

  /**
   * Record processing history
   */
  private recordProcessingHistory(requestId: string, entry: any): void {
    const history = this.processingHistory.get(requestId) || [];
    history.push({
      ...entry,
      timestamp: new Date().toISOString()
    });
    this.processingHistory.set(requestId, history);

    // Cleanup old history
    if (this.processingHistory.size > 1000) {
      const oldestKey = this.processingHistory.keys().next().value;
      this.processingHistory.delete(oldestKey);
    }
  }

  /**
   * Get processing statistics
   */
  getProcessingStatistics(): {
    totalProcessed: number;
    averageQualityScore: number;
    averageProcessingTime: number;
    transformationUsage: Record<string, number>;
    successRate: number;
  } {
    const allHistory = Array.from(this.processingHistory.values()).flat();
    
    if (allHistory.length === 0) {
      return {
        totalProcessed: 0,
        averageQualityScore: 0,
        averageProcessingTime: 0,
        transformationUsage: {},
        successRate: 0
      };
    }

    const transformationUsage: Record<string, number> = {};
    let totalQualityScore = 0;
    let totalProcessingTime = 0;
    let successCount = 0;

    for (const entry of allHistory) {
      if (entry.transformations) {
        for (const transformation of entry.transformations) {
          transformationUsage[transformation] = (transformationUsage[transformation] || 0) + 1;
        }
      }

      totalQualityScore += entry.qualityScore || 0;
      totalProcessingTime += entry.processingTime || 0;
      
      if (entry.success) {
        successCount++;
      }
    }

    return {
      totalProcessed: allHistory.length,
      averageQualityScore: totalQualityScore / allHistory.length,
      averageProcessingTime: totalProcessingTime / allHistory.length,
      transformationUsage,
      successRate: successCount / allHistory.length
    };
  }
}
