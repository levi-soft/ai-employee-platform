
import { createLogger } from '@ai-platform/shared-utils';
import { PrismaClient } from '@prisma/client';

const logger = createLogger('analytics-service');

export interface UsageAnalytics {
  userId?: number;
  timeframe: 'day' | 'week' | 'month' | 'year';
  startDate: Date;
  endDate: Date;
  metrics: {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    averageCostPerRequest: number;
    averageTokensPerRequest: number;
  };
  trends: Array<{
    date: string;
    requests: number;
    tokens: number;
    cost: number;
  }>;
  topAgents: Array<{
    agentId: string;
    agentName: string;
    requests: number;
    tokens: number;
    cost: number;
    percentage: number;
  }>;
  costBreakdown: {
    byAgent: Array<{
      agentId: string;
      agentName: string;
      cost: number;
      percentage: number;
    }>;
    byTimeOfDay: Array<{
      hour: number;
      cost: number;
      requests: number;
    }>;
    byDayOfWeek: Array<{
      dayOfWeek: number;
      dayName: string;
      cost: number;
      requests: number;
    }>;
  };
}

export interface RevenueAnalytics {
  timeframe: 'day' | 'week' | 'month' | 'year';
  startDate: Date;
  endDate: Date;
  metrics: {
    totalRevenue: number;
    totalTransactions: number;
    averageTransactionValue: number;
    totalCreditsIssued: number;
    totalCreditsUsed: number;
    creditUtilizationRate: number;
  };
  trends: Array<{
    date: string;
    revenue: number;
    transactions: number;
    newCustomers: number;
  }>;
  topCustomers: Array<{
    userId: number;
    userName: string;
    totalSpent: number;
    totalRequests: number;
    averageSpendPerRequest: number;
  }>;
}

export interface BillingForecast {
  userId: number;
  forecastPeriod: 'week' | 'month' | 'quarter';
  basedOnDays: number;
  currentUsage: {
    dailyAverage: number;
    weeklyAverage: number;
    monthlyAverage: number;
  };
  forecast: {
    estimatedCost: number;
    confidenceLevel: number;
    projectedRequests: number;
    projectedTokens: number;
  };
  recommendations: Array<{
    type: 'cost_optimization' | 'usage_pattern' | 'budget_alert';
    title: string;
    description: string;
    potentialSavings?: number;
  }>;
}

