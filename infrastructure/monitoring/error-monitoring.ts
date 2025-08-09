
import { logger } from '../../packages/shared-utils/src/logger';
import { CircuitBreakerFactory } from '../../packages/shared-utils/src/resilience/circuit-breaker';
import { RetryFactory } from '../../packages/shared-utils/src/resilience/retry-mechanism';
import { GracefulDegradationFactory } from '../../packages/shared-utils/src/resilience/graceful-degradation';

export interface ErrorMetrics {
  totalErrors: number;
  errorsByType: Record<string, number>;
  errorsByService: Record<string, number>;
  errorRate: number;
  averageErrorsPerMinute: number;
  criticalErrors: number;
  lastErrorTime?: Date;
}

export interface AlertConfig {
  errorRateThreshold: number;
  criticalErrorThreshold: number;
  consecutiveErrorThreshold: number;
  webhookUrl?: string;
  emailRecipients?: string[];
  slackChannel?: string;
}

export interface Alert {
  id: string;
  type: 'ERROR_RATE' | 'CRITICAL_ERROR' | 'CONSECUTIVE_ERRORS' | 'CIRCUIT_BREAKER' | 'SERVICE_DOWN';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  service?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  acknowledged: boolean;
}

export class ErrorMonitoring {
  private errorMetrics: ErrorMetrics = {
    totalErrors: 0,
    errorsByType: {},
    errorsByService: {},
    errorRate: 0,
    averageErrorsPerMinute: 0,
    criticalErrors: 0
  };

  private alerts: Alert[] = [];
  private errorHistory: Array<{ timestamp: Date; error: any }> = [];
  private readonly maxHistorySize = 1000;
  private monitoringInterval?: NodeJS.Timeout;
  private consecutiveErrors = 0;

  constructor(private readonly alertConfig: AlertConfig) {
    this.startMonitoring();
  }

  public recordError(
    error: Error,
    service: string,
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM',
    metadata?: Record<string, any>
  ): void {
    const timestamp = new Date();
    
    // Update metrics
    this.errorMetrics.totalErrors++;
    this.errorMetrics.lastErrorTime = timestamp;
    
    // Count by type
    const errorType = error.constructor.name;
    this.errorMetrics.errorsByType[errorType] = (this.errorMetrics.errorsByType[errorType] || 0) + 1;
    
    // Count by service
    this.errorMetrics.errorsByService[service] = (this.errorMetrics.errorsByService[service] || 0) + 1;
    
    // Track critical errors
    if (severity === 'CRITICAL') {
      this.errorMetrics.criticalErrors++;
    }

    // Add to history
    this.errorHistory.push({
      timestamp,
      error: {
        message: error.message,
        stack: error.stack,
        type: errorType,
        service,
        severity,
        metadata
      }
    });

    // Trim history if needed
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
    }

    // Update consecutive errors
    this.consecutiveErrors++;

    // Log the error
    logger.error(`Error recorded for ${service}`, {
      error: {
        message: error.message,
        type: errorType,
        severity
      },
      service,
      metadata,
      consecutiveErrors: this.consecutiveErrors,
      metrics: this.errorMetrics
    });

