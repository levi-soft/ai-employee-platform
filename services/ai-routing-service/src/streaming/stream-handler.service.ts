
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { logger } from '@ai-platform/shared-utils';

export interface StreamRequest {
  id: string;
  userId: string;
  agentId: string;
  prompt: string;
  options?: StreamOptions;
}

export interface StreamOptions {
  maxTokens?: number;
  temperature?: number;
  enableProgress?: boolean;
  compressionLevel?: number;
  bufferSize?: number;
}

export interface StreamChunk {
  id: string;
  content: string;
  done: boolean;
  metadata?: {
    tokens?: number;
    cost?: number;
    progress?: number;
  };
}

export interface StreamMetrics {
  totalTokens: number;
  totalChunks: number;
  averageChunkSize: number;
  streamDuration: number;
  throughput: number;
}

export class StreamHandlerService extends EventEmitter {
  private activeStreams: Map<string, {
    stream: Readable;
    startTime: number;
    metrics: Partial<StreamMetrics>;
  }> = new Map();

  private compressionEnabled = true;
  private defaultBufferSize = 64 * 1024; // 64KB

  constructor() {
    super();
    this.setupCleanup();
  }

  /**
   * Create a new streaming response handler
   */
  async createStream(request: StreamRequest): Promise<Readable> {
    const streamId = request.id;
    const stream = new Readable({
      objectMode: false,
      highWaterMark: request.options?.bufferSize || this.defaultBufferSize,
      read() {} // No-op, we'll push data manually
    });

    // Initialize stream metrics
    const streamData = {
      stream,
      startTime: Date.now(),
      metrics: {
        totalTokens: 0,
        totalChunks: 0,
        averageChunkSize: 0,
        streamDuration: 0,
        throughput: 0
      }
    };

    this.activeStreams.set(streamId, streamData);

    // Set up stream event handlers
    this.setupStreamHandlers(streamId, stream, request);

    logger.info('Stream created', { 
      streamId, 
      userId: request.userId,
      agentId: request.agentId,
      bufferSize: request.options?.bufferSize || this.defaultBufferSize
    });

    return stream;
  }

