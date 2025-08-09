
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Redis } from 'ioredis';

export interface ContextAnalyticsData {
  contextId: string;
  userId: string;
  agentId?: string;
  sessionId: string;
  eventType: string;
  eventData: Record<string, any>;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface ContextMetrics {
  totalContexts: number;
  averageContextLength: number;
  averageSessionDuration: number;
  compressionSavings: number;
  topTopics: Array<{ topic: string; count: number }>;
  userEngagementScore: number;
  contextRetentionRate: number;
  shareActivity: {
    totalShares: number;
    averageShareDuration: number;
    mostSharedTopics: Array<{ topic: string; count: number }>;
  };
}

export interface UserContextInsights {
  userId: string;
  totalContexts: number;
  averageContextLength: number;
  preferredTopics: string[];
  engagementLevel: 'low' | 'medium' | 'high';
  contextPatterns: {
    peakHours: number[];
    averageSessionGap: number;
    contextTypes: Record<string, number>;
  };
  sharingBehavior: {
    sharesGiven: number;
    sharesReceived: number;
    collaborationScore: number;
  };
}

@Injectable()
export class ContextAnalyticsService {
  private readonly logger = new Logger(ContextAnalyticsService.name);
  private readonly redisClient: Redis;
  private readonly analyticsBuffer: Map<string, ContextAnalyticsData[]>;
  private readonly bufferFlushInterval: number;
  private readonly maxBufferSize: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.redisClient = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      keyPrefix: 'ai_analytics:',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
    });

    this.analyticsBuffer = new Map();
    this.bufferFlushInterval = this.configService.get('ANALYTICS_FLUSH_INTERVAL', 30000); // 30s
    this.maxBufferSize = this.configService.get('ANALYTICS_BUFFER_SIZE', 1000);

    this.setupBufferFlushing();
  }

  @OnEvent('context.created')
  async handleContextCreated(event: any): Promise<void> {
    await this.recordEvent({
      contextId: event.contextId,
      userId: event.userId,
      agentId: event.agentId,
      sessionId: event.sessionId || 'unknown',
      eventType: 'context_created',
      eventData: {
        timestamp: event.timestamp,
      },
      timestamp: new Date(),
    });
  }

  @OnEvent('context.message_added')
  async handleMessageAdded(event: any): Promise<void> {
    await this.recordEvent({
      contextId: event.contextId,
      userId: 'unknown', // Would need to be passed in event
      sessionId: 'unknown',
      eventType: 'message_added',
      eventData: {
        messageId: event.messageId,
        tokenCount: event.tokenCount,
        totalTokens: event.totalTokens,
      },
      timestamp: new Date(),
    });
  }

  @OnEvent('context.shared')
  async handleContextShared(event: any): Promise<void> {
    await this.recordEvent({
      contextId: event.contextId,
      userId: event.fromUserId,
      sessionId: 'unknown',
      eventType: 'context_shared',
      eventData: {
        toUserId: event.toUserId,
        permissions: event.permissions,
      },
      timestamp: new Date(),
    });
  }

  @OnEvent('context.summarized')
  async handleContextSummarized(event: any): Promise<void> {
    await this.recordEvent({
      contextId: event.contextId,
      userId: 'unknown',
      sessionId: 'unknown',
      eventType: 'context_summarized',
      eventData: {
        summaryLength: event.summaryLength,
        messageCount: event.messageCount,
      },
      timestamp: new Date(),
    });
  }

  @OnEvent('context.deleted')
  async handleContextDeleted(event: any): Promise<void> {
    await this.recordEvent({
      contextId: event.contextId,
      userId: 'unknown',
      sessionId: 'unknown',
      eventType: 'context_deleted',
      eventData: {
        timestamp: event.timestamp,
      },
      timestamp: new Date(),
    });
  }

  async recordEvent(analyticsData: ContextAnalyticsData): Promise<void> {
    try {
      const key = `${analyticsData.userId}_${Date.now()}`;
      
      if (!this.analyticsBuffer.has(analyticsData.userId)) {
        this.analyticsBuffer.set(analyticsData.userId, []);
      }

      const userBuffer = this.analyticsBuffer.get(analyticsData.userId)!;
      userBuffer.push(analyticsData);

      // Flush if buffer is full
      if (userBuffer.length >= this.maxBufferSize) {
        await this.flushUserBuffer(analyticsData.userId);
      }

      this.logger.debug(`Recorded analytics event: ${analyticsData.eventType} for context ${analyticsData.contextId}`);
    } catch (error) {
      this.logger.error('Failed to record analytics event', error);
    }
  }

  async getContextMetrics(
    startDate?: Date,
    endDate?: Date,
    userId?: string
  ): Promise<ContextMetrics> {
    try {
      const metrics = await this.calculateMetrics(startDate, endDate, userId);
      
      this.logger.debug(`Generated context metrics for period ${startDate} - ${endDate}`);
      return metrics;
    } catch (error) {
      this.logger.error('Failed to get context metrics', error);
      return this.getDefaultMetrics();
    }
  }

  async getUserInsights(userId: string, daysPeriod = 30): Promise<UserContextInsights> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - daysPeriod);

      const events = await this.getUserEvents(userId, startDate, endDate);
      const insights = await this.analyzeUserEvents(userId, events);

      this.logger.debug(`Generated user insights for ${userId}`);
      return insights;
    } catch (error) {
      this.logger.error(`Failed to get user insights for ${userId}`, error);
      return this.getDefaultUserInsights(userId);
    }
  }

  async getTopicAnalytics(topic: string, daysPeriod = 7): Promise<{
    totalContexts: number;
    uniqueUsers: number;
    averageEngagement: number;
    trendDirection: 'up' | 'down' | 'stable';
    relatedTopics: string[];
  }> {
    try {
      // This would query analytics data for the specific topic
      // For now, returning placeholder data
      return {
        totalContexts: 0,
        uniqueUsers: 0,
        averageEngagement: 0,
        trendDirection: 'stable',
        relatedTopics: [],
      };
    } catch (error) {
      this.logger.error(`Failed to get topic analytics for ${topic}`, error);
      return {
        totalContexts: 0,
        uniqueUsers: 0,
        averageEngagement: 0,
        trendDirection: 'stable',
        relatedTopics: [],
      };
    }
  }

  async getEngagementTrends(
    daysPeriod = 30
  ): Promise<Array<{
    date: string;
    contextCount: number;
    messageCount: number;
    userCount: number;
    shareCount: number;
  }>> {
    try {
      const trends: Array<{
        date: string;
        contextCount: number;
        messageCount: number;
        userCount: number;
        shareCount: number;
      }> = [];

      // Generate trend data for the past period
      for (let i = daysPeriod - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        const dayMetrics = await this.getDayMetrics(date);
        trends.push({
          date: dateStr,
          ...dayMetrics,
        });
      }

      return trends;
    } catch (error) {
      this.logger.error('Failed to get engagement trends', error);
      return [];
    }
  }

  async generateInsightReport(userId?: string): Promise<{
    summary: string;
    keyFindings: string[];
    recommendations: string[];
    metrics: ContextMetrics;
  }> {
    try {
      const metrics = await this.getContextMetrics(undefined, undefined, userId);
      
      const summary = this.generateSummaryText(metrics);
      const keyFindings = this.extractKeyFindings(metrics);
      const recommendations = this.generateRecommendations(metrics);

      return {
        summary,
        keyFindings,
        recommendations,
        metrics,
      };
    } catch (error) {
      this.logger.error('Failed to generate insight report', error);
      return {
        summary: 'Unable to generate report',
        keyFindings: [],
        recommendations: [],
        metrics: this.getDefaultMetrics(),
      };
    }
  }

  private async calculateMetrics(
    startDate?: Date,
    endDate?: Date,
    userId?: string
  ): Promise<ContextMetrics> {
    // This would perform complex analytics calculations
    // For now, returning placeholder data
    return {
      totalContexts: 0,
      averageContextLength: 0,
      averageSessionDuration: 0,
      compressionSavings: 0,
      topTopics: [],
      userEngagementScore: 0,
      contextRetentionRate: 0,
      shareActivity: {
        totalShares: 0,
        averageShareDuration: 0,
        mostSharedTopics: [],
      },
    };
  }

  private async getUserEvents(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ContextAnalyticsData[]> {
    try {
      const keys = await this.redisClient.keys(`user_events:${userId}:*`);
      const events: ContextAnalyticsData[] = [];

      for (const key of keys) {
        const eventData = await this.redisClient.get(key);
        if (eventData) {
          const event = JSON.parse(eventData) as ContextAnalyticsData;
          const eventTime = new Date(event.timestamp);
          
          if (eventTime >= startDate && eventTime <= endDate) {
            events.push(event);
          }
        }
      }

      return events.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    } catch (error) {
      this.logger.error(`Failed to get user events for ${userId}`, error);
      return [];
    }
  }

  private async analyzeUserEvents(
    userId: string,
    events: ContextAnalyticsData[]
  ): Promise<UserContextInsights> {
    const contextEvents = events.filter(e => e.eventType === 'context_created');
    const messageEvents = events.filter(e => e.eventType === 'message_added');
    const shareEvents = events.filter(e => e.eventType === 'context_shared');

    // Calculate engagement level
    const totalEvents = events.length;
    let engagementLevel: 'low' | 'medium' | 'high' = 'low';
    if (totalEvents > 100) engagementLevel = 'high';
    else if (totalEvents > 30) engagementLevel = 'medium';

    // Calculate peak hours
    const hourCounts = new Array(24).fill(0);
    events.forEach(event => {
      const hour = new Date(event.timestamp).getHours();
      hourCounts[hour]++;
    });
    const peakHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(item => item.hour);

    return {
      userId,
      totalContexts: contextEvents.length,
      averageContextLength: messageEvents.length > 0 ? 
        messageEvents.reduce((sum, e) => sum + (e.eventData.tokenCount || 0), 0) / messageEvents.length : 0,
      preferredTopics: [], // Would extract from event metadata
      engagementLevel,
      contextPatterns: {
        peakHours,
        averageSessionGap: 0, // Would calculate from timestamps
        contextTypes: {}, // Would extract from event metadata
      },
      sharingBehavior: {
        sharesGiven: shareEvents.length,
        sharesReceived: 0, // Would need to query shares received
        collaborationScore: shareEvents.length > 0 ? 0.7 : 0.3,
      },
    };
  }

  private async getDayMetrics(date: Date): Promise<{
    contextCount: number;
    messageCount: number;
    userCount: number;
    shareCount: number;
  }> {
    // This would query daily metrics from stored analytics
    // For now, returning placeholder data
    return {
      contextCount: Math.floor(Math.random() * 50),
      messageCount: Math.floor(Math.random() * 200),
      userCount: Math.floor(Math.random() * 20),
      shareCount: Math.floor(Math.random() * 10),
    };
  }

  private generateSummaryText(metrics: ContextMetrics): string {
    return `Context analytics show ${metrics.totalContexts} total conversations with ` +
           `an average length of ${metrics.averageContextLength.toFixed(1)} messages. ` +
           `User engagement score is ${(metrics.userEngagementScore * 100).toFixed(1)}%.`;
  }

  private extractKeyFindings(metrics: ContextMetrics): string[] {
    const findings: string[] = [];
    
    if (metrics.compressionSavings > 0.3) {
      findings.push(`Context compression is saving ${(metrics.compressionSavings * 100).toFixed(1)}% of storage`);
    }
    
    if (metrics.shareActivity.totalShares > 0) {
      findings.push(`${metrics.shareActivity.totalShares} contexts have been shared between users`);
    }
    
    if (metrics.topTopics.length > 0) {
      findings.push(`Most discussed topic: ${metrics.topTopics[0].topic} (${metrics.topTopics[0].count} discussions)`);
    }

    return findings;
  }

  private generateRecommendations(metrics: ContextMetrics): string[] {
    const recommendations: string[] = [];
    
    if (metrics.userEngagementScore < 0.5) {
      recommendations.push('Consider improving user engagement through better AI responses');
    }
    
    if (metrics.contextRetentionRate < 0.7) {
      recommendations.push('Users may benefit from better context persistence features');
    }
    
    if (metrics.shareActivity.totalShares < 10) {
      recommendations.push('Promote context sharing features to increase collaboration');
    }

    return recommendations;
  }

  private getDefaultMetrics(): ContextMetrics {
    return {
      totalContexts: 0,
      averageContextLength: 0,
      averageSessionDuration: 0,
      compressionSavings: 0,
      topTopics: [],
      userEngagementScore: 0,
      contextRetentionRate: 0,
      shareActivity: {
        totalShares: 0,
        averageShareDuration: 0,
        mostSharedTopics: [],
      },
    };
  }

  private getDefaultUserInsights(userId: string): UserContextInsights {
    return {
      userId,
      totalContexts: 0,
      averageContextLength: 0,
      preferredTopics: [],
      engagementLevel: 'low',
      contextPatterns: {
        peakHours: [],
        averageSessionGap: 0,
        contextTypes: {},
      },
      sharingBehavior: {
        sharesGiven: 0,
        sharesReceived: 0,
        collaborationScore: 0,
      },
    };
  }

  private setupBufferFlushing(): void {
    setInterval(async () => {
      try {
        await this.flushAllBuffers();
      } catch (error) {
        this.logger.error('Buffer flush failed', error);
      }
    }, this.bufferFlushInterval);
  }

  private async flushAllBuffers(): Promise<void> {
    for (const userId of this.analyticsBuffer.keys()) {
      await this.flushUserBuffer(userId);
    }
  }

  private async flushUserBuffer(userId: string): Promise<void> {
    try {
      const buffer = this.analyticsBuffer.get(userId);
      if (!buffer || buffer.length === 0) {
        return;
      }

      const batchKey = `user_events:${userId}:${Date.now()}`;
      await this.redisClient.setex(
        batchKey,
        7 * 24 * 60 * 60, // 7 days TTL
        JSON.stringify(buffer)
      );

      // Clear the buffer
      this.analyticsBuffer.set(userId, []);
      
      this.logger.debug(`Flushed ${buffer.length} analytics events for user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to flush buffer for user ${userId}`, error);
    }
  }
}
