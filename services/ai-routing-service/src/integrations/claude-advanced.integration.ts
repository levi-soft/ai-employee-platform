
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '@ai-platform/shared-utils';
import { BaseProvider } from './base-provider';

export interface ClaudeAdvancedRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{
      type: 'text' | 'image';
      text?: string;
      source?: {
        type: 'base64';
        media_type: string;
        data: string;
      };
    }>;
  }>;
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stream?: boolean;
  stop_sequences?: string[];
  metadata?: {
    user_id?: string;
    tags?: string[];
  };
  tools?: Array<{
    name: string;
    description: string;
    input_schema: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  }>;
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
}

export interface ClaudeCapabilityConfig {
  enableReasoning: boolean;
  enableAnalysis: boolean;
  enableCreativeWriting: boolean;
  enableCodeGeneration: boolean;
  enableMathSolving: boolean;
  reasoningDepth: 'basic' | 'detailed' | 'comprehensive';
  safetyLevel: 'low' | 'medium' | 'high';
  contextOptimization: boolean;
}

export interface ClaudeAnalysisResult {
  reasoning_steps: string[];
  confidence: number;
  alternatives: string[];
  safety_assessment: {
    level: string;
    concerns: string[];
    recommendations: string[];
  };
  metadata: Record<string, any>;
}

export class ClaudeAdvancedIntegration extends BaseProvider {
  private client: Anthropic;
  private toolExecutors: Map<string, Function> = new Map();
  private capabilityConfigs: Map<string, ClaudeCapabilityConfig> = new Map();

  // Claude model capabilities
  private modelCapabilities = {
    'claude-3-opus-20240229': {
      maxTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      reasoningStrength: 'high',
      creativeStrength: 'high'
    },
    'claude-3-sonnet-20240229': {
      maxTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      reasoningStrength: 'high',
      creativeStrength: 'medium'
    },
    'claude-3-haiku-20240307': {
      maxTokens: 4096,
      supportsVision: true,
      supportsTools: true,
      reasoningStrength: 'medium',
      creativeStrength: 'medium'
    }
  };

  constructor() {
    super();
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    
    this.setupDefaultTools();
    this.setupDefaultCapabilityConfigs();
  }

