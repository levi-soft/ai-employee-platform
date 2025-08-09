
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  flags: number;
  baggage?: Record<string, string>;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'ok' | 'error' | 'timeout';
  tags: Record<string, any>;
  logs: LogEntry[];
  service: string;
  component?: string;
}

export interface LogEntry {
  timestamp: number;
  fields: Record<string, any>;
}

export interface TracerConfig {
  serviceName: string;
  version?: string;
  environment?: string;
  samplingRate?: number;
  enableConsoleOutput?: boolean;
  enableMetrics?: boolean;
  maxSpansInMemory?: number;
  flushInterval?: number;
}

export interface TraceMetrics {
  totalSpans: number;
  activeSpans: number;
  completedSpans: number;
  errorSpans: number;
  averageDuration: number;
  throughputPerSecond: number;
  serviceStats: Record<string, {
    spanCount: number;
    errorRate: number;
    avgDuration: number;
  }>;
}

class SpanContext {
  private span: Span;
  private tracer: DistributedTracer;
  private startTime: number;

  constructor(span: Span, tracer: DistributedTracer) {
    this.span = span;
    this.tracer = tracer;
    this.startTime = Date.now();
  }

  public setTag(key: string, value: any): SpanContext {
    this.span.tags[key] = value;
    return this;
  }

  public setTags(tags: Record<string, any>): SpanContext {
    Object.assign(this.span.tags, tags);
    return this;
  }

  public log(fields: Record<string, any>): SpanContext {
    this.span.logs.push({
      timestamp: Date.now(),
      fields,
    });
    return this;
  }

  public logError(error: Error | string): SpanContext {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    this.log({
      level: 'error',
      message: errorMessage,
      stack: errorStack,
    });
    
    this.setTag('error', true);
    this.span.status = 'error';
    
    return this;
  }

  public setStatus(status: 'ok' | 'error' | 'timeout'): SpanContext {
    this.span.status = status;
    return this;
  }

  public finish(): void {
    this.span.endTime = Date.now();
    this.span.duration = this.span.endTime - this.span.startTime;
    
    this.tracer.finishSpan(this.span);
  }

  public getSpan(): Span {
    return { ...this.span };
  }

  public getTraceId(): string {
    return this.span.traceId;
  }

  public getSpanId(): string {
    return this.span.spanId;
  }
}

export class DistributedTracer {
  private config: TracerConfig;
  private activeSpans: Map<string, Span> = new Map();
  private completedSpans: Span[] = [];
  private metrics: TraceMetrics;
  private lastFlush: number = Date.now();

  constructor(config: TracerConfig) {
    this.config = {
      samplingRate: 1.0,
      enableConsoleOutput: false,
      enableMetrics: true,
      maxSpansInMemory: 10000,
      flushInterval: 30000,
      ...config,
    };

    this.initializeMetrics();
    this.startPeriodicFlush();
  }

  private initializeMetrics(): void {
    this.metrics = {
      totalSpans: 0,
      activeSpans: 0,
      completedSpans: 0,
      errorSpans: 0,
      averageDuration: 0,
      throughputPerSecond: 0,
      serviceStats: {},
    };
  }

  private startPeriodicFlush(): void {
    setInterval(() => {
      this.flush();
      this.updateMetrics();
    }, this.config.flushInterval);
  }

  public startSpan(operationName: string, parentSpan?: SpanContext | TraceContext): SpanContext {
    // Check sampling
    if (Math.random() > this.config.samplingRate!) {
      return this.createNoOpSpan();
    }

    const now = Date.now();
    const traceId = parentSpan?.getTraceId?.() || (parentSpan as TraceContext)?.traceId || this.generateTraceId();
    const spanId = this.generateSpanId();
    const parentSpanId = parentSpan?.getSpanId?.() || (parentSpan as TraceContext)?.spanId;

    const span: Span = {
      traceId,
      spanId,
      parentSpanId,
      operationName,
      startTime: now,
      status: 'ok',
      tags: {
        'service.name': this.config.serviceName,
        'service.version': this.config.version || '1.0.0',
        'environment': this.config.environment || 'development',
      },
      logs: [],
      service: this.config.serviceName,
    };

    this.activeSpans.set(spanId, span);
    
    if (this.config.enableConsoleOutput) {
      console.log(`[Tracing] Started span: ${operationName} [${spanId}]`);
    }

    return new SpanContext(span, this);
  }

  public createChildSpan(operationName: string, parentSpan: SpanContext): SpanContext {
    return this.startSpan(operationName, parentSpan);
  }

  public extractTraceContext(carrier: any): TraceContext | null {
    try {
      const traceId = carrier['x-trace-id'] || carrier.traceId;
      const spanId = carrier['x-span-id'] || carrier.spanId;
      const parentSpanId = carrier['x-parent-span-id'] || carrier.parentSpanId;
      const flags = parseInt(carrier['x-trace-flags'] || carrier.flags || '0');

      if (traceId && spanId) {
        return {
          traceId,
          spanId,
          parentSpanId,
          flags,
        };
      }
    } catch (error) {
      console.error('[Tracing] Error extracting trace context:', error);
    }
    
    return null;
  }

  public injectTraceContext(spanContext: SpanContext, carrier: any): void {
    const span = spanContext.getSpan();
    carrier['x-trace-id'] = span.traceId;
    carrier['x-span-id'] = span.spanId;
    if (span.parentSpanId) {
      carrier['x-parent-span-id'] = span.parentSpanId;
    }
    carrier['x-trace-flags'] = '1';
  }

