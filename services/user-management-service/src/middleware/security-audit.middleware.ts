
import { Request, Response, NextFunction } from 'express';
import { logger } from '../../../../packages/shared-utils/src/logger';
import { securityAuditor, SecurityEventType, SecuritySeverity } from '../../../auth-service/src/middleware/security-audit.middleware';

// User management specific security events
export enum UserManagementSecurityEventType {
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DELETED = 'USER_DELETED',
  ROLE_CHANGED = 'ROLE_CHANGED',
  PROFILE_VIEWED = 'PROFILE_VIEWED',
  BULK_OPERATION = 'BULK_OPERATION',
  SENSITIVE_DATA_ACCESS = 'SENSITIVE_DATA_ACCESS',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  DATA_EXPORT = 'DATA_EXPORT',
  PRIVACY_VIOLATION = 'PRIVACY_VIOLATION'
}

class UserManagementSecurityAuditor {
  private sensitiveFields = new Set([
    'password',
    'ssn',
    'social_security',
    'tax_id',
    'credit_card',
    'bank_account',
    'phone',
    'address',
    'personal_id'
  ]);

  public logUserManagementEvent(
    eventType: UserManagementSecurityEventType | SecurityEventType,
    severity: SecuritySeverity,
    req: Request,
    success: boolean,
    targetUserId?: string,
    details?: Record<string, any>
  ): void {
    const enhancedDetails = {
      ...details,
      targetUserId,
      service: 'user-management',
      operatingUserId: (req as any).user?.id,
      operatingUserRole: (req as any).user?.role
    };

    // Check for privilege escalation
    if (this.isPrivilegeEscalation(req, targetUserId, eventType)) {
      securityAuditor.logEvent(
        SecurityEventType.PRIVILEGE_ESCALATION,
        SecuritySeverity.CRITICAL,
        req,
        false,
        { ...enhancedDetails, originalEventType: eventType }
      );
    }

    // Log the main event
    securityAuditor.logEvent(
      eventType as SecurityEventType,
      severity,
      req,
      success,
      enhancedDetails
    );
  }

  private isPrivilegeEscalation(
    req: Request,
    targetUserId?: string,
    eventType?: UserManagementSecurityEventType | SecurityEventType
  ): boolean {
    const operatingUser = (req as any).user;
    if (!operatingUser) return false;

    // Check if non-admin is trying to modify admin users
    if (operatingUser.role !== 'ADMIN' && operatingUser.role !== 'SUPER_ADMIN') {
      if (eventType === UserManagementSecurityEventType.ROLE_CHANGED ||
          eventType === UserManagementSecurityEventType.USER_DELETED) {
        return true;
      }

      // Check if trying to modify other users (except self)
      if (targetUserId && targetUserId !== operatingUser.id) {
        if ([
          UserManagementSecurityEventType.USER_UPDATED,
          UserManagementSecurityEventType.USER_DELETED
        ].includes(eventType as UserManagementSecurityEventType)) {
          return true;
        }
      }
    }

    // Check if regular admin is trying to modify super admin
    if (operatingUser.role === 'ADMIN' && eventType === UserManagementSecurityEventType.ROLE_CHANGED) {
      const newRole = req.body?.role;
      if (newRole === 'SUPER_ADMIN') {
        return true;
      }
    }

    return false;
  }

  public checkSensitiveDataAccess(req: Request): boolean {
    const body = req.body || {};
    const query = req.query || {};
    const params = req.params || {};

    const allData = { ...body, ...query, ...params };
    
    for (const [key, value] of Object.entries(allData)) {
      if (this.sensitiveFields.has(key.toLowerCase()) ||
          (typeof value === 'string' && this.containsSensitivePattern(value))) {
        return true;
      }
    }

    return false;
  }

  private containsSensitivePattern(value: string): boolean {
    const patterns = [
      /\d{3}-\d{2}-\d{4}/, // SSN pattern
      /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/, // Credit card pattern
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/ // Email pattern (in some contexts)
    ];

    return patterns.some(pattern => pattern.test(value));
  }
}

const userMgmtAuditor = new UserManagementSecurityAuditor();

