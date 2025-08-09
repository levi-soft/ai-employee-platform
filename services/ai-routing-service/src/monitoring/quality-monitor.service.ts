
import { logger } from '@ai-platform/shared-utils';
import { aiRoutingConfig } from '../config/config';
import { QualityScore, QualityScorerService } from '../quality/quality-scorer.service';
import { RedisCache } from '../cache/request-cache.service';

export interface QualityAlert {
  id: string;
  type: 'quality_degradation' | 'consistency_issue' | 'benchmark_missed' | 'anomaly_detected';
  severity: 'low' | 'medium' | 'high' | 'critical';
  agentId: string;
  title: string;
  description: string;
  threshold: number;
  actualValue: number;
  timestamp: Date;
  affectedRequests: string[];
  actionRequired: boolean;
  suggestedActions: string[];
  resolved: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
}

export interface QualityThreshold {
  id: string;
  name: string;
  agentId?: string; // null for global thresholds
  dimension: 'overall' | 'accuracy' | 'relevance' | 'coherence' | 'completeness' | 'clarity' | 'creativity' | 'safety' | 'efficiency';
  minValue: number;
  maxValue?: number;
  timeWindow: 'immediate' | '1h' | '24h' | '7d' | '30d';
  alertOnBreach: boolean;
  consecutiveFailures: number; // Number of consecutive failures before alert
  isActive: boolean;
}

export interface QualityMonitoringConfig {
  enabled: boolean;
  realTimeMonitoring: boolean;
  batchMonitoring: boolean;
  alertingEnabled: boolean;
  thresholds: QualityThreshold[];
  monitoringInterval: number; // milliseconds
  historicalAnalysisDepth: number; // days
  anomalyDetectionSensitivity: 'low' | 'medium' | 'high';
}

export interface QualityTrend {
  agentId: string;
  dimension: string;
  timeframe: '1h' | '24h' | '7d' | '30d';
  direction: 'improving' | 'stable' | 'declining';
  magnitude: number; // Rate of change
  confidence: number; // 0-1
  dataPoints: Array<{
    timestamp: Date;
    value: number;
    requestCount: number;
  }>;
  analysis: string;
}

export interface QualityReport {
  reportId: string;
  generatedAt: Date;
  timeframe: { start: Date; end: Date };
  summary: {
    totalRequests: number;
    averageQuality: number;
    qualityTrend: 'up' | 'down' | 'stable';
    alertsGenerated: number;
    thresholdsBreached: number;
  };
  agentPerformance: Array<{
    agentId: string;
    requestCount: number;
    averageScore: number;
    trendDirection: 'up' | 'down' | 'stable';
    issues: string[];
    improvements: string[];
  }>;
  trends: QualityTrend[];
  alerts: QualityAlert[];
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low';
    category: string;
    description: string;
    expectedImpact: string;
  }>;
}

export class QualityMonitorService {
  private cache: RedisCache;
  private qualityScorer: QualityScorerService;
  private config: QualityMonitoringConfig;
  private activeAlerts: Map<string, QualityAlert> = new Map();
  private thresholds: Map<string, QualityThreshold> = new Map();
  private monitoringInterval?: NodeJS.Timeout;

  constructor(qualityScorer: QualityScorerService) {
    this.qualityScorer = qualityScorer;
    this.cache = new RedisCache({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    });
    
    this.config = this.loadMonitoringConfig();
    this.initializeThresholds();
    
    if (this.config.enabled) {
      this.startMonitoring();
    }
  }

