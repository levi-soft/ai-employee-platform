
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { ContextCompressionService } from './context-compressor';
import { ContextSharingService } from './context-sharing.service';
import { ContextPersistenceService } from './context-persistence.service';

export interface ConversationContext {
  id: string;
  userId: string;
  agentId?: string;
  sessionId: string;
  messages: ContextMessage[];
  metadata: ContextMetadata;
  compressionLevel: number;
  sharedWith: string[];
  createdAt: Date;
  updatedAt: Date;
  lastAccessed: Date;
  tokenCount: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface ContextMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  timestamp: Date;
  tokenCount: number;
  compressed: boolean;
  metadata?: Record<string, any>;
}

export interface ContextMetadata {
  domain: string;
  language: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  topics: string[];
  entities: Array<{
    type: string;
    value: string;
    confidence: number;
  }>;
  complexity: number;
  userPreferences?: Record<string, any>;
}

@Injectable()
export class ContextManagerService {
  private readonly logger = new Logger(ContextManagerService.name);
  private readonly redisClient: Redis;
  private readonly maxContextSize: number;
  private readonly maxContextAge: number; // milliseconds
  private readonly compressionThreshold: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly contextCompressor: ContextCompressionService,
    private readonly contextSharing: ContextSharingService,
    private readonly contextPersistence: ContextPersistenceService,
  ) {
    this.redisClient = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      keyPrefix: 'ai_context:',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
    });

    this.maxContextSize = this.configService.get('MAX_CONTEXT_SIZE', 32000);
    this.maxContextAge = this.configService.get('MAX_CONTEXT_AGE', 24 * 60 * 60 * 1000); // 24 hours
    this.compressionThreshold = this.configService.get('COMPRESSION_THRESHOLD', 16000);

    this.setupCleanupInterval();
  }

  async createContext(
    userId: string,
    sessionId: string,
    agentId?: string,
    metadata?: Partial<ContextMetadata>
  ): Promise<ConversationContext> {
    try {
      const contextId = `${userId}_${sessionId}_${Date.now()}`;
      const context: ConversationContext = {
        id: contextId,
        userId,
        agentId,
        sessionId,
        messages: [],
        metadata: {
          domain: metadata?.domain || 'general',
          language: metadata?.language || 'en',
          sentiment: metadata?.sentiment,
          topics: metadata?.topics || [],
          entities: metadata?.entities || [],
          complexity: metadata?.complexity || 0,
          userPreferences: metadata?.userPreferences,
        },
        compressionLevel: 0,
        sharedWith: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        lastAccessed: new Date(),
        tokenCount: 0,
        priority: 'medium',
      };

      await this.storeContext(context);
      
      this.eventEmitter.emit('context.created', {
        contextId,
        userId,
        agentId,
        timestamp: new Date(),
      });

      this.logger.log(`Created context ${contextId} for user ${userId}`);
      return context;
    } catch (error) {
      this.logger.error('Failed to create context', error);
      throw new Error('Context creation failed');
    }
  }

  async getContext(contextId: string): Promise<ConversationContext | null> {
    try {
      const cached = await this.redisClient.get(contextId);
      if (cached) {
        const context = JSON.parse(cached) as ConversationContext;
        context.lastAccessed = new Date();
        await this.updateContext(context);
        return context;
      }

      // Fallback to persistent storage
      const context = await this.contextPersistence.loadContext(contextId);
      if (context) {
        await this.storeContext(context);
        context.lastAccessed = new Date();
      }
      
      return context;
    } catch (error) {
      this.logger.error(`Failed to get context ${contextId}`, error);
      return null;
    }
  }

  async addMessage(
    contextId: string,
    message: Omit<ContextMessage, 'id' | 'timestamp' | 'compressed'>
  ): Promise<ConversationContext | null> {
    try {
      const context = await this.getContext(contextId);
      if (!context) {
        this.logger.warn(`Context ${contextId} not found for message addition`);
        return null;
      }

      const newMessage: ContextMessage = {
        ...message,
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        compressed: false,
      };

      context.messages.push(newMessage);
      context.tokenCount += newMessage.tokenCount;
      context.updatedAt = new Date();
      context.lastAccessed = new Date();

      // Check if compression is needed
      if (context.tokenCount > this.compressionThreshold) {
        await this.compressContext(context);
      }

      // Check if context size exceeds limits
      if (context.tokenCount > this.maxContextSize) {
        await this.truncateContext(context);
      }

      await this.updateContext(context);
      
      this.eventEmitter.emit('context.message_added', {
        contextId,
        messageId: newMessage.id,
        tokenCount: newMessage.tokenCount,
        totalTokens: context.tokenCount,
      });

      return context;
    } catch (error) {
      this.logger.error(`Failed to add message to context ${contextId}`, error);
      return null;
    }
  }

  async shareContext(
    contextId: string,
    targetUserId: string,
    permissions: string[] = ['read']
  ): Promise<boolean> {
    try {
      const context = await this.getContext(contextId);
      if (!context) {
        return false;
      }

      const shared = await this.contextSharing.shareContext(
        contextId,
        context.userId,
        targetUserId,
        permissions
      );

      if (shared) {
        context.sharedWith.push(targetUserId);
        await this.updateContext(context);
        
        this.eventEmitter.emit('context.shared', {
          contextId,
          fromUserId: context.userId,
          toUserId: targetUserId,
          permissions,
        });
      }

      return shared;
    } catch (error) {
      this.logger.error(`Failed to share context ${contextId}`, error);
      return false;
    }
  }

  async getContextSummary(contextId: string): Promise<string | null> {
    try {
      const context = await this.getContext(contextId);
      if (!context || context.messages.length === 0) {
        return null;
      }

      // Generate summary using the most important messages
      const importantMessages = context.messages
        .filter(msg => msg.role !== 'system')
        .slice(-10); // Last 10 messages for recent context

      const summary = await this.generateSummary(importantMessages, context.metadata);
      
      this.eventEmitter.emit('context.summarized', {
        contextId,
        summaryLength: summary.length,
        messageCount: context.messages.length,
      });

      return summary;
    } catch (error) {
      this.logger.error(`Failed to generate context summary ${contextId}`, error);
      return null;
    }
  }

  async getUserContexts(userId: string, limit = 50): Promise<ConversationContext[]> {
    try {
      const contextKeys = await this.redisClient.keys(`*${userId}*`);
      const contexts: ConversationContext[] = [];

      for (const key of contextKeys.slice(0, limit)) {
        const contextData = await this.redisClient.get(key);
        if (contextData) {
          const context = JSON.parse(contextData) as ConversationContext;
          if (context.userId === userId) {
            contexts.push(context);
          }
        }
      }

      // Sort by last accessed time
      return contexts.sort((a, b) => 
        new Date(b.lastAccessed).getTime() - new Date(a.lastAccessed).getTime()
      );
    } catch (error) {
      this.logger.error(`Failed to get contexts for user ${userId}`, error);
      return [];
    }
  }

  async deleteContext(contextId: string): Promise<boolean> {
    try {
      await this.redisClient.del(contextId);
      await this.contextPersistence.deleteContext(contextId);
      
      this.eventEmitter.emit('context.deleted', {
        contextId,
        timestamp: new Date(),
      });

      this.logger.log(`Deleted context ${contextId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete context ${contextId}`, error);
      return false;
    }
  }

  private async storeContext(context: ConversationContext): Promise<void> {
    const ttl = Math.floor(this.maxContextAge / 1000);
    await this.redisClient.setex(
      context.id,
      ttl,
      JSON.stringify(context)
    );
  }

  private async updateContext(context: ConversationContext): Promise<void> {
    await this.storeContext(context);
    await this.contextPersistence.saveContext(context);
  }

  private async compressContext(context: ConversationContext): Promise<void> {
    try {
      const compressed = await this.contextCompressor.compressContext(context);
      if (compressed) {
        Object.assign(context, compressed);
        this.logger.log(`Compressed context ${context.id}, saved ${compressed.tokenCount} tokens`);
      }
    } catch (error) {
      this.logger.error(`Failed to compress context ${context.id}`, error);
    }
  }

  private async truncateContext(context: ConversationContext): Promise<void> {
    // Keep the most recent and important messages
    const systemMessages = context.messages.filter(msg => msg.role === 'system');
    const recentMessages = context.messages
      .filter(msg => msg.role !== 'system')
      .slice(-20); // Keep last 20 non-system messages

    context.messages = [...systemMessages, ...recentMessages];
    context.tokenCount = context.messages.reduce((sum, msg) => sum + msg.tokenCount, 0);
    context.compressionLevel++;
    
    this.logger.log(`Truncated context ${context.id} to ${context.tokenCount} tokens`);
  }

  private async generateSummary(
    messages: ContextMessage[],
    metadata: ContextMetadata
  ): Promise<string> {
    const conversationText = messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');

    // Simple extractive summarization - in production, use AI service
    const sentences = conversationText.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const summary = sentences.slice(0, 3).join('. ') + '.';
    
    return `Summary (${metadata.domain}): ${summary}`;
  }

  private setupCleanupInterval(): void {
    // Clean up old contexts every hour
    setInterval(async () => {
      try {
        await this.cleanupOldContexts();
      } catch (error) {
        this.logger.error('Context cleanup failed', error);
      }
    }, 60 * 60 * 1000);
  }

  private async cleanupOldContexts(): Promise<void> {
    try {
      const keys = await this.redisClient.keys('*');
      let cleaned = 0;

      for (const key of keys) {
        const contextData = await this.redisClient.get(key);
        if (contextData) {
          const context = JSON.parse(contextData) as ConversationContext;
          const age = Date.now() - new Date(context.lastAccessed).getTime();
          
          if (age > this.maxContextAge) {
            await this.deleteContext(context.id);
            cleaned++;
          }
        }
      }

      if (cleaned > 0) {
        this.logger.log(`Cleaned up ${cleaned} old contexts`);
      }
    } catch (error) {
      this.logger.error('Failed to cleanup old contexts', error);
    }
  }

  async getContextStats(): Promise<{
    totalContexts: number;
    totalTokens: number;
    averageContextSize: number;
    compressionRatio: number;
  }> {
    try {
      const keys = await this.redisClient.keys('*');
      let totalTokens = 0;
      let compressedTokens = 0;
      let totalContexts = keys.length;

      for (const key of keys) {
        const contextData = await this.redisClient.get(key);
        if (contextData) {
          const context = JSON.parse(contextData) as ConversationContext;
          totalTokens += context.tokenCount;
          if (context.compressionLevel > 0) {
            compressedTokens += context.tokenCount;
          }
        }
      }

      return {
        totalContexts,
        totalTokens,
        averageContextSize: totalContexts > 0 ? totalTokens / totalContexts : 0,
        compressionRatio: totalTokens > 0 ? compressedTokens / totalTokens : 0,
      };
    } catch (error) {
      this.logger.error('Failed to get context stats', error);
      return {
        totalContexts: 0,
        totalTokens: 0,
        averageContextSize: 0,
        compressionRatio: 0,
      };
    }
  }
}