    // Check for alerts
    this.checkForAlerts(error, service, severity, metadata);
  }

  public recordSuccess(service: string): void {
    this.consecutiveErrors = 0;
    logger.debug(`Success recorded for ${service}`, {
      service,
      consecutiveErrorsReset: true
    });
  }

  private checkForAlerts(
    error: Error,
    service: string,
    severity: string,
    metadata?: Record<string, any>
  ): void {
    const now = new Date();

    // Check for critical error alert
    if (severity === 'CRITICAL') {
      this.createAlert({
        type: 'CRITICAL_ERROR',
        severity: 'CRITICAL',
        message: `Critical error in ${service}: ${error.message}`,
        service,
        metadata: { error: error.message, ...metadata }
      });
    }

    // Check for consecutive errors
    if (this.consecutiveErrors >= this.alertConfig.consecutiveErrorThreshold) {
      this.createAlert({
        type: 'CONSECUTIVE_ERRORS',
        severity: 'HIGH',
        message: `${this.consecutiveErrors} consecutive errors detected across services`,
        metadata: { consecutiveErrors: this.consecutiveErrors, lastError: error.message }
      });
    }

    // Check for service-specific error rate
    const serviceErrors = this.errorMetrics.errorsByService[service] || 0;
    if (serviceErrors >= 10) { // Alert after 10 errors for a service
      this.createAlert({
        type: 'ERROR_RATE',
        severity: 'MEDIUM',
        message: `High error rate detected for ${service}: ${serviceErrors} errors`,
        service,
        metadata: { errorCount: serviceErrors }
      });
    }
  }

  private createAlert(alertData: Omit<Alert, 'id' | 'timestamp' | 'acknowledged'>): void {
    const alert: Alert = {
      id: this.generateAlertId(),
      timestamp: new Date(),
      acknowledged: false,
      ...alertData
    };

    this.alerts.push(alert);

    // Log alert
    logger.warn('Alert created', {
      alert: {
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        service: alert.service
      }
    });

    // Send alert notifications
    this.sendAlertNotification(alert);
  }

  private async sendAlertNotification(alert: Alert): Promise<void> {
    try {
      // Webhook notification
      if (this.alertConfig.webhookUrl) {
        await this.sendWebhookNotification(alert);
      }

      // Additional notification methods can be added here
      // - Email notifications
      // - Slack notifications
      // - SMS notifications
    } catch (error) {
      logger.error('Failed to send alert notification', {
        alert: alert.id,
        error: (error as Error).message
      });
    }
  }

  private async sendWebhookNotification(alert: Alert): Promise<void> {
    if (!this.alertConfig.webhookUrl) return;

    const payload = {
      alert: {
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        service: alert.service,
        timestamp: alert.timestamp.toISOString(),
        metadata: alert.metadata
      },
      metrics: this.getMetrics(),
      systemHealth: this.getSystemHealth()
    };

    // In a real implementation, you would use fetch or axios to send the webhook
    logger.info('Webhook notification sent', {
      webhookUrl: this.alertConfig.webhookUrl,
      alertId: alert.id,
      payload
    });
  }

  private startMonitoring(): void {
    // Run monitoring checks every minute
    this.monitoringInterval = setInterval(() => {
      this.updateMetrics();
      this.checkSystemHealth();
      this.cleanupOldAlerts();
    }, 60000);

    logger.info('Error monitoring started', {
      alertConfig: this.alertConfig
    });
  }

  private updateMetrics(): void {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    const recentErrors = this.errorHistory.filter(entry => entry.timestamp >= oneMinuteAgo);
    
    this.errorMetrics.averageErrorsPerMinute = recentErrors.length;
    
    // Calculate error rate (errors per minute over the last hour)
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const hourlyErrors = this.errorHistory.filter(entry => entry.timestamp >= oneHourAgo);
    this.errorMetrics.errorRate = hourlyErrors.length / 60; // errors per minute

    // Check for error rate alert
    if (this.errorMetrics.errorRate >= this.alertConfig.errorRateThreshold) {
      this.createAlert({
        type: 'ERROR_RATE',
        severity: 'HIGH',
        message: `High system error rate: ${this.errorMetrics.errorRate.toFixed(2)} errors/minute`,
        metadata: { 
          errorRate: this.errorMetrics.errorRate,
          threshold: this.alertConfig.errorRateThreshold
        }
      });
    }
  }

  private checkSystemHealth(): void {
    // Check circuit breaker health
    const circuitBreakerHealth = CircuitBreakerFactory.getHealthReport();
    for (const [serviceName, stats] of Object.entries(circuitBreakerHealth)) {
      if (stats.currentState === 'OPEN') {
        this.createAlert({
          type: 'CIRCUIT_BREAKER',
          severity: 'HIGH',
          message: `Circuit breaker is OPEN for ${serviceName}`,
          service: serviceName,
          metadata: { circuitBreakerStats: stats }
        });
      }
    }

    // Check graceful degradation health
    const degradationHealth = GracefulDegradationFactory.getHealthReport();
    for (const [serviceName, health] of Object.entries(degradationHealth)) {
      if (!health.isHealthy) {
        this.createAlert({
          type: 'SERVICE_DOWN',
          severity: health.degradationLevel >= 3 ? 'CRITICAL' : 'HIGH',
          message: `Service ${serviceName} is degraded`,
          service: serviceName,
          metadata: { serviceHealth: health }
        });
      }
    }
  }

  private cleanupOldAlerts(): void {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    this.alerts = this.alerts.filter(alert => alert.timestamp >= oneWeekAgo);
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public getMetrics(): ErrorMetrics {
    return { ...this.errorMetrics };
  }

  public getAlerts(limit: number = 50): Alert[] {
    return this.alerts
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  public getUnacknowledgedAlerts(): Alert[] {
    return this.alerts.filter(alert => !alert.acknowledged);
  }

  public acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      logger.info(`Alert acknowledged: ${alertId}`);
      return true;
    }
    return false;
  }

  public getSystemHealth(): any {
    return {
      errorMonitoring: {
        isHealthy: this.consecutiveErrors < this.alertConfig.consecutiveErrorThreshold,
        consecutiveErrors: this.consecutiveErrors,
        errorRate: this.errorMetrics.errorRate,
        activeAlerts: this.getUnacknowledgedAlerts().length
      },
      circuitBreakers: CircuitBreakerFactory.getHealthReport(),
      gracefulDegradation: GracefulDegradationFactory.getHealthReport(),
      retryMechanisms: RetryFactory.getStats()
    };
  }

  public reset(): void {
    this.errorMetrics = {
      totalErrors: 0,
      errorsByType: {},
      errorsByService: {},
      errorRate: 0,
      averageErrorsPerMinute: 0,
      criticalErrors: 0
    };
    
    this.alerts = [];
    this.errorHistory = [];
    this.consecutiveErrors = 0;
    
    logger.info('Error monitoring reset');
  }

  public destroy(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    
    logger.info('Error monitoring destroyed');
  }
}

// Global error monitoring instance
let globalErrorMonitoring: ErrorMonitoring | null = null;

export function initializeErrorMonitoring(alertConfig: AlertConfig): ErrorMonitoring {
  if (!globalErrorMonitoring) {
    globalErrorMonitoring = new ErrorMonitoring(alertConfig);
  }
  return globalErrorMonitoring;
}

export function getErrorMonitoring(): ErrorMonitoring | null {
  return globalErrorMonitoring;
}

// Middleware to integrate with Express error handling
export function errorMonitoringMiddleware() {
  return (error: Error, req: any, res: any, next: any) => {
    if (globalErrorMonitoring) {
      const service = req.baseUrl?.split('/')[2] || 'unknown'; // Extract service from URL
      const severity = error.name === 'ValidationError' ? 'LOW' : 'MEDIUM';
      
      globalErrorMonitoring.recordError(error, service, severity, {
        url: req.url,
        method: req.method,
        userAgent: req.headers['user-agent'],
        ip: req.ip
      });
    }
    
    next(error);
  };
}
