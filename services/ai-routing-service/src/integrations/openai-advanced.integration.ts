
import OpenAI from 'openai';
import { logger } from '@ai-platform/shared-utils';
import { BaseProvider } from './base-provider';

export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

export interface VisionMessage {
  role: 'user' | 'assistant';
  content: Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
      url: string;
      detail?: 'low' | 'high' | 'auto';
    };
  }>;
}

export interface AdvancedOpenAIRequest {
  model: string;
  messages: any[];
  functions?: FunctionDefinition[];
  function_call?: 'none' | 'auto' | { name: string };
  tools?: Array<{
    type: 'function';
    function: FunctionDefinition;
  }>;
  tool_choice?: 'none' | 'auto' | { type: 'function'; function: { name: string } };
  vision_config?: {
    detail: 'low' | 'high' | 'auto';
    max_tokens?: number;
  };
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

export interface FunctionCallResult {
  name: string;
  arguments: string;
  result?: any;
  error?: string;
  execution_time?: number;
}

export class OpenAIAdvancedIntegration extends BaseProvider {
  private client: OpenAI;
  private functionExecutors: Map<string, Function> = new Map();
  private visionModels = ['gpt-4-vision-preview', 'gpt-4o', 'gpt-4o-mini'];

  constructor() {
    super();
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    this.setupDefaultFunctions();
  }

  /**
   * Send advanced request with function calling and vision support
   */
  async sendAdvancedRequest(request: AdvancedOpenAIRequest): Promise<any> {
    try {
      logger.info('Sending advanced OpenAI request', {
        model: request.model,
        hasVision: this.hasVisionContent(request.messages),
        hasFunctions: !!request.functions || !!request.tools,
        stream: request.stream
      });

      // Prepare the request
      const preparedRequest = await this.prepareAdvancedRequest(request);

      // Send request to OpenAI
      const response = await this.client.chat.completions.create(preparedRequest as any);

      // Process response
      return await this.processAdvancedResponse(response, request);

    } catch (error) {
      logger.error('Advanced OpenAI request failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        model: request.model
      });
      throw this.handleProviderError(error);
    }
  }

  /**
   * Send streaming request with advanced features
   */
  async sendStreamingRequest(
    request: AdvancedOpenAIRequest,
    onChunk: (chunk: any) => void,
    onComplete: (result: any) => void,
    onError: (error: Error) => void
  ): Promise<void> {
    try {
      const preparedRequest = await this.prepareAdvancedRequest({
        ...request,
        stream: true
      });

      const stream = await this.client.chat.completions.create(preparedRequest as any);

      let fullResponse = '';
      let functionCalls: FunctionCallResult[] = [];
      let toolCalls: any[] = [];

      for await (const chunk of stream as any) {
        try {
          // Process streaming chunk
          const processedChunk = await this.processStreamingChunk(chunk);
          
          if (processedChunk.content) {
            fullResponse += processedChunk.content;
          }

          // Handle function calls in streaming
          if (processedChunk.function_call) {
            functionCalls.push(processedChunk.function_call);
          }

          if (processedChunk.tool_calls) {
            toolCalls.push(...processedChunk.tool_calls);
          }

          onChunk(processedChunk);

        } catch (chunkError) {
          logger.error('Error processing streaming chunk', {
            error: chunkError instanceof Error ? chunkError.message : 'Unknown error'
          });
        }
      }

      // Execute any function calls that were collected
      const functionResults = await this.executeFunctionCalls(functionCalls);
      const toolResults = await this.executeToolCalls(toolCalls);

      onComplete({
        content: fullResponse,
        function_calls: functionResults,
        tool_calls: toolResults
      });

    } catch (error) {
      logger.error('Advanced streaming request failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      onError(error instanceof Error ? error : new Error('Streaming failed'));
    }
  }

  /**
   * Process vision requests with image analysis
   */
  async processVisionRequest(
    messages: VisionMessage[],
    options: {
      model?: string;
      detail?: 'low' | 'high' | 'auto';
      max_tokens?: number;
    } = {}
  ): Promise<any> {
    const model = options.model || 'gpt-4o';
    
    if (!this.visionModels.includes(model)) {
      throw new Error(`Model ${model} does not support vision`);
    }

    try {
      // Prepare vision request
      const visionRequest: AdvancedOpenAIRequest = {
        model,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content.map(content => {
            if (content.type === 'image_url') {
              return {
                type: 'image_url',
                image_url: {
                  url: content.image_url!.url,
                  detail: content.image_url?.detail || options.detail || 'auto'
                }
              };
            }
            return content;
          })
        })),
        max_tokens: options.max_tokens || 1000,
        vision_config: {
          detail: options.detail || 'auto',
          max_tokens: options.max_tokens || 1000
        }
      };

