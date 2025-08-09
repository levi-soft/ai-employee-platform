
import { logger } from '@ai-platform/shared-utils';
import { aiRoutingConfig } from '../config/config';
import { QualityScore, QualityScorerService } from '../quality/quality-scorer.service';
import { QualityAlert, QualityMonitorService } from '../monitoring/quality-monitor.service';
import { QualityBenchmarkService, BenchmarkExecution } from '../benchmarking/quality-benchmark.service';
import { RedisCache } from '../cache/request-cache.service';

export interface QualityDashboardData {
  timestamp: Date;
  overview: QualityOverview;
  agentPerformance: AgentPerformanceData[];
  alerts: QualityAlert[];
  trends: QualityTrendData[];
  benchmarks: BenchmarkSummaryData[];
  insights: QualityInsight[];
  recommendations: QualityRecommendation[];
}

export interface QualityOverview {
  totalRequests: number;
  averageQuality: number;
  qualityTrend: 'improving' | 'stable' | 'declining';
  activeAlerts: number;
  criticalAlerts: number;
  topPerformingAgent: string;
  lowestPerformingAgent: string;
  systemHealth: 'excellent' | 'good' | 'fair' | 'poor';
  complianceScore: number; // 0-1
}

export interface AgentPerformanceData {
  agentId: string;
  agentName: string;
  overallScore: number;
  requestCount: number;
  dimensions: {
    accuracy: number;
    relevance: number;
    coherence: number;
    completeness: number;
    clarity: number;
    creativity: number;
    safety: number;
    efficiency: number;
  };
  trend: 'up' | 'down' | 'stable';
  status: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  lastUpdated: Date;
  alerts: number;
  benchmarkRank?: number;
}

export interface QualityTrendData {
  dimension: string;
  timeframe: '1h' | '24h' | '7d' | '30d';
  dataPoints: Array<{
    timestamp: Date;
    value: number;
    agentId?: string;
  }>;
  trend: 'improving' | 'stable' | 'declining';
  changeRate: number; // Percentage change
  significance: 'high' | 'medium' | 'low';
}

export interface BenchmarkSummaryData {
  suiteId: string;
  suiteName: string;
  lastExecuted: Date;
  results: Array<{
    agentId: string;
    score: number;
    rank: number;
    status: 'passed' | 'failed';
  }>;
  averageScore: number;
  passRate: number;
}

export interface QualityInsight {
  id: string;
  type: 'performance' | 'trend' | 'anomaly' | 'benchmark' | 'compliance';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affectedAgents: string[];
  dataPoints: any[];
  actionable: boolean;
  recommendations: string[];
  confidence: number; // 0-1
  createdAt: Date;
}

export interface QualityRecommendation {
  id: string;
  category: 'performance' | 'safety' | 'efficiency' | 'accuracy' | 'consistency';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affectedAgents: string[];
  expectedImpact: string;
  implementationComplexity: 'low' | 'medium' | 'high';
  estimatedTimeToImplement: string;
  prerequisites: string[];
  steps: string[];
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: Date;
}

export interface QualityMetricsConfiguration {
  refreshInterval: number; // milliseconds
  dataRetentionPeriod: number; // days
  alertThresholds: {
    criticalQuality: number;
    lowQuality: number;
    highAlertCount: number;
    lowComplianceScore: number;
  };
  trendAnalysisWindow: number; // hours
  benchmarkUpdateFrequency: number; // hours
}

export interface QualityReportExport {
  reportId: string;
  generatedAt: Date;
  timeframe: { start: Date; end: Date };
  format: 'json' | 'csv' | 'pdf' | 'excel';
  data: QualityDashboardData;
  metadata: {
    generatedBy: string;
    configuration: QualityMetricsConfiguration;
    version: string;
  };
}

export class QualityDashboard {
  private cache: RedisCache;
  private qualityScorer: QualityScorerService;
  private qualityMonitor: QualityMonitorService;
  private benchmarkService: QualityBenchmarkService;
  private config: QualityMetricsConfiguration;
  private refreshInterval?: NodeJS.Timeout;

  constructor(
    qualityScorer: QualityScorerService,
    qualityMonitor: QualityMonitorService,
    benchmarkService: QualityBenchmarkService
  ) {
    this.qualityScorer = qualityScorer;
    this.qualityMonitor = qualityMonitor;
    this.benchmarkService = benchmarkService;
    
    this.cache = new RedisCache({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    });
    
    this.config = this.loadConfiguration();
    this.startDashboardRefresh();
  }

