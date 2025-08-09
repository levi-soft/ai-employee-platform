
import { logger } from '@ai-platform/shared-utils';
import { aiRoutingConfig } from '../config/config';
import { CostCalculation } from './cost-calculator.service';
import { RedisCache } from '../cache/request-cache.service';

export interface CostAnalytics {
  timeframe: 'hour' | 'day' | 'week' | 'month';
  startDate: Date;
  endDate: Date;
  totalCost: number;
  totalRequests: number;
  averageCostPerRequest: number;
  costTrend: 'increasing' | 'decreasing' | 'stable';
  breakdown: CostBreakdown;
  insights: CostInsight[];
  forecasts: CostForecast[];
  recommendations: CostRecommendation[];
}

export interface CostBreakdown {
  byAgent: Array<{
    agentId: string;
    agentName: string;
    cost: number;
    requests: number;
    percentage: number;
    efficiency: number;
  }>;
  byUser: Array<{
    userId: string;
    userName?: string;
    cost: number;
    requests: number;
    percentage: number;
    tier: string;
  }>;
  byTimeOfDay: Array<{
    hour: number;
    cost: number;
    requests: number;
    averageCost: number;
  }>;
  byComplexity: Array<{
    complexity: 'simple' | 'medium' | 'complex' | 'expert';
    cost: number;
    requests: number;
    averageCost: number;
  }>;
  byPriority: Array<{
    priority: 'low' | 'normal' | 'high' | 'critical';
    cost: number;
    requests: number;
    costMultiplier: number;
  }>;
}

export interface CostInsight {
  type: 'spike' | 'anomaly' | 'trend' | 'efficiency' | 'optimization';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  value: number;
  threshold?: number;
  affectedPeriod: { start: Date; end: Date };
  recommendation?: string;
  confidence: number; // 0-1
}

export interface CostForecast {
  timeframe: 'day' | 'week' | 'month' | 'quarter';
  forecastDate: Date;
  predictedCost: number;
  confidenceInterval: { lower: number; upper: number };
  forecastAccuracy: number; // Based on historical accuracy
  factors: Array<{
    name: string;
    impact: number; // -1 to 1
    description: string;
  }>;
}

export interface CostRecommendation {
  type: 'agent_optimization' | 'timing_optimization' | 'user_education' | 'budget_adjustment';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  potentialSavings: number;
  implementationComplexity: 'low' | 'medium' | 'high';
  timeToImplement: string; // e.g., "1-2 days"
  steps: string[];
  expectedROI: number;
}

export interface CostReport {
  id: string;
  generatedAt: Date;
  generatedBy: string;
  reportType: 'executive' | 'operational' | 'technical' | 'custom';
  timeframe: { start: Date; end: Date };
  analytics: CostAnalytics;
  executiveSummary: ExecutiveSummary;
  detailedAnalysis: DetailedAnalysis;
  attachments: ReportAttachment[];
}

export interface ExecutiveSummary {
  totalSpend: number;
  budgetUtilization: number;
  costPerformance: 'excellent' | 'good' | 'fair' | 'poor';
  keyMetrics: Array<{
    metric: string;
    current: number;
    previous: number;
    change: number;
    trend: 'up' | 'down' | 'stable';
  }>;
  topInsights: CostInsight[];
  urgentActions: CostRecommendation[];
}

export interface DetailedAnalysis {
  costDrivers: Array<{
    factor: string;
    impact: number;
    analysis: string;
  }>;
  varianceAnalysis: Array<{
    category: string;
    budgeted: number;
    actual: number;
    variance: number;
    explanation: string;
  }>;
  benchmarking: Array<{
    metric: string;
    value: number;
    benchmark: number;
    performance: 'above' | 'at' | 'below';
  }>;
  costOptimization: {
    identifiedOpportunities: CostRecommendation[];
    implementedSavings: number;
    potentialSavings: number;
  };
}

export interface ReportAttachment {
  name: string;
  type: 'chart' | 'table' | 'document';
  url: string;
  description: string;
}

export class CostAnalyticsService {
  private cache: RedisCache;

  constructor() {
    this.cache = new RedisCache({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    });
  }