  public finishSpan(span: Span): void {
    this.activeSpans.delete(span.spanId);
    this.completedSpans.push(span);
    
    if (this.config.enableConsoleOutput) {
      console.log(`[Tracing] Finished span: ${span.operationName} [${span.spanId}] - ${span.duration}ms`);
    }

    // Cleanup if memory usage is high
    if (this.completedSpans.length > this.config.maxSpansInMemory!) {
      this.flush();
    }
  }

  public flush(): void {
    if (this.completedSpans.length === 0) return;

    // In a real implementation, this would send to a tracing backend
    if (this.config.enableConsoleOutput) {
      console.log(`[Tracing] Flushing ${this.completedSpans.length} completed spans`);
    }

    // Simulate sending to backend
    this.processCompletedSpans();
    this.completedSpans = [];
    this.lastFlush = Date.now();
  }

  private processCompletedSpans(): void {
    // This would typically send spans to Jaeger, Zipkin, or other tracing backend
    // For now, we'll just update metrics and optionally log
    this.completedSpans.forEach(span => {
      if (this.config.enableConsoleOutput) {
        console.log(`[Tracing] Span: ${span.service}/${span.operationName} - ${span.duration}ms - ${span.status}`);
      }
    });
  }

  private updateMetrics(): void {
    if (!this.config.enableMetrics) return;

    const totalSpans = this.completedSpans.length;
    const errorSpans = this.completedSpans.filter(span => span.status === 'error').length;
    const totalDuration = this.completedSpans.reduce((sum, span) => sum + (span.duration || 0), 0);
    
    this.metrics.totalSpans += totalSpans;
    this.metrics.activeSpans = this.activeSpans.size;
    this.metrics.completedSpans += totalSpans;
    this.metrics.errorSpans += errorSpans;
    
    if (totalSpans > 0) {
      this.metrics.averageDuration = totalDuration / totalSpans;
    }

    const timeSinceLastFlush = (Date.now() - this.lastFlush) / 1000;
    this.metrics.throughputPerSecond = timeSinceLastFlush > 0 ? totalSpans / timeSinceLastFlush : 0;

    // Update service stats
    this.completedSpans.forEach(span => {
      if (!this.metrics.serviceStats[span.service]) {
        this.metrics.serviceStats[span.service] = {
          spanCount: 0,
          errorRate: 0,
          avgDuration: 0,
        };
      }
      
      const stats = this.metrics.serviceStats[span.service];
      stats.spanCount++;
      if (span.status === 'error') {
        stats.errorRate = (stats.errorRate * (stats.spanCount - 1) + 1) / stats.spanCount;
      }
      stats.avgDuration = (stats.avgDuration * (stats.spanCount - 1) + (span.duration || 0)) / stats.spanCount;
    });
  }

  public getMetrics(): TraceMetrics {
    return { ...this.metrics };
  }

  public getActiveSpans(): Span[] {
    return Array.from(this.activeSpans.values());
  }

  public getCompletedSpans(): Span[] {
    return [...this.completedSpans];
  }

  private createNoOpSpan(): SpanContext {
    const noOpSpan: Span = {
      traceId: 'noop',
      spanId: 'noop',
      operationName: 'noop',
      startTime: Date.now(),
      status: 'ok',
      tags: {},
      logs: [],
      service: this.config.serviceName,
    };

    return new SpanContext(noOpSpan, this);
  }

  private generateTraceId(): string {
    return uuidv4().replace(/-/g, '');
  }

  private generateSpanId(): string {
    return uuidv4().replace(/-/g, '').substring(0, 16);
  }

  public shutdown(): void {
    this.flush();
  }
}

// Express middleware for automatic tracing
export function tracingMiddleware(tracer: DistributedTracer) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parentContext = tracer.extractTraceContext(req.headers);
    const span = tracer.startSpan(`${req.method} ${req.path}`, parentContext || undefined);
    
    // Add request details as tags
    span.setTags({
      'http.method': req.method,
      'http.url': req.url,
      'http.path': req.path,
      'http.user_agent': req.get('User-Agent'),
      'http.remote_addr': req.ip,
    });

    // Store span in request for use in handlers
    (req as any).span = span;
    (req as any).tracer = tracer;

    // Add trace context to response headers
    tracer.injectTraceContext(span, res);

    // Finish span when response ends
    res.on('finish', () => {
      span.setTags({
        'http.status_code': res.statusCode,
        'http.response_size': res.get('Content-Length') || 0,
      });

      if (res.statusCode >= 400) {
        span.setStatus('error');
        span.log({
          event: 'error',
          message: `HTTP ${res.statusCode}`,
        });
      }

      span.finish();
    });

    next();
  };
}

// Helper function to trace async operations
export async function traceAsync<T>(
  tracer: DistributedTracer,
  operationName: string,
  operation: (span: SpanContext) => Promise<T>,
  parentSpan?: SpanContext
): Promise<T> {
  const span = tracer.startSpan(operationName, parentSpan);
  
  try {
    const result = await operation(span);
    span.setStatus('ok');
    return result;
  } catch (error) {
    span.logError(error as Error);
    throw error;
  } finally {
    span.finish();
  }
}

// Factory function
export function createTracer(config: TracerConfig): DistributedTracer {
  return new DistributedTracer(config);
}
