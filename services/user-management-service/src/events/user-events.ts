
import { EventBus, EVENT_TYPES, EventPayload, createEventBus } from '@ai-platform/shared-utils';

export interface UserEventPayload extends EventPayload {
  userId?: string;
  adminId?: string;
  changes?: any;
  oldValues?: any;
  newValues?: any;
}

export class UserEvents {
  private eventBus: EventBus;
  private serviceName = 'user-management-service';

  constructor() {
    this.eventBus = createEventBus({
      serviceName: this.serviceName,
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
      },
      enablePersistence: true,
      enableDeadLetterQueue: true,
      retryAttempts: 3,
      retryDelay: 1000,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Subscribe to auth events for user management
    this.eventBus.subscribe(EVENT_TYPES.USER.CREATED, this.handleUserCreated.bind(this));
    this.eventBus.subscribe(EVENT_TYPES.USER.LOGIN, this.handleUserLogin.bind(this));
  }

  // Profile events
  public async publishProfileUpdated(userId: string, changes: any, adminId?: string): Promise<void> {
    await this.eventBus.publish('user.profile.updated', {
      userId,
      adminId,
      changes,
      updatedAt: new Date().toISOString(),
    }, { priority: 'medium', persistent: true });
  }

  public async publishAvatarUpdated(userId: string, oldAvatar: string | null, newAvatar: string): Promise<void> {
    await this.eventBus.publish('user.avatar.updated', {
      userId,
      oldAvatar,
      newAvatar,
      updatedAt: new Date().toISOString(),
    }, { priority: 'low' });
  }

  public async publishPreferencesUpdated(userId: string, preferences: any): Promise<void> {
    await this.eventBus.publish('user.preferences.updated', {
      userId,
      preferences,
      updatedAt: new Date().toISOString(),
    }, { priority: 'low' });
  }

  // Role and permission events
  public async publishRoleChanged(userId: string, oldRole: string, newRole: string, adminId: string): Promise<void> {
    await this.eventBus.publish('user.role.changed', {
      userId,
      adminId,
      oldRole,
      newRole,
      changedAt: new Date().toISOString(),
    }, { priority: 'high', persistent: true });
  }

  public async publishPermissionGranted(userId: string, permission: string, adminId: string): Promise<void> {
    await this.eventBus.publish('user.permission.granted', {
      userId,
      adminId,
      permission,
      grantedAt: new Date().toISOString(),
    }, { priority: 'medium', persistent: true });
  }

  public async publishPermissionRevoked(userId: string, permission: string, adminId: string): Promise<void> {
    await this.eventBus.publish('user.permission.revoked', {
      userId,
      adminId,
      permission,
      revokedAt: new Date().toISOString(),
    }, { priority: 'medium', persistent: true });
  }

  // Activity tracking events
  public async publishActivityTracked(userId: string, activity: string, details: any): Promise<void> {
    await this.eventBus.publish('user.activity.tracked', {
      userId,
      activity,
      details,
      timestamp: new Date().toISOString(),
    }, { priority: 'low' });
  }

  public async publishLoginTracked(userId: string, ip: string, userAgent: string, location?: string): Promise<void> {
    await this.eventBus.publish('user.login.tracked', {
      userId,
      ip,
      userAgent,
      location,
      timestamp: new Date().toISOString(),
    }, { priority: 'low' });
  }

  // User status events
  public async publishUserActivated(userId: string, adminId: string, reason?: string): Promise<void> {
    await this.eventBus.publish('user.status.activated', {
      userId,
      adminId,
      reason,
      timestamp: new Date().toISOString(),
    }, { priority: 'high', persistent: true });
  }

  public async publishUserDeactivated(userId: string, adminId: string, reason?: string): Promise<void> {
    await this.eventBus.publish('user.status.deactivated', {
      userId,
      adminId,
      reason,
      timestamp: new Date().toISOString(),
    }, { priority: 'high', persistent: true });
  }

  public async publishUserSuspended(userId: string, adminId: string, reason: string, duration?: string): Promise<void> {
    await this.eventBus.publish('user.status.suspended', {
      userId,
      adminId,
      reason,
      duration,
      timestamp: new Date().toISOString(),
    }, { priority: 'critical', persistent: true });
  }

  // Bulk operations events
  public async publishBulkUserUpdate(userIds: string[], changes: any, adminId: string): Promise<void> {
    await this.eventBus.publish('user.bulk.updated', {
      userIds,
      adminId,
      changes,
      affectedCount: userIds.length,
      timestamp: new Date().toISOString(),
    }, { priority: 'medium', persistent: true });
  }

  public async publishBulkUserExport(adminId: string, filterCriteria: any, exportCount: number): Promise<void> {
    await this.eventBus.publish('user.bulk.exported', {
      adminId,
      filterCriteria,
      exportCount,
      timestamp: new Date().toISOString(),
    }, { priority: 'low', persistent: true });
  }

  // Data privacy events
  public async publishDataExportRequested(userId: string, requestId: string, requestedBy: string): Promise<void> {
    await this.eventBus.publish('user.data.export_requested', {
      userId,
      requestId,
      requestedBy,
      timestamp: new Date().toISOString(),
    }, { priority: 'medium', persistent: true });
  }

  public async publishDataDeletionRequested(userId: string, requestId: string, requestedBy: string): Promise<void> {
    await this.eventBus.publish('user.data.deletion_requested', {
      userId,
      requestId,
      requestedBy,
      timestamp: new Date().toISOString(),
    }, { priority: 'high', persistent: true });
  }

  // Security and compliance events
  public async publishSensitiveDataAccessed(adminId: string, userId: string, dataType: string, reason: string): Promise<void> {
    await this.eventBus.publish('user.security.sensitive_data_accessed', {
      adminId,
      userId,
      dataType,
      reason,
      timestamp: new Date().toISOString(),
    }, { priority: 'medium', persistent: true });
  }

  public async publishComplianceCheck(userId: string, checkType: string, result: string, details: any): Promise<void> {
    await this.eventBus.publish('user.compliance.check', {
      userId,
      checkType,
      result,
      details,
      timestamp: new Date().toISOString(),
    }, { priority: 'medium', persistent: true });
  }

  // Event handlers for incoming events
  private async handleUserCreated(payload: EventPayload): Promise<void> {
    try {
      const { userId, email, role } = payload.data;
      
      console.log(`[UserEvents] New user created - ID: ${userId}, Email: ${email}, Role: ${role}`);
      
      // Initialize user profile tracking
      await this.publishActivityTracked(userId, 'account_created', {
        method: 'registration',
        role,
        source: payload.source,
      });
    } catch (error) {
      console.error('[UserEvents] Error handling user created event:', error);
    }
  }

  private async handleUserLogin(payload: EventPayload): Promise<void> {
    try {
      const { userId, ip, userAgent, success } = payload.data;
      
      if (success) {
        // Track successful login
        await this.publishLoginTracked(userId, ip, userAgent);
        await this.publishActivityTracked(userId, 'login', {
          ip,
          userAgent,
          timestamp: payload.timestamp,
        });
      }
    } catch (error) {
      console.error('[UserEvents] Error handling user login event:', error);
    }
  }

  // Utility methods
  public async getUserActivityHistory(userId: string, limit: number = 50): Promise<EventPayload[]> {
    const activities = await this.eventBus.getEventHistory('user.activity.tracked', limit * 2);
    return activities.filter(activity => activity.data.userId === userId).slice(0, limit);
  }

  public async getSecurityEvents(userId?: string, limit: number = 100): Promise<EventPayload[]> {
    const events = await this.eventBus.getEventHistory('user.security.*', limit);
    if (userId) {
      return events.filter(event => event.data.userId === userId || event.data.adminId === userId);
    }
    return events;
  }

  public getMetrics() {
    return this.eventBus.getMetrics();
  }

  public async disconnect(): Promise<void> {
    await this.eventBus.disconnect();
  }
}

// Singleton instance
let userEventsInstance: UserEvents | null = null;

export function getUserEvents(): UserEvents {
  if (!userEventsInstance) {
    userEventsInstance = new UserEvents();
  }
  return userEventsInstance;
}