      logger.info('Processing vision request', {
        model,
        imageCount: this.countImages(messages),
        detail: options.detail
      });

      return await this.sendAdvancedRequest(visionRequest);

    } catch (error) {
      logger.error('Vision request failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Register custom function for function calling
   */
  registerFunction(definition: FunctionDefinition, executor: Function): void {
    this.functionExecutors.set(definition.name, executor);
    
    logger.info('Function registered', {
      name: definition.name,
      description: definition.description
    });
  }

  /**
   * Execute function call with error handling and timeout
   */
  async executeFunction(
    name: string,
    argumentsJson: string,
    timeoutMs: number = 30000
  ): Promise<FunctionCallResult> {
    const executor = this.functionExecutors.get(name);
    if (!executor) {
      return {
        name,
        arguments: argumentsJson,
        error: `Function '${name}' not found`
      };
    }

    const startTime = Date.now();

    try {
      // Parse arguments
      const args = JSON.parse(argumentsJson);
      
      // Execute with timeout
      const result = await Promise.race([
        executor(args),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Function execution timeout')), timeoutMs)
        )
      ]);

      const executionTime = Date.now() - startTime;

      logger.info('Function executed successfully', {
        name,
        executionTime,
        hasResult: result !== undefined
      });

      return {
        name,
        arguments: argumentsJson,
        result,
        execution_time: executionTime
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      logger.error('Function execution failed', {
        name,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime
      });

      return {
        name,
        arguments: argumentsJson,
        error: error instanceof Error ? error.message : 'Unknown error',
        execution_time: executionTime
      };
    }
  }

  /**
   * Analyze image and extract information
   */
  async analyzeImage(
    imageUrl: string,
    prompt: string = 'Describe what you see in this image',
    options: {
      detail?: 'low' | 'high' | 'auto';
      focus?: string[];
    } = {}
  ): Promise<{
    description: string;
    objects: string[];
    confidence: number;
    metadata: Record<string, any>;
  }> {
    try {
      const enhancedPrompt = this.buildImageAnalysisPrompt(prompt, options.focus);

      const messages: VisionMessage[] = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: enhancedPrompt
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: options.detail || 'high'
              }
            }
          ]
        }
      ];

      const response = await this.processVisionRequest(messages, {
        max_tokens: 1000,
        detail: options.detail
      });

      // Parse structured response
      return this.parseImageAnalysisResponse(response.content);

    } catch (error) {
      logger.error('Image analysis failed', {
        imageUrl: imageUrl.substring(0, 100) + '...',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get available functions
   */
  getAvailableFunctions(): FunctionDefinition[] {
    return Array.from(this.functionExecutors.keys()).map(name => ({
      name,
      description: `Registered function: ${name}`,
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }));
  }

  private async prepareAdvancedRequest(request: AdvancedOpenAIRequest): Promise<any> {
    const prepared: any = {
      model: request.model,
      messages: request.messages,
      stream: request.stream || false,
      temperature: request.temperature || 0.7,
      max_tokens: request.max_tokens || 1000
    };

    // Add function calling if present
    if (request.functions) {
      prepared.functions = request.functions;
      prepared.function_call = request.function_call || 'auto';
    }

    // Add tools if present (newer API)
    if (request.tools) {
      prepared.tools = request.tools;
      prepared.tool_choice = request.tool_choice || 'auto';
    }

    // Add other parameters
    if (request.top_p !== undefined) prepared.top_p = request.top_p;
    if (request.frequency_penalty !== undefined) prepared.frequency_penalty = request.frequency_penalty;
    if (request.presence_penalty !== undefined) prepared.presence_penalty = request.presence_penalty;

    return prepared;
  }

  private async processAdvancedResponse(response: any, originalRequest: AdvancedOpenAIRequest): Promise<any> {
    const choice = response.choices?.[0];
    if (!choice) {
      throw new Error('No response choice available');
    }

    const result: any = {
      content: choice.message?.content || '',
      finish_reason: choice.finish_reason,
      usage: response.usage,
      model: response.model
    };

    // Handle function calls
    if (choice.message?.function_call) {
      const functionResult = await this.executeFunction(
        choice.message.function_call.name,
        choice.message.function_call.arguments
      );
      result.function_call = functionResult;
    }

    // Handle tool calls
    if (choice.message?.tool_calls) {
      const toolResults = await this.executeToolCalls(choice.message.tool_calls);
      result.tool_calls = toolResults;
    }

    return result;
  }

  private async processStreamingChunk(chunk: any): Promise<any> {
    const choice = chunk.choices?.[0];
    if (!choice) {
      return {};
    }

    const result: any = {
      id: chunk.id,
      model: chunk.model,
      content: choice.delta?.content || '',
      finish_reason: choice.finish_reason
    };

    // Handle function calls in streaming
    if (choice.delta?.function_call) {
      result.function_call = choice.delta.function_call;
    }

    // Handle tool calls in streaming
    if (choice.delta?.tool_calls) {
      result.tool_calls = choice.delta.tool_calls;
    }

    return result;
  }

  private async executeFunctionCalls(calls: FunctionCallResult[]): Promise<FunctionCallResult[]> {
    const results = await Promise.all(
      calls.map(call => this.executeFunction(call.name, call.arguments))
    );
    return results;
  }

  private async executeToolCalls(toolCalls: any[]): Promise<any[]> {
    const results = await Promise.all(
      toolCalls.map(async (toolCall) => {
        if (toolCall.type === 'function') {
          const result = await this.executeFunction(
            toolCall.function.name,
            toolCall.function.arguments
          );
          return {
            ...toolCall,
            result
          };
        }
        return toolCall;
      })
    );
    return results;
  }

  private hasVisionContent(messages: any[]): boolean {
    return messages.some(message => {
      if (Array.isArray(message.content)) {
        return message.content.some((content: any) => content.type === 'image_url');
      }
      return false;
    });
  }

  private countImages(messages: VisionMessage[]): number {
    let count = 0;
    for (const message of messages) {
      for (const content of message.content) {
        if (content.type === 'image_url') {
          count++;
        }
      }
    }
    return count;
  }

  private buildImageAnalysisPrompt(basePrompt: string, focus?: string[]): string {
    let prompt = basePrompt;
    
    if (focus && focus.length > 0) {
      prompt += `\n\nPlease focus on: ${focus.join(', ')}`;
    }

    prompt += '\n\nProvide your response in the following JSON format:\n';
    prompt += '{\n';
    prompt += '  "description": "detailed description of the image",\n';
    prompt += '  "objects": ["list", "of", "detected", "objects"],\n';
    prompt += '  "confidence": 0.95,\n';
    prompt += '  "metadata": { "any": "additional", "information": "here" }\n';
    prompt += '}';

    return prompt;
  }

  private parseImageAnalysisResponse(content: string): {
    description: string;
    objects: string[];
    confidence: number;
    metadata: Record<string, any>;
  } {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          description: parsed.description || content,
          objects: parsed.objects || [],
          confidence: parsed.confidence || 0.8,
          metadata: parsed.metadata || {}
        };
      }
    } catch (error) {
      logger.warn('Failed to parse structured image analysis response', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Fallback to basic parsing
    return {
      description: content,
      objects: [],
      confidence: 0.7,
      metadata: { parsing_method: 'fallback' }
    };
  }

  private setupDefaultFunctions(): void {
    // Register default utility functions
    
    this.registerFunction(
      {
        name: 'get_current_time',
        description: 'Get the current date and time',
        parameters: {
          type: 'object',
          properties: {
            timezone: {
              type: 'string',
              description: 'Timezone (optional, defaults to UTC)'
            }
          },
          required: []
        }
      },
      (args: { timezone?: string }) => {
        const now = new Date();
        if (args.timezone) {
          return now.toLocaleString('en-US', { timeZone: args.timezone });
        }
        return now.toISOString();
      }
    );

    this.registerFunction(
      {
        name: 'calculate',
        description: 'Perform basic mathematical calculations',
        parameters: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description: 'Mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)")'
            }
          },
          required: ['expression']
        }
      },
      (args: { expression: string }) => {
        try {
          // Simple calculator (in production, use a safer math evaluator)
          const result = Function(`"use strict"; return (${args.expression})`)();
          return { result, expression: args.expression };
        } catch (error) {
          return { error: 'Invalid expression', expression: args.expression };
        }
      }
    );

    this.registerFunction(
      {
        name: 'format_text',
        description: 'Format text with various options',
        parameters: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text to format'
            },
            format: {
              type: 'string',
              enum: ['uppercase', 'lowercase', 'title', 'sentence'],
              description: 'Formatting option'
            }
          },
          required: ['text', 'format']
        }
      },
      (args: { text: string; format: string }) => {
        switch (args.format) {
          case 'uppercase':
            return args.text.toUpperCase();
          case 'lowercase':
            return args.text.toLowerCase();
          case 'title':
            return args.text.replace(/\w\S*/g, (txt) =>
              txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
            );
          case 'sentence':
            return args.text.charAt(0).toUpperCase() + args.text.slice(1).toLowerCase();
          default:
            return args.text;
        }
      }
    );

    logger.info('Default functions registered', {
      count: this.functionExecutors.size
    });
  }
}

export default new OpenAIAdvancedIntegration();
