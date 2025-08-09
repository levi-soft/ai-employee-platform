
import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import { logger } from '@ai-platform/shared-utils';
import Redis from 'ioredis';

export interface PerformanceMetrics {
  agentId: string;
  agentName: string;
  provider: string;
  model: string;
  timeWindow: {
    start: Date;
    end: Date;
    duration: number; // milliseconds
  };
  requestMetrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    successRate: number;
    averageResponseTime: number;
    medianResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    minResponseTime: number;
    maxResponseTime: number;
  };
  qualityMetrics: {
    averageScore: number;
    confidenceScore: number;
    userSatisfaction: number;
    accuracyScore: number;
    relevanceScore: number;
  };
  costMetrics: {
    totalCost: number;
    averageCostPerRequest: number;
    costEfficiencyRatio: number;
    tokenUsage: {
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
      averageTokensPerRequest: number;
    };
  };
  utilizationMetrics: {
    concurrentRequestsPeak: number;
    averageConcurrentRequests: number;
    queueTimeAverage: number;
    throughputPerMinute: number;
    capacityUtilization: number;
  };
  errorMetrics: {
    timeouts: number;
    rateLimit: number;
    serverErrors: number;
    clientErrors: number;
    networkErrors: number;
    errorsByType: Record<string, number>;
  };
}

export interface PerformanceAlert {
  id: string;
  agentId: string;
  alertType: 'performance' | 'quality' | 'cost' | 'error' | 'capacity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  metrics: Record<string, any>;
  threshold: {
    metric: string;
    value: number;
    operator: '>' | '<' | '>=' | '<=' | '=';
  };
  timestamp: Date;
  resolved: boolean;
  resolvedAt?: Date;
}

export interface PerformanceTrend {
  agentId: string;
  metric: string;
  timeRange: 'hour' | 'day' | 'week' | 'month';
  dataPoints: {
    timestamp: Date;
    value: number;
  }[];
  trend: 'improving' | 'degrading' | 'stable';
  changeRate: number; // percentage change
  predictions: {
    nextHour: number;
    nextDay: number;
    confidence: number;
  };
}

export interface BenchmarkComparison {
  agentId: string;
  comparisons: {
    metric: string;
    agentValue: number;
    benchmarkValue: number;
    percentageDifference: number;
    ranking: number;
    totalAgents: number;
  }[];
  overallRanking: {
    performance: number;
    quality: number;
    cost: number;
    overall: number;
  };
}

export class AgentPerformanceService extends EventEmitter {
  private prisma: PrismaClient;
  private redis: Redis;
  private performanceCache: Map<string, PerformanceMetrics> = new Map();
  private alertThresholds: Map<string, any[]> = new Map();
  private activeAlerts: Map<string, PerformanceAlert> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private isMonitoring = false;

  private readonly METRICS_KEY_PREFIX = 'ai:metrics:agent:';
  private readonly ALERTS_KEY = 'ai:alerts:performance';
  private readonly TRENDS_KEY_PREFIX = 'ai:trends:';
  private readonly BENCHMARKS_KEY = 'ai:benchmarks';

  constructor(
    redisConfig: { host: string; port: number; password?: string; db: number }
  ) {
    super();
    this.prisma = new PrismaClient();
    this.redis = new Redis(redisConfig);
    this.initializeDefaultThresholds();
  }

