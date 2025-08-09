
import { Request, Response, NextFunction } from 'express';
import { createSecurityMiddleware, createUserRateLimit } from '@ai-platform/shared-utils/security';
import { createValidationMiddleware } from '@ai-platform/shared-utils/security';
import { secureAiRequestSchema, secureApiRequestSchema } from '@ai-platform/shared-utils/validation/security.schemas';

/**
 * AI routing service security configuration
 */
const aiRoutingSecurityConfig = {
  enableXssProtection: true,
  enableSqlInjectionProtection: true,
  enableCsrfProtection: false, // API service
  enableInputSanitization: true,
  maxRequestSize: 20 * 1024 * 1024, // 20MB for large AI prompts and responses
  allowedOrigins: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGINS?.split(',') || ['https://ai-platform.com'])
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8080']
};

/**
 * General AI routing security middleware
 */
export const aiRoutingSecurityMiddleware = createSecurityMiddleware(aiRoutingSecurityConfig);

/**
 * AI request validation middleware
 */
export const validateAiRequest = createValidationMiddleware(secureAiRequestSchema, 'body');

/**
 * API query validation middleware
 */
export const validateApiQuery = createValidationMiddleware(secureApiRequestSchema, 'query');

/**
 * AI service rate limiting - more restrictive
 */
export const aiServiceRateLimit = createUserRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 20, // 20 AI requests per 15 minutes
  message: 'Too many AI requests, please try again later',
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.id || req.ip || 'unknown';
    return `ai-service:${userId}`;
  }
});

/**
 * High-cost AI model rate limiting
 */
export const highCostModelRateLimit = createUserRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 50, // 50 requests per hour for expensive models
  message: 'Rate limit exceeded for high-cost AI models',
  keyGenerator: (req: Request) => {
    const userId = (req as any).user?.id || req.ip || 'unknown';
    const model = req.body?.model || 'unknown';
    return `ai-high-cost:${userId}:${model}`;
  }
});

/**
 * Prompt content security validation
 */
export const promptSecurityValidation = (req: Request, res: Response, next: NextFunction) => {
  const prompt = req.body?.prompt;
  
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Prompt is required and must be a string',
      code: 'INVALID_PROMPT'
    });
  }
  
  // Check for malicious prompt patterns
  const maliciousPatterns = [
    /ignore\s+previous\s+instructions/i,
    /system\s*:\s*you\s+are/i,
    /forget\s+everything/i,
    /act\s+as\s+if/i,
    /jailbreak/i,
    /developer\s+mode/i,
    /\[SYSTEM\]/i,
    /\[ADMIN\]/i,
    /\[ROOT\]/i,
    /prompt\s+injection/i
  ];
  
  if (maliciousPatterns.some(pattern => pattern.test(prompt))) {
    console.warn('Security Event - Malicious Prompt Detected', {
      timestamp: new Date().toISOString(),
      userId: (req as any).user?.id || 'unknown',
      ip: req.ip || req.connection.remoteAddress,
      prompt: prompt.substring(0, 200) + '...',
      userAgent: req.headers['user-agent']
    });
    
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Prompt contains potentially malicious content',
      code: 'MALICIOUS_PROMPT_DETECTED'
    });
  }
  
  // Check prompt length
  if (prompt.length > 50000) { // 50k characters max
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Prompt is too long (max 50,000 characters)',
      code: 'PROMPT_TOO_LONG'
    });
  }
  
  // Check for excessive repetition (potential DoS)
  const repetitionCheck = checkExcessiveRepetition(prompt);
  if (repetitionCheck.isExcessive) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Prompt contains excessive repetition',
      code: 'EXCESSIVE_REPETITION'
    });
  }
  
  next();
};

/**
 * Check for excessive repetition in prompt
 */
const checkExcessiveRepetition = (text: string): { isExcessive: boolean; pattern?: string } => {
  // Check for repeated characters (more than 50 consecutive)
  const charRepeatPattern = /(.)\1{49,}/;
  if (charRepeatPattern.test(text)) {
    return { isExcessive: true, pattern: 'character repetition' };
  }
  
  // Check for repeated words (more than 20 consecutive)
  const words = text.toLowerCase().split(/\s+/);
  let consecutiveCount = 1;
  let lastWord = '';
  
  for (const word of words) {
    if (word === lastWord && word.length > 2) {
      consecutiveCount++;
      if (consecutiveCount > 20) {
        return { isExcessive: true, pattern: 'word repetition' };
      }
    } else {
      consecutiveCount = 1;
    }
    lastWord = word;
  }
  
  return { isExcessive: false };
};

