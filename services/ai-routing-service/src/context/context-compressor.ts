
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationContext, ContextMessage } from './context-manager.service';

export interface CompressionStrategy {
  name: string;
  ratio: number;
  quality: number;
  latency: number;
}

export interface CompressionResult {
  originalTokens: number;
  compressedTokens: number;
  ratio: number;
  strategy: string;
  quality: number;
}

@Injectable()
export class ContextCompressionService {
  private readonly logger = new Logger(ContextCompressionService.name);
  
  private readonly strategies: Map<string, CompressionStrategy> = new Map([
    ['semantic', { name: 'semantic', ratio: 0.3, quality: 0.85, latency: 200 }],
    ['extractive', { name: 'extractive', ratio: 0.5, quality: 0.7, latency: 50 }],
    ['lossy', { name: 'lossy', ratio: 0.2, quality: 0.5, latency: 20 }],
    ['smart', { name: 'smart', ratio: 0.4, quality: 0.8, latency: 100 }],
  ]);

  constructor(private readonly configService: ConfigService) {}

  async compressContext(context: ConversationContext): Promise<ConversationContext | null> {
    try {
      const startTime = Date.now();
      const originalTokens = context.tokenCount;

      // Choose compression strategy based on context characteristics
      const strategy = this.selectCompressionStrategy(context);
      
      this.logger.log(`Compressing context ${context.id} using ${strategy.name} strategy`);

      let compressedMessages: ContextMessage[];
      let compressionResult: CompressionResult;

      switch (strategy.name) {
        case 'semantic':
          compressedMessages = await this.semanticCompression(context.messages);
          break;
        case 'extractive':
          compressedMessages = await this.extractiveCompression(context.messages);
          break;
        case 'lossy':
          compressedMessages = await this.lossyCompression(context.messages);
          break;
        case 'smart':
          compressedMessages = await this.smartCompression(context.messages);
          break;
        default:
          compressedMessages = context.messages;
      }

      const compressedTokens = compressedMessages.reduce(
        (sum, msg) => sum + msg.tokenCount, 0
      );

      compressionResult = {
        originalTokens,
        compressedTokens,
        ratio: 1 - (compressedTokens / originalTokens),
        strategy: strategy.name,
        quality: strategy.quality,
      };

      const compressedContext: ConversationContext = {
        ...context,
        messages: compressedMessages,
        tokenCount: compressedTokens,
        compressionLevel: context.compressionLevel + 1,
        updatedAt: new Date(),
      };

      const duration = Date.now() - startTime;
      
      this.logger.log(
        `Context compression completed: ${originalTokens} → ${compressedTokens} tokens ` +
        `(${(compressionResult.ratio * 100).toFixed(1)}% reduction) in ${duration}ms`
      );

      return compressedContext;
    } catch (error) {
      this.logger.error(`Failed to compress context ${context.id}`, error);
      return null;
    }
  }

  private selectCompressionStrategy(context: ConversationContext): CompressionStrategy {
    // Smart strategy selection based on context characteristics
    const messageCount = context.messages.length;
    const avgTokensPerMessage = context.tokenCount / messageCount;
    const complexity = context.metadata.complexity;
    const priority = context.priority;

    // High priority contexts get better quality compression
    if (priority === 'critical' || priority === 'high') {
      return this.strategies.get('semantic')!;
    }

    // Long conversations with simple messages can use lossy compression
    if (messageCount > 100 && avgTokensPerMessage < 50 && complexity < 0.5) {
      return this.strategies.get('lossy')!;
    }

    // Medium complexity contexts use smart compression
    if (complexity >= 0.5 && complexity < 0.8) {
      return this.strategies.get('smart')!;
    }

    // Default to extractive for most cases
    return this.strategies.get('extractive')!;
  }

  private async semanticCompression(messages: ContextMessage[]): Promise<ContextMessage[]> {
    // Semantic compression: Keep messages with high semantic importance
    const systemMessages = messages.filter(msg => msg.role === 'system');
    const userMessages = messages.filter(msg => msg.role === 'user');
    const assistantMessages = messages.filter(msg => msg.role === 'assistant');

    // Always keep system messages
    const compressedMessages = [...systemMessages];

    // Keep the most semantically important user-assistant pairs
    const conversationPairs = this.extractConversationPairs(userMessages, assistantMessages);
    const importantPairs = this.selectImportantPairs(conversationPairs, 0.3);

    compressedMessages.push(...importantPairs);

    return this.sortMessagesByTimestamp(compressedMessages);
  }

  private async extractiveCompression(messages: ContextMessage[]): Promise<ContextMessage[]> {
    // Extractive compression: Keep a percentage of messages based on importance scores
    const systemMessages = messages.filter(msg => msg.role === 'system');
    const otherMessages = messages.filter(msg => msg.role !== 'system');

    // Score messages by importance
    const scoredMessages = otherMessages.map(msg => ({
      message: msg,
      score: this.calculateMessageImportance(msg, messages),
    }));

    // Sort by score and keep top 50%
    scoredMessages.sort((a, b) => b.score - a.score);
    const keepCount = Math.max(1, Math.floor(scoredMessages.length * 0.5));
    const selectedMessages = scoredMessages.slice(0, keepCount).map(item => item.message);

    return [...systemMessages, ...this.sortMessagesByTimestamp(selectedMessages)];
  }

