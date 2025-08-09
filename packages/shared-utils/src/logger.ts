
import { createLogger, format, transports, Logger } from 'winston';
import path from 'path';

export interface LogContext {
  service?: string;
  userId?: string;
  requestId?: string;
  sessionId?: string;
  operation?: string;
  duration?: number;
  statusCode?: number;
  method?: string;
  url?: string;
  userAgent?: string;
  ip?: string;
  [key: string]: any;
}

export class StructuredLogger {
  private logger: Logger;
  private serviceName: string;

  constructor(serviceName: string, logLevel: string = 'info') {
    this.serviceName = serviceName;
    this.logger = this.createLogger(logLevel);
  }

  private createLogger(logLevel: string): Logger {
    const logFormat = format.combine(
      format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      format.errors({ stack: true }),
      format.json(),
      format.printf((info) => {
        const logEntry = {
          timestamp: info.timestamp,
          level: info.level,
          service: this.serviceName,
          message: info.message,
          ...info.meta,
          ...(info.stack && { stack: info.stack }),
        };
        return JSON.stringify(logEntry);
      })
    );

    const logger = createLogger({
      level: logLevel,
      format: logFormat,
      defaultMeta: { service: this.serviceName },
      transports: [
        // Console transport for development
        new transports.Console({
          format: process.env.NODE_ENV === 'development' 
            ? format.combine(
                format.colorize(),
                format.simple(),
                format.printf(({ timestamp, level, message, service, ...meta }) => {
                  const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
                  return `${timestamp} [${service}] ${level}: ${message} ${metaStr}`;
                })
              )
            : logFormat
        }),

        // File transport for persistent logs
        new transports.File({
          filename: path.join(process.cwd(), 'logs', 'error.log'),
          level: 'error',
          maxsize: 10485760, // 10MB
          maxFiles: 5,
        }),

        new transports.File({
          filename: path.join(process.cwd(), 'logs', 'combined.log'),
          maxsize: 10485760, // 10MB
          maxFiles: 5,
        }),

        // HTTP transport for ELK stack integration
        ...(process.env.ELASTICSEARCH_URL ? [
          new transports.Http({
            host: process.env.ELASTICSEARCH_HOST || 'localhost',
            port: parseInt(process.env.ELASTICSEARCH_PORT || '9200'),
            path: `/${process.env.ELASTICSEARCH_INDEX || 'ai-platform-logs'}-${new Date().toISOString().slice(0, 7)}/_doc`,
            ssl: process.env.ELASTICSEARCH_SSL === 'true',
          })
        ] : []),
      ],
    });

    return logger;
  }

  info(message: string, context?: LogContext): void {
    this.logger.info(message, { meta: context });
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.logger.error(message, {
      meta: {
        ...context,
        error: error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : undefined,
      },
    });
  }

  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, { meta: context });
  }

  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, { meta: context });
  }

  // Performance logging
  performance(operation: string, duration: number, context?: LogContext): void {
    this.info(`Performance: ${operation} completed`, {
      ...context,
      operation,
      duration,
      type: 'performance',
    });
  }

  // Security logging
  security(event: string, context?: LogContext): void {
    this.warn(`Security: ${event}`, {
      ...context,
      type: 'security',
      severity: 'high',
    });
  }

  // Business logic logging
  business(event: string, context?: LogContext): void {
    this.info(`Business: ${event}`, {
      ...context,
      type: 'business',
    });
  }

  // HTTP request logging
  http(method: string, url: string, statusCode: number, duration: number, context?: LogContext): void {
    const level = statusCode >= 400 ? 'error' : statusCode >= 300 ? 'warn' : 'info';
    this.logger.log(level, `HTTP ${method} ${url}`, {
      meta: {
        ...context,
        method,
        url,
        statusCode,
        duration,
        type: 'http',
      },
    });
  }
}

// Factory function to create service-specific loggers
export const createServiceLogger = (serviceName: string): StructuredLogger => {
  const logLevel = process.env.LOG_LEVEL || 'info';
  return new StructuredLogger(serviceName, logLevel);
};

// Default logger instance
export const logger = createServiceLogger('ai-platform');

// Metrics collection utilities
export class MetricsCollector {
  private static instance: MetricsCollector;
  private metrics: Map<string, any> = new Map();
  private logger: StructuredLogger;

  private constructor() {
    this.logger = createServiceLogger('metrics');
  }

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  // Counter metrics
  incrementCounter(name: string, labels?: Record<string, string>): void {
    const key = `${name}${labels ? JSON.stringify(labels) : ''}`;
    const current = this.metrics.get(key) || 0;
    this.metrics.set(key, current + 1);
    
    this.logger.info('Counter incremented', {
      metric: name,
      labels,
      value: current + 1,
      type: 'counter',
    });
  }

  // Histogram metrics
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = `${name}_histogram${labels ? JSON.stringify(labels) : ''}`;
    const existing = this.metrics.get(key) || { sum: 0, count: 0, values: [] };
    
    existing.sum += value;
    existing.count += 1;
    existing.values.push(value);
    
    // Keep only last 1000 values for memory efficiency
    if (existing.values.length > 1000) {
      existing.values.shift();
    }
    
    this.metrics.set(key, existing);
    
    this.logger.info('Histogram recorded', {
      metric: name,
      labels,
      value,
      avg: existing.sum / existing.count,
      type: 'histogram',
    });
  }

  // Gauge metrics
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = `${name}_gauge${labels ? JSON.stringify(labels) : ''}`;
    this.metrics.set(key, value);
    
    this.logger.info('Gauge set', {
      metric: name,
      labels,
      value,
      type: 'gauge',
    });
  }

  // Get all metrics for export
  getMetrics(): Record<string, any> {
    const result: Record<string, any> = {};
    this.metrics.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  // Export metrics in Prometheus format
  exportPrometheusFormat(): string {
    let output = '';
    this.metrics.forEach((value, key) => {
      if (typeof value === 'number') {
        output += `${key} ${value}\n`;
      } else if (value.sum !== undefined) {
        // Histogram
        output += `${key}_sum ${value.sum}\n`;
        output += `${key}_count ${value.count}\n`;
      }
    });
    return output;
  }

  // Clear metrics (useful for testing)
  clear(): void {
    this.metrics.clear();
  }
}

export const metrics = MetricsCollector.getInstance();
