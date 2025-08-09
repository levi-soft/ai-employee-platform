
import { Request, Response, NextFunction } from 'express';
import { logger } from '../../../../packages/shared-utils/src/logger';
import { securityAuditor, SecurityEventType, SecuritySeverity } from '../../../auth-service/src/middleware/security-audit.middleware';

// AI routing specific security events
export enum AISecurityEventType {
  AI_REQUEST_MADE = 'AI_REQUEST_MADE',
  AI_REQUEST_BLOCKED = 'AI_REQUEST_BLOCKED',
  MALICIOUS_PROMPT = 'MALICIOUS_PROMPT',
  EXCESSIVE_TOKENS = 'EXCESSIVE_TOKENS',
  MODEL_ABUSE = 'MODEL_ABUSE',
  COST_THRESHOLD_EXCEEDED = 'COST_THRESHOLD_EXCEEDED',
  PROMPT_INJECTION = 'PROMPT_INJECTION',
  DATA_EXFILTRATION_ATTEMPT = 'DATA_EXFILTRATION_ATTEMPT',
  UNAUTHORIZED_MODEL_ACCESS = 'UNAUTHORIZED_MODEL_ACCESS',
  ANOMALOUS_USAGE_PATTERN = 'ANOMALOUS_USAGE_PATTERN'
}