  /**
   * Push data chunk to stream
   */
  async pushChunk(streamId: string, chunk: StreamChunk): Promise<void> {
    const streamData = this.activeStreams.get(streamId);
    if (!streamData) {
      throw new Error(`Stream ${streamId} not found`);
    }

    try {
      // Apply compression if enabled
      const processedChunk = await this.processChunk(chunk, streamId);
      
      // Update metrics
      this.updateStreamMetrics(streamId, processedChunk);

      // Push to stream
      const success = streamData.stream.push(JSON.stringify(processedChunk) + '\n');
      
      if (!success) {
        // Stream buffer is full, wait for drain
        await this.waitForDrain(streamData.stream);
      }

      // Emit progress event if enabled
      if (chunk.metadata?.progress !== undefined) {
        this.emit('progress', {
          streamId,
          progress: chunk.metadata.progress,
          tokens: chunk.metadata.tokens
        });
      }

      // End stream if chunk is marked as done
      if (chunk.done) {
        await this.endStream(streamId);
      }

    } catch (error) {
      logger.error('Error pushing chunk to stream', {
        streamId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      this.emit('error', { streamId, error });
      throw error;
    }
  }

  /**
   * End a stream and clean up resources
   */
  async endStream(streamId: string): Promise<StreamMetrics | null> {
    const streamData = this.activeStreams.get(streamId);
    if (!streamData) {
      return null;
    }

    try {
      // Calculate final metrics
      const endTime = Date.now();
      const duration = endTime - streamData.startTime;
      
      const finalMetrics: StreamMetrics = {
        ...streamData.metrics as StreamMetrics,
        streamDuration: duration,
        throughput: (streamData.metrics.totalTokens || 0) / (duration / 1000)
      };

      // End the stream
      streamData.stream.push(null);
      
      // Clean up
      this.activeStreams.delete(streamId);

      logger.info('Stream ended', { 
        streamId, 
        metrics: finalMetrics
      });

      this.emit('streamEnd', { streamId, metrics: finalMetrics });
      
      return finalMetrics;

    } catch (error) {
      logger.error('Error ending stream', {
        streamId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get active stream metrics
   */
  getStreamMetrics(streamId: string): Partial<StreamMetrics> | null {
    const streamData = this.activeStreams.get(streamId);
    if (!streamData) {
      return null;
    }

    const currentTime = Date.now();
    const duration = currentTime - streamData.startTime;
    
    return {
      ...streamData.metrics,
      streamDuration: duration,
      throughput: (streamData.metrics.totalTokens || 0) / (duration / 1000)
    };
  }

  /**
   * Get all active streams
   */
  getActiveStreams(): string[] {
    return Array.from(this.activeStreams.keys());
  }

  /**
   * Force close a stream
   */
  async closeStream(streamId: string): Promise<void> {
    const streamData = this.activeStreams.get(streamId);
    if (!streamData) {
      return;
    }

    streamData.stream.destroy();
    this.activeStreams.delete(streamId);

    logger.info('Stream forcefully closed', { streamId });
    this.emit('streamClosed', { streamId });
  }

  private setupStreamHandlers(streamId: string, stream: Readable, request: StreamRequest): void {
    stream.on('error', (error) => {
      logger.error('Stream error', { streamId, error: error.message });
      this.activeStreams.delete(streamId);
      this.emit('streamError', { streamId, error });
    });

    stream.on('close', () => {
      logger.debug('Stream closed', { streamId });
      this.activeStreams.delete(streamId);
      this.emit('streamClosed', { streamId });
    });

    stream.on('end', () => {
      logger.debug('Stream ended naturally', { streamId });
    });
  }

  private async processChunk(chunk: StreamChunk, streamId: string): Promise<StreamChunk> {
    // Apply compression if enabled and chunk is large enough
    if (this.compressionEnabled && chunk.content.length > 1024) {
      try {
        // Simple compression: remove extra whitespace and normalize
        const compressedContent = chunk.content
          .replace(/\s+/g, ' ')
          .trim();

        return {
          ...chunk,
          content: compressedContent,
          metadata: {
            ...chunk.metadata,
            compressed: true,
            originalLength: chunk.content.length,
            compressedLength: compressedContent.length
          }
        };
      } catch (error) {
        logger.warn('Chunk compression failed, using original', {
          streamId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        return chunk;
      }
    }

    return chunk;
  }

  private updateStreamMetrics(streamId: string, chunk: StreamChunk): void {
    const streamData = this.activeStreams.get(streamId);
    if (!streamData) return;

    const metrics = streamData.metrics;
    metrics.totalChunks = (metrics.totalChunks || 0) + 1;
    metrics.totalTokens = (metrics.totalTokens || 0) + (chunk.metadata?.tokens || 0);
    
    // Calculate running average chunk size
    const chunkSize = chunk.content.length;
    const totalChunks = metrics.totalChunks;
    metrics.averageChunkSize = ((metrics.averageChunkSize || 0) * (totalChunks - 1) + chunkSize) / totalChunks;
  }

  private async waitForDrain(stream: Readable): Promise<void> {
    return new Promise((resolve) => {
      stream.once('drain', resolve);
    });
  }

  private setupCleanup(): void {
    // Clean up stale streams every 5 minutes
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const maxAge = 30 * 60 * 1000; // 30 minutes

      for (const [streamId, streamData] of this.activeStreams.entries()) {
        if (now - streamData.startTime > maxAge) {
          logger.warn('Cleaning up stale stream', { streamId });
          this.closeStream(streamId);
        }
      }
    }, 5 * 60 * 1000);

    // Clean up on process exit
    process.on('SIGINT', () => {
      clearInterval(cleanupInterval);
      for (const streamId of this.activeStreams.keys()) {
        this.closeStream(streamId);
      }
    });
  }
}

export default new StreamHandlerService();