// Middleware to log user management security events
export function userManagementAuditMiddleware(req: Request, res: Response, next: NextFunction) {
  // Store original response methods
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
    const method = req.method.toUpperCase();
    
    let eventType: UserManagementSecurityEventType | SecurityEventType = SecurityEventType.DATA_ACCESS;
    let severity = SecuritySeverity.LOW;
    let targetUserId = req.params?.id || req.params?.userId || req.body?.userId;

    // Determine event type based on endpoint and method
    if (path.includes('/users')) {
      switch (method) {
        case 'POST':
          if (path.includes('/bulk')) {
            eventType = UserManagementSecurityEventType.BULK_OPERATION;
            severity = SecuritySeverity.HIGH;
          } else {
            eventType = UserManagementSecurityEventType.USER_CREATED;
            severity = SecuritySeverity.MEDIUM;
          }
          break;
        case 'PUT':
        case 'PATCH':
          if (path.includes('/role')) {
            eventType = UserManagementSecurityEventType.ROLE_CHANGED;
            severity = SecuritySeverity.HIGH;
          } else {
            eventType = UserManagementSecurityEventType.USER_UPDATED;
            severity = SecuritySeverity.MEDIUM;
          }
          break;
        case 'DELETE':
          eventType = UserManagementSecurityEventType.USER_DELETED;
          severity = SecuritySeverity.HIGH;
          break;
        case 'GET':
          eventType = UserManagementSecurityEventType.PROFILE_VIEWED;
          severity = SecuritySeverity.LOW;
          break;
      }
    }

    // Check for sensitive data access
    if (userMgmtAuditor.checkSensitiveDataAccess(req)) {
      eventType = UserManagementSecurityEventType.SENSITIVE_DATA_ACCESS;
      severity = SecuritySeverity.HIGH;
    }

    // Check for data export operations
    if (path.includes('/export') || req.query.export) {
      eventType = UserManagementSecurityEventType.DATA_EXPORT;
      severity = SecuritySeverity.HIGH;
    }

    // Handle permission denied
    if (res.statusCode === 403) {
      eventType = UserManagementSecurityEventType.PERMISSION_DENIED;
      severity = SecuritySeverity.HIGH;
    }

    // Prepare additional details
    const details: Record<string, any> = {
      statusCode: res.statusCode,
      responseTime: Date.now() - (req as any).startTime,
      endpoint: path,
      method: method
    };

    if (responseBody?.error) {
      details.error = responseBody.error;
    }

    if (req.body && Object.keys(req.body).length > 0) {
      // Log field names but not values for privacy
      details.modifiedFields = Object.keys(req.body);
    }

    if (req.query?.q) {
      details.searchQuery = req.query.q;
    }

    // Log the event
    userMgmtAuditor.logUserManagementEvent(
      eventType,
      severity,
      req,
      success,
      targetUserId,
      details
    );

    return originalEnd.call(this, chunk);
  };

  // Record start time
  (req as any).startTime = Date.now();

  next();
}

// Middleware to check for privacy violations
export function privacyProtectionMiddleware(req: Request, res: Response, next: NextFunction) {
  const operatingUser = (req as any).user;
  const targetUserId = req.params?.id || req.params?.userId;

  // Check if user is trying to access other user's private data
  if (targetUserId && operatingUser?.id !== targetUserId && 
      operatingUser?.role !== 'ADMIN' && operatingUser?.role !== 'SUPER_ADMIN') {
    
    userMgmtAuditor.logUserManagementEvent(
      UserManagementSecurityEventType.PRIVACY_VIOLATION,
      SecuritySeverity.HIGH,
      req,
      false,
      targetUserId,
      { 
        attemptType: 'unauthorized_access',
        operatingUserId: operatingUser?.id 
      }
    );

    return res.status(403).json({
      error: 'Access denied',
      message: 'You can only access your own profile'
    });
  }

  // Check for bulk operations by non-admin users
  if (req.path.includes('/bulk') && 
      operatingUser?.role !== 'ADMIN' && operatingUser?.role !== 'SUPER_ADMIN') {
    
    userMgmtAuditor.logUserManagementEvent(
      UserManagementSecurityEventType.PRIVACY_VIOLATION,
      SecuritySeverity.CRITICAL,
      req,
      false,
      undefined,
      { attemptType: 'unauthorized_bulk_operation' }
    );

    return res.status(403).json({
      error: 'Access denied',
      message: 'Bulk operations require admin privileges'
    });
  }

  next();
}

// Middleware to log sensitive field access
export function sensitiveFieldAccessMiddleware(req: Request, res: Response, next: NextFunction) {
  if (userMgmtAuditor.checkSensitiveDataAccess(req)) {
    logger.info('Sensitive data access detected', {
      userId: (req as any).user?.id,
      ip: req.ip,
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString()
    });

    // Add header to indicate sensitive data handling
    res.setHeader('X-Sensitive-Data-Access', 'true');
  }

  next();
}

export { userMgmtAuditor };