class AISecurityAuditor {
  private suspiciousPatterns = [
    // Prompt injection patterns
    /ignore\s+(previous|above|all)\s+(instructions|prompts|commands)/gi,
    /forget\s+(everything|all)\s+(above|before)/gi,
    /new\s+(instructions|task|role|system)/gi,
    
    // Data exfiltration patterns
    /show\s+(me\s+)?(all\s+)?(users|passwords|secrets|keys|tokens)/gi,
    /list\s+(all\s+)?(database|table|users|admin)/gi,
    /dump\s+(database|data|table)/gi,
    
    // Code injection patterns
    /execute\s+(code|script|command)/gi,
    /eval\s*\(|exec\s*\(/gi,
    /(system|os|subprocess)\..*\(/gi,
    
    // Social engineering
    /you\s+are\s+(now\s+)?(a\s+)?(hacker|admin|root)/gi,
    /pretend\s+(to\s+be|you\s+are)/gi,
    /act\s+as\s+(if\s+you\s+are|a)/gi
  ];

  private sensitiveKeywords = [
    'password', 'secret', 'key', 'token', 'credential',
    'ssn', 'social security', 'credit card', 'bank account',
    'api key', 'private key', 'certificate'
  ];

  public analyzePrompt(prompt: string): {
    isSafe: boolean;
    threats: Array<{
      type: string;
      severity: SecuritySeverity;
      pattern: string;
      description: string;
    }>;
    riskScore: number;
  } {
    const threats: Array<{
      type: string;
      severity: SecuritySeverity;
      pattern: string;
      description: string;
    }> = [];
    let riskScore = 0;

    // Check for suspicious patterns
    for (const pattern of this.suspiciousPatterns) {
      if (pattern.test(prompt)) {
        const threat = {
          type: 'PATTERN_MATCH',
          severity: SecuritySeverity.HIGH,
          pattern: pattern.toString(),
          description: this.getPatternDescription(pattern)
        };
        threats.push(threat);
        riskScore += 30;
      }
    }

    // Check for sensitive keywords
    const lowerPrompt = prompt.toLowerCase();
    for (const keyword of this.sensitiveKeywords) {
      if (lowerPrompt.includes(keyword)) {
        threats.push({
          type: 'SENSITIVE_KEYWORD',
          severity: SecuritySeverity.MEDIUM,
          pattern: keyword,
          description: `Contains sensitive keyword: ${keyword}`
        });
        riskScore += 15;
      }
    }

    // Check prompt length (very long prompts might be attempts to confuse the AI)
    if (prompt.length > 10000) {
      threats.push({
        type: 'EXCESSIVE_LENGTH',
        severity: SecuritySeverity.MEDIUM,
        pattern: 'LENGTH_CHECK',
        description: `Unusually long prompt (${prompt.length} characters)`
      });
      riskScore += 20;
    }

    // Check for repeated patterns (possible prompt stuffing)
    const words = prompt.split(/\s+/);
    const wordCount = new Map<string, number>();
    for (const word of words) {
      if (word.length > 3) {
        wordCount.set(word.toLowerCase(), (wordCount.get(word.toLowerCase()) || 0) + 1);
      }
    }

    for (const [word, count] of wordCount.entries()) {
      if (count > 10) { // Same word repeated more than 10 times
        threats.push({
          type: 'REPETITIVE_CONTENT',
          severity: SecuritySeverity.MEDIUM,
          pattern: word,
          description: `Word "${word}" repeated ${count} times (possible prompt stuffing)`
        });
        riskScore += 10;
      }
    }

    riskScore = Math.min(riskScore, 100);
    const isSafe = riskScore < 50; // Threshold for blocking

    return { isSafe, threats, riskScore };
  }

  private getPatternDescription(pattern: RegExp): string {
    const patternStr = pattern.toString().toLowerCase();
    
    if (patternStr.includes('ignore.*instructions')) return 'Prompt injection attempt - trying to ignore instructions';
    if (patternStr.includes('forget.*above')) return 'Prompt injection attempt - trying to forget context';
    if (patternStr.includes('new.*instructions')) return 'Prompt injection attempt - trying to set new instructions';
    if (patternStr.includes('show.*users')) return 'Data exfiltration attempt - requesting user data';
    if (patternStr.includes('execute.*code')) return 'Code injection attempt';
    if (patternStr.includes('you.*are.*admin')) return 'Role manipulation attempt';
    
    return 'Suspicious pattern detected';
  }

  public checkAnomalousUsage(userId: string, request: any): {
    isAnomalous: boolean;
    anomalies: Array<{
      type: string;
      description: string;
      severity: SecuritySeverity;
    }>;
  } {
    const anomalies: Array<{
      type: string;
      description: string;
      severity: SecuritySeverity;
    }> = [];

    // Check for excessive token usage
    const maxTokens = request.maxTokens || 1000;
    if (maxTokens > 8000) {
      anomalies.push({
        type: 'EXCESSIVE_TOKENS',
        description: `Requesting ${maxTokens} tokens (unusually high)`,
        severity: SecuritySeverity.MEDIUM
      });
    }

    // Check for unusual temperature settings
    const temperature = request.temperature;
    if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
      anomalies.push({
        type: 'UNUSUAL_TEMPERATURE',
        description: `Temperature setting ${temperature} is outside normal range`,
        severity: SecuritySeverity.LOW
      });
    }

    // Check for unusual model requests
    const model = request.model;
    if (model && model.includes('admin') || model.includes('root') || model.includes('system')) {
      anomalies.push({
        type: 'SUSPICIOUS_MODEL',
        description: `Requesting suspicious model: ${model}`,
        severity: SecuritySeverity.HIGH
      });
    }

    // Check for rapid-fire requests (would need to track request history)
    // This is a placeholder for more sophisticated anomaly detection

    return {
      isAnomalous: anomalies.length > 0,
      anomalies
    };
  }

  public logAIEvent(
    eventType: AISecurityEventType | SecurityEventType,
    severity: SecuritySeverity,
    req: Request,
    success: boolean,
    details?: Record<string, any>
  ): void {
    const enhancedDetails = {
      ...details,
      service: 'ai-routing',
      userId: (req as any).user?.id,
      userRole: (req as any).user?.role,
      model: (req as any).body?.model,
      estimatedCost: (req as any).body?.estimatedCost,
      tokenUsage: (req as any).tokenUsage
    };

    securityAuditor.logEvent(
      eventType as SecurityEventType,
      severity,
      req,
      success,
      enhancedDetails
    );
  }
}

const aiSecurityAuditor = new AISecurityAuditor();

// Middleware to analyze AI prompts for security threats
export function promptSecurityMiddleware(req: Request, res: Response, next: NextFunction) {
  const prompt = req.body?.prompt || req.body?.message || req.body?.input;
  
  if (prompt && typeof prompt === 'string') {
    const analysis = aiSecurityAuditor.analyzePrompt(prompt);
    
    if (!analysis.isSafe) {
      aiSecurityAuditor.logAIEvent(
        AISecurityEventType.MALICIOUS_PROMPT,
        SecuritySeverity.HIGH,
        req,
        false,
        {
          promptLength: prompt.length,
          riskScore: analysis.riskScore,
          threatCount: analysis.threats.length,
          threats: analysis.threats.map(t => ({ type: t.type, severity: t.severity }))
        }
      );

      logger.warn('Malicious prompt detected and blocked', {
        userId: (req as any).user?.id,
        ip: req.ip,
        riskScore: analysis.riskScore,
        threatTypes: analysis.threats.map(t => t.type)
      });

      return res.status(400).json({
        error: 'Prompt security violation',
        message: 'Your prompt contains potentially harmful content and has been blocked',
        riskScore: analysis.riskScore,
        violations: analysis.threats.length
      });
    }

    // Store analysis for later use
    (req as any).promptAnalysis = analysis;
  }

  next();
}

// Middleware to check for anomalous AI usage patterns
export function anomalousUsageMiddleware(req: Request, res: Response, next: NextFunction) {
  const userId = (req as any).user?.id;
  
  if (userId) {
    const anomalyCheck = aiSecurityAuditor.checkAnomalousUsage(userId, req.body || {});
    
    if (anomalyCheck.isAnomalous) {
      aiSecurityAuditor.logAIEvent(
        AISecurityEventType.ANOMALOUS_USAGE_PATTERN,
        SecuritySeverity.MEDIUM,
        req,
        true, // Not blocking, just logging
        {
          anomalies: anomalyCheck.anomalies,
          requestDetails: {
            model: req.body?.model,
            maxTokens: req.body?.maxTokens,
            temperature: req.body?.temperature
          }
        }
      );

      logger.info('Anomalous AI usage pattern detected', {
        userId,
        anomalies: anomalyCheck.anomalies.map(a => a.type)
      });

      // Add warning header but don't block
      res.setHeader('X-Usage-Warning', 'anomalous-pattern-detected');
    }
  }

  next();
}

// Main AI routing audit middleware
export function aiRoutingAuditMiddleware(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json;
  let responseBody: any;

  res.json = function(body: any) {
    responseBody = body;
    return originalJson.call(this, body);
  };

  const originalEnd = res.end;
  res.end = function(chunk?: any) {
    const success = res.statusCode < 400;
    const path = req.path.toLowerCase();
    
    let eventType: AISecurityEventType | SecurityEventType = AISecurityEventType.AI_REQUEST_MADE;
    let severity = SecuritySeverity.LOW;

    // Determine event type based on endpoint
    if (path.includes('/route')) {
      eventType = success ? AISecurityEventType.AI_REQUEST_MADE : AISecurityEventType.AI_REQUEST_BLOCKED;
      severity = success ? SecuritySeverity.LOW : SecuritySeverity.HIGH;
    } else if (path.includes('/capabilities')) {
      eventType = SecurityEventType.DATA_ACCESS;
      severity = SecuritySeverity.LOW;
    } else if (path.includes('/simulation')) {
      eventType = AISecurityEventType.MODEL_ABUSE; // Could be testing for vulnerabilities
      severity = SecuritySeverity.MEDIUM;
    }

    // Check for unauthorized model access
    if (res.statusCode === 403 && path.includes('/route')) {
      eventType = AISecurityEventType.UNAUTHORIZED_MODEL_ACCESS;
      severity = SecuritySeverity.HIGH;
    }

    const details: Record<string, any> = {
      statusCode: res.statusCode,
      responseTime: Date.now() - (req as any).startTime,
      endpoint: path,
      method: req.method
    };

    // Add AI-specific details
    if (req.body?.model) details.requestedModel = req.body.model;
    if (req.body?.maxTokens) details.requestedTokens = req.body.maxTokens;
    if ((req as any).promptAnalysis) details.promptRiskScore = (req as any).promptAnalysis.riskScore;
    if ((req as any).tokenUsage) details.tokenUsage = (req as any).tokenUsage;
    if (responseBody?.selectedAgent) details.selectedAgent = responseBody.selectedAgent;
    if (responseBody?.cost) details.estimatedCost = responseBody.cost;

    aiSecurityAuditor.logAIEvent(eventType, severity, req, success, details);

    return originalEnd.call(this, chunk);
  };

  (req as any).startTime = Date.now();
  next();
}

export { aiSecurityAuditor };
