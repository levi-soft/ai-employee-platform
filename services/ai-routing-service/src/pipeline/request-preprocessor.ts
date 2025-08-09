
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';
import { z } from 'zod';

// Types for request preprocessing
export interface IPreprocessedRequest {
  id: string;
  originalRequest: any;
  normalizedRequest: any;
  metadata: {
    processingTime: number;
    validationPassed: boolean;
    transformations: string[];
    riskScore: number;
    priority: number;
    estimatedCost: number;
    estimatedTokens: {
      input: number;
      output: number;
    };
  };
  context: {
    userId?: string;
    sessionId?: string;
    userTier?: string;
    requestCount?: number;
    rateLimitInfo?: any;
  };
}

export interface IPreprocessingRule {
  name: string;
  enabled: boolean;
  priority: number;
  condition: (request: any) => boolean;
  transform: (request: any) => Promise<any>;
}

export interface IValidationSchema {
  required: string[];
  optional?: string[];
  contentLimits: {
    minLength: number;
    maxLength: number;
  };
  requestLimits: {
    maxParameterCount: number;
    maxParameterSize: number;
  };
}

/**
 * Advanced request preprocessing service with validation, normalization, and optimization
 */
export class RequestPreprocessorService extends EventEmitter {
  private logger: Logger;
  private preprocessingRules: Map<string, IPreprocessingRule> = new Map();
  private validationSchemas: Map<string, IValidationSchema> = new Map();
  private cache = new Map<string, any>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Zod schemas for validation
  private readonly baseRequestSchema = z.object({
    content: z.string().min(1).max(100000),
    type: z.string().min(1),
    parameters: z.record(z.any()).optional(),
    context: z.record(z.any()).optional(),
    userId: z.string().optional(),
    sessionId: z.string().optional(),
    priority: z.number().min(1).max(10).optional(),
    timeout: z.number().min(1000).max(300000).optional()
  });

  constructor() {
    super();
    this.logger = new Logger('RequestPreprocessor');
    this.initializeDefaultRules();
    this.initializeValidationSchemas();
  }

