
import { PrismaClient } from '@prisma/client';
import { connectRedis } from '../config/redis';

// Extend Prisma client with audit log functionality
const prisma = new PrismaClient();

export enum AuditEventType {
  // Authentication events
  LOGIN_SUCCESS = 'LOGIN_SUCCESS',
  LOGIN_FAILED = 'LOGIN_FAILED',
  LOGOUT = 'LOGOUT',
  LOGOUT_ALL = 'LOGOUT_ALL',
  TOKEN_REFRESH = 'TOKEN_REFRESH',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  
  // Registration events
  USER_REGISTERED = 'USER_REGISTERED',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',
  EMAIL_VERIFICATION_SENT = 'EMAIL_VERIFICATION_SENT',
  
  // Password events
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED = 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED = 'PASSWORD_RESET_COMPLETED',
  PASSWORD_RESET_FAILED = 'PASSWORD_RESET_FAILED',
  
  // MFA events
  MFA_ENABLED = 'MFA_ENABLED',
  MFA_DISABLED = 'MFA_DISABLED',
  MFA_VERIFIED = 'MFA_VERIFIED',
  MFA_FAILED = 'MFA_FAILED',
  BACKUP_CODES_GENERATED = 'BACKUP_CODES_GENERATED',
  BACKUP_CODE_USED = 'BACKUP_CODE_USED',
  
  // OAuth events
  OAUTH_LOGIN_SUCCESS = 'OAUTH_LOGIN_SUCCESS',
  OAUTH_LOGIN_FAILED = 'OAUTH_LOGIN_FAILED',
  OAUTH_ACCOUNT_LINKED = 'OAUTH_ACCOUNT_LINKED',
  OAUTH_ACCOUNT_UNLINKED = 'OAUTH_ACCOUNT_UNLINKED',
  
  // Account events
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED = 'ACCOUNT_UNLOCKED',
  ACCOUNT_DEACTIVATED = 'ACCOUNT_DEACTIVATED',
  ACCOUNT_REACTIVATED = 'ACCOUNT_REACTIVATED',
  PROFILE_UPDATED = 'PROFILE_UPDATED',
  ROLE_CHANGED = 'ROLE_CHANGED',
  
  // Session events
  SESSION_CREATED = 'SESSION_CREATED',
  SESSION_DELETED = 'SESSION_DELETED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  CONCURRENT_SESSION_LIMIT = 'CONCURRENT_SESSION_LIMIT',
  
  // Security events
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
  IP_BLOCKED = 'IP_BLOCKED',
  
  // System events
  API_ACCESS = 'API_ACCESS',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  DATA_ACCESS = 'DATA_ACCESS',
  CONFIGURATION_CHANGED = 'CONFIGURATION_CHANGED',
}

export enum AuditSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface AuditLogEntry {
  id?: string;
  eventType: AuditEventType;
  severity: AuditSeverity;
  userId?: string;
  userEmail?: string;
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  action?: string;
  details?: any;
  metadata?: any;
  timestamp: Date;
  success: boolean;
  errorMessage?: string;
}

export interface AuditSearchFilters {
  userId?: string;
  eventType?: AuditEventType;
  severity?: AuditSeverity;
  startDate?: Date;
  endDate?: Date;
  ipAddress?: string;
  success?: boolean;
  limit?: number;
  offset?: number;
}

