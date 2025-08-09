
import { Request, Response, NextFunction } from 'express';
import { logger } from '../../../../packages/shared-utils/src/logger';

export interface SecurityEvent {
  id: string;
  timestamp: Date;
  eventType: SecurityEventType;
  severity: SecuritySeverity;
  userId?: string;
  ip: string;
  userAgent?: string;
  resource?: string;
  action?: string;
  success: boolean;
  details?: Record<string, any>;
  riskScore: number;
}

export enum SecurityEventType {
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILURE = 'LOGIN_FAILURE',
  REGISTRATION = 'REGISTRATION',
  PASSWORD_RESET = 'PASSWORD_RESET',
  TOKEN_REFRESH = 'TOKEN_REFRESH',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INPUT_VALIDATION = 'INPUT_VALIDATION',
  ACCESS_DENIED = 'ACCESS_DENIED',
  PRIVILEGE_ESCALATION = 'PRIVILEGE_ESCALATION',
  DATA_ACCESS = 'DATA_ACCESS',
  ACCOUNT_LOCKOUT = 'ACCOUNT_LOCKOUT',
  BRUTE_FORCE = 'BRUTE_FORCE',
  SESSION_ANOMALY = 'SESSION_ANOMALY'
}

export enum SecuritySeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

class SecurityAuditor {
  private events: SecurityEvent[] = [];
  private maxEvents = 10000; // Keep last 10k events in memory
  private suspiciousIPs = new Set<string>();
  private failedLoginAttempts = new Map<string, number>();
  private lastFailedLogin = new Map<string, number>();

  public logEvent(
    eventType: SecurityEventType,
    severity: SecuritySeverity,
    req: Request,
    success: boolean,
    details?: Record<string, any>
  ): void {
    const event: SecurityEvent = {
      id: this.generateEventId(),
      timestamp: new Date(),
      eventType,
      severity,
      userId: (req as any).user?.id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      resource: req.path,
      action: req.method,
      success,
      details,
      riskScore: this.calculateRiskScore(eventType, severity, req, success, details)
    };

    this.events.push(event);
    
    // Keep events within limit
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Log to system logger
    const logData = {
      securityEvent: {
        id: event.id,
        type: event.eventType,
        severity: event.severity,
        userId: event.userId,
        ip: event.ip,
        success: event.success,
        riskScore: event.riskScore
      },
      request: {
        path: req.path,
        method: req.method,
        userAgent: req.headers['user-agent']
      },
      details: event.details
    };

    switch (severity) {
      case SecuritySeverity.CRITICAL:
        logger.error('Critical security event', logData);
        break;
      case SecuritySeverity.HIGH:
        logger.warn('High severity security event', logData);
        break;
      case SecuritySeverity.MEDIUM:
        logger.info('Medium severity security event', logData);
        break;
      case SecuritySeverity.LOW:
        logger.debug('Low severity security event', logData);
        break;
    }

    // Check for patterns and respond accordingly
    this.analyzeEvent(event, req);
  }