  private async lossyCompression(messages: ContextMessage[]): Promise<ContextMessage[]> {
    // Lossy compression: Keep only the most recent and system messages
    const systemMessages = messages.filter(msg => msg.role === 'system');
    const recentMessages = messages
      .filter(msg => msg.role !== 'system')
      .slice(-10); // Keep last 10 non-system messages

    return [...systemMessages, ...recentMessages];
  }

  private async smartCompression(messages: ContextMessage[]): Promise<ContextMessage[]> {
    // Smart compression: Hybrid approach combining multiple strategies
    const systemMessages = messages.filter(msg => msg.role === 'system');
    const otherMessages = messages.filter(msg => msg.role !== 'system');

    // Keep system messages
    let compressedMessages = [...systemMessages];

    // Keep recent messages (last 20%)
    const recentCount = Math.max(1, Math.floor(otherMessages.length * 0.2));
    const recentMessages = otherMessages.slice(-recentCount);
    compressedMessages.push(...recentMessages);

    // Keep important older messages
    const olderMessages = otherMessages.slice(0, -recentCount);
    if (olderMessages.length > 0) {
      const importantOlderMessages = this.selectImportantMessages(olderMessages, 0.3);
      compressedMessages.push(...importantOlderMessages);
    }

    return this.sortMessagesByTimestamp(compressedMessages);
  }

  private extractConversationPairs(
    userMessages: ContextMessage[],
    assistantMessages: ContextMessage[]
  ): ContextMessage[] {
    const pairs: ContextMessage[] = [];
    const allMessages = [...userMessages, ...assistantMessages]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    for (let i = 0; i < allMessages.length - 1; i++) {
      const current = allMessages[i];
      const next = allMessages[i + 1];

      if (current.role === 'user' && next.role === 'assistant') {
        pairs.push(current, next);
      }
    }

    return pairs;
  }

  private selectImportantPairs(pairs: ContextMessage[], ratio: number): ContextMessage[] {
    // Score conversation pairs and select the most important ones
    const pairGroups: ContextMessage[][] = [];
    for (let i = 0; i < pairs.length; i += 2) {
      if (i + 1 < pairs.length) {
        pairGroups.push([pairs[i], pairs[i + 1]]);
      }
    }

    const scoredPairs = pairGroups.map(pair => ({
      pair,
      score: (this.calculateMessageImportance(pair[0], pairs) + 
              this.calculateMessageImportance(pair[1], pairs)) / 2,
    }));

    scoredPairs.sort((a, b) => b.score - a.score);
    const keepCount = Math.max(1, Math.floor(scoredPairs.length * ratio));
    
    return scoredPairs.slice(0, keepCount).flatMap(item => item.pair);
  }

  private selectImportantMessages(messages: ContextMessage[], ratio: number): ContextMessage[] {
    const scoredMessages = messages.map(msg => ({
      message: msg,
      score: this.calculateMessageImportance(msg, messages),
    }));

    scoredMessages.sort((a, b) => b.score - a.score);
    const keepCount = Math.max(1, Math.floor(messages.length * ratio));
    
    return scoredMessages.slice(0, keepCount).map(item => item.message);
  }

  private calculateMessageImportance(message: ContextMessage, allMessages: ContextMessage[]): number {
    let score = 0;

    // Token count factor (longer messages might be more important)
    score += Math.min(message.tokenCount / 100, 1) * 0.2;

    // Role factor
    if (message.role === 'system') score += 0.8;
    else if (message.role === 'user') score += 0.6;
    else if (message.role === 'assistant') score += 0.5;

    // Recency factor (more recent messages are more important)
    const messageAge = Date.now() - new Date(message.timestamp).getTime();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const recencyScore = Math.max(0, 1 - (messageAge / maxAge));
    score += recencyScore * 0.3;

    // Content quality indicators
    const content = message.content.toLowerCase();
    
    // Questions and important keywords
    if (content.includes('?')) score += 0.1;
    if (content.includes('important') || content.includes('critical')) score += 0.2;
    if (content.includes('error') || content.includes('problem')) score += 0.15;
    if (content.includes('solution') || content.includes('answer')) score += 0.15;

    // Length penalty for very short messages
    if (message.content.length < 20) score *= 0.5;

    return Math.min(score, 1);
  }

  private sortMessagesByTimestamp(messages: ContextMessage[]): ContextMessage[] {
    return messages.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  async getCompressionStats(): Promise<{
    totalCompressions: number;
    averageRatio: number;
    strategies: Record<string, { count: number; avgRatio: number }>;
  }> {
    // In a real implementation, these stats would be stored and tracked
    return {
      totalCompressions: 0,
      averageRatio: 0.4,
      strategies: {
        semantic: { count: 0, avgRatio: 0.3 },
        extractive: { count: 0, avgRatio: 0.5 },
        lossy: { count: 0, avgRatio: 0.2 },
        smart: { count: 0, avgRatio: 0.4 },
      },
    };
  }
}