  /**
   * Main preprocessing entry point
   */
  async preprocessRequest(request: any): Promise<IPreprocessedRequest> {
    const startTime = Date.now();
    const requestId = request.id || this.generateRequestId();

    this.logger.info('Starting request preprocessing', {
      requestId,
      type: request.type,
      userId: request.userId
    });

    try {
      // Step 1: Basic validation
      const validationResult = await this.validateRequest(request);
      if (!validationResult.isValid) {
        throw new Error(`Validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Step 2: Normalize request format
      let normalizedRequest = await this.normalizeRequest(request);

      // Step 3: Apply preprocessing rules
      const transformations: string[] = [];
      const applicableRules = this.getApplicableRules(normalizedRequest);

      for (const rule of applicableRules) {
        if (rule.enabled) {
          try {
            const transformedRequest = await rule.transform(normalizedRequest);
            normalizedRequest = transformedRequest;
            transformations.push(rule.name);
            
            this.logger.debug('Applied preprocessing rule', {
              requestId,
              rule: rule.name
            });
          } catch (error) {
            this.logger.warn('Preprocessing rule failed', {
              requestId,
              rule: rule.name,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }

      // Step 4: Calculate risk score and priority
      const riskScore = await this.calculateRiskScore(normalizedRequest);
      const priority = this.calculatePriority(normalizedRequest);

      // Step 5: Estimate costs and tokens
      const { estimatedCost, estimatedTokens } = await this.estimateCosts(normalizedRequest);

      // Step 6: Build context information
      const context = await this.buildContext(normalizedRequest);

      const processingTime = Date.now() - startTime;

      const preprocessedRequest: IPreprocessedRequest = {
        id: requestId,
        originalRequest: request,
        normalizedRequest,
        metadata: {
          processingTime,
          validationPassed: true,
          transformations,
          riskScore,
          priority,
          estimatedCost,
          estimatedTokens
        },
        context
      };

      this.logger.info('Request preprocessing completed', {
        requestId,
        processingTime,
        transformations: transformations.length,
        riskScore,
        priority
      });

      this.emit('requestPreprocessed', { request: preprocessedRequest });
      return preprocessedRequest;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      this.logger.error('Request preprocessing failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        processingTime
      });

      // Return failed preprocessing result
      const failedRequest: IPreprocessedRequest = {
        id: requestId,
        originalRequest: request,
        normalizedRequest: request,
        metadata: {
          processingTime,
          validationPassed: false,
          transformations: [],
          riskScore: 10, // High risk for failed preprocessing
          priority: 1,
          estimatedCost: 0,
          estimatedTokens: { input: 0, output: 0 }
        },
        context: {}
      };

      this.emit('preprocessingError', { request: failedRequest, error });
      throw error;
    }
  }

  /**
   * Validate request against schema
   */
  private async validateRequest(request: any): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      // Base validation using Zod
      const result = this.baseRequestSchema.safeParse(request);
      if (!result.success) {
        errors.push(...result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`));
      }

      // Type-specific validation
      if (request.type) {
        const schema = this.validationSchemas.get(request.type);
        if (schema) {
          const typeValidation = await this.validateAgainstSchema(request, schema);
          if (!typeValidation.isValid) {
            errors.push(...typeValidation.errors);
          }
        }
      }

      // Content safety validation
      const contentValidation = await this.validateContentSafety(request.content || '');
      if (!contentValidation.isValid) {
        errors.push(...contentValidation.errors);
      }

      return {
        isValid: errors.length === 0,
        errors
      };

    } catch (error) {
      return {
        isValid: false,
        errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }

  /**
   * Validate against specific schema
   */
  private async validateAgainstSchema(request: any, schema: IValidationSchema): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Check required fields
    for (const field of schema.required) {
      if (!request[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Check content limits
    const content = request.content || '';
    if (content.length < schema.contentLimits.minLength) {
      errors.push(`Content too short: minimum ${schema.contentLimits.minLength} characters`);
    }
    if (content.length > schema.contentLimits.maxLength) {
      errors.push(`Content too long: maximum ${schema.contentLimits.maxLength} characters`);
    }

    // Check parameter limits
    const parameters = request.parameters || {};
    const paramCount = Object.keys(parameters).length;
    if (paramCount > schema.requestLimits.maxParameterCount) {
      errors.push(`Too many parameters: maximum ${schema.requestLimits.maxParameterCount}`);
    }

    for (const [key, value] of Object.entries(parameters)) {
      const valueSize = JSON.stringify(value).length;
      if (valueSize > schema.requestLimits.maxParameterSize) {
        errors.push(`Parameter '${key}' too large: maximum ${schema.requestLimits.maxParameterSize} bytes`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Content safety validation
   */
  private async validateContentSafety(content: string): Promise<{ isValid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const cacheKey = `safety:${this.hashContent(content)}`;
    
    // Check cache first
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Basic content safety checks
      const suspiciousPatterns = [
        /password\s*[:=]\s*\S+/i,
        /api[_\-]?key\s*[:=]\s*\S+/i,
        /token\s*[:=]\s*\S+/i,
        /secret\s*[:=]\s*\S+/i,
        /private[_\-]?key/i
      ];

      for (const pattern of suspiciousPatterns) {
        if (pattern.test(content)) {
          errors.push('Content contains potentially sensitive information');
          break;
        }
      }

      // Check for excessive repetition (possible spam)
      const words = content.split(/\s+/);
      const wordCount = new Map<string, number>();
      for (const word of words) {
        wordCount.set(word, (wordCount.get(word) || 0) + 1);
      }

      const maxRepetition = Math.max(...wordCount.values());
      if (maxRepetition > words.length * 0.3) {
        errors.push('Content contains excessive repetition');
      }

      const result = {
        isValid: errors.length === 0,
        errors
      };

      this.setCache(cacheKey, result);
      return result;

    } catch (error) {
      return {
        isValid: false,
        errors: [`Content safety check failed: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }

  /**
   * Normalize request format
   */
  private async normalizeRequest(request: any): Promise<any> {
    return {
      id: request.id || this.generateRequestId(),
      type: request.type?.toLowerCase() || 'general',
      content: this.normalizeContent(request.content || ''),
      parameters: this.normalizeParameters(request.parameters || {}),
      context: request.context || {},
      userId: request.userId,
      sessionId: request.sessionId,
      priority: Math.max(1, Math.min(10, request.priority || 5)),
      timeout: Math.max(1000, Math.min(300000, request.timeout || 30000)),
      timestamp: new Date().toISOString(),
      metadata: {
        originalSize: JSON.stringify(request).length,
        ...request.metadata
      }
    };
  }

  /**
   * Normalize content
   */
  private normalizeContent(content: string): string {
    return content
      .trim()
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // Remove control characters
  }

  /**
   * Normalize parameters
   */
  private normalizeParameters(parameters: Record<string, any>): Record<string, any> {
    const normalized: Record<string, any> = {};

    for (const [key, value] of Object.entries(parameters)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      
      if (typeof value === 'string') {
        normalized[normalizedKey] = value.trim();
      } else if (typeof value === 'number') {
        normalized[normalizedKey] = isNaN(value) ? 0 : value;
      } else if (typeof value === 'boolean') {
        normalized[normalizedKey] = value;
      } else if (Array.isArray(value)) {
        normalized[normalizedKey] = value.slice(0, 100); // Limit array size
      } else if (value !== null && typeof value === 'object') {
        normalized[normalizedKey] = this.normalizeParameters(value);
      } else {
        normalized[normalizedKey] = String(value);
      }
    }

    return normalized;
  }

  /**
   * Calculate risk score (0-10)
   */
  private async calculateRiskScore(request: any): Promise<number> {
    let riskScore = 0;

    // Content length risk
    const contentLength = request.content?.length || 0;
    if (contentLength > 50000) riskScore += 2;
    else if (contentLength > 10000) riskScore += 1;

    // Parameter complexity risk
    const paramCount = Object.keys(request.parameters || {}).length;
    if (paramCount > 20) riskScore += 2;
    else if (paramCount > 10) riskScore += 1;

    // Request type risk
    const highRiskTypes = ['code_execution', 'file_access', 'network_request'];
    if (highRiskTypes.includes(request.type)) {
      riskScore += 3;
    }

    // User history risk (would be based on actual user data)
    if (!request.userId) {
      riskScore += 1; // Anonymous requests are riskier
    }

    return Math.min(10, riskScore);
  }

  /**
   * Calculate request priority (1-10)
   */
  private calculatePriority(request: any): number {
    let priority = request.priority || 5;

    // User tier adjustments (would be based on actual user data)
    const context = request.context || {};
    const userTier = context.userTier || 'free';
    
    switch (userTier) {
      case 'enterprise':
        priority += 3;
        break;
      case 'pro':
        priority += 2;
        break;
      case 'plus':
        priority += 1;
        break;
    }

    // Request type adjustments
    const highPriorityTypes = ['urgent', 'critical', 'real_time'];
    if (highPriorityTypes.includes(request.type)) {
      priority += 2;
    }

    return Math.max(1, Math.min(10, priority));
  }

  /**
   * Estimate costs and token usage
   */
  private async estimateCosts(request: any): Promise<{
    estimatedCost: number;
    estimatedTokens: { input: number; output: number };
  }> {
    const content = request.content || '';
    
    // Rough token estimation (1 token ≈ 4 characters)
    const inputTokens = Math.ceil(content.length / 4);
    const outputTokens = Math.min(4000, Math.max(100, inputTokens * 0.3)); // Estimate output based on input

    // Cost estimation (rough pricing)
    const inputCostPerToken = 0.00001; // $0.01 per 1K tokens
    const outputCostPerToken = 0.00003; // $0.03 per 1K tokens

    const estimatedCost = (inputTokens * inputCostPerToken) + (outputTokens * outputCostPerToken);

    return {
      estimatedCost: Math.round(estimatedCost * 100000) / 100000, // Round to 5 decimal places
      estimatedTokens: {
        input: inputTokens,
        output: outputTokens
      }
    };
  }

  /**
   * Build request context
   */
  private async buildContext(request: any): Promise<any> {
    const context = {
      userId: request.userId,
      sessionId: request.sessionId,
      userTier: 'free', // Would be looked up from user data
      requestCount: 1, // Would be counted from user history
      timestamp: new Date().toISOString(),
      rateLimitInfo: {
        remaining: 100,
        resetTime: new Date(Date.now() + 3600000).toISOString() // 1 hour from now
      }
    };

    return context;
  }

  /**
   * Get applicable preprocessing rules
   */
  private getApplicableRules(request: any): IPreprocessingRule[] {
    const applicableRules: IPreprocessingRule[] = [];

    for (const rule of this.preprocessingRules.values()) {
      if (rule.condition(request)) {
        applicableRules.push(rule);
      }
    }

    // Sort by priority (higher first)
    return applicableRules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Initialize default preprocessing rules
   */
  private initializeDefaultRules(): void {
    // Text cleanup rule
    this.addRule({
      name: 'text_cleanup',
      enabled: true,
      priority: 10,
      condition: (request) => typeof request.content === 'string',
      transform: async (request) => ({
        ...request,
        content: request.content
          .replace(/\u00A0/g, ' ') // Replace non-breaking spaces
          .replace(/[\u2000-\u200B\u2028-\u2029]/g, ' ') // Replace various Unicode spaces
          .trim()
      })
    });

    // Parameter sanitization rule
    this.addRule({
      name: 'parameter_sanitization',
      enabled: true,
      priority: 9,
      condition: (request) => request.parameters && Object.keys(request.parameters).length > 0,
      transform: async (request) => ({
        ...request,
        parameters: this.sanitizeParameters(request.parameters)
      })
    });

    // Content truncation rule
    this.addRule({
      name: 'content_truncation',
      enabled: true,
      priority: 8,
      condition: (request) => request.content && request.content.length > 95000,
      transform: async (request) => ({
        ...request,
        content: request.content.substring(0, 95000) + '... [truncated]',
        metadata: {
          ...request.metadata,
          truncated: true,
          originalLength: request.content.length
        }
      })
    });
  }

  /**
   * Initialize validation schemas
   */
  private initializeValidationSchemas(): void {
    // General schema
    this.validationSchemas.set('general', {
      required: ['content'],
      contentLimits: { minLength: 1, maxLength: 100000 },
      requestLimits: { maxParameterCount: 20, maxParameterSize: 10000 }
    });

    // Code generation schema
    this.validationSchemas.set('code_generation', {
      required: ['content'],
      optional: ['language', 'framework'],
      contentLimits: { minLength: 10, maxLength: 50000 },
      requestLimits: { maxParameterCount: 15, maxParameterSize: 5000 }
    });

    // Text analysis schema
    this.validationSchemas.set('text_analysis', {
      required: ['content'],
      optional: ['analysis_type'],
      contentLimits: { minLength: 1, maxLength: 200000 },
      requestLimits: { maxParameterCount: 10, maxParameterSize: 1000 }
    });
  }

  /**
   * Add preprocessing rule
   */
  addRule(rule: IPreprocessingRule): void {
    this.preprocessingRules.set(rule.name, rule);
    this.logger.info('Preprocessing rule added', { name: rule.name, priority: rule.priority });
  }

  /**
   * Remove preprocessing rule
   */
  removeRule(name: string): void {
    if (this.preprocessingRules.delete(name)) {
      this.logger.info('Preprocessing rule removed', { name });
    }
  }

  /**
   * Enable/disable preprocessing rule
   */
  toggleRule(name: string, enabled: boolean): void {
    const rule = this.preprocessingRules.get(name);
    if (rule) {
      rule.enabled = enabled;
      this.logger.info('Preprocessing rule toggled', { name, enabled });
    }
  }

  // Utility methods
  private generateRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
  }

  private sanitizeParameters(parameters: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(parameters)) {
      if (typeof value === 'string') {
        // Remove potential script injections
        sanitized[key] = value.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
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
}
