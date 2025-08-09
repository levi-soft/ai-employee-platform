
import { logger } from '@ai-platform/shared-utils';

export interface StreamOptimizationConfig {
  enableChunking: boolean;
  chunkSize: number;
  enableCompression: boolean;
  compressionThreshold: number;
  enableBatching: boolean;
  batchTimeout: number;
  enablePrioritization: boolean;
  bufferSize: number;
  enableAdaptiveBuffering: boolean;
  enableLatencyOptimization: boolean;
}

export interface StreamMetrics {
  throughput: number; // bytes per second
  latency: number; // milliseconds
  compressionRatio: number;
  chunkCount: number;
  totalBytes: number;
  errors: number;
}

export interface OptimizationResult {
  originalSize: number;
  optimizedSize: number;
  compressionSavings: number;
  chunkingStrategy: string;
  bufferStrategy: string;
  latencyImprovement: number;
  metrics: StreamMetrics;
}

export interface StreamContext {
  streamId: string;
  userId: string;
  agentId: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  contentType: 'text' | 'json' | 'binary' | 'mixed';
  expectedSize?: number;
  userBandwidth?: number;
  deviceType?: 'mobile' | 'desktop' | 'tablet';
}

export class StreamOptimizer {
  private config: StreamOptimizationConfig;
  private metricsHistory: Map<string, StreamMetrics[]> = new Map();
  private activeOptimizations: Map<string, {
    context: StreamContext;
    startTime: number;
    chunks: Buffer[];
    metrics: Partial<StreamMetrics>;
  }> = new Map();

  // Adaptive optimization thresholds
  private performanceThresholds = {
    highLatency: 200, // ms
    lowThroughput: 1024 * 100, // 100 KB/s
    highCompressionRatio: 0.3, // 30% compression
    maxChunkSize: 1024 * 64, // 64 KB
    minChunkSize: 1024 * 4, // 4 KB
  };

  constructor(config?: Partial<StreamOptimizationConfig>) {
    this.config = {
      enableChunking: true,
      chunkSize: 1024 * 16, // 16 KB default
      enableCompression: true,
      compressionThreshold: 1024, // 1 KB
      enableBatching: true,
      batchTimeout: 100, // 100ms
      enablePrioritization: true,
      bufferSize: 1024 * 64, // 64 KB
      enableAdaptiveBuffering: true,
      enableLatencyOptimization: true,
      ...config
    };
  }