export class AnalyticsService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get comprehensive usage analytics
   */
  async getUsageAnalytics(options: {
    userId?: number;
    timeframe: UsageAnalytics['timeframe'];
    startDate?: Date;
    endDate?: Date;
  }): Promise<UsageAnalytics> {
    try {
      const { userId, timeframe, startDate, endDate } = options;
      
      // Calculate date range if not provided
      const dateRange = this.calculateDateRange(timeframe, startDate, endDate);

      logger.info('Generating usage analytics', {
        userId,
        timeframe,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      });

      // Base query conditions
      const whereConditions: any = {
        createdAt: {
          gte: dateRange.startDate,
          lte: dateRange.endDate,
        },
      };

      if (userId) {
        whereConditions.userId = userId;
      }

      // Get basic metrics
      const [metricsData, aiRequests, agents] = await Promise.all([
        this.prisma.aIRequest.aggregate({
          where: whereConditions,
          _count: { id: true },
          _sum: { tokensUsed: true, cost: true },
          _avg: { tokensUsed: true, cost: true },
        }),
        this.prisma.aIRequest.findMany({
          where: whereConditions,
          select: {
            createdAt: true,
            tokensUsed: true,
            cost: true,
            agentId: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.aIAgent.findMany({
          select: {
            id: true,
            name: true,
          },
        }),
      ]);

      // Create agent lookup map
      const agentMap = new Map(agents.map(agent => [agent.id, agent.name]));

      // Calculate metrics
      const metrics = {
        totalRequests: metricsData._count.id || 0,
        totalTokens: metricsData._sum.tokensUsed || 0,
        totalCost: metricsData._sum.cost || 0,
        averageCostPerRequest: metricsData._avg.cost || 0,
        averageTokensPerRequest: metricsData._avg.tokensUsed || 0,
      };

      // Generate trends
      const trends = this.generateTrends(aiRequests, timeframe);

      // Calculate top agents
      const topAgents = this.calculateTopAgents(aiRequests, agentMap, metrics.totalCost);

      // Generate cost breakdown
      const costBreakdown = this.generateCostBreakdown(aiRequests, agentMap);

      const analytics: UsageAnalytics = {
        userId,
        timeframe,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        metrics,
        trends,
        topAgents,
        costBreakdown,
      };

      logger.info('Usage analytics generated successfully', {
        userId,
        totalRequests: metrics.totalRequests,
        totalCost: metrics.totalCost,
      });

      return analytics;
    } catch (error) {
      logger.error('Failed to generate usage analytics', {
        userId: options.userId,
        timeframe: options.timeframe,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get revenue analytics (admin only)
   */
  async getRevenueAnalytics(options: {
    timeframe: RevenueAnalytics['timeframe'];
    startDate?: Date;
    endDate?: Date;
  }): Promise<RevenueAnalytics> {
    try {
      const { timeframe, startDate, endDate } = options;
      const dateRange = this.calculateDateRange(timeframe, startDate, endDate);

      logger.info('Generating revenue analytics', {
        timeframe,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      });

      const whereConditions: any = {
        createdAt: {
          gte: dateRange.startDate,
          lte: dateRange.endDate,
        },
      };

      // Get revenue metrics from transactions
      const [revenueMetrics, addTransactions, deductTransactions, users] = await Promise.all([
        this.prisma.transaction.aggregate({
          where: {
            ...whereConditions,
            type: 'ADD',
          },
          _count: { id: true },
          _sum: { amount: true },
          _avg: { amount: true },
        }),
        this.prisma.transaction.findMany({
          where: {
            ...whereConditions,
            type: 'ADD',
          },
          select: {
            createdAt: true,
            amount: true,
            creditAccount: {
              select: {
                userId: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.transaction.aggregate({
          where: {
            ...whereConditions,
            type: 'DEDUCT',
          },
          _sum: { amount: true },
        }),
        this.prisma.user.aggregate({
          where: {
            createdAt: {
              gte: dateRange.startDate,
              lte: dateRange.endDate,
            },
          },
          _count: { id: true },
        }),
      ]);

      // Calculate metrics
      const totalRevenue = revenueMetrics._sum.amount || 0;
      const totalTransactions = revenueMetrics._count.id || 0;
      const totalCreditsUsed = Math.abs(deductTransactions._sum.amount || 0);

      const metrics = {
        totalRevenue,
        totalTransactions,
        averageTransactionValue: revenueMetrics._avg.amount || 0,
        totalCreditsIssued: totalRevenue, // Credits issued = revenue
        totalCreditsUsed,
        creditUtilizationRate: totalRevenue > 0 ? (totalCreditsUsed / totalRevenue) * 100 : 0,
      };

      // Generate trends
      const trends = this.generateRevenueTrends(addTransactions, timeframe, users._count.id || 0);

      // Calculate top customers
      const topCustomers = this.calculateTopCustomers(addTransactions);

      const analytics: RevenueAnalytics = {
        timeframe,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        metrics,
        trends,
        topCustomers,
      };

      logger.info('Revenue analytics generated successfully', {
        totalRevenue,
        totalTransactions,
      });

      return analytics;
    } catch (error) {
      logger.error('Failed to generate revenue analytics', {
        timeframe: options.timeframe,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Generate billing forecast for a user
   */
  async getBillingForecast(userId: number, options: {
    forecastPeriod: BillingForecast['forecastPeriod'];
    basedOnDays?: number;
  }): Promise<BillingForecast> {
    try {
      const { forecastPeriod, basedOnDays = 30 } = options;

      logger.info('Generating billing forecast', {
        userId,
        forecastPeriod,
        basedOnDays,
      });

      // Get historical usage data
      const lookbackDate = new Date();
      lookbackDate.setDate(lookbackDate.getDate() - basedOnDays);

      const historicalRequests = await this.prisma.aIRequest.findMany({
        where: {
          userId,
          createdAt: {
            gte: lookbackDate,
          },
        },
        select: {
          createdAt: true,
          tokensUsed: true,
          cost: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      if (historicalRequests.length === 0) {
        throw new Error('Insufficient historical data for forecast');
      }

      // Calculate current usage patterns
      const totalCost = historicalRequests.reduce((sum, req) => sum + req.cost, 0);
      const totalTokens = historicalRequests.reduce((sum, req) => sum + req.tokensUsed, 0);
      const totalRequests = historicalRequests.length;

      const currentUsage = {
        dailyAverage: totalCost / basedOnDays,
        weeklyAverage: totalCost / (basedOnDays / 7),
        monthlyAverage: totalCost / (basedOnDays / 30),
      };

      // Generate forecast
      const forecastDays = this.getForecastDays(forecastPeriod);
      const estimatedCost = currentUsage.dailyAverage * forecastDays;
      const projectedRequests = Math.round((totalRequests / basedOnDays) * forecastDays);
      const projectedTokens = Math.round((totalTokens / basedOnDays) * forecastDays);

      // Calculate confidence level based on data consistency
      const confidenceLevel = this.calculateConfidenceLevel(historicalRequests, basedOnDays);

      // Generate recommendations
      const recommendations = await this.generateRecommendations(userId, currentUsage, historicalRequests);

      const forecast: BillingForecast = {
        userId,
        forecastPeriod,
        basedOnDays,
        currentUsage,
        forecast: {
          estimatedCost,
          confidenceLevel,
          projectedRequests,
          projectedTokens,
        },
        recommendations,
      };

      logger.info('Billing forecast generated successfully', {
        userId,
        estimatedCost,
        confidenceLevel,
      });

      return forecast;
    } catch (error) {
      logger.error('Failed to generate billing forecast', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get cost optimization insights
   */
  async getCostOptimizationInsights(userId: number): Promise<{
    potentialSavings: number;
    insights: Array<{
      category: string;
      description: string;
      impact: 'high' | 'medium' | 'low';
      savings: number;
      actionRequired: string;
    }>;
  }> {
    try {
      logger.info('Generating cost optimization insights', { userId });

      // Get recent usage data
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentRequests = await this.prisma.aIRequest.findMany({
        where: {
          userId,
          createdAt: { gte: thirtyDaysAgo },
        },
        include: {
          agent: true,
        },
      });

      if (recentRequests.length === 0) {
        return { potentialSavings: 0, insights: [] };
      }

      const insights: any[] = [];
      let totalPotentialSavings = 0;

      // Analyze expensive agents usage
      const agentUsage = new Map();
      recentRequests.forEach(req => {
        const agentId = req.agentId;
        const current = agentUsage.get(agentId) || { requests: 0, cost: 0, agent: req.agent };
        current.requests++;
        current.cost += req.cost;
        agentUsage.set(agentId, current);
      });

      // Find opportunities to switch to cheaper agents
      const expensiveAgents = Array.from(agentUsage.values())
        .filter(usage => usage.cost / usage.requests > 0.05) // More than 5 cents per request
        .sort((a, b) => b.cost - a.cost);

      if (expensiveAgents.length > 0) {
        const potentialSavings = expensiveAgents[0].cost * 0.3; // Assume 30% savings
        totalPotentialSavings += potentialSavings;
        
        insights.push({
          category: 'Agent Optimization',
          description: `Consider using more cost-effective AI agents for routine tasks. Your most expensive agent (${expensiveAgents[0].agent.name}) accounts for $${expensiveAgents[0].cost.toFixed(2)} in recent usage.`,
          impact: 'high' as const,
          savings: potentialSavings,
          actionRequired: 'Review agent selection strategies',
        });
      }

      // Analyze usage patterns
      const hourlyUsage = new Array(24).fill(0);
      recentRequests.forEach(req => {
        const hour = req.createdAt.getHours();
        hourlyUsage[hour] += req.cost;
      });

      const peakHourCost = Math.max(...hourlyUsage);
      const offPeakSavings = peakHourCost * 0.1; // 10% savings in off-peak
      
      if (peakHourCost > 1) { // If significant peak usage
        totalPotentialSavings += offPeakSavings;
        
        insights.push({
          category: 'Usage Timing',
          description: 'Consider scheduling non-urgent AI requests during off-peak hours (typically 2-6 AM) for potential cost savings.',
          impact: 'medium' as const,
          savings: offPeakSavings,
          actionRequired: 'Implement request scheduling',
        });
      }

      // Check for redundant requests
      const requestPatterns = new Map();
      recentRequests.forEach(req => {
        // Simple pattern detection based on first 100 characters of request
        const pattern = JSON.stringify(req.metadata).substring(0, 100);
        const current = requestPatterns.get(pattern) || { count: 0, cost: 0 };
        current.count++;
        current.cost += req.cost;
        requestPatterns.set(pattern, current);
      });

      const redundantCost = Array.from(requestPatterns.values())
        .filter(p => p.count > 5) // More than 5 similar requests
        .reduce((sum, p) => sum + (p.cost * 0.2), 0); // 20% could be saved with caching

      if (redundantCost > 0.5) {
        totalPotentialSavings += redundantCost;
        
        insights.push({
          category: 'Request Optimization',
          description: 'Implement caching for frequently repeated requests to reduce AI usage costs.',
          impact: 'medium' as const,
          savings: redundantCost,
          actionRequired: 'Set up request caching',
        });
      }

      logger.info('Cost optimization insights generated', {
        userId,
        totalPotentialSavings,
        insightsCount: insights.length,
      });

      return {
        potentialSavings: totalPotentialSavings,
        insights,
      };
    } catch (error) {
      logger.error('Failed to generate cost optimization insights', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  private calculateDateRange(
    timeframe: string,
    startDate?: Date,
    endDate?: Date
  ): { startDate: Date; endDate: Date } {
    if (startDate && endDate) {
      return { startDate, endDate };
    }

    const now = new Date();
    const end = endDate || now;
    let start: Date;

    switch (timeframe) {
      case 'day':
        start = new Date(end);
        start.setHours(0, 0, 0, 0);
        break;
      case 'week':
        start = new Date(end);
        start.setDate(end.getDate() - 7);
        break;
      case 'month':
        start = new Date(end);
        start.setMonth(end.getMonth() - 1);
        break;
      case 'year':
        start = new Date(end);
        start.setFullYear(end.getFullYear() - 1);
        break;
      default:
        start = new Date(end);
        start.setDate(end.getDate() - 7);
    }

    return { startDate: startDate || start, endDate: end };
  }

  private generateTrends(requests: any[], timeframe: string): UsageAnalytics['trends'] {
    const trendsMap = new Map<string, { requests: number; tokens: number; cost: number }>();

    requests.forEach(req => {
      let key: string;
      
      switch (timeframe) {
        case 'day':
          key = req.createdAt.toISOString().substring(0, 13) + ':00:00.000Z'; // Hour precision
          break;
        case 'week':
        case 'month':
          key = req.createdAt.toISOString().split('T')[0]; // Day precision
          break;
        case 'year':
          key = req.createdAt.toISOString().substring(0, 7); // Month precision
          break;
        default:
          key = req.createdAt.toISOString().split('T')[0];
      }

      const current = trendsMap.get(key) || { requests: 0, tokens: 0, cost: 0 };
      current.requests++;
      current.tokens += req.tokensUsed;
      current.cost += req.cost;
      trendsMap.set(key, current);
    });

    return Array.from(trendsMap.entries())
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private calculateTopAgents(requests: any[], agentMap: Map<string, string>, totalCost: number): UsageAnalytics['topAgents'] {
    const agentStats = new Map<string, { requests: number; tokens: number; cost: number }>();

    requests.forEach(req => {
      const current = agentStats.get(req.agentId) || { requests: 0, tokens: 0, cost: 0 };
      current.requests++;
      current.tokens += req.tokensUsed;
      current.cost += req.cost;
      agentStats.set(req.agentId, current);
    });

    return Array.from(agentStats.entries())
      .map(([agentId, stats]) => ({
        agentId,
        agentName: agentMap.get(agentId) || 'Unknown',
        requests: stats.requests,
        tokens: stats.tokens,
        cost: stats.cost,
        percentage: totalCost > 0 ? (stats.cost / totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);
  }

  private generateCostBreakdown(requests: any[], agentMap: Map<string, string>): UsageAnalytics['costBreakdown'] {
    // By agent
    const agentCosts = new Map<string, number>();
    const hourCosts = new Array(24).fill(0);
    const dayCosts = new Array(7).fill(0);

    let totalCost = 0;

    requests.forEach(req => {
      totalCost += req.cost;
      
      // By agent
      const currentAgentCost = agentCosts.get(req.agentId) || 0;
      agentCosts.set(req.agentId, currentAgentCost + req.cost);
      
      // By time of day
      const hour = req.createdAt.getHours();
      hourCosts[hour] += req.cost;
      
      // By day of week
      const dayOfWeek = req.createdAt.getDay();
      dayCosts[dayOfWeek] += req.cost;
    });

    const byAgent = Array.from(agentCosts.entries())
      .map(([agentId, cost]) => ({
        agentId,
        agentName: agentMap.get(agentId) || 'Unknown',
        cost,
        percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost);

    const byTimeOfDay = hourCosts.map((cost, hour) => ({
      hour,
      cost,
      requests: requests.filter(req => req.createdAt.getHours() === hour).length,
    }));

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const byDayOfWeek = dayCosts.map((cost, dayOfWeek) => ({
      dayOfWeek,
      dayName: dayNames[dayOfWeek],
      cost,
      requests: requests.filter(req => req.createdAt.getDay() === dayOfWeek).length,
    }));

    return {
      byAgent,
      byTimeOfDay,
      byDayOfWeek,
    };
  }

  private generateRevenueTrends(transactions: any[], timeframe: string, newCustomersCount: number): RevenueAnalytics['trends'] {
    const trendsMap = new Map<string, { revenue: number; transactions: number }>();

    transactions.forEach(txn => {
      let key: string;
      
      switch (timeframe) {
        case 'day':
          key = txn.createdAt.toISOString().substring(0, 13) + ':00:00.000Z';
          break;
        case 'week':
        case 'month':
          key = txn.createdAt.toISOString().split('T')[0];
          break;
        case 'year':
          key = txn.createdAt.toISOString().substring(0, 7);
          break;
        default:
          key = txn.createdAt.toISOString().split('T')[0];
      }

      const current = trendsMap.get(key) || { revenue: 0, transactions: 0 };
      current.revenue += txn.amount;
      current.transactions++;
      trendsMap.set(key, current);
    });

    const trends = Array.from(trendsMap.entries())
      .map(([date, stats]) => ({ 
        date, 
        ...stats,
        newCustomers: Math.round(newCustomersCount / trendsMap.size) // Distribute evenly
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return trends;
  }

  private calculateTopCustomers(transactions: any[]): RevenueAnalytics['topCustomers'] {
    const customerStats = new Map<number, { 
      userName: string; 
      totalSpent: number; 
      totalTransactions: number; 
    }>();

    transactions.forEach(txn => {
      const userId = txn.creditAccount.userId;
      const user = txn.creditAccount.user;
      const userName = `${user.firstName} ${user.lastName}`.trim() || 'Unknown';
      
      const current = customerStats.get(userId) || { 
        userName, 
        totalSpent: 0, 
        totalTransactions: 0 
      };
      current.totalSpent += txn.amount;
      current.totalTransactions++;
      customerStats.set(userId, current);
    });

    return Array.from(customerStats.entries())
      .map(([userId, stats]) => ({
        userId,
        userName: stats.userName,
        totalSpent: stats.totalSpent,
        totalRequests: stats.totalTransactions, // Using transactions as proxy
        averageSpendPerRequest: stats.totalTransactions > 0 ? stats.totalSpent / stats.totalTransactions : 0,
      }))
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10);
  }

  private getForecastDays(period: BillingForecast['forecastPeriod']): number {
    switch (period) {
      case 'week': return 7;
      case 'month': return 30;
      case 'quarter': return 90;
      default: return 30;
    }
  }

  private calculateConfidenceLevel(requests: any[], basedOnDays: number): number {
    if (requests.length < 10) return 30; // Low confidence with little data
    
    // Calculate variance in daily spending
    const dailyCosts = new Array(basedOnDays).fill(0);
    requests.forEach(req => {
      const dayIndex = Math.floor((new Date().getTime() - req.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      if (dayIndex >= 0 && dayIndex < basedOnDays) {
        dailyCosts[dayIndex] += req.cost;
      }
    });

    const avgDailyCost = dailyCosts.reduce((sum, cost) => sum + cost, 0) / basedOnDays;
    const variance = dailyCosts.reduce((sum, cost) => sum + Math.pow(cost - avgDailyCost, 2), 0) / basedOnDays;
    const coefficientOfVariation = avgDailyCost > 0 ? Math.sqrt(variance) / avgDailyCost : 1;

    // Lower coefficient of variation = higher confidence
    return Math.max(50, Math.min(95, 95 - (coefficientOfVariation * 100)));
  }

  private async generateRecommendations(
    userId: number,
    currentUsage: BillingForecast['currentUsage'],
    historicalRequests: any[]
  ): Promise<BillingForecast['recommendations']> {
    const recommendations: BillingForecast['recommendations'] = [];

    // Check if user has budget limits
    const budgetLimits = await this.prisma.budgetLimit.findMany({
      where: { userId, isActive: true },
    });

    if (budgetLimits.length === 0) {
      recommendations.push({
        type: 'budget_alert',
        title: 'Set Budget Limits',
        description: 'Consider setting daily, weekly, or monthly budget limits to better control your AI usage costs.',
      });
    }

    // Check for high usage variance
    const costVariance = this.calculateCostVariance(historicalRequests);
    if (costVariance > 0.5) {
      recommendations.push({
        type: 'usage_pattern',
        title: 'Optimize Usage Patterns',
        description: 'Your AI usage varies significantly. Consider scheduling routine tasks to optimize costs.',
        potentialSavings: currentUsage.monthlyAverage * 0.15,
      });
    }

    // Check for expensive agent usage
    const expensiveUsage = historicalRequests
      .filter(req => req.cost > 0.1) // More than 10 cents per request
      .reduce((sum, req) => sum + req.cost, 0);

    if (expensiveUsage > currentUsage.monthlyAverage * 0.3) {
      recommendations.push({
        type: 'cost_optimization',
        title: 'Review AI Agent Selection',
        description: 'Consider using more cost-effective AI agents for routine tasks.',
        potentialSavings: expensiveUsage * 0.25,
      });
    }

    return recommendations;
  }

  private calculateCostVariance(requests: any[]): number {
    const dailyCosts = new Map<string, number>();
    
    requests.forEach(req => {
      const date = req.createdAt.toISOString().split('T')[0];
      const current = dailyCosts.get(date) || 0;
      dailyCosts.set(date, current + req.cost);
    });

    const costs = Array.from(dailyCosts.values());
    const avg = costs.reduce((sum, cost) => sum + cost, 0) / costs.length;
    const variance = costs.reduce((sum, cost) => sum + Math.pow(cost - avg, 2), 0) / costs.length;
    
    return avg > 0 ? Math.sqrt(variance) / avg : 0;
  }
}

export default AnalyticsService;