export class AuditLogModel {
  /**
   * Create a new audit log entry
   */
  static async create(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
    try {
      // Create audit log entry
      const auditEntry = {
        eventType: entry.eventType,
        severity: entry.severity,
        userId: entry.userId || null,
        userEmail: entry.userEmail || null,
        sessionId: entry.sessionId || null,
        ipAddress: entry.ipAddress || null,
        userAgent: entry.userAgent || null,
        resource: entry.resource || null,
        action: entry.action || null,
        details: entry.details ? JSON.stringify(entry.details) : null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        success: entry.success,
        errorMessage: entry.errorMessage || null,
        timestamp: new Date(),
      };

      // Store in database (assuming audit_logs table exists in schema)
      // For now, we'll also cache recent entries in Redis for faster access
      const redis = await connectRedis();
      
      // Store in Redis for real-time monitoring (keep last 1000 entries)
      const redisKey = 'audit_logs:recent';
      await redis.lPush(redisKey, JSON.stringify(auditEntry));
      await redis.lTrim(redisKey, 0, 999); // Keep only last 1000 entries
      
      // Also store user-specific logs for faster user history lookup
      if (entry.userId) {
        const userLogKey = `audit_logs:user:${entry.userId}`;
        await redis.lPush(userLogKey, JSON.stringify(auditEntry));
        await redis.lTrim(userLogKey, 0, 99); // Keep last 100 per user
        await redis.expire(userLogKey, 2592000); // 30 days expiration
      }

      // Store IP-specific logs for security monitoring
      if (entry.ipAddress) {
        const ipLogKey = `audit_logs:ip:${entry.ipAddress}`;
        await redis.lPush(ipLogKey, JSON.stringify(auditEntry));
        await redis.lTrim(ipLogKey, 0, 49); // Keep last 50 per IP
        await redis.expire(ipLogKey, 604800); // 7 days expiration
      }

      // Increment event counters for monitoring
      const today = new Date().toISOString().split('T')[0];
      await redis.incr(`audit_stats:${today}:${entry.eventType}`);
      await redis.expire(`audit_stats:${today}:${entry.eventType}`, 86400 * 7); // 7 days

      if (!entry.success) {
        await redis.incr(`audit_stats:${today}:failures`);
        await redis.expire(`audit_stats:${today}:failures`, 86400 * 7);
      }

      console.log(`Audit log created: ${entry.eventType} - ${entry.success ? 'SUCCESS' : 'FAILED'}`);
    } catch (error) {
      console.error('Error creating audit log:', error);
      // Don't throw error to avoid disrupting the main flow
    }
  }

  /**
   * Get recent audit logs
   */
  static async getRecent(limit: number = 100): Promise<AuditLogEntry[]> {
    try {
      const redis = await connectRedis();
      const logs = await redis.lRange('audit_logs:recent', 0, limit - 1);
      
      return logs.map(log => JSON.parse(log));
    } catch (error) {
      console.error('Error fetching recent audit logs:', error);
      return [];
    }
  }

  /**
   * Get audit logs for a specific user
   */
  static async getUserLogs(userId: string, limit: number = 50): Promise<AuditLogEntry[]> {
    try {
      const redis = await connectRedis();
      const logs = await redis.lRange(`audit_logs:user:${userId}`, 0, limit - 1);
      
      return logs.map(log => JSON.parse(log));
    } catch (error) {
      console.error('Error fetching user audit logs:', error);
      return [];
    }
  }

  /**
   * Get audit logs for a specific IP address
   */
  static async getIPLogs(ipAddress: string, limit: number = 50): Promise<AuditLogEntry[]> {
    try {
      const redis = await connectRedis();
      const logs = await redis.lRange(`audit_logs:ip:${ipAddress}`, 0, limit - 1);
      
      return logs.map(log => JSON.parse(log));
    } catch (error) {
      console.error('Error fetching IP audit logs:', error);
      return [];
    }
  }

  /**
   * Get audit statistics for today
   */
  static async getTodayStats(): Promise<Record<string, number>> {
    try {
      const redis = await connectRedis();
      const today = new Date().toISOString().split('T')[0];
      const keys = await redis.keys(`audit_stats:${today}:*`);
      
      const stats: Record<string, number> = {};
      
      for (const key of keys) {
        const count = await redis.get(key);
        const eventType = key.split(':')[2];
        stats[eventType] = parseInt(count || '0');
      }
      
      return stats;
    } catch (error) {
      console.error('Error fetching audit stats:', error);
      return {};
    }
  }