  /**
   * Generate comprehensive cost analytics
   */
  public async generateCostAnalytics(
    userId?: string,
    timeframe: 'hour' | 'day' | 'week' | 'month' = 'month',
    startDate?: Date,
    endDate?: Date
  ): Promise<CostAnalytics> {
    try {
      // Set date range
      const { start, end } = this.calculateDateRange(timeframe, startDate, endDate);
      
      // Get cost data
      const costData = await this.getCostData(userId, start, end);
      
      // Calculate basic metrics
      const totalCost = costData.reduce((sum, calc) => sum + calc.totalCost, 0);
      const totalRequests = costData.length;
      const averageCostPerRequest = totalRequests > 0 ? totalCost / totalRequests : 0;
      
      // Determine cost trend
      const costTrend = await this.calculateCostTrend(userId, start, end, timeframe);
      
      // Generate breakdown
      const breakdown = await this.generateCostBreakdown(costData);
      
      // Generate insights
      const insights = await this.generateCostInsights(costData, start, end);
      
      // Generate forecasts
      const forecasts = await this.generateCostForecasts(costData, timeframe);
      
      // Generate recommendations
      const recommendations = await this.generateCostRecommendations(costData, insights);
      
      const analytics: CostAnalytics = {
        timeframe,
        startDate: start,
        endDate: end,
        totalCost,
        totalRequests,
        averageCostPerRequest,
        costTrend,
        breakdown,
        insights,
        forecasts,
        recommendations
      };
      
      // Cache analytics
      await this.cacheAnalytics(analytics, userId);
      
      logger.info('Generated cost analytics', {
        userId,
        timeframe,
        totalCost,
        totalRequests,
        insightCount: insights.length,
        recommendationCount: recommendations.length
      });
      
      return analytics;
      
    } catch (error) {
      logger.error('Failed to generate cost analytics', {
        userId,
        timeframe,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Generate executive cost report
   */
  public async generateExecutiveReport(
    generatedBy: string,
    timeframe: { start: Date; end: Date },
    reportType: 'executive' | 'operational' | 'technical' | 'custom' = 'executive'
  ): Promise<CostReport> {
    try {
      const reportId = `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Generate analytics
      const analytics = await this.generateCostAnalytics(
        undefined,
        'month',
        timeframe.start,
        timeframe.end
      );
      
      // Generate executive summary
      const executiveSummary = await this.generateExecutiveSummary(analytics, timeframe);
      
      // Generate detailed analysis
      const detailedAnalysis = await this.generateDetailedAnalysis(analytics, timeframe);
      
      // Generate attachments (charts, tables, etc.)
      const attachments = await this.generateReportAttachments(analytics);
      
      const report: CostReport = {
        id: reportId,
        generatedAt: new Date(),
        generatedBy,
        reportType,
        timeframe,
        analytics,
        executiveSummary,
        detailedAnalysis,
        attachments
      };
      
      // Cache report
      await this.cacheReport(report);
      
      logger.info('Generated executive cost report', {
        reportId,
        generatedBy,
        reportType,
        totalCost: analytics.totalCost,
        budgetUtilization: executiveSummary.budgetUtilization
      });
      
      return report;
      
    } catch (error) {
      logger.error('Failed to generate executive report', {
        generatedBy,
        reportType,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Real-time cost monitoring
   */
  public async getRealtimeCostMetrics(): Promise<{
    currentHourSpend: number;
    todaySpend: number;
    monthToDateSpend: number;
    hourlyRate: number;
    dailyProjection: number;
    monthlyProjection: number;
    alerts: Array<{
      type: 'budget_threshold' | 'unusual_spike' | 'cost_efficiency';
      message: string;
      severity: 'info' | 'warning' | 'critical';
      value: number;
    }>;
  }> {
    try {
      const now = new Date();
      const startOfHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      
      // Get spending data
      const [currentHourData, todayData, monthData] = await Promise.all([
        this.getCostData(undefined, startOfHour, now),
        this.getCostData(undefined, startOfDay, now),
        this.getCostData(undefined, startOfMonth, now)
      ]);
      
      const currentHourSpend = currentHourData.reduce((sum, calc) => sum + calc.totalCost, 0);
      const todaySpend = todayData.reduce((sum, calc) => sum + calc.totalCost, 0);
      const monthToDateSpend = monthData.reduce((sum, calc) => sum + calc.totalCost, 0);
      
      // Calculate rates and projections
      const minutesIntoHour = now.getMinutes();
      const hourlyRate = minutesIntoHour > 0 ? (currentHourSpend / minutesIntoHour) * 60 : 0;
      const hoursIntoDay = now.getHours() + (now.getMinutes() / 60);
      const dailyProjection = hoursIntoDay > 0 ? (todaySpend / hoursIntoDay) * 24 : 0;
      
      const daysIntoMonth = now.getDate() - 1 + (now.getHours() / 24);
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const monthlyProjection = daysIntoMonth > 0 ? (monthToDateSpend / daysIntoMonth) * daysInMonth : 0;
      
      // Generate alerts
      const alerts = await this.generateRealtimeAlerts({
        currentHourSpend,
        todaySpend,
        monthToDateSpend,
        hourlyRate,
        dailyProjection,
        monthlyProjection
      });
      
      return {
        currentHourSpend,
        todaySpend,
        monthToDateSpend,
        hourlyRate,
        dailyProjection,
        monthlyProjection,
        alerts
      };
      
    } catch (error) {
      logger.error('Failed to get realtime cost metrics', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Cost optimization tracking
   */
  public async trackOptimizationImpact(
    optimizationId: string,
    beforePeriod: { start: Date; end: Date },
    afterPeriod: { start: Date; end: Date }
  ): Promise<{
    optimizationId: string;
    beforeMetrics: { cost: number; requests: number; avgCost: number };
    afterMetrics: { cost: number; requests: number; avgCost: number };
    impact: {
      costSavings: number;
      savingsPercentage: number;
      requestVolumeChange: number;
      efficiencyImprovement: number;
    };
    roi: number;
    confidence: number;
  }> {
    try {
      // Get before and after data
      const [beforeData, afterData] = await Promise.all([
        this.getCostData(undefined, beforePeriod.start, beforePeriod.end),
        this.getCostData(undefined, afterPeriod.start, afterPeriod.end)
      ]);
      
      // Calculate metrics
      const beforeMetrics = {
        cost: beforeData.reduce((sum, calc) => sum + calc.totalCost, 0),
        requests: beforeData.length,
        avgCost: beforeData.length > 0 ? beforeData.reduce((sum, calc) => sum + calc.totalCost, 0) / beforeData.length : 0
      };
      
      const afterMetrics = {
        cost: afterData.reduce((sum, calc) => sum + calc.totalCost, 0),
        requests: afterData.length,
        avgCost: afterData.length > 0 ? afterData.reduce((sum, calc) => sum + calc.totalCost, 0) / afterData.length : 0
      };
      
      // Calculate impact
      const costSavings = beforeMetrics.cost - afterMetrics.cost;
      const savingsPercentage = beforeMetrics.cost > 0 ? (costSavings / beforeMetrics.cost) * 100 : 0;
      const requestVolumeChange = ((afterMetrics.requests - beforeMetrics.requests) / Math.max(beforeMetrics.requests, 1)) * 100;
      const efficiencyImprovement = beforeMetrics.avgCost > 0 ? ((beforeMetrics.avgCost - afterMetrics.avgCost) / beforeMetrics.avgCost) * 100 : 0;
      
      // Calculate ROI (simplified)
      const implementationCost = 1000; // Placeholder - in practice, track actual implementation costs
      const roi = implementationCost > 0 ? (costSavings / implementationCost) * 100 : 0;
      
      // Calculate confidence based on data volume and consistency
      const dataVolumeScore = Math.min((beforeData.length + afterData.length) / 100, 1);
      const consistencyScore = 1 - Math.abs(requestVolumeChange / 100);
      const confidence = (dataVolumeScore + consistencyScore) / 2;
      
      const result = {
        optimizationId,
        beforeMetrics,
        afterMetrics,
        impact: {
          costSavings,
          savingsPercentage,
          requestVolumeChange,
          efficiencyImprovement
        },
        roi,
        confidence
      };
      
      logger.info('Tracked optimization impact', {
        optimizationId,
        costSavings,
        savingsPercentage,
        roi,
        confidence
      });
      
      return result;
      
    } catch (error) {
      logger.error('Failed to track optimization impact', {
        optimizationId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Calculate date range based on timeframe
   */
  private calculateDateRange(
    timeframe: 'hour' | 'day' | 'week' | 'month',
    startDate?: Date,
    endDate?: Date
  ): { start: Date; end: Date } {
    const now = new Date();
    
    if (startDate && endDate) {
      return { start: startDate, end: endDate };
    }
    
    const end = endDate || now;
    let start: Date;
    
    switch (timeframe) {
      case 'hour':
        start = new Date(end.getTime() - 60 * 60 * 1000);
        break;
      case 'day':
        start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        start = new Date(end.getFullYear(), end.getMonth() - 1, end.getDate());
        break;
      default:
        start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    }
    
    return { start, end };
  }

  /**
   * Get cost data from cache/database
   */
  private async getCostData(
    userId?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<CostCalculation[]> {
    // In practice, this would query the database
    // For now, return sample data from cache
    const cacheKey = `cost_data:${userId || 'all'}:${startDate?.toISOString()}:${endDate?.toISOString()}`;
    let data = await this.cache.get<CostCalculation[]>(cacheKey);
    
    if (!data) {
      // Generate sample data for demonstration
      data = this.generateSampleCostData(userId, startDate, endDate);
      await this.cache.set(cacheKey, data, 300); // Cache for 5 minutes
    }
    
    return data;
  }

  /**
   * Generate sample cost data for demonstration
   */
  private generateSampleCostData(
    userId?: string,
    startDate?: Date,
    endDate?: Date
  ): CostCalculation[] {
    const data: CostCalculation[] = [];
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate || new Date();
    
    // Generate sample data points
    const requestCount = Math.floor(Math.random() * 100) + 50;
    
    for (let i = 0; i < requestCount; i++) {
      const timestamp = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
      
      data.push({
        requestId: `req_${i}_${Date.now()}`,
        agentId: ['gpt-4', 'gpt-3.5', 'claude-3'][Math.floor(Math.random() * 3)],
        userId: userId || `user_${Math.floor(Math.random() * 10) + 1}`,
        inputTokens: Math.floor(Math.random() * 2000) + 100,
        outputTokens: Math.floor(Math.random() * 1000) + 50,
        totalTokens: 0, // Will be calculated
        inputCost: 0, // Will be calculated
        outputCost: 0, // Will be calculated
        totalCost: Math.random() * 0.1 + 0.01,
        timestamp,
        currency: 'USD',
        costBreakdown: {
          baseCost: 0,
          surcharges: [],
          discounts: [],
          taxes: [],
          finalCost: 0
        },
        metadata: {
          agentName: 'Sample Agent',
          model: 'sample-model',
          provider: 'sample-provider',
          region: 'us-east-1',
          priority: ['low', 'normal', 'high'][Math.floor(Math.random() * 3)] as any,
          complexity: ['simple', 'medium', 'complex', 'expert'][Math.floor(Math.random() * 4)] as any,
          duration: Math.floor(Math.random() * 5000) + 1000,
          qualityScore: Math.random() * 0.3 + 0.7,
          costEfficiencyScore: Math.random() * 0.4 + 0.6
        }
      });
    }
    
    return data.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  // Simplified implementations of complex analysis methods
  private async calculateCostTrend(
    userId?: string,
    startDate?: Date,
    endDate?: Date,
    timeframe?: string
  ): Promise<'increasing' | 'decreasing' | 'stable'> {
    // Simplified trend calculation
    return Math.random() > 0.5 ? 'increasing' : Math.random() > 0.5 ? 'decreasing' : 'stable';
  }

  private async generateCostBreakdown(costData: CostCalculation[]): Promise<CostBreakdown> {
    // Simplified breakdown generation
    return {
      byAgent: [],
      byUser: [],
      byTimeOfDay: [],
      byComplexity: [],
      byPriority: []
    };
  }

  private async generateCostInsights(
    costData: CostCalculation[],
    startDate: Date,
    endDate: Date
  ): Promise<CostInsight[]> {
    return [
      {
        type: 'trend',
        severity: 'info',
        title: 'Cost Trend Analysis',
        description: 'Costs have increased by 15% compared to previous period',
        value: 15,
        affectedPeriod: { start: startDate, end: endDate },
        confidence: 0.85
      }
    ];
  }

  private async generateCostForecasts(
    costData: CostCalculation[],
    timeframe: string
  ): Promise<CostForecast[]> {
    return [];
  }

  private async generateCostRecommendations(
    costData: CostCalculation[],
    insights: CostInsight[]
  ): Promise<CostRecommendation[]> {
    return [];
  }

  private async cacheAnalytics(analytics: CostAnalytics, userId?: string): Promise<void> {
    const cacheKey = `analytics:${userId || 'all'}:${analytics.timeframe}`;
    await this.cache.set(cacheKey, analytics, 3600);
  }

  private async generateExecutiveSummary(
    analytics: CostAnalytics,
    timeframe: { start: Date; end: Date }
  ): Promise<ExecutiveSummary> {
    return {
      totalSpend: analytics.totalCost,
      budgetUtilization: 75, // Placeholder
      costPerformance: 'good',
      keyMetrics: [],
      topInsights: analytics.insights.slice(0, 3),
      urgentActions: analytics.recommendations.filter(r => r.priority === 'high' || r.priority === 'critical').slice(0, 3)
    };
  }

  private async generateDetailedAnalysis(
    analytics: CostAnalytics,
    timeframe: { start: Date; end: Date }
  ): Promise<DetailedAnalysis> {
    return {
      costDrivers: [],
      varianceAnalysis: [],
      benchmarking: [],
      costOptimization: {
        identifiedOpportunities: analytics.recommendations,
        implementedSavings: 0,
        potentialSavings: analytics.recommendations.reduce((sum, rec) => sum + rec.potentialSavings, 0)
      }
    };
  }

  private async generateReportAttachments(analytics: CostAnalytics): Promise<ReportAttachment[]> {
    return [];
  }

  private async cacheReport(report: CostReport): Promise<void> {
    const cacheKey = `report:${report.id}`;
    await this.cache.set(cacheKey, report, 86400); // Cache for 24 hours
  }

  private async generateRealtimeAlerts(metrics: any): Promise<any[]> {
    return [];
  }
}
