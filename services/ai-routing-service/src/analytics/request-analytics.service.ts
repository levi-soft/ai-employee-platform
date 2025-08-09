
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import { IPreprocessedRequest } from '../pipeline/request-preprocessor';
import { IProcessedResponse } from '../pipeline/response-processor';
import { IRoutingResult } from '../pipeline/request-router';

export interface IRequestAnalytics {
  requestId: string;
  userId?: string;
  requestType: string;
  requestSize: number;
  responseSize: number;
  processingTime: number;
  totalTime: number;
  success: boolean;
  qualityScore: number;
  cost: number;
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  provider?: string;
  agent?: string;
  cached: boolean;
  riskScore: number;
  timestamp: Date;
  metadata: Record<string, any>;
}

export interface IAnalyticsQuery {
  timeRange?: {
    start: Date;
    end: Date;
  };
  userId?: string;
  requestType?: string;
  provider?: string;
  agent?: string;
  success?: boolean;
  limit?: number;
  offset?: number;
}

export interface IAnalyticsReport {
  summary: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    successRate: number;
    averageResponseTime: number;
    averageQualityScore: number;
    totalCost: number;
    totalTokens: number;
    cacheHitRate: number;
  };
  trends: {
    requestsOverTime: Array<{ date: string; count: number }>;
    responseTimeOverTime: Array<{ date: string; averageTime: number }>;
    qualityOverTime: Array<{ date: string; averageQuality: number }>;
    costOverTime: Array<{ date: string; totalCost: number }>;
  };
  breakdowns: {
    byRequestType: Record<string, number>;
    byProvider: Record<string, number>;
    byUser: Record<string, number>;
    byHour: Record<string, number>;
  };
  insights: {
    topPerformingProviders: Array<{ name: string; score: number }>;
    mostCostEffectiveProviders: Array<{ name: string; costPerToken: number }>;
    peakUsageHours: Array<{ hour: number; requestCount: number }>;
    riskAnalysis: {
      highRiskRequests: number;
      averageRiskScore: number;
      riskDistribution: Record<string, number>;
    };
  };
}

export interface IPerformanceMetrics {
  provider: string;
  agent?: string;
  metrics: {
    requestCount: number;
    averageResponseTime: number;
    successRate: number;
    averageQualityScore: number;
    costPerRequest: number;
    tokensPerSecond: number;
    errorRate: number;
  };
  trends: {
    responseTimeP95: number;
    responseTimeP99: number;
    throughput: number;
  };
}

/**
 * Advanced request analytics service for monitoring, reporting, and insights
 */
export class RequestAnalyticsService extends EventEmitter {
  private logger: Logger;
  private prisma: PrismaClient;
  private analyticsBuffer: IRequestAnalytics[] = [];
  private metricsCache = new Map<string, any>();
  private readonly BATCH_SIZE = 100;
  private readonly FLUSH_INTERVAL = 30000; // 30 seconds
  private readonly CACHE_TTL = 300000; // 5 minutes

  constructor() {
    super();
    this.logger = new Logger('RequestAnalytics');
    this.prisma = new PrismaClient();
    
    this.startPeriodicFlush();
  }