  /**
   * Initialize default alert thresholds
   */
  private initializeDefaultThresholds(): void {
    const defaultThresholds = [
      {
        metric: 'successRate',
        operator: '<' as const,
        value: 0.95,
        severity: 'high' as const,
        alertType: 'performance' as const,
        title: 'Low Success Rate',
        description: 'Agent success rate has fallen below 95%'
      },
      {
        metric: 'averageResponseTime',
        operator: '>' as const,
        value: 10000,
        severity: 'medium' as const,
        alertType: 'performance' as const,
        title: 'High Response Time',
        description: 'Agent response time exceeds 10 seconds'
      },
      {
        metric: 'p95ResponseTime',
        operator: '>' as const,
        value: 30000,
        severity: 'high' as const,
        alertType: 'performance' as const,
        title: 'High P95 Response Time',
        description: '95th percentile response time exceeds 30 seconds'
      },
      {
        metric: 'averageScore',
        operator: '<' as const,
        value: 0.7,
        severity: 'medium' as const,
        alertType: 'quality' as const,
        title: 'Low Quality Score',
        description: 'Agent quality score has fallen below 70%'
      },
      {
        metric: 'costEfficiencyRatio',
        operator: '<' as const,
        value: 0.5,
        severity: 'low' as const,
        alertType: 'cost' as const,
        title: 'Low Cost Efficiency',
        description: 'Agent cost efficiency has decreased'
      },
      {
        metric: 'capacityUtilization',
        operator: '>' as const,
        value: 0.9,
        severity: 'critical' as const,
        alertType: 'capacity' as const,
        title: 'High Capacity Utilization',
        description: 'Agent capacity utilization exceeds 90%'
      }
    ];

    defaultThresholds.forEach(threshold => {
      const agentThresholds = this.alertThresholds.get('default') || [];
      agentThresholds.push(threshold);
      this.alertThresholds.set('default', agentThresholds);
    });
  }

