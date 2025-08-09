
import { EventBus, EVENT_TYPES, EventPayload, createEventBus } from '@ai-platform/shared-utils';

export interface AuthEventPayload extends EventPayload {
  userId?: string;
  email?: string;
  role?: string;
  ip?: string;
  userAgent?: string;
}

export class AuthEvents {
  private eventBus: EventBus;
  private serviceName = 'auth-service';

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
    // Subscribe to billing events to handle credit updates
    this.eventBus.subscribe(EVENT_TYPES.BILLING.CREDIT_CONSUMED, this.handleCreditConsumed.bind(this));
    this.eventBus.subscribe(EVENT_TYPES.BILLING.BUDGET_EXCEEDED, this.handleBudgetExceeded.bind(this));
  }

  // User lifecycle events
  public async publishUserCreated(userId: string, email: string, role: string, metadata: any = {}): Promise<void> {
    await this.eventBus.publish(EVENT_TYPES.USER.CREATED, {
      userId,
      email,
      role,
      createdAt: new Date().toISOString(),
      ...metadata,
    }, { priority: 'high', persistent: true });
  }

  public async publishUserUpdated(userId: string, changes: any, metadata: any = {}): Promise<void> {
    await this.eventBus.publish(EVENT_TYPES.USER.UPDATED, {
      userId,
      changes,
      updatedAt: new Date().toISOString(),
      ...metadata,
    }, { priority: 'medium', persistent: true });
  }

  public async publishUserDeleted(userId: string, metadata: any = {}): Promise<void> {
    await this.eventBus.publish(EVENT_TYPES.USER.DELETED, {
      userId,
      deletedAt: new Date().toISOString(),
      ...metadata,
    }, { priority: 'high', persistent: true });
  }

  // Authentication events
  public async publishUserLogin(userId: string, email: string, ip: string, userAgent: string, success: boolean = true): Promise<void> {
    await this.eventBus.publish(EVENT_TYPES.USER.LOGIN, {
      userId,
      email,
      ip,
      userAgent,
      success,
      loginAt: new Date().toISOString(),
    }, { priority: 'medium' });
  }

  public async publishUserLogout(userId: string, sessionId: string, metadata: any = {}): Promise<void> {
    await this.eventBus.publish(EVENT_TYPES.USER.LOGOUT, {
      userId,
      sessionId,
      logoutAt: new Date().toISOString(),
      ...metadata,
    }, { priority: 'low' });
  }

  // Security events
  public async publishSecurityEvent(event: string, userId: string, details: any, severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'): Promise<void> {
    await this.eventBus.publish(`security.${event}`, {
      userId,
      event,
      severity,
      details,
      timestamp: new Date().toISOString(),
    }, { priority: severity === 'critical' ? 'high' : 'medium', persistent: true });
  }

  // MFA events
  public async publishMFASetup(userId: string, method: string, success: boolean): Promise<void> {
    await this.eventBus.publish('auth.mfa.setup', {
      userId,
      method,
      success,
      timestamp: new Date().toISOString(),
    }, { priority: 'medium', persistent: true });
  }

  public async publishMFAVerification(userId: string, method: string, success: boolean, ip: string): Promise<void> {
    await this.eventBus.publish('auth.mfa.verification', {
      userId,
      method,
      success,
      ip,
      timestamp: new Date().toISOString(),
    }, { priority: 'medium' });
  }

  // OAuth events
  public async publishOAuthLogin(userId: string, provider: string, success: boolean, metadata: any = {}): Promise<void> {
    await this.eventBus.publish('auth.oauth.login', {
      userId,
      provider,
      success,
      timestamp: new Date().toISOString(),
      ...metadata,
    }, { priority: 'medium', persistent: true });
  }

  // Password events
  public async publishPasswordReset(email: string, success: boolean, ip: string): Promise<void> {
    await this.eventBus.publish('auth.password.reset', {
      email,
      success,
      ip,
      timestamp: new Date().toISOString(),
    }, { priority: 'medium' });
  }

  public async publishPasswordChange(userId: string, method: string, ip: string): Promise<void> {
    await this.eventBus.publish('auth.password.change', {
      userId,
      method, // 'reset', 'change', 'admin'
      ip,
      timestamp: new Date().toISOString(),
    }, { priority: 'medium', persistent: true });
  }

  // Event handlers for incoming events
  private async handleCreditConsumed(payload: EventPayload): Promise<void> {
    try {
      const { userId, amount, remainingCredits } = payload.data;
      
      // Log credit consumption for audit purposes
      console.log(`[AuthEvents] Credit consumed - User: ${userId}, Amount: ${amount}, Remaining: ${remainingCredits}`);
      
      // Optionally trigger notifications for low credit warnings
      if (remainingCredits < 10) {
        await this.publishSecurityEvent('low_credits', userId, {
          remainingCredits,
          consumedAmount: amount,
        }, 'medium');
      }
    } catch (error) {
      console.error('[AuthEvents] Error handling credit consumed event:', error);
    }
  }

  private async handleBudgetExceeded(payload: EventPayload): Promise<void> {
    try {
      const { userId, budgetLimit, currentUsage } = payload.data;
      
      // Log budget exceeded for security monitoring
      console.log(`[AuthEvents] Budget exceeded - User: ${userId}, Limit: ${budgetLimit}, Usage: ${currentUsage}`);
      
      // Publish security event for budget exceeded
      await this.publishSecurityEvent('budget_exceeded', userId, {
        budgetLimit,
        currentUsage,
        excessAmount: currentUsage - budgetLimit,
      }, 'high');
    } catch (error) {
      console.error('[AuthEvents] Error handling budget exceeded event:', error);
    }
  }

  // Utility methods
  public async getEventHistory(eventType: string, limit: number = 100): Promise<EventPayload[]> {
    return await this.eventBus.getEventHistory(eventType, limit);
  }

  public getMetrics() {
    return this.eventBus.getMetrics();
  }

  public async disconnect(): Promise<void> {
    await this.eventBus.disconnect();
  }
}

// Singleton instance
let authEventsInstance: AuthEvents | null = null;

export function getAuthEvents(): AuthEvents {
  if (!authEventsInstance) {
    authEventsInstance = new AuthEvents();
  }
  return authEventsInstance;
}