  /**
   * Monitor quality in real-time for a new request
   */
  public async monitorRealTimeQuality(
    qualityScore: QualityScore
  ): Promise<QualityAlert[]> {
    try {
      if (!this.config.realTimeMonitoring) {
        return [];
      }
      
      const alerts: QualityAlert[] = [];
      
      // Check immediate thresholds
      const immediateAlerts = await this.checkImmediateThresholds(qualityScore);
      alerts.push(...immediateAlerts);
      
      // Check for anomalies
      const anomalyAlerts = await this.detectAnomalies(qualityScore);
      alerts.push(...anomalyAlerts);
      
      // Update quality history
      await this.updateQualityHistory(qualityScore);
      
      // Store alerts
      for (const alert of alerts) {
        await this.storeAlert(alert);
        this.activeAlerts.set(alert.id, alert);
      }
      
      if (alerts.length > 0) {
        logger.info('Real-time quality alerts generated', {
          requestId: qualityScore.requestId,
          agentId: qualityScore.agentId,
          alertCount: alerts.length,
          criticalAlerts: alerts.filter(a => a.severity === 'critical').length
        });
        
        // Send notifications for critical alerts
        const criticalAlerts = alerts.filter(a => a.severity === 'critical');
        if (criticalAlerts.length > 0 && this.config.alertingEnabled) {
          await this.sendAlertNotifications(criticalAlerts);
        }
      }
      
      return alerts;
      
    } catch (error) {
      logger.error('Failed to monitor real-time quality', {
        requestId: qualityScore.requestId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Run batch quality monitoring
   */
  public async runBatchMonitoring(): Promise<{
    alertsGenerated: QualityAlert[];
    trendsUpdated: QualityTrend[];
    summary: {
      requestsAnalyzed: number;
      qualityIssuesFound: number;
      thresholdsBreached: number;
    };
  }> {
    try {
      logger.info('Starting batch quality monitoring');
      
      const alerts: QualityAlert[] = [];
      const trends: QualityTrend[] = [];
      let requestsAnalyzed = 0;
      let qualityIssuesFound = 0;
      let thresholdsBreached = 0;
      
      // Get recent quality scores for analysis
      const recentScores = await this.getRecentQualityScores('24h');
      requestsAnalyzed = recentScores.length;
      
      // Check time-window thresholds
      for (const threshold of this.thresholds.values()) {
        if (threshold.isActive && threshold.timeWindow !== 'immediate') {
          const thresholdAlerts = await this.checkTimeWindowThreshold(threshold, recentScores);
          alerts.push(...thresholdAlerts);
          if (thresholdAlerts.length > 0) {
            thresholdsBreached++;
          }
        }
      }
      
      // Analyze quality trends
      const agentIds = [...new Set(recentScores.map(score => score.agentId))];
      for (const agentId of agentIds) {
        const agentTrends = await this.analyzeQualityTrends(agentId);
        trends.push(...agentTrends);
        
        // Generate alerts for declining trends
        const decliningTrends = agentTrends.filter(
          trend => trend.direction === 'declining' && trend.magnitude > 0.1
        );
        
        for (const trend of decliningTrends) {
          const trendAlert = await this.createTrendAlert(trend);
          alerts.push(trendAlert);
          qualityIssuesFound++;
        }
      }
      
      // Check consistency issues
      const consistencyAlerts = await this.checkConsistencyIssues(recentScores);
      alerts.push(...consistencyAlerts);
      qualityIssuesFound += consistencyAlerts.length;
      
      // Store all alerts
      for (const alert of alerts) {
        await this.storeAlert(alert);
        this.activeAlerts.set(alert.id, alert);
      }
      
      // Send notifications for high/critical alerts
      const highPriorityAlerts = alerts.filter(
        a => a.severity === 'high' || a.severity === 'critical'
      );
      
      if (highPriorityAlerts.length > 0 && this.config.alertingEnabled) {
        await this.sendAlertNotifications(highPriorityAlerts);
      }
      
      logger.info('Batch quality monitoring completed', {
        requestsAnalyzed,
        alertsGenerated: alerts.length,
        trendsUpdated: trends.length,
        qualityIssuesFound,
        thresholdsBreached
      });
      
      return {
        alertsGenerated: alerts,
        trendsUpdated: trends,
        summary: {
          requestsAnalyzed,
          qualityIssuesFound,
          thresholdsBreached
        }
      };
      
    } catch (error) {
      logger.error('Failed to run batch quality monitoring', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Generate quality monitoring report
   */
  public async generateQualityReport(
    timeframe: { start: Date; end: Date },
    includeDetails: boolean = true
  ): Promise<QualityReport> {
    try {
      const reportId = `quality_report_${Date.now()}`;
      
      // Get quality data for the timeframe
      const qualityScores = await this.getQualityScoresForTimeframe(timeframe.start, timeframe.end);
      const alerts = await this.getAlertsForTimeframe(timeframe.start, timeframe.end);
      
      // Calculate summary statistics
      const totalRequests = qualityScores.length;
      const averageQuality = totalRequests > 0 
        ? qualityScores.reduce((sum, score) => sum + score.overallScore, 0) / totalRequests 
        : 0;
      
      const qualityTrend = await this.determineOverallQualityTrend(qualityScores);
      const alertsGenerated = alerts.length;
      const thresholdsBreached = alerts.filter(a => a.type !== 'anomaly_detected').length;
      
      // Analyze agent performance
      const agentPerformance = await this.analyzeAgentPerformance(qualityScores, alerts);
      
      // Get quality trends
      const trends = await this.getQualityTrendsForTimeframe(timeframe);
      
      // Generate recommendations
      const recommendations = await this.generateRecommendations(qualityScores, alerts, trends);
      
      const report: QualityReport = {
        reportId,
        generatedAt: new Date(),
        timeframe,
        summary: {
          totalRequests,
          averageQuality,
          qualityTrend,
          alertsGenerated,
          thresholdsBreached
        },
        agentPerformance,
        trends: includeDetails ? trends : [],
        alerts: includeDetails ? alerts : alerts.filter(a => a.severity === 'high' || a.severity === 'critical'),
        recommendations
      };
      
      // Cache report
      await this.cacheReport(report);
      
      logger.info('Quality monitoring report generated', {
        reportId,
        timeframe: `${timeframe.start.toISOString()} to ${timeframe.end.toISOString()}`,
        totalRequests,
        averageQuality,
        alertsGenerated,
        recommendationCount: recommendations.length
      });
      
      return report;
      
    } catch (error) {
      logger.error('Failed to generate quality report', {
        timeframe,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Add or update quality threshold
   */
  public async setQualityThreshold(threshold: Omit<QualityThreshold, 'id'>): Promise<QualityThreshold> {
    try {
      const thresholdId = `threshold_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      
      const newThreshold: QualityThreshold = {
        id: thresholdId,
        ...threshold
      };
      
      this.thresholds.set(thresholdId, newThreshold);
      
      // Cache threshold
      await this.cacheThreshold(newThreshold);
      
      logger.info('Quality threshold set', {
        thresholdId,
        agentId: threshold.agentId,
        dimension: threshold.dimension,
        minValue: threshold.minValue
      });
      
      return newThreshold;
      
    } catch (error) {
      logger.error('Failed to set quality threshold', {
        threshold,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get active alerts for an agent or overall
   */
  public async getActiveAlerts(agentId?: string): Promise<QualityAlert[]> {
    try {
      let alerts = Array.from(this.activeAlerts.values()).filter(alert => !alert.resolved);
      
      if (agentId) {
        alerts = alerts.filter(alert => alert.agentId === agentId);
      }
      
      return alerts.sort((a, b) => {
        // Sort by severity (critical first) then by timestamp (newest first)
        const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
        if (severityDiff !== 0) return severityDiff;
        
        return b.timestamp.getTime() - a.timestamp.getTime();
      });
      
    } catch (error) {
      logger.error('Failed to get active alerts', {
        agentId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Resolve quality alert
   */
  public async resolveAlert(
    alertId: string,
    resolvedBy: string,
    notes?: string
  ): Promise<void> {
    try {
      const alert = this.activeAlerts.get(alertId);
      if (!alert) {
        throw new Error('Alert not found');
      }
      
      alert.resolved = true;
      alert.resolvedAt = new Date();
      alert.resolvedBy = resolvedBy;
      
      // Update in cache
      await this.updateAlert(alert);
      
      logger.info('Quality alert resolved', {
        alertId,
        resolvedBy,
        alertType: alert.type,
        agentId: alert.agentId
      });
      
    } catch (error) {
      logger.error('Failed to resolve alert', {
        alertId,
        resolvedBy,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Start monitoring loop
   */
  private startMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    this.monitoringInterval = setInterval(async () => {
      try {
        if (this.config.batchMonitoring) {
          await this.runBatchMonitoring();
        }
        
        // Clean up resolved alerts older than 7 days
        await this.cleanupOldAlerts();
        
      } catch (error) {
        logger.error('Error in quality monitoring loop', {
          error: error.message
        });
      }
    }, this.config.monitoringInterval);
    
    logger.info('Quality monitoring started', {
      interval: this.config.monitoringInterval,
      realTimeMonitoring: this.config.realTimeMonitoring,
      batchMonitoring: this.config.batchMonitoring
    });
  }

  /**
   * Stop monitoring
   */
  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    
    logger.info('Quality monitoring stopped');
  }

  /**
   * Load monitoring configuration
   */
  private loadMonitoringConfig(): QualityMonitoringConfig {
    return {
      enabled: true,
      realTimeMonitoring: true,
      batchMonitoring: true,
      alertingEnabled: true,
      thresholds: [], // Will be populated by initializeThresholds
      monitoringInterval: 5 * 60 * 1000, // 5 minutes
      historicalAnalysisDepth: 30, // 30 days
      anomalyDetectionSensitivity: 'medium'
    };
  }

  /**
   * Initialize default thresholds
   */
  private initializeThresholds(): void {
    const defaultThresholds: Omit<QualityThreshold, 'id'>[] = [
      {
        name: 'Critical Overall Quality',
        dimension: 'overall',
        minValue: 0.6,
        timeWindow: 'immediate',
        alertOnBreach: true,
        consecutiveFailures: 1,
        isActive: true
      },
      {
        name: 'Safety Threshold',
        dimension: 'safety',
        minValue: 0.8,
        timeWindow: 'immediate',
        alertOnBreach: true,
        consecutiveFailures: 1,
        isActive: true
      },
      {
        name: 'Accuracy Trend',
        dimension: 'accuracy',
        minValue: 0.7,
        timeWindow: '24h',
        alertOnBreach: true,
        consecutiveFailures: 3,
        isActive: true
      },
      {
        name: 'Weekly Quality Average',
        dimension: 'overall',
        minValue: 0.75,
        timeWindow: '7d',
        alertOnBreach: true,
        consecutiveFailures: 2,
        isActive: true
      }
    ];
    
    defaultThresholds.forEach((threshold, index) => {
      const id = `default_threshold_${index}`;
      this.thresholds.set(id, { id, ...threshold });
    });
  }

  /**
   * Check immediate thresholds
   */
  private async checkImmediateThresholds(qualityScore: QualityScore): Promise<QualityAlert[]> {
    const alerts: QualityAlert[] = [];
    
    for (const threshold of this.thresholds.values()) {
      if (!threshold.isActive || threshold.timeWindow !== 'immediate') {
        continue;
      }
      
      // Skip if threshold is agent-specific but doesn't match
      if (threshold.agentId && threshold.agentId !== qualityScore.agentId) {
        continue;
      }
      
      const actualValue = this.getScoreValue(qualityScore, threshold.dimension);
      
      if (actualValue < threshold.minValue || 
          (threshold.maxValue && actualValue > threshold.maxValue)) {
        
        const alert = await this.createThresholdAlert(threshold, qualityScore, actualValue);
        alerts.push(alert);
      }
    }
    
    return alerts;
  }

  /**
   * Detect anomalies in quality scores
   */
  private async detectAnomalies(qualityScore: QualityScore): Promise<QualityAlert[]> {
    try {
      const alerts: QualityAlert[] = [];
      
      // Get recent scores for comparison
      const recentScores = await this.getRecentAgentScores(qualityScore.agentId, '24h');
      
      if (recentScores.length < 10) {
        return []; // Need more data for anomaly detection
      }
      
      // Calculate statistical baseline
      const recentScoreValues = recentScores.map(score => score.overallScore);
      const mean = recentScoreValues.reduce((sum, val) => sum + val, 0) / recentScoreValues.length;
      const variance = recentScoreValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recentScoreValues.length;
      const stdDev = Math.sqrt(variance);
      
      // Detect anomaly based on sensitivity
      let threshold: number;
      switch (this.config.anomalyDetectionSensitivity) {
        case 'low': threshold = 3 * stdDev; break;
        case 'medium': threshold = 2 * stdDev; break;
        case 'high': threshold = 1.5 * stdDev; break;
        default: threshold = 2 * stdDev;
      }
      
      const deviation = Math.abs(qualityScore.overallScore - mean);
      
      if (deviation > threshold) {
        const alert: QualityAlert = {
          id: `anomaly_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          type: 'anomaly_detected',
          severity: deviation > 3 * stdDev ? 'high' : 'medium',
          agentId: qualityScore.agentId,
          title: 'Quality Score Anomaly Detected',
          description: `Quality score ${qualityScore.overallScore.toFixed(3)} deviates significantly from recent average ${mean.toFixed(3)} (deviation: ${deviation.toFixed(3)})`,
          threshold: mean - threshold,
          actualValue: qualityScore.overallScore,
          timestamp: new Date(),
          affectedRequests: [qualityScore.requestId],
          actionRequired: deviation > 3 * stdDev,
          suggestedActions: [
            'Review request and response for quality issues',
            'Check agent configuration and performance',
            'Investigate potential data quality problems'
          ],
          resolved: false
        };
        
        alerts.push(alert);
      }
      
      return alerts;
      
    } catch (error) {
      logger.error('Failed to detect quality anomalies', {
        requestId: qualityScore.requestId,
        agentId: qualityScore.agentId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Get score value for a specific dimension
   */
  private getScoreValue(qualityScore: QualityScore, dimension: string): number {
    if (dimension === 'overall') {
      return qualityScore.overallScore;
    }
    
    return qualityScore.dimensions[dimension as keyof typeof qualityScore.dimensions] || 0;
  }

  /**
   * Create threshold alert
   */
  private async createThresholdAlert(
    threshold: QualityThreshold,
    qualityScore: QualityScore,
    actualValue: number
  ): Promise<QualityAlert> {
    let severity: QualityAlert['severity'] = 'medium';
    
    if (threshold.dimension === 'safety' || actualValue < 0.5) {
      severity = 'critical';
    } else if (actualValue < 0.6) {
      severity = 'high';
    } else if (actualValue < 0.7) {
      severity = 'medium';
    } else {
      severity = 'low';
    }
    
    return {
      id: `threshold_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      type: 'benchmark_missed',
      severity,
      agentId: qualityScore.agentId,
      title: `Quality Threshold Breach: ${threshold.name}`,
      description: `${threshold.dimension} score ${actualValue.toFixed(3)} is below threshold ${threshold.minValue}`,
      threshold: threshold.minValue,
      actualValue,
      timestamp: new Date(),
      affectedRequests: [qualityScore.requestId],
      actionRequired: severity === 'critical' || severity === 'high',
      suggestedActions: this.generateSuggestedActions(threshold, actualValue),
      resolved: false
    };
  }

  /**
   * Generate suggested actions for threshold breach
   */
  private generateSuggestedActions(threshold: QualityThreshold, actualValue: number): string[] {
    const actions = [];
    
    switch (threshold.dimension) {
      case 'safety':
        actions.push('Review content for safety violations');
        actions.push('Update safety filters and guidelines');
        break;
      case 'accuracy':
        actions.push('Verify facts and information in responses');
        actions.push('Review agent knowledge base and training');
        break;
      case 'relevance':
        actions.push('Review query understanding and response matching');
        actions.push('Improve context awareness');
        break;
      case 'coherence':
        actions.push('Review response structure and logical flow');
        actions.push('Improve text generation quality');
        break;
      default:
        actions.push(`Investigate ${threshold.dimension} quality issues`);
        actions.push('Review agent configuration and parameters');
    }
    
    if (actualValue < 0.5) {
      actions.push('Consider temporarily disabling agent until issues are resolved');
    }
    
    return actions;
  }

  // Additional helper methods would be implemented here...
  private async updateQualityHistory(qualityScore: QualityScore): Promise<void> {}
  private async storeAlert(alert: QualityAlert): Promise<void> {}
  private async sendAlertNotifications(alerts: QualityAlert[]): Promise<void> {}
  private async getRecentQualityScores(timeWindow: string): Promise<QualityScore[]> { return []; }
  private async checkTimeWindowThreshold(threshold: QualityThreshold, scores: QualityScore[]): Promise<QualityAlert[]> { return []; }
  private async analyzeQualityTrends(agentId: string): Promise<QualityTrend[]> { return []; }
  private async createTrendAlert(trend: QualityTrend): Promise<QualityAlert> {
    return {
      id: `trend_${Date.now()}`,
      type: 'quality_degradation',
      severity: 'medium',
      agentId: trend.agentId,
      title: 'Quality Trend Alert',
      description: `Quality declining in ${trend.dimension}`,
      threshold: 0,
      actualValue: 0,
      timestamp: new Date(),
      affectedRequests: [],
      actionRequired: true,
      suggestedActions: [],
      resolved: false
    };
  }
  private async checkConsistencyIssues(scores: QualityScore[]): Promise<QualityAlert[]> { return []; }
  private async getAlertsForTimeframe(start: Date, end: Date): Promise<QualityAlert[]> { return []; }
  private async getQualityScoresForTimeframe(start: Date, end: Date): Promise<QualityScore[]> { return []; }
  private async determineOverallQualityTrend(scores: QualityScore[]): Promise<'up' | 'down' | 'stable'> { return 'stable'; }
  private async analyzeAgentPerformance(scores: QualityScore[], alerts: QualityAlert[]): Promise<any[]> { return []; }
  private async getQualityTrendsForTimeframe(timeframe: any): Promise<QualityTrend[]> { return []; }
  private async generateRecommendations(scores: QualityScore[], alerts: QualityAlert[], trends: QualityTrend[]): Promise<any[]> { return []; }
  private async cacheReport(report: QualityReport): Promise<void> {}
  private async cacheThreshold(threshold: QualityThreshold): Promise<void> {}
  private async updateAlert(alert: QualityAlert): Promise<void> {}
  private async cleanupOldAlerts(): Promise<void> {}
  private async getRecentAgentScores(agentId: string, timeWindow: string): Promise<QualityScore[]> { return []; }
}