  /**
   * Send advanced request with enhanced capabilities
   */
  async sendAdvancedRequest(request: ClaudeAdvancedRequest): Promise<any> {
    try {
      logger.info('Sending advanced Claude request', {
        model: request.model,
        hasTools: !!request.tools,
        hasVision: this.hasVisionContent(request.messages),
        messageCount: request.messages.length
      });

      // Apply capability enhancements
      const enhancedRequest = await this.enhanceRequest(request);

      // Send request to Claude
      const response = await this.client.messages.create(enhancedRequest as any);

      // Process and enhance response
      return await this.processAdvancedResponse(response, request);

    } catch (error) {
      logger.error('Advanced Claude request failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        model: request.model
      });
      throw this.handleProviderError(error);
    }
  }

  /**
   * Perform advanced reasoning with step-by-step analysis
   */
  async performAdvancedReasoning(
    problem: string,
    context?: string,
    config?: Partial<ClaudeCapabilityConfig>
  ): Promise<ClaudeAnalysisResult> {
    const finalConfig = { ...this.getDefaultCapabilityConfig(), ...config };

    try {
      const reasoningPrompt = this.buildReasoningPrompt(problem, context, finalConfig);

      const request: ClaudeAdvancedRequest = {
        model: 'claude-3-opus-20240229',
        messages: [
          {
            role: 'user',
            content: reasoningPrompt
          }
        ],
        max_tokens: 4000,
        temperature: 0.3, // Lower temperature for more consistent reasoning
        system: this.buildReasoningSystemPrompt(finalConfig)
      };

      const response = await this.sendAdvancedRequest(request);
      return this.parseReasoningResponse(response.content);

    } catch (error) {
      logger.error('Advanced reasoning failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Generate creative content with Claude's advanced capabilities
   */
  async generateCreativeContent(
    prompt: string,
    contentType: 'story' | 'poem' | 'script' | 'article' | 'dialogue',
    options: {
      style?: string;
      tone?: string;
      length?: 'short' | 'medium' | 'long';
      audience?: string;
    } = {}
  ): Promise<{
    content: string;
    style_analysis: string;
    creative_elements: string[];
    quality_score: number;
  }> {
    try {
      const creativePrompt = this.buildCreativePrompt(prompt, contentType, options);

      const request: ClaudeAdvancedRequest = {
        model: 'claude-3-opus-20240229',
        messages: [
          {
            role: 'user',
            content: creativePrompt
          }
        ],
        max_tokens: this.getTokensForLength(options.length),
        temperature: 0.8, // Higher temperature for creativity
        system: this.buildCreativeSystemPrompt(contentType, options)
      };

      const response = await this.sendAdvancedRequest(request);
      return this.parseCreativeResponse(response.content, contentType);

    } catch (error) {
      logger.error('Creative content generation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Analyze complex data or problems
   */
  async performComplexAnalysis(
    data: string | object,
    analysisType: 'statistical' | 'logical' | 'comparative' | 'predictive',
    config: {
      depth: 'surface' | 'detailed' | 'comprehensive';
      includeVisualization?: boolean;
      confidence_threshold?: number;
    }
  ): Promise<{
    analysis: string;
    insights: string[];
    confidence: number;
    recommendations: string[];
    data_quality: string;
  }> {
    try {
      const dataString = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      const analysisPrompt = this.buildAnalysisPrompt(dataString, analysisType, config);

      const request: ClaudeAdvancedRequest = {
        model: 'claude-3-sonnet-20240229',
        messages: [
          {
            role: 'user',
            content: analysisPrompt
          }
        ],
        max_tokens: this.getTokensForDepth(config.depth),
        temperature: 0.2, // Low temperature for analytical consistency
        system: this.buildAnalysisSystemPrompt(analysisType, config)
      };

      const response = await this.sendAdvancedRequest(request);
      return this.parseAnalysisResponse(response.content);

    } catch (error) {
      logger.error('Complex analysis failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Stream with advanced processing
   */
  async streamAdvanced(
    request: ClaudeAdvancedRequest,
    onChunk: (chunk: any) => void,
    onComplete: (result: any) => void,
    onError: (error: Error) => void
  ): Promise<void> {
    try {
      const enhancedRequest = await this.enhanceRequest({ ...request, stream: true });

      const stream = await this.client.messages.create(enhancedRequest as any);

      let fullContent = '';
      let toolUses: any[] = [];

      for await (const chunk of stream as any) {
        try {
          const processedChunk = this.processStreamingChunk(chunk);
          
          if (processedChunk.content) {
            fullContent += processedChunk.content;
          }

          if (processedChunk.tool_use) {
            toolUses.push(processedChunk.tool_use);
          }

          onChunk(processedChunk);

        } catch (chunkError) {
          logger.error('Error processing streaming chunk', {
            error: chunkError instanceof Error ? chunkError.message : 'Unknown error'
          });
        }
      }

      // Execute any tool calls
      const toolResults = await this.executeToolUses(toolUses);

      onComplete({
        content: fullContent,
        tool_uses: toolResults
      });

    } catch (error) {
      logger.error('Advanced streaming failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      onError(error instanceof Error ? error : new Error('Streaming failed'));
    }
  }

  /**
   * Register custom tool
   */
  registerTool(
    name: string,
    description: string,
    inputSchema: any,
    executor: Function
  ): void {
    this.toolExecutors.set(name, executor);
    
    logger.info('Tool registered for Claude', {
      name,
      description
    });
  }

  /**
   * Execute tool with Claude
   */
  async executeTool(
    name: string,
    input: any,
    timeoutMs: number = 30000
  ): Promise<any> {
    const executor = this.toolExecutors.get(name);
    if (!executor) {
      throw new Error(`Tool '${name}' not found`);
    }

    const startTime = Date.now();

    try {
      const result = await Promise.race([
        executor(input),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Tool execution timeout')), timeoutMs)
        )
      ]);

      const executionTime = Date.now() - startTime;

      logger.info('Tool executed successfully', {
        name,
        executionTime,
        hasResult: result !== undefined
      });

      return {
        success: true,
        result,
        execution_time: executionTime
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      logger.error('Tool execution failed', {
        name,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        execution_time: executionTime
      };
    }
  }

  /**
   * Get model capabilities
   */
  getModelCapabilities(model: string): any {
    return this.modelCapabilities[model as keyof typeof this.modelCapabilities] || null;
  }

  private async enhanceRequest(request: ClaudeAdvancedRequest): Promise<ClaudeAdvancedRequest> {
    const enhanced = { ...request };

    // Apply safety enhancements
    if (!enhanced.system) {
      enhanced.system = this.buildDefaultSystemPrompt();
    }

    // Add metadata if missing
    if (!enhanced.metadata) {
      enhanced.metadata = {
        user_id: 'system',
        tags: ['advanced-integration']
      };
    }

    // Optimize context if needed
    if (this.shouldOptimizeContext(enhanced)) {
      enhanced.messages = await this.optimizeContext(enhanced.messages);
    }

    return enhanced;
  }

  private async processAdvancedResponse(response: any, originalRequest: ClaudeAdvancedRequest): Promise<any> {
    const result: any = {
      id: response.id,
      content: response.content,
      model: response.model,
      role: response.role,
      stop_reason: response.stop_reason,
      usage: response.usage
    };

    // Process tool uses
    if (response.content) {
      const toolUses = this.extractToolUses(response.content);
      if (toolUses.length > 0) {
        const toolResults = await this.executeToolUses(toolUses);
        result.tool_uses = toolResults;
      }
    }

    // Add safety assessment
    result.safety_assessment = await this.assessSafety(result.content);

    return result;
  }

  private processStreamingChunk(chunk: any): any {
    const result: any = {
      type: chunk.type
    };

    switch (chunk.type) {
      case 'content_block_delta':
        result.content = chunk.delta?.text || '';
        break;

      case 'content_block_start':
        if (chunk.content_block?.type === 'tool_use') {
          result.tool_use = chunk.content_block;
        }
        break;

      case 'content_block_stop':
        result.stop_reason = chunk.stop_reason;
        break;

      default:
        result.data = chunk;
    }

    return result;
  }

  private hasVisionContent(messages: any[]): boolean {
    return messages.some(message => {
      if (Array.isArray(message.content)) {
        return message.content.some((content: any) => content.type === 'image');
      }
      return false;
    });
  }

  private buildReasoningPrompt(
    problem: string,
    context?: string,
    config?: ClaudeCapabilityConfig
  ): string {
    let prompt = `Please analyze the following problem using advanced reasoning:\n\n`;
    prompt += `Problem: ${problem}\n\n`;

    if (context) {
      prompt += `Context: ${context}\n\n`;
    }

    const depth = config?.reasoningDepth || 'detailed';
    
    switch (depth) {
      case 'comprehensive':
        prompt += `Please provide a comprehensive analysis including:\n`;
        prompt += `1. Problem decomposition\n`;
        prompt += `2. Step-by-step reasoning\n`;
        prompt += `3. Alternative approaches\n`;
        prompt += `4. Confidence assessment\n`;
        prompt += `5. Potential limitations\n`;
        prompt += `6. Recommendations\n`;
        break;
      case 'detailed':
        prompt += `Please provide detailed reasoning including:\n`;
        prompt += `1. Key insights\n`;
        prompt += `2. Logical steps\n`;
        prompt += `3. Confidence level\n`;
        prompt += `4. Alternative solutions\n`;
        break;
      default:
        prompt += `Please provide your reasoning and conclusion.\n`;
    }

    return prompt;
  }

  private buildCreativePrompt(
    prompt: string,
    contentType: string,
    options: any
  ): string {
    let creativePrompt = `Create ${contentType === 'article' ? 'an' : 'a'} ${contentType} based on: ${prompt}\n\n`;

    if (options.style) {
      creativePrompt += `Style: ${options.style}\n`;
    }
    if (options.tone) {
      creativePrompt += `Tone: ${options.tone}\n`;
    }
    if (options.audience) {
      creativePrompt += `Target audience: ${options.audience}\n`;
    }

    creativePrompt += `\nPlease be creative and engaging while maintaining high quality.`;

    return creativePrompt;
  }

  private buildAnalysisPrompt(
    data: string,
    analysisType: string,
    config: any
  ): string {
    let prompt = `Perform ${analysisType} analysis on the following data:\n\n`;
    prompt += `${data}\n\n`;

    switch (config.depth) {
      case 'comprehensive':
        prompt += `Please provide a comprehensive analysis including detailed insights, patterns, recommendations, and confidence assessments.`;
        break;
      case 'detailed':
        prompt += `Please provide a detailed analysis with key insights and recommendations.`;
        break;
      default:
        prompt += `Please provide a surface-level analysis with main findings.`;
    }

    return prompt;
  }

  private buildReasoningSystemPrompt(config: ClaudeCapabilityConfig): string {
    return `You are an advanced reasoning AI assistant. Your task is to provide thorough, logical analysis while maintaining high accuracy and clarity. Always show your reasoning steps and assess your confidence in your conclusions.`;
  }

  private buildCreativeSystemPrompt(contentType: string, options: any): string {
    return `You are a creative writing AI assistant specializing in ${contentType}. Focus on creating engaging, original content that matches the requested style and tone while maintaining high literary quality.`;
  }

  private buildAnalysisSystemPrompt(analysisType: string, config: any): string {
    return `You are an analytical AI assistant specializing in ${analysisType} analysis. Provide accurate, insightful analysis with clear reasoning and appropriate confidence levels.`;
  }

  private buildDefaultSystemPrompt(): string {
    return `You are Claude, an AI assistant created by Anthropic. You are helpful, harmless, and honest. You should be thorough in your responses while being concise when appropriate.`;
  }

  private async executeToolUses(toolUses: any[]): Promise<any[]> {
    const results = await Promise.all(
      toolUses.map(async (toolUse) => {
        try {
          const result = await this.executeTool(toolUse.name, toolUse.input);
          return {
            ...toolUse,
            result
          };
        } catch (error) {
          return {
            ...toolUse,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      })
    );
    return results;
  }

  private extractToolUses(content: any): any[] {
    // Extract tool uses from Claude's response
    const toolUses: any[] = [];
    
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_use') {
          toolUses.push(block);
        }
      }
    }

    return toolUses;
  }

  private async assessSafety(content: string): Promise<any> {
    // Simple safety assessment (in production, use more sophisticated methods)
    return {
      level: 'safe',
      concerns: [],
      recommendations: []
    };
  }

  private parseReasoningResponse(content: any): ClaudeAnalysisResult {
    const contentText = Array.isArray(content) 
      ? content.map(block => block.text || '').join('\n')
      : content;

    // Parse structured reasoning response
    return {
      reasoning_steps: this.extractReasoningSteps(contentText),
      confidence: this.extractConfidence(contentText),
      alternatives: this.extractAlternatives(contentText),
      safety_assessment: {
        level: 'safe',
        concerns: [],
        recommendations: []
      },
      metadata: { parsing_method: 'content_analysis' }
    };
  }

  private parseCreativeResponse(content: any, contentType: string): any {
    const contentText = Array.isArray(content) 
      ? content.map(block => block.text || '').join('\n')
      : content;

    return {
      content: contentText,
      style_analysis: `Generated ${contentType} with creative elements`,
      creative_elements: this.extractCreativeElements(contentText),
      quality_score: 0.85 // Placeholder scoring
    };
  }

  private parseAnalysisResponse(content: any): any {
    const contentText = Array.isArray(content) 
      ? content.map(block => block.text || '').join('\n')
      : content;

    return {
      analysis: contentText,
      insights: this.extractInsights(contentText),
      confidence: this.extractConfidence(contentText),
      recommendations: this.extractRecommendations(contentText),
      data_quality: 'good'
    };
  }

  private extractReasoningSteps(content: string): string[] {
    // Extract numbered or bulleted reasoning steps
    const steps = content.match(/(?:\d+\.|•|-)\s*(.+)/g) || [];
    return steps.map(step => step.replace(/^(?:\d+\.|•|-)\s*/, ''));
  }

  private extractConfidence(content: string): number {
    // Look for confidence indicators
    const confidenceMatches = content.match(/confidence[:\s]+(\d+)%?/i);
    if (confidenceMatches) {
      return parseInt(confidenceMatches[1]) / 100;
    }
    return 0.8; // Default confidence
  }

  private extractAlternatives(content: string): string[] {
    // Extract alternative approaches or solutions
    const alternatives = content.match(/alternative[s]?[:\s]+(.+)/gi) || [];
    return alternatives.map(alt => alt.replace(/alternative[s]?[:\s]+/i, ''));
  }

  private extractCreativeElements(content: string): string[] {
    // Identify creative elements in the content
    const elements = [];
    if (content.includes('metaphor') || content.match(/like|as.+as/)) elements.push('metaphors');
    if (content.match(/[.!?]{3,}/)) elements.push('dramatic emphasis');
    if (content.includes('dialogue') || content.match(/[""].*[""]|'.*'/)) elements.push('dialogue');
    return elements;
  }

  private extractInsights(content: string): string[] {
    // Extract key insights from analysis
    const insights = content.match(/insight[s]?[:\s]+(.+)/gi) || [];
    return insights.map(insight => insight.replace(/insight[s]?[:\s]+/i, ''));
  }

  private extractRecommendations(content: string): string[] {
    // Extract recommendations
    const recommendations = content.match(/recommend[s]?[:\s]+(.+)/gi) || [];
    return recommendations.map(rec => rec.replace(/recommend[s]?[:\s]+/i, ''));
  }

  private getTokensForLength(length?: string): number {
    switch (length) {
      case 'short': return 500;
      case 'medium': return 1500;
      case 'long': return 3000;
      default: return 1000;
    }
  }

  private getTokensForDepth(depth: string): number {
    switch (depth) {
      case 'surface': return 1000;
      case 'detailed': return 2000;
      case 'comprehensive': return 4000;
      default: return 1500;
    }
  }

  private shouldOptimizeContext(request: ClaudeAdvancedRequest): boolean {
    const totalTokens = request.messages.reduce((sum, msg) => {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return sum + content.length / 4; // Rough token estimation
    }, 0);

    return totalTokens > 8000; // Optimize if context is large
  }

  private async optimizeContext(messages: any[]): Promise<any[]> {
    // Simple context optimization - keep system message and recent messages
    if (messages.length <= 5) return messages;

    const systemMessages = messages.filter(msg => msg.role === 'system');
    const recentMessages = messages.slice(-4); // Keep last 4 messages

    return [...systemMessages, ...recentMessages];
  }

  private setupDefaultTools(): void {
    this.registerTool(
      'text_analysis',
      'Analyze text for sentiment, topics, and structure',
      {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to analyze' },
          analysis_type: { 
            type: 'string', 
            enum: ['sentiment', 'topics', 'structure', 'all'],
            description: 'Type of analysis to perform'
          }
        },
        required: ['text']
      },
      async (input: { text: string; analysis_type?: string }) => {
        return {
          sentiment: 'neutral',
          topics: ['general'],
          structure: 'paragraph',
          word_count: input.text.split(' ').length
        };
      }
    );

    this.registerTool(
      'data_processing',
      'Process and transform data',
      {
        type: 'object',
        properties: {
          data: { type: 'array', description: 'Data to process' },
          operation: { 
            type: 'string',
            enum: ['sort', 'filter', 'summarize', 'validate'],
            description: 'Operation to perform'
          }
        },
        required: ['data', 'operation']
      },
      async (input: { data: any[]; operation: string }) => {
        switch (input.operation) {
          case 'sort':
            return { result: input.data.sort() };
          case 'summarize':
            return { result: { count: input.data.length, sample: input.data.slice(0, 3) } };
          default:
            return { result: input.data };
        }
      }
    );
  }

  private setupDefaultCapabilityConfigs(): void {
    const defaultConfig: ClaudeCapabilityConfig = {
      enableReasoning: true,
      enableAnalysis: true,
      enableCreativeWriting: true,
      enableCodeGeneration: true,
      enableMathSolving: true,
      reasoningDepth: 'detailed',
      safetyLevel: 'medium',
      contextOptimization: true
    };

    this.capabilityConfigs.set('default', defaultConfig);
  }

  private getDefaultCapabilityConfig(): ClaudeCapabilityConfig {
    return this.capabilityConfigs.get('default')!;
  }
}

export default new ClaudeAdvancedIntegration();