/**
 * AI model access control
 */
export const aiModelAccessControl = (req: Request, res: Response, next: NextFunction) => {
  const model = req.body?.model;
  const user = (req as any).user;
  
  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required for AI services',
      code: 'AUTH_REQUIRED'
    });
  }
  
  // Define model access levels
  const modelAccessLevels = {
    'gpt-3.5-turbo': ['EMPLOYEE', 'ADMIN'],
    'gpt-4': ['ADMIN'], // Restricted to admins only
    'claude-3': ['EMPLOYEE', 'ADMIN'],
    'gemini-pro': ['EMPLOYEE', 'ADMIN']
  };
  
  const allowedRoles = modelAccessLevels[model as keyof typeof modelAccessLevels];
  
  if (!allowedRoles || !allowedRoles.includes(user.role)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: `Access denied to model ${model}`,
      code: 'MODEL_ACCESS_DENIED'
    });
  }
  
  next();
};

/**
 * Credit validation middleware
 */
export const creditValidation = async (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  const model = req.body?.model;
  const maxTokens = req.body?.maxTokens || 1000;
  
  if (!user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
      code: 'AUTH_REQUIRED'
    });
  }
  
  try {
    // Estimate cost based on model and tokens
    const estimatedCost = calculateEstimatedCost(model, maxTokens);
    
    // Check if user has sufficient credits (this would be a database call in real implementation)
    // For now, we'll simulate this check
    const userCredits = 1000; // This should come from database
    
    if (userCredits < estimatedCost) {
      return res.status(402).json({
        error: 'Payment Required',
        message: 'Insufficient credits for this AI request',
        code: 'INSUFFICIENT_CREDITS',
        requiredCredits: estimatedCost,
        availableCredits: userCredits
      });
    }
    
    // Store estimated cost for billing
    (req as any).estimatedCost = estimatedCost;
    
    next();
  } catch (error) {
    console.error('Credit validation error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Credit validation failed',
      code: 'CREDIT_VALIDATION_ERROR'
    });
  }
};

/**
 * Calculate estimated cost for AI request
 */
const calculateEstimatedCost = (model: string, maxTokens: number): number => {
  const modelCosts = {
    'gpt-3.5-turbo': 0.002, // per 1k tokens
    'gpt-4': 0.03, // per 1k tokens
    'claude-3': 0.008, // per 1k tokens
    'gemini-pro': 0.001 // per 1k tokens
  };
  
  const costPerToken = modelCosts[model as keyof typeof modelCosts] || 0.002;
  return Math.ceil((maxTokens / 1000) * costPerToken * 100); // Convert to credits (cents)
};

/**
 * Response sanitization for AI outputs
 */
export const sanitizeAiResponse = (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  
  res.json = function(body) {
    if (body && body.content) {
      // Sanitize AI response content
      body.content = sanitizeAiContent(body.content);
    }
    
    // Remove sensitive metadata
    if (body.metadata) {
      delete body.metadata.apiKey;
      delete body.metadata.internalId;
      delete body.metadata.debugInfo;
    }
    
    return originalJson.call(this, body);
  };
  
  next();
};

/**
 * Sanitize AI-generated content
 */
const sanitizeAiContent = (content: string): string => {
  if (!content || typeof content !== 'string') {
    return content;
  }
  
  // Remove potential script tags and event handlers
  let sanitized = content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/on\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
  
  // Remove potential markdown script execution
  sanitized = sanitized.replace(/```javascript[\s\S]*?```/gi, '```\n[JavaScript code removed for security]\n```');
  
  return sanitized;
};

/**
 * AI request audit logging
 */
export const aiRequestAuditLog = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const originalJson = res.json;
  
  res.json = function(body) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.info('AI Request Audit', {
      timestamp: new Date().toISOString(),
      userId: (req as any).user?.id || 'unknown',
      model: req.body?.model || 'unknown',
      promptLength: req.body?.prompt?.length || 0,
      maxTokens: req.body?.maxTokens || 0,
      estimatedCost: (req as any).estimatedCost || 0,
      responseTime: duration,
      statusCode: res.statusCode,
      success: res.statusCode >= 200 && res.statusCode < 300,
      ip: req.ip || req.connection.remoteAddress
    });
    
    return originalJson.call(this, body);
  };
  
  next();
};

/**
 * AI streaming response security
 */
export const aiStreamingSecurity = (req: Request, res: Response, next: NextFunction) => {
  // Set streaming security headers
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  // Set content type for streaming
  if (req.headers.accept?.includes('text/event-stream')) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
  }
  
  next();
};