  /**
   * Get failed login attempts for IP in last hour
   */
  static async getFailedLoginAttempts(ipAddress: string): Promise<number> {
    try {
      const redis = await connectRedis();
      const logs = await redis.lRange(`audit_logs:ip:${ipAddress}`, 0, -1);
      
      const oneHourAgo = new Date(Date.now() - 3600000);
      let failedAttempts = 0;
      
      for (const logStr of logs) {
        const log = JSON.parse(logStr);
        const logTime = new Date(log.timestamp);
        
        if (
          logTime > oneHourAgo &&
          (log.eventType === AuditEventType.LOGIN_FAILED || log.eventType === AuditEventType.OAUTH_LOGIN_FAILED) &&
          !log.success
        ) {
          failedAttempts++;
        }
      }
      
      return failedAttempts;
    } catch (error) {
      console.error('Error counting failed login attempts:', error);
      return 0;
    }
  }

  /**
   * Check for suspicious activity patterns
   */
  static async detectSuspiciousActivity(userId: string): Promise<{
    suspicious: boolean;
    reasons: string[];
  }> {
    try {
      const redis = await connectRedis();
      const logs = await redis.lRange(`audit_logs:user:${userId}`, 0, 49);
      
      const reasons: string[] = [];
      const recentLogs = logs.map(log => JSON.parse(log));
      const lastHour = new Date(Date.now() - 3600000);
      
      // Check for multiple failed attempts
      const recentFailures = recentLogs.filter(log => 
        new Date(log.timestamp) > lastHour && !log.success
      );
      
      if (recentFailures.length >= 5) {
        reasons.push('Multiple failed attempts in last hour');
      }
      
      // Check for logins from multiple IPs
      const recentLogins = recentLogs.filter(log => 
        new Date(log.timestamp) > lastHour && 
        log.eventType === AuditEventType.LOGIN_SUCCESS
      );
      
      const uniqueIPs = new Set(recentLogins.map(log => log.ipAddress));
      if (uniqueIPs.size > 3) {
        reasons.push('Logins from multiple IP addresses');
      }
      
      // Check for rapid successive actions
      const recentActions = recentLogs.filter(log => 
        new Date(log.timestamp) > new Date(Date.now() - 300000) // 5 minutes
      );
      
      if (recentActions.length > 20) {
        reasons.push('Unusually high activity rate');
      }
      
      return {
        suspicious: reasons.length > 0,
        reasons,
      };
    } catch (error) {
      console.error('Error detecting suspicious activity:', error);
      return { suspicious: false, reasons: [] };
    }
  }

  /**
   * Clean up old audit logs from Redis
   */
  static async cleanup(): Promise<void> {
    try {
      const redis = await connectRedis();
      
      // Clean up expired user logs
      const userKeys = await redis.keys('audit_logs:user:*');
      for (const key of userKeys) {
        const ttl = await redis.ttl(key);
        if (ttl === -1) {
          await redis.expire(key, 2592000); // Set 30 day expiration
        }
      }
      
      // Clean up expired IP logs
      const ipKeys = await redis.keys('audit_logs:ip:*');
      for (const key of ipKeys) {
        const ttl = await redis.ttl(key);
        if (ttl === -1) {
          await redis.expire(key, 604800); // Set 7 day expiration
        }
      }
      
      console.log('Audit log cleanup completed');
    } catch (error) {
      console.error('Error cleaning up audit logs:', error);
    }
  }
}

// Helper function to create audit logs with consistent format
export const createAuditLog = async (
  eventType: AuditEventType,
  options: {
    severity?: AuditSeverity;
    userId?: string;
    userEmail?: string;
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
    resource?: string;
    action?: string;
    details?: any;
    metadata?: any;
    success?: boolean;
    errorMessage?: string;
  } = {}
): Promise<void> => {
  await AuditLogModel.create({
    eventType,
    severity: options.severity || AuditSeverity.LOW,
    userId: options.userId,
    userEmail: options.userEmail,
    sessionId: options.sessionId,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    resource: options.resource,
    action: options.action,
    details: options.details,
    metadata: options.metadata,
    success: options.success !== false, // Default to true
    errorMessage: options.errorMessage,
  });
};