  private generateEventId(): string {
    return `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private calculateRiskScore(
    eventType: SecurityEventType,
    severity: SecuritySeverity,
    req: Request,
    success: boolean,
    details?: Record<string, any>
  ): number {
    let score = 0;

    // Base score by severity
    switch (severity) {
      case SecuritySeverity.CRITICAL:
        score += 40;
        break;
      case SecuritySeverity.HIGH:
        score += 30;
        break;
      case SecuritySeverity.MEDIUM:
        score += 20;
        break;
      case SecuritySeverity.LOW:
        score += 10;
        break;
    }

    // Additional score by event type
    switch (eventType) {
      case SecurityEventType.LOGIN_FAILURE:
        score += 15;
        break;
      case SecurityEventType.BRUTE_FORCE:
        score += 35;
        break;
      case SecurityEventType.PRIVILEGE_ESCALATION:
        score += 40;
        break;
      case SecurityEventType.SUSPICIOUS_ACTIVITY:
        score += 25;
        break;
      case SecurityEventType.RATE_LIMIT_EXCEEDED:
        score += 20;
        break;
    }

    // Reduce score for successful operations
    if (success && ![SecurityEventType.SUSPICIOUS_ACTIVITY, SecurityEventType.BRUTE_FORCE].includes(eventType)) {
      score = score * 0.5;
    }

    // Increase score for suspicious IPs
    if (this.suspiciousIPs.has(req.ip)) {
      score += 15;
    }

    // Increase score based on failed login attempts
    const failedAttempts = this.failedLoginAttempts.get(req.ip) || 0;
    score += Math.min(failedAttempts * 5, 30);

    return Math.min(Math.max(score, 0), 100);
  }

  private analyzeEvent(event: SecurityEvent, req: Request): void {
    // Track failed login attempts
    if (event.eventType === SecurityEventType.LOGIN_FAILURE) {
      const currentAttempts = this.failedLoginAttempts.get(event.ip) || 0;
      this.failedLoginAttempts.set(event.ip, currentAttempts + 1);
      this.lastFailedLogin.set(event.ip, Date.now());

      // Check for brute force attack
      if (currentAttempts >= 10) { // 10 failed attempts
        this.logEvent(
          SecurityEventType.BRUTE_FORCE,
          SecuritySeverity.CRITICAL,
          req,
          false,
          { failedAttempts: currentAttempts + 1, timeWindow: '15 minutes' }
        );
        this.suspiciousIPs.add(event.ip);
      }
    }

    // Reset failed attempts on successful login
    if (event.eventType === SecurityEventType.LOGIN_SUCCESS) {
      this.failedLoginAttempts.delete(event.ip);
      this.lastFailedLogin.delete(event.ip);
    }

    // Detect session anomalies
    if (event.userId) {
      this.detectSessionAnomalies(event, req);
    }

    // Clean up old data periodically
    if (Math.random() < 0.01) { // 1% chance to clean up
      this.cleanup();
    }
  }

  private detectSessionAnomalies(event: SecurityEvent, req: Request): void {
    // Get recent events for this user
    const recentEvents = this.events
      .filter(e => e.userId === event.userId && e.timestamp.getTime() > Date.now() - 3600000) // Last hour
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (recentEvents.length < 2) return;

    const currentEvent = recentEvents[0];
    const previousEvent = recentEvents[1];

    // Check for IP changes
    if (previousEvent.ip !== currentEvent.ip && 
        currentEvent.timestamp.getTime() - previousEvent.timestamp.getTime() < 300000) { // 5 minutes
      this.logEvent(
        SecurityEventType.SESSION_ANOMALY,
        SecuritySeverity.HIGH,
        req,
        false,
        {
          anomalyType: 'IP_CHANGE',
          previousIP: previousEvent.ip,
          currentIP: currentEvent.ip,
          timeDiff: currentEvent.timestamp.getTime() - previousEvent.timestamp.getTime()
        }
      );
    }

    // Check for unusual activity patterns
    const activityCount = recentEvents.length;
    if (activityCount > 50) { // More than 50 activities in an hour
      this.logEvent(
        SecurityEventType.SUSPICIOUS_ACTIVITY,
        SecuritySeverity.MEDIUM,
        req,
        false,
        {
          activityType: 'HIGH_FREQUENCY',
          activityCount,
          timeWindow: 'hour'
        }
      );
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    // Clean up old failed login attempts
    for (const [ip, timestamp] of this.lastFailedLogin.entries()) {
      if (now - timestamp > oneHour * 24) { // 24 hours
        this.failedLoginAttempts.delete(ip);
        this.lastFailedLogin.delete(ip);
      }
    }

    // Remove old suspicious IPs (after 24 hours of no activity)
    const oldSuspiciousIPs = Array.from(this.suspiciousIPs).filter(ip => {
      const lastActivity = this.events
        .filter(e => e.ip === ip)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
      
      return !lastActivity || now - lastActivity.timestamp.getTime() > oneHour * 24;
    });

    oldSuspiciousIPs.forEach(ip => this.suspiciousIPs.delete(ip));
  }

  public getEvents(
    limit: number = 100,
    severity?: SecuritySeverity,
    eventType?: SecurityEventType,
    userId?: string,
    ip?: string,
    startTime?: Date,
    endTime?: Date
  ): SecurityEvent[] {
    let filtered = this.events;

    if (severity) {
      filtered = filtered.filter(e => e.severity === severity);
    }

    if (eventType) {
      filtered = filtered.filter(e => e.eventType === eventType);
    }

    if (userId) {
      filtered = filtered.filter(e => e.userId === userId);
    }

    if (ip) {
      filtered = filtered.filter(e => e.ip === ip);
    }

    if (startTime) {
      filtered = filtered.filter(e => e.timestamp >= startTime);
    }

    if (endTime) {
      filtered = filtered.filter(e => e.timestamp <= endTime);
    }

    return filtered
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  public getSecurityReport(): {
    totalEvents: number;
    eventsBySeverity: Record<SecuritySeverity, number>;
    eventsByType: Record<SecurityEventType, number>;
    suspiciousIPs: string[];
    highRiskEvents: number;
    topRiskIPs: Array<{ ip: string; riskScore: number; eventCount: number }>;
  } {
    const eventsBySeverity: Record<SecuritySeverity, number> = {
      [SecuritySeverity.LOW]: 0,
      [SecuritySeverity.MEDIUM]: 0,
      [SecuritySeverity.HIGH]: 0,
      [SecuritySeverity.CRITICAL]: 0
    };

    const eventsByType: Record<SecurityEventType, number> = {} as any;
    const ipRisks = new Map<string, { totalRisk: number; count: number }>();

    for (const event of this.events) {
      eventsBySeverity[event.severity]++;
      eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;

      const ipData = ipRisks.get(event.ip) || { totalRisk: 0, count: 0 };
      ipData.totalRisk += event.riskScore;
      ipData.count++;
      ipRisks.set(event.ip, ipData);
    }

    const topRiskIPs = Array.from(ipRisks.entries())
      .map(([ip, data]) => ({
        ip,
        riskScore: Math.round(data.totalRisk / data.count),
        eventCount: data.count
      }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10);

    return {
      totalEvents: this.events.length,
      eventsBySeverity,
      eventsByType,
      suspiciousIPs: Array.from(this.suspiciousIPs),
      highRiskEvents: this.events.filter(e => e.riskScore > 50).length,
      topRiskIPs
    };
  }

  public isSuspiciousIP(ip: string): boolean {
    return this.suspiciousIPs.has(ip);
  }

  public getFailedLoginAttempts(ip: string): number {
    return this.failedLoginAttempts.get(ip) || 0;
  }
}

// Global security auditor instance
export const securityAuditor = new SecurityAuditor();

// Middleware to automatically log security events
export function securityAuditMiddleware(req: Request, res: Response, next: NextFunction) {
  // Store original res.json to intercept responses
  const originalJson = res.json;
  let responseBody: any;

  res.json = function(body: any) {
    responseBody = body;
    return originalJson.call(this, body);
  };

  // Store original end to capture all responses
  const originalEnd = res.end;
  res.end = function(chunk?: any) {
    // Log event based on response
    const success = res.statusCode < 400;
    let eventType = SecurityEventType.DATA_ACCESS;
    let severity = SecuritySeverity.LOW;

    // Determine event type and severity based on endpoint and response
    const path = req.path.toLowerCase();
    
    if (path.includes('/login')) {
      eventType = success ? SecurityEventType.LOGIN_SUCCESS : SecurityEventType.LOGIN_FAILURE;
      severity = success ? SecuritySeverity.LOW : SecuritySeverity.HIGH;
    } else if (path.includes('/register')) {
      eventType = SecurityEventType.REGISTRATION;
      severity = SecuritySeverity.MEDIUM;
    } else if (path.includes('/reset') || path.includes('/password')) {
      eventType = SecurityEventType.PASSWORD_RESET;
      severity = SecuritySeverity.MEDIUM;
    } else if (path.includes('/refresh')) {
      eventType = SecurityEventType.TOKEN_REFRESH;
      severity = SecuritySeverity.LOW;
    } else if (res.statusCode === 403) {
      eventType = SecurityEventType.ACCESS_DENIED;
      severity = SecuritySeverity.HIGH;
    } else if (res.statusCode === 401) {
      eventType = SecurityEventType.AUTHORIZATION;
      severity = SecuritySeverity.MEDIUM;
    } else if (res.statusCode === 429) {
      eventType = SecurityEventType.RATE_LIMIT_EXCEEDED;
      severity = SecuritySeverity.HIGH;
    }

    // Additional details
    const details: Record<string, any> = {
      statusCode: res.statusCode,
      responseTime: Date.now() - (req as any).startTime,
    };

    if (responseBody?.error) {
      details.error = responseBody.error;
    }

    if (req.body?.email) {
      details.email = req.body.email;
    }

    securityAuditor.logEvent(eventType, severity, req, success, details);

    return originalEnd.call(this, chunk);
  };

  // Record start time for response time calculation
  (req as any).startTime = Date.now();

  next();
}

// Middleware to check for suspicious activity
export function suspiciousActivityCheck(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip;

  // Check if IP is marked as suspicious
  if (securityAuditor.isSuspiciousIP(ip)) {
    securityAuditor.logEvent(
      SecurityEventType.SUSPICIOUS_ACTIVITY,
      SecuritySeverity.HIGH,
      req,
      false,
      { reason: 'Request from suspicious IP' }
    );

    // Add additional security headers
    res.setHeader('X-Suspicious-Activity', 'detected');
    
    // Could add CAPTCHA requirement here
    logger.warn('Request from suspicious IP', {
      ip,
      path: req.path,
      userAgent: req.headers['user-agent']
    });
  }

  // Check for failed login attempts
  const failedAttempts = securityAuditor.getFailedLoginAttempts(ip);
  if (failedAttempts >= 5) {
    // Add delay for IPs with many failed attempts
    setTimeout(() => next(), 1000 * Math.min(failedAttempts - 4, 10));
    return;
  }

  next();
}

// Export middleware functions
export const securityAudit = {
  audit: securityAuditMiddleware,
  suspicious: suspiciousActivityCheck,
  logger: securityAuditor
};