  /**
   * Start performance monitoring
   */
  async startMonitoring(intervalMs = 60000): Promise<void> {
    if (this.isMonitoring) {
      logger.warn('Performance monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    
    // Start periodic performance collection
    this.monitoringInterval = setInterval(
      () => this.collectAndAnalyzeMetrics(),
      intervalMs
    );

    // Initial metrics collection
    await this.collectAndAnalyzeMetrics();
    
    logger.info('Agent performance monitoring started', { intervalMs });
    this.emit('monitoringStarted', { intervalMs });
  }

  /**
   * Stop performance monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    
    logger.info('Agent performance monitoring stopped');
    this.emit('monitoringStopped');
  }

  /**
   * Record performance data for an agent request
   */
  async recordRequestMetrics(data: {
    agentId: string;
    requestId: string;
    startTime: Date;
    endTime: Date;
    success: boolean;
    responseTime: number;
    cost?: number;
    tokenUsage?: {
      inputTokens: number;
      outputTokens: number;
    };
    qualityScore?: number;
    errorType?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const timestamp = new Date();
    
    try {
      // Store in database
      await this.prisma.aIRequest.create({
        data: {
          id: data.requestId,
          agentId: data.agentId,
          startTime: data.startTime,
          endTime: data.endTime,
          responseTime: data.responseTime,
          success: data.success,
          cost: data.cost || 0,
          inputTokens: data.tokenUsage?.inputTokens || 0,
          outputTokens: data.tokenUsage?.outputTokens || 0,
          qualityScore: data.qualityScore,
          errorType: data.errorType,
          metadata: data.metadata ? JSON.stringify(data.metadata) : null,
          createdAt: timestamp
        }
      });

      // Update real-time metrics in Redis
      await this.updateRealTimeMetrics(data.agentId, data);
      
      // Check for alerts
      await this.checkAlertThresholds(data.agentId);
      
      logger.debug('Request metrics recorded', {
        agentId: data.agentId,
        requestId: data.requestId,
        success: data.success,
        responseTime: data.responseTime
      });

    } catch (error) {
      logger.error('Failed to record request metrics', { error, data });
    }
  }

  /**
   * Get performance metrics for an agent
   */
  async getAgentPerformance(
    agentId: string,
    timeRange: {
      start: Date;
      end: Date;
    }
  ): Promise<PerformanceMetrics | null> {
    try {
      // Check cache first
      const cacheKey = `${agentId}:${timeRange.start.getTime()}:${timeRange.end.getTime()}`;
      const cachedMetrics = this.performanceCache.get(cacheKey);
      
      if (cachedMetrics) {
        return cachedMetrics;
      }

      // Get agent info
      const agent = await this.prisma.aIAgent.findUnique({
        where: { id: agentId }
      });

      if (!agent) {
        return null;
      }

      // Query request data
      const requests = await this.prisma.aIRequest.findMany({
        where: {
          agentId,
          createdAt: {
            gte: timeRange.start,
            lte: timeRange.end
          }
        },
        orderBy: { responseTime: 'asc' }
      });

      if (requests.length === 0) {
        return null;
      }

      // Calculate metrics
      const metrics = this.calculatePerformanceMetrics(agent, requests, timeRange);
      
      // Cache the results
      this.performanceCache.set(cacheKey, metrics);
      setTimeout(() => this.performanceCache.delete(cacheKey), 5 * 60 * 1000); // 5 min cache

      return metrics;

    } catch (error) {
      logger.error('Failed to get agent performance', { error, agentId });
      return null;
    }
  }

  /**
   * Calculate performance metrics from request data
   */
  private calculatePerformanceMetrics(
    agent: any,
    requests: any[],
    timeRange: { start: Date; end: Date }
  ): PerformanceMetrics {
    const successfulRequests = requests.filter(r => r.success);
    const failedRequests = requests.filter(r => !r.success);
    
    // Response time calculations
    const responseTimes = requests.map(r => r.responseTime).sort((a, b) => a - b);
    const successRate = requests.length > 0 ? successfulRequests.length / requests.length : 0;
    
    // Percentile calculations
    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p99Index = Math.floor(responseTimes.length * 0.99);
    const medianIndex = Math.floor(responseTimes.length * 0.5);
    
    // Cost calculations
    const totalCost = requests.reduce((sum, r) => sum + (r.cost || 0), 0);
    const totalTokens = requests.reduce((sum, r) => sum + (r.inputTokens || 0) + (r.outputTokens || 0), 0);
    const inputTokens = requests.reduce((sum, r) => sum + (r.inputTokens || 0), 0);
    const outputTokens = requests.reduce((sum, r) => sum + (r.outputTokens || 0), 0);
    
    // Quality calculations
    const qualityScores = requests.filter(r => r.qualityScore !== null).map(r => r.qualityScore);
    const averageQualityScore = qualityScores.length > 0 
      ? qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length 
      : 0;
    
    // Error analysis
    const errorsByType: Record<string, number> = {};
    failedRequests.forEach(r => {
      if (r.errorType) {
        errorsByType[r.errorType] = (errorsByType[r.errorType] || 0) + 1;
      }
    });

    return {
      agentId: agent.id,
      agentName: agent.name,
      provider: agent.provider,
      model: agent.model,
      timeWindow: {
        start: timeRange.start,
        end: timeRange.end,
        duration: timeRange.end.getTime() - timeRange.start.getTime()
      },
      requestMetrics: {
        totalRequests: requests.length,
        successfulRequests: successfulRequests.length,
        failedRequests: failedRequests.length,
        successRate,
        averageResponseTime: responseTimes.length > 0 
          ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length 
          : 0,
        medianResponseTime: responseTimes[medianIndex] || 0,
        p95ResponseTime: responseTimes[p95Index] || 0,
        p99ResponseTime: responseTimes[p99Index] || 0,
        minResponseTime: responseTimes[0] || 0,
        maxResponseTime: responseTimes[responseTimes.length - 1] || 0
      },
      qualityMetrics: {
        averageScore: averageQualityScore,
        confidenceScore: averageQualityScore * 0.9, // Simplified
        userSatisfaction: averageQualityScore * 0.95, // Simplified
        accuracyScore: averageQualityScore,
        relevanceScore: averageQualityScore * 1.05 // Simplified
      },
      costMetrics: {
        totalCost,
        averageCostPerRequest: requests.length > 0 ? totalCost / requests.length : 0,
        costEfficiencyRatio: averageQualityScore > 0 ? averageQualityScore / (totalCost / requests.length || 1) : 0,
        tokenUsage: {
          totalTokens,
          inputTokens,
          outputTokens,
          averageTokensPerRequest: requests.length > 0 ? totalTokens / requests.length : 0
        }
      },
      utilizationMetrics: {
        concurrentRequestsPeak: Math.max(...requests.map(() => 1)), // Simplified
        averageConcurrentRequests: 1, // Simplified
        queueTimeAverage: 0, // Simplified
        throughputPerMinute: requests.length / ((timeRange.end.getTime() - timeRange.start.getTime()) / 60000),
        capacityUtilization: Math.min(1, requests.length / 1000) // Simplified
      },
      errorMetrics: {
        timeouts: errorsByType['timeout'] || 0,
        rateLimit: errorsByType['rate_limit'] || 0,
        serverErrors: errorsByType['server_error'] || 0,
        clientErrors: errorsByType['client_error'] || 0,
        networkErrors: errorsByType['network_error'] || 0,
        errorsByType
      }
    };
  }

  /**
   * Update real-time metrics in Redis
   */
  private async updateRealTimeMetrics(agentId: string, data: any): Promise<void> {
    const metricsKey = `${this.METRICS_KEY_PREFIX}${agentId}`;
    const now = Date.now();
    
    // Update running averages and counters
    const pipeline = this.redis.pipeline();
    
    // Request counters
    pipeline.hincrby(metricsKey, 'totalRequests', 1);
    pipeline.hincrby(metricsKey, data.success ? 'successfulRequests' : 'failedRequests', 1);
    
    // Response time metrics
    pipeline.lpush(`${metricsKey}:responseTimes`, data.responseTime);
    pipeline.ltrim(`${metricsKey}:responseTimes`, 0, 1000); // Keep last 1000 values
    
    // Cost metrics
    if (data.cost) {
      pipeline.hincrbyfloat(metricsKey, 'totalCost', data.cost);
    }
    
    // Token usage
    if (data.tokenUsage) {
      pipeline.hincrby(metricsKey, 'totalInputTokens', data.tokenUsage.inputTokens);
      pipeline.hincrby(metricsKey, 'totalOutputTokens', data.tokenUsage.outputTokens);
    }
    
    // Quality scores
    if (data.qualityScore) {
      pipeline.lpush(`${metricsKey}:qualityScores`, data.qualityScore);
      pipeline.ltrim(`${metricsKey}:qualityScores`, 0, 1000);
    }
    
    // Error tracking
    if (!data.success && data.errorType) {
      pipeline.hincrby(`${metricsKey}:errors`, data.errorType, 1);
    }
    
    // Timestamp for staleness check
    pipeline.hset(metricsKey, 'lastUpdate', now);
    pipeline.expire(metricsKey, 86400); // 24 hours
    
    await pipeline.exec();
  }

  /**
   * Check alert thresholds for an agent
   */
  private async checkAlertThresholds(agentId: string): Promise<void> {
    try {
      // Get recent metrics for quick threshold checking
      const recentMetrics = await this.getAgentPerformance(agentId, {
        start: new Date(Date.now() - 15 * 60 * 1000), // Last 15 minutes
        end: new Date()
      });

      if (!recentMetrics) {
        return;
      }

      const thresholds = this.alertThresholds.get(agentId) || this.alertThresholds.get('default') || [];
      
      for (const threshold of thresholds) {
        const metricValue = this.getMetricValue(recentMetrics, threshold.metric);
        const shouldAlert = this.evaluateThreshold(metricValue, threshold);
        
        if (shouldAlert) {
          await this.createAlert(agentId, threshold, metricValue, recentMetrics);
        }
      }

    } catch (error) {
      logger.error('Failed to check alert thresholds', { error, agentId });
    }
  }

  /**
   * Get metric value from performance data
   */
  private getMetricValue(metrics: PerformanceMetrics, metricPath: string): number {
    const parts = metricPath.split('.');
    let value: any = metrics;
    
    for (const part of parts) {
      value = value[part];
      if (value === undefined) {
        return 0;
      }
    }
    
    return typeof value === 'number' ? value : 0;
  }

  /**
   * Evaluate if threshold condition is met
   */
  private evaluateThreshold(value: number, threshold: any): boolean {
    switch (threshold.operator) {
      case '>': return value > threshold.value;
      case '<': return value < threshold.value;
      case '>=': return value >= threshold.value;
      case '<=': return value <= threshold.value;
      case '=': return Math.abs(value - threshold.value) < 0.001; // Float comparison
      default: return false;
    }
  }

  /**
   * Create performance alert
   */
  private async createAlert(
    agentId: string,
    threshold: any,
    currentValue: number,
    metrics: PerformanceMetrics
  ): Promise<void> {
    const alertId = `${agentId}:${threshold.metric}:${Date.now()}`;
    
    // Check if similar alert already exists
    const existingAlert = Array.from(this.activeAlerts.values())
      .find(alert => 
        alert.agentId === agentId && 
        alert.threshold.metric === threshold.metric && 
        !alert.resolved
      );
    
    if (existingAlert) {
      return; // Don't create duplicate alerts
    }

    const alert: PerformanceAlert = {
      id: alertId,
      agentId,
      alertType: threshold.alertType,
      severity: threshold.severity,
      title: threshold.title,
      description: `${threshold.description}. Current value: ${currentValue.toFixed(3)}, Threshold: ${threshold.value}`,
      metrics: {
        currentValue,
        thresholdValue: threshold.value,
        agentMetrics: metrics
      },
      threshold: {
        metric: threshold.metric,
        value: threshold.value,
        operator: threshold.operator
      },
      timestamp: new Date(),
      resolved: false
    };

    this.activeAlerts.set(alertId, alert);
    
    // Store in Redis for persistence
    await this.redis.hset(this.ALERTS_KEY, alertId, JSON.stringify(alert));
    
    logger.warn('Performance alert created', {
      alertId,
      agentId,
      metric: threshold.metric,
      currentValue,
      threshold: threshold.value
    });

    this.emit('alertCreated', alert);
  }

  /**
   * Collect and analyze metrics for all agents
   */
  private async collectAndAnalyzeMetrics(): Promise<void> {
    try {
      const agents = await this.prisma.aIAgent.findMany({
        where: { status: 'active' }
      });

      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      for (const agent of agents) {
        const metrics = await this.getAgentPerformance(agent.id, {
          start: hourAgo,
          end: now
        });

        if (metrics) {
          // Store aggregated metrics
          await this.storeAggregatedMetrics(metrics);
          
          // Update trends
          await this.updateTrends(agent.id, metrics);
          
          // Check thresholds
          await this.checkAlertThresholds(agent.id);
        }
      }

      logger.debug('Metrics collection completed', { agentCount: agents.length });

    } catch (error) {
      logger.error('Failed to collect and analyze metrics', { error });
    }
  }

  /**
   * Store aggregated metrics for historical analysis
   */
  private async storeAggregatedMetrics(metrics: PerformanceMetrics): Promise<void> {
    const key = `${this.METRICS_KEY_PREFIX}aggregated:${metrics.agentId}:${metrics.timeWindow.start.getTime()}`;
    
    await this.redis.setex(key, 86400 * 7, JSON.stringify({
      agentId: metrics.agentId,
      timestamp: metrics.timeWindow.start,
      successRate: metrics.requestMetrics.successRate,
      averageResponseTime: metrics.requestMetrics.averageResponseTime,
      averageScore: metrics.qualityMetrics.averageScore,
      totalCost: metrics.costMetrics.totalCost,
      throughput: metrics.utilizationMetrics.throughputPerMinute
    }));
  }

  /**
   * Update performance trends
   */
  private async updateTrends(agentId: string, metrics: PerformanceMetrics): Promise<void> {
    const trendKey = `${this.TRENDS_KEY_PREFIX}${agentId}`;
    
    const trendData = {
      timestamp: new Date(),
      successRate: metrics.requestMetrics.successRate,
      responseTime: metrics.requestMetrics.averageResponseTime,
      qualityScore: metrics.qualityMetrics.averageScore,
      cost: metrics.costMetrics.averageCostPerRequest,
      throughput: metrics.utilizationMetrics.throughputPerMinute
    };
    
    // Store trend point
    await this.redis.lpush(trendKey, JSON.stringify(trendData));
    await this.redis.ltrim(trendKey, 0, 168); // Keep last 168 hours (1 week)
    await this.redis.expire(trendKey, 86400 * 7);
  }

  /**
   * Get performance trends for an agent
   */
  async getPerformanceTrends(
    agentId: string,
    metric: string,
    timeRange: 'hour' | 'day' | 'week' | 'month' = 'day'
  ): Promise<PerformanceTrend | null> {
    try {
      const trendKey = `${this.TRENDS_KEY_PREFIX}${agentId}`;
      const rawData = await this.redis.lrange(trendKey, 0, -1);
      
      if (rawData.length === 0) {
        return null;
      }

      const dataPoints = rawData
        .map(data => JSON.parse(data))
        .filter(point => point[metric] !== undefined)
        .map(point => ({
          timestamp: new Date(point.timestamp),
          value: point[metric]
        }))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      if (dataPoints.length < 2) {
        return null;
      }

      // Calculate trend direction
      const recentValues = dataPoints.slice(-Math.min(10, dataPoints.length));
      const oldValues = dataPoints.slice(0, Math.min(10, dataPoints.length));
      
      const recentAverage = recentValues.reduce((sum, p) => sum + p.value, 0) / recentValues.length;
      const oldAverage = oldValues.reduce((sum, p) => sum + p.value, 0) / oldValues.length;
      
      const changeRate = oldAverage !== 0 ? ((recentAverage - oldAverage) / oldAverage) * 100 : 0;
      
      let trend: 'improving' | 'degrading' | 'stable';
      if (Math.abs(changeRate) < 5) {
        trend = 'stable';
      } else if (this.isImprovingMetric(metric)) {
        trend = changeRate > 0 ? 'improving' : 'degrading';
      } else {
        trend = changeRate < 0 ? 'improving' : 'degrading';
      }

      return {
        agentId,
        metric,
        timeRange,
        dataPoints,
        trend,
        changeRate,
        predictions: {
          nextHour: this.predictNextValue(dataPoints, 1),
          nextDay: this.predictNextValue(dataPoints, 24),
          confidence: Math.min(0.9, dataPoints.length / 100)
        }
      };

    } catch (error) {
      logger.error('Failed to get performance trends', { error, agentId, metric });
      return null;
    }
  }

  /**
   * Check if metric improvement means higher values
   */
  private isImprovingMetric(metric: string): boolean {
    const improvingMetrics = ['successRate', 'qualityScore', 'throughput', 'costEfficiencyRatio'];
    return improvingMetrics.includes(metric);
  }

  /**
   * Simple linear prediction for next values
   */
  private predictNextValue(dataPoints: any[], hoursAhead: number): number {
    if (dataPoints.length < 3) {
      return dataPoints[dataPoints.length - 1]?.value || 0;
    }

    // Simple linear regression
    const n = Math.min(24, dataPoints.length); // Use last 24 points
    const recent = dataPoints.slice(-n);
    
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    
    recent.forEach((point, index) => {
      sumX += index;
      sumY += point.value;
      sumXY += index * point.value;
      sumXX += index * index;
    });
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return slope * (n + hoursAhead) + intercept;
  }

  /**
   * Get active performance alerts
   */
  getActiveAlerts(agentId?: string): PerformanceAlert[] {
    let alerts = Array.from(this.activeAlerts.values()).filter(alert => !alert.resolved);
    
    if (agentId) {
      alerts = alerts.filter(alert => alert.agentId === agentId);
    }
    
    return alerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string, reason?: string): Promise<boolean> {
    const alert = this.activeAlerts.get(alertId);
    if (!alert || alert.resolved) {
      return false;
    }

    alert.resolved = true;
    alert.resolvedAt = new Date();

    // Update in Redis
    await this.redis.hset(this.ALERTS_KEY, alertId, JSON.stringify(alert));
    
    logger.info('Performance alert resolved', { alertId, reason });
    this.emit('alertResolved', { alert, reason });
    
    return true;
  }

  /**
   * Get performance comparison between agents
   */
  async getPerformanceComparison(
    agentIds: string[],
    timeRange: { start: Date; end: Date }
  ): Promise<Record<string, PerformanceMetrics | null>> {
    const comparison: Record<string, PerformanceMetrics | null> = {};
    
    for (const agentId of agentIds) {
      comparison[agentId] = await this.getAgentPerformance(agentId, timeRange);
    }
    
    return comparison;
  }

  /**
   * Close connections and cleanup
   */
  async close(): Promise<void> {
    this.stopMonitoring();
    await this.prisma.$disconnect();
    await this.redis.quit();
  }
}