  /**
   * Get comprehensive quality dashboard data
   */
  public async getDashboardData(
    timeframe: '1h' | '24h' | '7d' | '30d' = '24h'
  ): Promise<QualityDashboardData> {
    try {
      logger.info('Generating quality dashboard data', { timeframe });
      
      const startTime = Date.now();
      
      // Check cache first
      const cacheKey = `quality_dashboard:${timeframe}`;
      let dashboardData = await this.cache.get<QualityDashboardData>(cacheKey);
      
      if (!dashboardData) {
        // Generate fresh dashboard data
        const [
          overview,
          agentPerformance,
          alerts,
          trends,
          benchmarks,
          insights,
          recommendations
        ] = await Promise.all([
          this.generateQualityOverview(timeframe),
          this.generateAgentPerformanceData(timeframe),
          this.qualityMonitor.getActiveAlerts(),
          this.generateTrendData(timeframe),
          this.generateBenchmarkSummary(),
          this.generateQualityInsights(timeframe),
          this.generateQualityRecommendations(timeframe)
        ]);
        
        dashboardData = {
          timestamp: new Date(),
          overview,
          agentPerformance,
          alerts: alerts.slice(0, 10), // Show top 10 alerts
          trends,
          benchmarks,
          insights,
          recommendations
        };
        
        // Cache for shorter duration than refresh interval
        const cacheTime = Math.floor(this.config.refreshInterval * 0.8);
        await this.cache.set(cacheKey, dashboardData, cacheTime / 1000);
      }
      
      const generationTime = Date.now() - startTime;
      
      logger.info('Quality dashboard data generated', {
        timeframe,
        generationTime,
        agentCount: dashboardData.agentPerformance.length,
        alertCount: dashboardData.alerts.length,
        insightCount: dashboardData.insights.length
      });
      
      return dashboardData;
      
    } catch (error) {
      logger.error('Failed to generate quality dashboard data', {
        timeframe,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get real-time quality metrics for live dashboard
   */
  public async getRealTimeMetrics(): Promise<{
    currentQuality: number;
    requestsLastHour: number;
    activeAlerts: number;
    criticalIssues: number;
    systemStatus: 'operational' | 'degraded' | 'outage';
    lastUpdated: Date;
    agentStatuses: Array<{
      agentId: string;
      status: 'online' | 'offline' | 'degraded';
      currentQuality: number;
      lastRequest: Date;
    }>;
  }> {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      
      // Get recent quality data
      const recentScores = await this.getRecentQualityScores('1h');
      const currentQuality = recentScores.length > 0 
        ? recentScores.reduce((sum, score) => sum + score.overallScore, 0) / recentScores.length
        : 0;
      
      // Get alert counts
      const alerts = await this.qualityMonitor.getActiveAlerts();
      const activeAlerts = alerts.length;
      const criticalIssues = alerts.filter(a => a.severity === 'critical').length;
      
      // Determine system status
      let systemStatus: 'operational' | 'degraded' | 'outage';
      if (criticalIssues > 0) {
        systemStatus = 'outage';
      } else if (currentQuality < 0.6 || activeAlerts > 5) {
        systemStatus = 'degraded';
      } else {
        systemStatus = 'operational';
      }
      
      // Get agent statuses
      const agentStatuses = await this.getAgentStatuses();
      
      return {
        currentQuality,
        requestsLastHour: recentScores.length,
        activeAlerts,
        criticalIssues,
        systemStatus,
        lastUpdated: new Date(),
        agentStatuses
      };
      
    } catch (error) {
      logger.error('Failed to get real-time metrics', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Export quality report in specified format
   */
  public async exportQualityReport(
    timeframe: { start: Date; end: Date },
    format: 'json' | 'csv' | 'pdf' | 'excel',
    generatedBy: string
  ): Promise<QualityReportExport> {
    try {
      const reportId = `quality_report_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      
      // Generate dashboard data for the timeframe
      const dashboardData = await this.getDashboardDataForTimeframe(timeframe);
      
      const report: QualityReportExport = {
        reportId,
        generatedAt: new Date(),
        timeframe,
        format,
        data: dashboardData,
        metadata: {
          generatedBy,
          configuration: this.config,
          version: '1.0'
        }
      };
      
      // Cache the report
      await this.cacheReport(report);
      
      logger.info('Quality report exported', {
        reportId,
        format,
        timeframe: `${timeframe.start.toISOString()} to ${timeframe.end.toISOString()}`,
        generatedBy
      });
      
      return report;
      
    } catch (error) {
      logger.error('Failed to export quality report', {
        format,
        generatedBy,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Update dashboard configuration
   */
  public updateConfiguration(
    updates: Partial<QualityMetricsConfiguration>
  ): QualityMetricsConfiguration {
    try {
      this.config = { ...this.config, ...updates };
      
      // Restart refresh interval if needed
      if (updates.refreshInterval && this.refreshInterval) {
        this.stopDashboardRefresh();
        this.startDashboardRefresh();
      }
      
      logger.info('Dashboard configuration updated', {
        updates,
        newConfig: this.config
      });
      
      return this.config;
      
    } catch (error) {
      logger.error('Failed to update dashboard configuration', {
        updates,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get dashboard configuration
   */
  public getConfiguration(): QualityMetricsConfiguration {
    return { ...this.config };
  }

  /**
   * Start automatic dashboard refresh
   */
  private startDashboardRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    
    this.refreshInterval = setInterval(async () => {
      try {
        // Pre-generate dashboard data for common timeframes
        const timeframes: Array<'1h' | '24h' | '7d' | '30d'> = ['1h', '24h', '7d', '30d'];
        
        for (const timeframe of timeframes) {
          await this.getDashboardData(timeframe);
        }
        
        logger.debug('Dashboard data refreshed', {
          timeframes,
          timestamp: new Date().toISOString()
        });
        
      } catch (error) {
        logger.error('Error refreshing dashboard data', {
          error: error.message
        });
      }
    }, this.config.refreshInterval);
    
    logger.info('Dashboard refresh started', {
      interval: this.config.refreshInterval
    });
  }

  /**
   * Stop automatic dashboard refresh
   */
  private stopDashboardRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
    
    logger.info('Dashboard refresh stopped');
  }

  /**
   * Load dashboard configuration
   */
  private loadConfiguration(): QualityMetricsConfiguration {
    return {
      refreshInterval: 5 * 60 * 1000, // 5 minutes
      dataRetentionPeriod: 30, // 30 days
      alertThresholds: {
        criticalQuality: 0.5,
        lowQuality: 0.7,
        highAlertCount: 10,
        lowComplianceScore: 0.8
      },
      trendAnalysisWindow: 24, // 24 hours
      benchmarkUpdateFrequency: 168 // 1 week
    };
  }

  /**
   * Generate quality overview
   */
  private async generateQualityOverview(timeframe: string): Promise<QualityOverview> {
    try {
      // Get recent quality scores
      const recentScores = await this.getRecentQualityScores(timeframe);
      const totalRequests = recentScores.length;
      
      // Calculate average quality
      const averageQuality = totalRequests > 0 
        ? recentScores.reduce((sum, score) => sum + score.overallScore, 0) / totalRequests
        : 0;
      
      // Determine quality trend
      const qualityTrend = await this.calculateQualityTrend(recentScores);
      
      // Get alert counts
      const alerts = await this.qualityMonitor.getActiveAlerts();
      const activeAlerts = alerts.length;
      const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;
      
      // Find top and worst performing agents
      const agentPerformance = await this.calculateAgentPerformanceRankings(recentScores);
      const topPerformingAgent = agentPerformance[0]?.agentId || 'none';
      const lowestPerformingAgent = agentPerformance[agentPerformance.length - 1]?.agentId || 'none';
      
      // Calculate system health
      const systemHealth = this.determineSystemHealth(averageQuality, activeAlerts, criticalAlerts);
      
      // Calculate compliance score (simplified)
      const complianceScore = this.calculateComplianceScore(recentScores, alerts);
      
      return {
        totalRequests,
        averageQuality,
        qualityTrend,
        activeAlerts,
        criticalAlerts,
        topPerformingAgent,
        lowestPerformingAgent,
        systemHealth,
        complianceScore
      };
      
    } catch (error) {
      logger.error('Failed to generate quality overview', {
        timeframe,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Generate agent performance data
   */
  private async generateAgentPerformanceData(timeframe: string): Promise<AgentPerformanceData[]> {
    try {
      const recentScores = await this.getRecentQualityScores(timeframe);
      const agentGroups = this.groupScoresByAgent(recentScores);
      const performanceData: AgentPerformanceData[] = [];
      
      for (const [agentId, scores] of agentGroups.entries()) {
        const agentStats = await this.qualityScorer.getAgentQualityStats(agentId, timeframe as any);
        const agentAlerts = await this.qualityMonitor.getActiveAlerts(agentId);
        
        // Calculate dimensions
        const dimensions = this.calculateAgentDimensions(scores);
        
        // Determine status
        const status = this.determineAgentStatus(agentStats.avgScore, agentAlerts.length);
        
        performanceData.push({
          agentId,
          agentName: await this.getAgentName(agentId),
          overallScore: agentStats.avgScore,
          requestCount: scores.length,
          dimensions,
          trend: this.determineAgentTrend(agentStats.trendData),
          status,
          lastUpdated: new Date(),
          alerts: agentAlerts.length
        });
      }
      
      // Sort by overall score descending
      return performanceData.sort((a, b) => b.overallScore - a.overallScore);
      
    } catch (error) {
      logger.error('Failed to generate agent performance data', {
        timeframe,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Generate quality trend data
   */
  private async generateTrendData(timeframe: string): Promise<QualityTrendData[]> {
    try {
      const trends: QualityTrendData[] = [];
      const dimensions = ['overall', 'accuracy', 'relevance', 'coherence', 'completeness', 'clarity', 'safety'];
      
      for (const dimension of dimensions) {
        const trendData = await this.calculateDimensionTrend(dimension, timeframe);
        trends.push(trendData);
      }
      
      return trends.sort((a, b) => {
        // Sort by significance and change rate
        const significanceOrder = { high: 3, medium: 2, low: 1 };
        const sigDiff = significanceOrder[b.significance] - significanceOrder[a.significance];
        if (sigDiff !== 0) return sigDiff;
        
        return Math.abs(b.changeRate) - Math.abs(a.changeRate);
      });
      
    } catch (error) {
      logger.error('Failed to generate trend data', {
        timeframe,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Generate benchmark summary
   */
  private async generateBenchmarkSummary(): Promise<BenchmarkSummaryData[]> {
    try {
      const benchmarkSuites = this.benchmarkService.getBenchmarkSuites();
      const summaryData: BenchmarkSummaryData[] = [];
      
      for (const suite of benchmarkSuites) {
        // Get recent executions for this suite (simplified)
        const recentExecutions = await this.getRecentBenchmarkExecutions(suite.id);
        
        if (recentExecutions.length > 0) {
          const latestExecution = recentExecutions.sort((a, b) => 
            b.executionDate.getTime() - a.executionDate.getTime()
          )[0];
          
          const results = recentExecutions.map(execution => ({
            agentId: execution.agentId,
            score: execution.summary.overallScore,
            rank: 1, // Would calculate actual rank
            status: execution.summary.overallScore >= 0.7 ? 'passed' as const : 'failed' as const
          }));
          
          const averageScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
          const passRate = results.filter(r => r.status === 'passed').length / results.length;
          
          summaryData.push({
            suiteId: suite.id,
            suiteName: suite.name,
            lastExecuted: latestExecution.executionDate,
            results,
            averageScore,
            passRate
          });
        }
      }
      
      return summaryData;
      
    } catch (error) {
      logger.error('Failed to generate benchmark summary', {
        error: error.message
      });
      return [];
    }
  }

  /**
   * Generate quality insights
   */
  private async generateQualityInsights(timeframe: string): Promise<QualityInsight[]> {
    try {
      const insights: QualityInsight[] = [];
      const recentScores = await this.getRecentQualityScores(timeframe);
      const alerts = await this.qualityMonitor.getActiveAlerts();
      
      // Performance insights
      const performanceInsight = await this.generatePerformanceInsight(recentScores);
      if (performanceInsight) insights.push(performanceInsight);
      
      // Trend insights
      const trendInsights = await this.generateTrendInsights(recentScores);
      insights.push(...trendInsights);
      
      // Anomaly insights
      const anomalyInsights = await this.generateAnomalyInsights(alerts);
      insights.push(...anomalyInsights);
      
      // Benchmark insights
      const benchmarkInsights = await this.generateBenchmarkInsights();
      insights.push(...benchmarkInsights);
      
      return insights.sort((a, b) => {
        // Sort by priority and confidence
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        
        return b.confidence - a.confidence;
      });
      
    } catch (error) {
      logger.error('Failed to generate quality insights', {
        timeframe,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Generate quality recommendations
   */
  private async generateQualityRecommendations(timeframe: string): Promise<QualityRecommendation[]> {
    try {
      const recommendations: QualityRecommendation[] = [];
      
      // Get data for analysis
      const recentScores = await this.getRecentQualityScores(timeframe);
      const alerts = await this.qualityMonitor.getActiveAlerts();
      const agentPerformance = await this.generateAgentPerformanceData(timeframe);
      
      // Generate recommendations based on poor performance
      const performanceRecommendations = this.generatePerformanceRecommendations(agentPerformance);
      recommendations.push(...performanceRecommendations);
      
      // Generate recommendations based on alerts
      const alertRecommendations = this.generateAlertRecommendations(alerts);
      recommendations.push(...alertRecommendations);
      
      // Generate preventive recommendations
      const preventiveRecommendations = this.generatePreventiveRecommendations(recentScores);
      recommendations.push(...preventiveRecommendations);
      
      return recommendations.sort((a, b) => {
        // Sort by priority and expected impact
        const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        
        // Secondary sort by implementation complexity (easier first)
        const complexityOrder = { low: 3, medium: 2, high: 1 };
        return complexityOrder[b.implementationComplexity] - complexityOrder[a.implementationComplexity];
      });
      
    } catch (error) {
      logger.error('Failed to generate quality recommendations', {
        timeframe,
        error: error.message
      });
      return [];
    }
  }

  // Helper methods (simplified implementations)
  private async getRecentQualityScores(timeframe: string): Promise<QualityScore[]> {
    // In practice, query database for quality scores
    return [];
  }

  private async calculateQualityTrend(scores: QualityScore[]): Promise<'improving' | 'stable' | 'declining'> {
    // Simplified trend calculation
    return 'stable';
  }

  private async calculateAgentPerformanceRankings(scores: QualityScore[]): Promise<any[]> {
    // Group by agent and calculate performance
    return [];
  }

  private determineSystemHealth(
    avgQuality: number,
    activeAlerts: number,
    criticalAlerts: number
  ): 'excellent' | 'good' | 'fair' | 'poor' {
    if (criticalAlerts > 0 || avgQuality < this.config.alertThresholds.criticalQuality) {
      return 'poor';
    } else if (avgQuality < this.config.alertThresholds.lowQuality || activeAlerts > 5) {
      return 'fair';
    } else if (avgQuality >= 0.8 && activeAlerts <= 2) {
      return 'excellent';
    } else {
      return 'good';
    }
  }

  private calculateComplianceScore(scores: QualityScore[], alerts: QualityAlert[]): number {
    // Simplified compliance score based on safety and quality metrics
    const safetyScores = scores.map(s => s.dimensions.safety);
    const avgSafety = safetyScores.length > 0 
      ? safetyScores.reduce((sum, s) => sum + s, 0) / safetyScores.length 
      : 0;
    
    const safetyAlerts = alerts.filter(a => a.type === 'benchmark_missed' && a.title.includes('Safety'));
    const safetyPenalty = safetyAlerts.length * 0.1;
    
    return Math.max(0, Math.min(1, avgSafety - safetyPenalty));
  }

  // Additional helper method stubs
  private groupScoresByAgent(scores: QualityScore[]): Map<string, QualityScore[]> { return new Map(); }
  private calculateAgentDimensions(scores: QualityScore[]): any { return {}; }
  private determineAgentStatus(score: number, alertCount: number): string { return 'good'; }
  private async getAgentName(agentId: string): Promise<string> { return `Agent ${agentId}`; }
  private determineAgentTrend(trendData: any[]): 'up' | 'down' | 'stable' { return 'stable'; }
  private async calculateDimensionTrend(dimension: string, timeframe: string): Promise<QualityTrendData> {
    return {
      dimension,
      timeframe: timeframe as any,
      dataPoints: [],
      trend: 'stable',
      changeRate: 0,
      significance: 'low'
    };
  }
  private async getRecentBenchmarkExecutions(suiteId: string): Promise<BenchmarkExecution[]> { return []; }
  private async generatePerformanceInsight(scores: QualityScore[]): Promise<QualityInsight | null> { return null; }
  private async generateTrendInsights(scores: QualityScore[]): Promise<QualityInsight[]> { return []; }
  private async generateAnomalyInsights(alerts: QualityAlert[]): Promise<QualityInsight[]> { return []; }
  private async generateBenchmarkInsights(): Promise<QualityInsight[]> { return []; }
  private generatePerformanceRecommendations(performance: AgentPerformanceData[]): QualityRecommendation[] { return []; }
  private generateAlertRecommendations(alerts: QualityAlert[]): QualityRecommendation[] { return []; }
  private generatePreventiveRecommendations(scores: QualityScore[]): QualityRecommendation[] { return []; }
  private async getAgentStatuses(): Promise<any[]> { return []; }
  private async getDashboardDataForTimeframe(timeframe: { start: Date; end: Date }): Promise<QualityDashboardData> {
    // Generate dashboard data for specific timeframe
    return await this.getDashboardData('24h');
  }
  private async cacheReport(report: QualityReportExport): Promise<void> {
    const cacheKey = `quality_report:${report.reportId}`;
    await this.cache.set(cacheKey, report, 86400 * 7); // Cache for 7 days
  }
}