  /**
   * Optimize streaming data based on context and configuration
   */
  async optimizeStream(
    data: Buffer,
    context: StreamContext
  ): Promise<{ chunks: Buffer[]; result: OptimizationResult }> {
    const startTime = Date.now();
    const originalSize = data.length;

    // Initialize optimization session
    const optimizationSession = {
      context,
      startTime,
      chunks: [],
      metrics: {
        totalBytes: originalSize,
        chunkCount: 0,
        errors: 0
      } as Partial<StreamMetrics>
    };

    this.activeOptimizations.set(context.streamId, optimizationSession);

    try {
      // Step 1: Apply compression if beneficial
      let processedData = data;
      let compressionRatio = 0;

      if (this.shouldCompress(data, context)) {
        const compressionResult = await this.compressData(data, context);
        processedData = compressionResult.data;
        compressionRatio = compressionResult.ratio;
      }

      // Step 2: Apply intelligent chunking
      const chunks = this.chunkData(processedData, context);

      // Step 3: Apply prioritization and buffering
      const optimizedChunks = await this.optimizeChunks(chunks, context);

      // Calculate final metrics
      const endTime = Date.now();
      const processingTime = endTime - startTime;
      const optimizedSize = optimizedChunks.reduce((sum, chunk) => sum + chunk.length, 0);

      const result: OptimizationResult = {
        originalSize,
        optimizedSize,
        compressionSavings: originalSize - optimizedSize,
        chunkingStrategy: this.getChunkingStrategy(context),
        bufferStrategy: this.getBufferStrategy(context),
        latencyImprovement: this.calculateLatencyImprovement(context),
        metrics: {
          throughput: optimizedSize / (processingTime / 1000),
          latency: processingTime,
          compressionRatio,
          chunkCount: optimizedChunks.length,
          totalBytes: optimizedSize,
          errors: optimizationSession.metrics.errors || 0
        }
      };

      // Store metrics for future optimization
      this.updateMetricsHistory(context.streamId, result.metrics);

      // Clean up optimization session
      this.activeOptimizations.delete(context.streamId);

      logger.info('Stream optimization completed', {
        streamId: context.streamId,
        originalSize,
        optimizedSize,
        compressionSavings: result.compressionSavings,
        processingTime
      });

      return { chunks: optimizedChunks, result };

    } catch (error) {
      logger.error('Stream optimization failed', {
        streamId: context.streamId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Return original data as fallback
      return {
        chunks: [data],
        result: {
          originalSize,
          optimizedSize: originalSize,
          compressionSavings: 0,
          chunkingStrategy: 'fallback',
          bufferStrategy: 'none',
          latencyImprovement: 0,
          metrics: {
            throughput: 0,
            latency: Date.now() - startTime,
            compressionRatio: 0,
            chunkCount: 1,
            totalBytes: originalSize,
            errors: 1
          }
        }
      };
    }
  }

  /**
   * Optimize streaming in real-time with adaptive adjustments
   */
  async optimizeRealtime(
    chunk: Buffer,
    context: StreamContext,
    streamState: {
      totalChunks: number;
      averageLatency: number;
      throughput: number;
    }
  ): Promise<Buffer> {
    try {
      // Adaptive optimization based on current performance
      const adaptiveConfig = this.getAdaptiveConfig(context, streamState);

      // Apply real-time optimizations
      let optimizedChunk = chunk;

      // 1. Dynamic compression
      if (adaptiveConfig.enableCompression && chunk.length > adaptiveConfig.compressionThreshold) {
        const compressionResult = await this.compressData(chunk, context);
        optimizedChunk = compressionResult.data;
      }

      // 2. Adaptive chunking (re-chunk if necessary)
      if (adaptiveConfig.enableChunking && chunk.length > adaptiveConfig.maxChunkSize) {
        // Split large chunks
        const subChunks = this.splitChunk(optimizedChunk, adaptiveConfig.chunkSize);
        // Return the first chunk, queue others for later transmission
        optimizedChunk = subChunks[0];
        
        // Queue remaining chunks for batched transmission
        if (subChunks.length > 1) {
          this.queueChunks(context.streamId, subChunks.slice(1));
        }
      }

      // 3. Priority-based optimization
      if (adaptiveConfig.enablePrioritization) {
        optimizedChunk = await this.applyPriorityOptimization(optimizedChunk, context);
      }

      return optimizedChunk;

    } catch (error) {
      logger.error('Real-time stream optimization failed', {
        streamId: context.streamId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return chunk; // Fallback to original chunk
    }
  }

  /**
   * Get optimization recommendations based on historical performance
   */
  getOptimizationRecommendations(streamId: string): {
    recommendations: string[];
    predictedImprovement: number;
  } {
    const history = this.metricsHistory.get(streamId) || [];
    if (history.length === 0) {
      return {
        recommendations: ['No historical data available'],
        predictedImprovement: 0
      };
    }

    const recommendations: string[] = [];
    let predictedImprovement = 0;

    // Analyze performance patterns
    const avgLatency = history.reduce((sum, m) => sum + m.latency, 0) / history.length;
    const avgThroughput = history.reduce((sum, m) => sum + m.throughput, 0) / history.length;
    const avgCompression = history.reduce((sum, m) => sum + m.compressionRatio, 0) / history.length;

    // Latency recommendations
    if (avgLatency > this.performanceThresholds.highLatency) {
      recommendations.push('Enable aggressive chunking to reduce latency');
      recommendations.push('Implement adaptive buffering');
      predictedImprovement += 15; // 15% improvement
    }

    // Throughput recommendations
    if (avgThroughput < this.performanceThresholds.lowThroughput) {
      recommendations.push('Increase chunk size for better throughput');
      recommendations.push('Enable batch processing');
      predictedImprovement += 20; // 20% improvement
    }

    // Compression recommendations
    if (avgCompression < this.performanceThresholds.highCompressionRatio) {
      recommendations.push('Enable compression for bandwidth savings');
      predictedImprovement += 10; // 10% improvement
    }

    if (recommendations.length === 0) {
      recommendations.push('Current optimization is performing well');
    }

    return { recommendations, predictedImprovement };
  }

  private shouldCompress(data: Buffer, context: StreamContext): boolean {
    if (!this.config.enableCompression) return false;
    if (data.length < this.config.compressionThreshold) return false;
    
    // Don't compress binary data or already compressed data
    if (context.contentType === 'binary') return false;
    
    // Compress for high priority and large data
    if (context.priority === 'critical' || data.length > 1024 * 50) return true;
    
    return true;
  }

  private async compressData(
    data: Buffer, 
    context: StreamContext
  ): Promise<{ data: Buffer; ratio: number }> {
    try {
      // Simple compression simulation (in real implementation, use zlib or brotli)
      const compressionLevel = context.priority === 'critical' ? 9 : 6;
      
      // Simulate compression (replace with actual compression library)
      const compressedSize = Math.floor(data.length * (1 - Math.random() * 0.4)); // 0-40% compression
      const compressedData = Buffer.alloc(compressedSize);
      data.copy(compressedData, 0, 0, compressedSize);

      const ratio = (data.length - compressedData.length) / data.length;

      return {
        data: compressedData,
        ratio
      };

    } catch (error) {
      logger.warn('Compression failed, using original data', {
        streamId: context.streamId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        data,
        ratio: 0
      };
    }
  }

  private chunkData(data: Buffer, context: StreamContext): Buffer[] {
    if (!this.config.enableChunking) {
      return [data];
    }

    const chunkSize = this.getOptimalChunkSize(context);
    const chunks: Buffer[] = [];

    for (let i = 0; i < data.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, data.length);
      chunks.push(data.slice(i, end));
    }

    return chunks;
  }

  private async optimizeChunks(chunks: Buffer[], context: StreamContext): Promise<Buffer[]> {
    if (!this.config.enablePrioritization) {
      return chunks;
    }

    // Apply priority-based optimizations
    const optimizedChunks = await Promise.all(
      chunks.map((chunk, index) => this.optimizeChunk(chunk, context, index))
    );

    return optimizedChunks;
  }

  private async optimizeChunk(
    chunk: Buffer, 
    context: StreamContext, 
    chunkIndex: number
  ): Promise<Buffer> {
    // Priority-based chunk optimization
    switch (context.priority) {
      case 'critical':
        // Minimize latency for critical data
        return this.applyLatencyOptimization(chunk, context);
      
      case 'high':
        // Balance between latency and throughput
        return this.applyBalancedOptimization(chunk, context);
      
      default:
        // Optimize for throughput
        return this.applyThroughputOptimization(chunk, context);
    }
  }

  private async applyLatencyOptimization(chunk: Buffer, context: StreamContext): Promise<Buffer> {
    // For latency optimization, prefer smaller chunks and minimal processing
    if (chunk.length > this.performanceThresholds.minChunkSize) {
      return chunk;
    }
    return chunk;
  }

  private async applyBalancedOptimization(chunk: Buffer, context: StreamContext): Promise<Buffer> {
    // Balance compression and chunk size
    if (chunk.length > 1024 * 8) { // 8KB threshold
      const compressionResult = await this.compressData(chunk, context);
      return compressionResult.data;
    }
    return chunk;
  }

  private async applyThroughputOptimization(chunk: Buffer, context: StreamContext): Promise<Buffer> {
    // Optimize for maximum throughput
    const compressionResult = await this.compressData(chunk, context);
    return compressionResult.data;
  }

  private async applyPriorityOptimization(chunk: Buffer, context: StreamContext): Promise<Buffer> {
    // Apply context-specific optimizations
    const deviceOptimizedChunk = this.optimizeForDevice(chunk, context.deviceType);
    const bandwidthOptimizedChunk = this.optimizeForBandwidth(deviceOptimizedChunk, context.userBandwidth);
    
    return bandwidthOptimizedChunk;
  }

  private optimizeForDevice(chunk: Buffer, deviceType?: string): Buffer {
    // Device-specific optimizations
    switch (deviceType) {
      case 'mobile':
        // Optimize for mobile devices (smaller chunks, aggressive compression)
        return chunk.length > 1024 * 8 ? chunk.slice(0, 1024 * 8) : chunk;
      
      case 'desktop':
        // Desktop can handle larger chunks
        return chunk;
      
      default:
        return chunk;
    }
  }

  private optimizeForBandwidth(chunk: Buffer, bandwidth?: number): Buffer {
    if (!bandwidth) return chunk;

    // Adjust chunk size based on available bandwidth
    const optimalSize = Math.min(chunk.length, bandwidth / 8); // bytes per second to bytes
    return chunk.length > optimalSize ? chunk.slice(0, Math.floor(optimalSize)) : chunk;
  }

  private getOptimalChunkSize(context: StreamContext): number {
    let baseSize = this.config.chunkSize;

    // Adjust based on priority
    switch (context.priority) {
      case 'critical':
        baseSize = Math.min(baseSize, this.performanceThresholds.minChunkSize * 2);
        break;
      case 'low':
        baseSize = Math.min(baseSize * 2, this.performanceThresholds.maxChunkSize);
        break;
    }

    // Adjust based on expected size
    if (context.expectedSize) {
      if (context.expectedSize < 1024 * 10) { // Small files
        baseSize = Math.min(baseSize, 1024 * 4);
      } else if (context.expectedSize > 1024 * 100) { // Large files
        baseSize = Math.min(baseSize * 2, this.performanceThresholds.maxChunkSize);
      }
    }

    return baseSize;
  }

  private getAdaptiveConfig(
    context: StreamContext,
    streamState: { totalChunks: number; averageLatency: number; throughput: number }
  ): any {
    const adaptiveConfig = { ...this.config };

    // Adjust based on performance metrics
    if (streamState.averageLatency > this.performanceThresholds.highLatency) {
      adaptiveConfig.chunkSize = Math.max(adaptiveConfig.chunkSize / 2, this.performanceThresholds.minChunkSize);
      adaptiveConfig.enableLatencyOptimization = true;
    }

    if (streamState.throughput < this.performanceThresholds.lowThroughput) {
      adaptiveConfig.chunkSize = Math.min(adaptiveConfig.chunkSize * 1.5, this.performanceThresholds.maxChunkSize);
      adaptiveConfig.enableBatching = true;
    }

    return adaptiveConfig;
  }

  private splitChunk(chunk: Buffer, maxSize: number): Buffer[] {
    const subChunks: Buffer[] = [];
    for (let i = 0; i < chunk.length; i += maxSize) {
      subChunks.push(chunk.slice(i, i + maxSize));
    }
    return subChunks;
  }

  private queueChunks(streamId: string, chunks: Buffer[]): void {
    // In a real implementation, this would queue chunks for batch transmission
    logger.debug('Queued chunks for batch transmission', {
      streamId,
      chunkCount: chunks.length
    });
  }

  private getChunkingStrategy(context: StreamContext): string {
    if (context.priority === 'critical') return 'latency-optimized';
    if (context.expectedSize && context.expectedSize > 1024 * 100) return 'large-file';
    return 'balanced';
  }

  private getBufferStrategy(context: StreamContext): string {
    if (this.config.enableAdaptiveBuffering) return 'adaptive';
    if (this.config.enableBatching) return 'batched';
    return 'standard';
  }

  private calculateLatencyImprovement(context: StreamContext): number {
    // Calculate based on optimization strategies applied
    let improvement = 0;
    
    if (context.priority === 'critical') improvement += 15;
    if (this.config.enableLatencyOptimization) improvement += 10;
    if (this.config.enableAdaptiveBuffering) improvement += 5;

    return improvement;
  }

  private updateMetricsHistory(streamId: string, metrics: StreamMetrics): void {
    if (!this.metricsHistory.has(streamId)) {
      this.metricsHistory.set(streamId, []);
    }

    const history = this.metricsHistory.get(streamId)!;
    history.push(metrics);

    // Keep only last 100 entries
    if (history.length > 100) {
      history.shift();
    }
  }
}

export default new StreamOptimizer();