  /**
   * Record request analytics
   */
  async recordRequest(
    request: IPreprocessedRequest,
    routing: IRoutingResult,
    response: IProcessedResponse
  ): Promise<void> {
    try {
      const analytics: IRequestAnalytics = {
        requestId: request.id,
        userId: request.context.userId,
        requestType: request.normalizedRequest.type,
        requestSize: JSON.stringify(request.originalRequest).length,
        responseSize: response.content.length,
        processingTime: response.metadata.processingTime,
        totalTime: response.metadata.originalResponseTime + response.metadata.processingTime,
        success: response.success,
        qualityScore: response.metadata.qualityScore || 0,
        cost: response.usage.cost,
        tokensUsed: {
          input: response.usage.tokens.input,
          output: response.usage.tokens.output,
          total: response.usage.tokens.total
        },
        provider: routing.selectedProvider?.name,
        agent: routing.selectedAgent?.name,
        cached: response.metadata.cached || false,
        riskScore: request.metadata.riskScore,
        timestamp: new Date(),
        metadata: {
          requestPriority: request.metadata.priority,
          routingStrategy: routing.routingStrategy,
          routingReason: routing.routingReason,
          transformations: response.metadata.transformations,
          warnings: response.warnings,
          model: response.metadata.model,
          streaming: response.metadata.streaming
        }
      };

      // Add to buffer for batch processing
      this.analyticsBuffer.push(analytics);

      // Flush if buffer is full
      if (this.analyticsBuffer.length >= this.BATCH_SIZE) {
        await this.flushAnalytics();
      }

      this.logger.debug('Request analytics recorded', {
        requestId: request.id,
        success: response.success,
        processingTime: analytics.processingTime,
        cost: analytics.cost
      });

      this.emit('analyticsRecorded', { analytics, request, response });

    } catch (error) {
      this.logger.error('Failed to record request analytics', {
        requestId: request.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get analytics report
   */
  async generateReport(
    query: IAnalyticsQuery = {},
    includeInsights: boolean = true
  ): Promise<IAnalyticsReport> {
    try {
      this.logger.info('Generating analytics report', { query, includeInsights });

      // Build where clause for database query
      const where = this.buildWhereClause(query);

      // Get summary data
      const summary = await this.generateSummary(where);

      // Get trends data
      const trends = await this.generateTrends(where, query.timeRange);

      // Get breakdowns
      const breakdowns = await this.generateBreakdowns(where);

      // Get insights (if requested)
      const insights = includeInsights ? await this.generateInsights(where) : {
        topPerformingProviders: [],
        mostCostEffectiveProviders: [],
        peakUsageHours: [],
        riskAnalysis: {
          highRiskRequests: 0,
          averageRiskScore: 0,
          riskDistribution: {}
        }
      };

      const report: IAnalyticsReport = {
        summary,
        trends,
        breakdowns,
        insights
      };

      this.logger.info('Analytics report generated', {
        totalRequests: summary.totalRequests,
        successRate: Math.round(summary.successRate * 100),
        timeRange: query.timeRange
      });

      this.emit('reportGenerated', { report, query });
      return report;

    } catch (error) {
      this.logger.error('Failed to generate analytics report', {
        query,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error('Failed to generate analytics report');
    }
  }

  /**
   * Get performance metrics for providers/agents
   */
  async getPerformanceMetrics(
    target: { provider?: string; agent?: string },
    timeRange?: { start: Date; end: Date }
  ): Promise<IPerformanceMetrics[]> {
    const cacheKey = `metrics:${JSON.stringify(target)}:${timeRange?.start?.toISOString()}:${timeRange?.end?.toISOString()}`;
    
    // Check cache first
    const cached = this.getCachedMetrics(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const where: any = {};
      
      if (target.provider) {
        where.provider = target.provider;
      }
      
      if (target.agent) {
        where.agent = target.agent;
      }

      if (timeRange) {
        where.timestamp = {
          gte: timeRange.start,
          lte: timeRange.end
        };
      }

      // This would be implemented with actual database queries
      // For now, returning mock data structure
      const metrics: IPerformanceMetrics[] = await this.getMockPerformanceMetrics(target);

      // Cache the results
      this.setCachedMetrics(cacheKey, metrics);

      this.logger.info('Performance metrics retrieved', {
        target,
        timeRange,
        metricsCount: metrics.length
      });

      return metrics;

    } catch (error) {
      this.logger.error('Failed to get performance metrics', {
        target,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Get real-time analytics dashboard data
   */
  async getDashboardData(): Promise<{
    currentMetrics: {
      activeRequests: number;
      requestsPerMinute: number;
      averageResponseTime: number;
      successRate: number;
      errorRate: number;
    };
    recentActivity: Array<{
      timestamp: Date;
      requestType: string;
      success: boolean;
      responseTime: number;
      provider?: string;
    }>;
    alerts: Array<{
      type: 'warning' | 'error' | 'info';
      message: string;
      timestamp: Date;
      severity: number;
    }>;
  }> {
    try {
      // Get current metrics (last 5 minutes)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      const currentMetrics = {
        activeRequests: this.analyticsBuffer.length,
        requestsPerMinute: await this.getRequestsPerMinute(),
        averageResponseTime: await this.getAverageResponseTime(fiveMinutesAgo),
        successRate: await this.getSuccessRate(fiveMinutesAgo),
        errorRate: await this.getErrorRate(fiveMinutesAgo)
      };

      // Get recent activity (last hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentActivity = await this.getRecentActivity(oneHourAgo);

      // Generate alerts based on current metrics
      const alerts = await this.generateAlerts(currentMetrics);

      return {
        currentMetrics,
        recentActivity,
        alerts
      };

    } catch (error) {
      this.logger.error('Failed to get dashboard data', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        currentMetrics: {
          activeRequests: 0,
          requestsPerMinute: 0,
          averageResponseTime: 0,
          successRate: 0,
          errorRate: 0
        },
        recentActivity: [],
        alerts: []
      };
    }
  }

  /**
   * Export analytics data
   */
  async exportData(
    query: IAnalyticsQuery,
    format: 'csv' | 'json' | 'xlsx' = 'json'
  ): Promise<{
    data: any;
    filename: string;
    mimeType: string;
  }> {
    try {
      const where = this.buildWhereClause(query);
      
      // This would query actual database
      const mockData = await this.getMockAnalyticsData(where);

      let exportData: any;
      let mimeType: string;
      let filename: string;

      switch (format) {
        case 'csv':
          exportData = this.convertToCSV(mockData);
          mimeType = 'text/csv';
          filename = `analytics-${Date.now()}.csv`;
          break;
        case 'xlsx':
          exportData = await this.convertToXLSX(mockData);
          mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          filename = `analytics-${Date.now()}.xlsx`;
          break;
        case 'json':
        default:
          exportData = mockData;
          mimeType = 'application/json';
          filename = `analytics-${Date.now()}.json`;
          break;
      }

      this.logger.info('Analytics data exported', {
        format,
        recordCount: Array.isArray(mockData) ? mockData.length : Object.keys(mockData).length
      });

      return { data: exportData, filename, mimeType };

    } catch (error) {
      this.logger.error('Failed to export analytics data', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error('Failed to export analytics data');
    }
  }

  /**
   * Flush analytics buffer to database
   */
  private async flushAnalytics(): Promise<void> {
    if (this.analyticsBuffer.length === 0) {
      return;
    }

    try {
      const batch = [...this.analyticsBuffer];
      this.analyticsBuffer = [];

      // In production, this would batch insert to database
      // For now, just log the batch
      this.logger.debug('Flushing analytics batch', {
        batchSize: batch.length
      });

      this.emit('analyticsFlushed', { count: batch.length });

    } catch (error) {
      this.logger.error('Failed to flush analytics', {
        batchSize: this.analyticsBuffer.length,
        error: error instanceof Error ? error.message : String(error)
      });

      // Put data back in buffer for retry
      this.analyticsBuffer.unshift(...this.analyticsBuffer);
    }
  }

  /**
   * Start periodic flush timer
   */
  private startPeriodicFlush(): void {
    setInterval(async () => {
      await this.flushAnalytics();
    }, this.FLUSH_INTERVAL);
  }

  /**
   * Build where clause for queries
   */
  private buildWhereClause(query: IAnalyticsQuery): any {
    const where: any = {};

    if (query.timeRange) {
      where.timestamp = {
        gte: query.timeRange.start,
        lte: query.timeRange.end
      };
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.requestType) {
      where.requestType = query.requestType;
    }

    if (query.provider) {
      where.provider = query.provider;
    }

    if (query.agent) {
      where.agent = query.agent;
    }

    if (query.success !== undefined) {
      where.success = query.success;
    }

    return where;
  }

  // Mock data generation methods (would be replaced with actual database queries in production)
  private async generateSummary(where: any): Promise<any> {
    return {
      totalRequests: 1250,
      successfulRequests: 1180,
      failedRequests: 70,
      successRate: 0.944,
      averageResponseTime: 1850,
      averageQualityScore: 7.8,
      totalCost: 15.67,
      totalTokens: 125000,
      cacheHitRate: 0.23
    };
  }

  private async generateTrends(where: any, timeRange?: any): Promise<any> {
    return {
      requestsOverTime: [
        { date: '2024-08-08T00:00:00Z', count: 150 },
        { date: '2024-08-08T01:00:00Z', count: 120 },
        { date: '2024-08-08T02:00:00Z', count: 180 }
      ],
      responseTimeOverTime: [
        { date: '2024-08-08T00:00:00Z', averageTime: 1800 },
        { date: '2024-08-08T01:00:00Z', averageTime: 1750 },
        { date: '2024-08-08T02:00:00Z', averageTime: 1900 }
      ],
      qualityOverTime: [
        { date: '2024-08-08T00:00:00Z', averageQuality: 7.5 },
        { date: '2024-08-08T01:00:00Z', averageQuality: 7.8 },
        { date: '2024-08-08T02:00:00Z', averageQuality: 8.1 }
      ],
      costOverTime: [
        { date: '2024-08-08T00:00:00Z', totalCost: 5.21 },
        { date: '2024-08-08T01:00:00Z', totalCost: 4.89 },
        { date: '2024-08-08T02:00:00Z', totalCost: 5.57 }
      ]
    };
  }

  private async generateBreakdowns(where: any): Promise<any> {
    return {
      byRequestType: {
        'text_generation': 450,
        'code_generation': 320,
        'data_analysis': 280,
        'translation': 200
      },
      byProvider: {
        'gpt-4': 600,
        'claude-3': 350,
        'gemini-pro': 300
      },
      byUser: {
        'user-123': 150,
        'user-456': 120,
        'user-789': 100
      },
      byHour: {
        '00': 45,
        '01': 38,
        '02': 52,
        '03': 41
      }
    };
  }

  private async generateInsights(where: any): Promise<any> {
    return {
      topPerformingProviders: [
        { name: 'gpt-4', score: 8.5 },
        { name: 'claude-3', score: 8.2 },
        { name: 'gemini-pro', score: 7.9 }
      ],
      mostCostEffectiveProviders: [
        { name: 'gpt-3.5', costPerToken: 0.000002 },
        { name: 'claude-instant', costPerToken: 0.000008 },
        { name: 'gemini-pro', costPerToken: 0.000015 }
      ],
      peakUsageHours: [
        { hour: 14, requestCount: 180 },
        { hour: 15, requestCount: 165 },
        { hour: 16, requestCount: 150 }
      ],
      riskAnalysis: {
        highRiskRequests: 15,
        averageRiskScore: 3.2,
        riskDistribution: {
          'low': 1100,
          'medium': 135,
          'high': 15
        }
      }
    };
  }

  // Additional helper methods
  private async getMockPerformanceMetrics(target: any): Promise<IPerformanceMetrics[]> {
    return [
      {
        provider: target.provider || 'gpt-4',
        metrics: {
          requestCount: 600,
          averageResponseTime: 1800,
          successRate: 0.96,
          averageQualityScore: 8.5,
          costPerRequest: 0.015,
          tokensPerSecond: 25,
          errorRate: 0.04
        },
        trends: {
          responseTimeP95: 3200,
          responseTimeP99: 4800,
          throughput: 15.5
        }
      }
    ];
  }

  private async getRequestsPerMinute(): Promise<number> {
    return Math.floor(Math.random() * 20) + 5; // 5-25 requests per minute
  }

  private async getAverageResponseTime(since: Date): Promise<number> {
    return 1850 + Math.floor(Math.random() * 500); // 1850-2350ms
  }

  private async getSuccessRate(since: Date): Promise<number> {
    return 0.92 + Math.random() * 0.08; // 92-100%
  }

  private async getErrorRate(since: Date): Promise<number> {
    return Math.random() * 0.08; // 0-8%
  }

  private async getRecentActivity(since: Date): Promise<any[]> {
    return [
      {
        timestamp: new Date(Date.now() - 30000),
        requestType: 'text_generation',
        success: true,
        responseTime: 1800,
        provider: 'gpt-4'
      },
      {
        timestamp: new Date(Date.now() - 60000),
        requestType: 'code_generation',
        success: true,
        responseTime: 2200,
        provider: 'claude-3'
      }
    ];
  }

  private async generateAlerts(metrics: any): Promise<any[]> {
    const alerts: any[] = [];

    if (metrics.errorRate > 0.1) {
      alerts.push({
        type: 'error',
        message: `High error rate detected: ${Math.round(metrics.errorRate * 100)}%`,
        timestamp: new Date(),
        severity: 8
      });
    }

    if (metrics.averageResponseTime > 5000) {
      alerts.push({
        type: 'warning',
        message: `High response time: ${metrics.averageResponseTime}ms`,
        timestamp: new Date(),
        severity: 6
      });
    }

    return alerts;
  }

  private async getMockAnalyticsData(where: any): Promise<any[]> {
    return [
      {
        requestId: 'req-1',
        timestamp: new Date(),
        requestType: 'text_generation',
        success: true,
        responseTime: 1800,
        qualityScore: 8.5,
        cost: 0.015
      }
    ];
  }

  private convertToCSV(data: any[]): string {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row => Object.values(row).join(','));
    
    return [headers, ...rows].join('\n');
  }

  private async convertToXLSX(data: any[]): Promise<Buffer> {
    // In production, use a library like xlsx
    return Buffer.from(JSON.stringify(data));
  }

  // Cache management
  private getCachedMetrics(key: string): any {
    const cached = this.metricsCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    return null;
  }

  private setCachedMetrics(key: string, data: any): void {
    this.metricsCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
}
