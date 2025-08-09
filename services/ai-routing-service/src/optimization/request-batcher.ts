
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';

export interface BatchConfig {
  maxBatchSize: number;
  maxWaitTime: number;
  minBatchSize: number;
  enableAdaptiveBatching: boolean;
  priorityLevels: string[];
  batchingStrategies: string[];
  concurrencyLimit: number;
  timeoutThreshold: number;
}

export interface BatchRequest {
  id: string;
  data: any;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  timestamp: Date;
  timeout?: number;
  userId?: string;
  provider?: string;
  agent?: string;
  metadata: Record<string, any>;
  resolve: (result: any) => void;
  reject: (error: any) => void;
}

export interface BatchJob {
  id: string;
  requests: BatchRequest[];
  strategy: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: Date;
  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  status: 'pending' | 'scheduled' | 'processing' | 'completed' | 'failed';
  metadata: Record<string, any>;
}

export interface BatchResult {
  jobId: string;
  results: Array<{
    requestId: string;
    success: boolean;
    data?: any;
    error?: any;
    duration: number;
  }>;
  totalDuration: number;
  strategy: string;
  efficiency: number;
  metadata: Record<string, any>;
}

export interface BatchStrategy {
  id: string;
  name: string;
  description: string;
  shouldBatch: (request: BatchRequest, existingRequests: BatchRequest[]) => boolean;
  createBatch: (requests: BatchRequest[]) => BatchJob;
  processBatch: (job: BatchJob) => Promise<BatchResult>;
  priority: number;
  efficiency: number;
}

export class RequestBatcherService extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: BatchConfig;
  private pendingRequests: Map<string, BatchRequest> = new Map();
  private activeBatches: Map<string, BatchJob> = new Map();
  private batchStrategies: Map<string, BatchStrategy> = new Map();
  private processingQueue: BatchJob[] = [];
  private batchingTimers: Map<string, NodeJS.Timeout> = new Map();
  
  private metrics = {
    totalRequests: 0,
    batchedRequests: 0,
    batchesSent: 0,
    averageBatchSize: 0,
    averageWaitTime: 0,
    averageProcessingTime: 0,
    efficiencyGains: 0,
    timeoutCount: 0,
    strategyUsage: new Map<string, number>(),
    priorityDistribution: new Map<string, number>()
  };

  constructor(config: Partial<BatchConfig> = {}) {
    super();
    this.logger = new Logger('RequestBatcherService');
    
    this.config = {
      maxBatchSize: 50,
      maxWaitTime: 2000,
      minBatchSize: 3,
      enableAdaptiveBatching: true,
      priorityLevels: ['low', 'medium', 'high', 'urgent'],
      batchingStrategies: ['similarity', 'provider', 'priority', 'temporal'],
      concurrencyLimit: 10,
      timeoutThreshold: 30000,
      ...config
    };

    this.initializeBatchingStrategies();
    this.startBatchProcessor();
  }

  /**
   * Initialize default batching strategies
   */
  private initializeBatchingStrategies(): void {
    // Similarity-based batching
    this.registerStrategy({
      id: 'similarity',
      name: 'Similarity Batching',
      description: 'Groups similar requests together',
      priority: 1,
      efficiency: 0.8,
      shouldBatch: (request, existing) => {
        return existing.some(r => this.areRequestsSimilar(request, r));
      },
      createBatch: (requests) => this.createSimilarityBatch(requests),
      processBatch: async (job) => this.processSimilarityBatch(job)
    });

    // Provider-based batching
    this.registerStrategy({
      id: 'provider',
      name: 'Provider Batching',
      description: 'Groups requests by provider',
      priority: 2,
      efficiency: 0.75,
      shouldBatch: (request, existing) => {
        return existing.some(r => r.provider === request.provider);
      },
      createBatch: (requests) => this.createProviderBatch(requests),
      processBatch: async (job) => this.processProviderBatch(job)
    });

    // Priority-based batching
    this.registerStrategy({
      id: 'priority',
      name: 'Priority Batching',
      description: 'Groups requests by priority level',
      priority: 3,
      efficiency: 0.7,
      shouldBatch: (request, existing) => {
        return existing.some(r => r.priority === request.priority);
      },
      createBatch: (requests) => this.createPriorityBatch(requests),
      processBatch: async (job) => this.processPriorityBatch(job)
    });

    // Temporal batching
    this.registerStrategy({
      id: 'temporal',
      name: 'Temporal Batching',
      description: 'Groups requests within time window',
      priority: 4,
      efficiency: 0.6,
      shouldBatch: (request, existing) => {
        const timeWindow = 5000; // 5 seconds
        return existing.some(r => 
          Math.abs(request.timestamp.getTime() - r.timestamp.getTime()) < timeWindow
        );
      },
      createBatch: (requests) => this.createTemporalBatch(requests),
      processBatch: async (job) => this.processTemporalBatch(job)
    });

    // Emergency batching (fallback)
    this.registerStrategy({
      id: 'emergency',
      name: 'Emergency Batching',
      description: 'Processes high-priority requests immediately',
      priority: 0,
      efficiency: 0.9,
      shouldBatch: (request, existing) => {
        return request.priority === 'urgent' && existing.length === 0;
      },
      createBatch: (requests) => this.createEmergencyBatch(requests),
      processBatch: async (job) => this.processEmergencyBatch(job)
    });
  }

  /**
   * Register a custom batching strategy
   */
  registerStrategy(strategy: BatchStrategy): void {
    this.batchStrategies.set(strategy.id, strategy);
    this.logger.info(`Registered batching strategy: ${strategy.name}`, {
      strategyId: strategy.id,
      priority: strategy.priority,
      efficiency: strategy.efficiency
    });
  }

  /**
   * Add request to batching queue
   */
  async addRequest(
    data: any,
    options: {
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      timeout?: number;
      userId?: string;
      provider?: string;
      agent?: string;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<any> {
    
    const requestId = `req_${Date.now()}_${Math.random()}`;
    this.metrics.totalRequests++;
    
    const request: BatchRequest = {
      id: requestId,
      data,
      priority: options.priority || 'medium',
      timestamp: new Date(),
      timeout: options.timeout || this.config.timeoutThreshold,
      userId: options.userId,
      provider: options.provider,
      agent: options.agent,
      metadata: options.metadata || {},
      resolve: () => {},
      reject: () => {}
    };

    // Update priority distribution metrics
    const priorityCount = this.metrics.priorityDistribution.get(request.priority) || 0;
    this.metrics.priorityDistribution.set(request.priority, priorityCount + 1);

    return new Promise((resolve, reject) => {
      request.resolve = resolve;
      request.reject = reject;

      // Set timeout for individual request
      const timeoutId = setTimeout(() => {
        this.handleRequestTimeout(requestId);
      }, request.timeout);

      request.metadata.timeoutId = timeoutId;

      // Try to add to existing batch or create new one
      if (this.tryAddToExistingBatch(request)) {
        this.logger.debug('Added request to existing batch', {
          requestId,
          priority: request.priority,
          provider: request.provider
        });
      } else {
        this.pendingRequests.set(requestId, request);
        this.scheduleNewBatch(request);
        
        this.logger.debug('Added request to pending queue', {
          requestId,
          priority: request.priority,
          pendingCount: this.pendingRequests.size
        });
      }
    });
  }

  /**
   * Try to add request to existing batch
   */
  private tryAddToExistingBatch(request: BatchRequest): boolean {
    // Find compatible active batch
    for (const [jobId, job] of this.activeBatches.entries()) {
      if (job.status === 'pending' && job.requests.length < this.config.maxBatchSize) {
        const strategy = this.batchStrategies.get(job.strategy);
        
        if (strategy && strategy.shouldBatch(request, job.requests)) {
          job.requests.push(request);
          
          this.emit('requestAddedToBatch', {
            requestId: request.id,
            jobId,
            batchSize: job.requests.length
          });

          // If batch is full or urgent priority, process immediately
          if (job.requests.length >= this.config.maxBatchSize || 
              request.priority === 'urgent') {
            this.scheduleJobProcessing(job);
          }

          return true;
        }
      }
    }

    return false;
  }

  /**
   * Schedule new batch creation
   */
  private scheduleNewBatch(request: BatchRequest): void {
    const strategyKey = this.getBatchingStrategyKey(request);
    
    // Cancel existing timer if any
    const existingTimer = this.batchingTimers.get(strategyKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer based on priority
    const waitTime = this.calculateWaitTime(request);
    
    const timer = setTimeout(() => {
      this.createBatchFromPending(strategyKey);
    }, waitTime);

    this.batchingTimers.set(strategyKey, timer);
    
    this.logger.debug('Scheduled new batch creation', {
      strategyKey,
      waitTime,
      priority: request.priority
    });
  }

  /**
   * Create batch from pending requests
   */
  private createBatchFromPending(strategyKey: string): void {
    this.batchingTimers.delete(strategyKey);
    
    const compatibleRequests = Array.from(this.pendingRequests.values())
      .filter(request => this.getBatchingStrategyKey(request) === strategyKey)
      .sort((a, b) => {
        // Sort by priority first, then timestamp
        const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        const aPriority = priorityOrder[a.priority];
        const bPriority = priorityOrder[b.priority];
        
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        
        return a.timestamp.getTime() - b.timestamp.getTime();
      });

    if (compatibleRequests.length === 0) {
      return;
    }

    // Select best strategy for these requests
    const strategy = this.selectBestStrategy(compatibleRequests);
    if (!strategy) {
      // Process requests individually
      this.processIndividualRequests(compatibleRequests);
      return;
    }

    // Take up to maxBatchSize requests
    const requestsForBatch = compatibleRequests.slice(0, this.config.maxBatchSize);
    
    // Remove from pending
    requestsForBatch.forEach(request => {
      this.pendingRequests.delete(request.id);
    });

    // Create batch job
    const job = strategy.createBatch(requestsForBatch);
    this.activeBatches.set(job.id, job);
    
    this.metrics.batchesSent++;
    this.metrics.batchedRequests += requestsForBatch.length;
    
    // Update strategy usage metrics
    const strategyCount = this.metrics.strategyUsage.get(strategy.id) || 0;
    this.metrics.strategyUsage.set(strategy.id, strategyCount + 1);

    this.emit('batchCreated', {
      jobId: job.id,
      strategy: strategy.name,
      requestCount: requestsForBatch.length,
      priority: job.priority
    });

    this.logger.info('Created new batch', {
      jobId: job.id,
      strategy: strategy.name,
      requestCount: requestsForBatch.length,
      priority: job.priority
    });

    // Schedule for processing
    this.scheduleJobProcessing(job);
  }

  /**
   * Select best batching strategy for requests
   */
  private selectBestStrategy(requests: BatchRequest[]): BatchStrategy | null {
    const applicableStrategies = Array.from(this.batchStrategies.values())
      .filter(strategy => {
        // Check if strategy can handle these requests
        if (requests.length < 2 && strategy.id !== 'emergency') {
          return false;
        }
        
        return strategy.shouldBatch(requests[0], requests.slice(1));
      })
      .sort((a, b) => {
        // Sort by priority first, then efficiency
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return b.efficiency - a.efficiency;
      });

    return applicableStrategies[0] || null;
  }

  /**
   * Schedule job for processing
   */
  private scheduleJobProcessing(job: BatchJob): void {
    job.status = 'scheduled';
    job.scheduledAt = new Date();
    
    // Add to processing queue based on priority
    this.insertJobInQueue(job);
    
    this.emit('batchScheduled', {
      jobId: job.id,
      requestCount: job.requests.length,
      priority: job.priority
    });
  }

  /**
   * Insert job in processing queue maintaining priority order
   */
  private insertJobInQueue(job: BatchJob): void {
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    const jobPriority = priorityOrder[job.priority];
    
    let insertIndex = this.processingQueue.length;
    
    for (let i = 0; i < this.processingQueue.length; i++) {
      const queuedJobPriority = priorityOrder[this.processingQueue[i].priority];
      
      if (jobPriority < queuedJobPriority) {
        insertIndex = i;
        break;
      }
    }
    
    this.processingQueue.splice(insertIndex, 0, job);
  }

  /**
   * Start batch processing loop
   */
  private startBatchProcessor(): void {
    setInterval(() => {
      this.processBatchQueue();
    }, 100); // Check every 100ms
    
    this.logger.info('Started batch processor');
  }

  /**
   * Process batch queue
   */
  private async processBatchQueue(): Promise<void> {
    const activeJobs = Array.from(this.activeBatches.values())
      .filter(job => job.status === 'processing').length;

    if (activeJobs >= this.config.concurrencyLimit) {
      return; // Already at concurrency limit
    }

    const nextJob = this.processingQueue.shift();
    if (!nextJob) {
      return; // No jobs to process
    }

    try {
      await this.processBatchJob(nextJob);
    } catch (error) {
      this.logger.error('Batch processing failed', {
        jobId: nextJob.id,
        error: error.message
      });
      
      this.handleJobFailure(nextJob, error);
    }
  }

  /**
   * Process individual batch job
   */
  private async processBatchJob(job: BatchJob): Promise<void> {
    job.status = 'processing';
    job.startedAt = new Date();

    this.logger.info('Processing batch job', {
      jobId: job.id,
      requestCount: job.requests.length,
      strategy: job.strategy
    });

    const strategy = this.batchStrategies.get(job.strategy);
    if (!strategy) {
      throw new Error(`Unknown batch strategy: ${job.strategy}`);
    }

    try {
      const result = await strategy.processBatch(job);
      
      job.status = 'completed';
      job.completedAt = new Date();
      
      this.handleJobSuccess(job, result);
      
    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date();
      
      throw error;
    }
  }

  /**
   * Handle successful job completion
   */
  private handleJobSuccess(job: BatchJob, result: BatchResult): void {
    const duration = job.completedAt!.getTime() - job.startedAt!.getTime();
    
    // Update metrics
    this.updateMetrics(job, result, duration);
    
    // Resolve individual requests
    for (const resultItem of result.results) {
      const request = job.requests.find(r => r.id === resultItem.requestId);
      
      if (request) {
        // Clear timeout
        if (request.metadata.timeoutId) {
          clearTimeout(request.metadata.timeoutId);
        }
        
        if (resultItem.success) {
          request.resolve(resultItem.data);
        } else {
          request.reject(resultItem.error);
        }
      }
    }

    this.activeBatches.delete(job.id);
    
    this.emit('batchCompleted', {
      jobId: job.id,
      requestCount: job.requests.length,
      duration,
      efficiency: result.efficiency,
      strategy: result.strategy
    });

    this.logger.info('Batch job completed successfully', {
      jobId: job.id,
      duration,
      efficiency: result.efficiency,
      successCount: result.results.filter(r => r.success).length
    });
  }

  /**
   * Handle job failure
   */
  private handleJobFailure(job: BatchJob, error: any): void {
    // Reject all requests in the job
    for (const request of job.requests) {
      // Clear timeout
      if (request.metadata.timeoutId) {
        clearTimeout(request.metadata.timeoutId);
      }
      
      request.reject(error);
    }

    this.activeBatches.delete(job.id);
    
    this.emit('batchFailed', {
      jobId: job.id,
      requestCount: job.requests.length,
      error: error.message,
      strategy: job.strategy
    });

    this.logger.error('Batch job failed', {
      jobId: job.id,
      requestCount: job.requests.length,
      error: error.message
    });
  }

  /**
   * Handle individual request timeout
   */
  private handleRequestTimeout(requestId: string): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) return;
    
    this.pendingRequests.delete(requestId);
    this.metrics.timeoutCount++;
    
    request.reject(new Error(`Request timeout after ${request.timeout}ms`));
    
    this.emit('requestTimeout', {
      requestId,
      timeout: request.timeout,
      priority: request.priority
    });

    this.logger.warn('Request timeout', {
      requestId,
      timeout: request.timeout,
      priority: request.priority
    });
  }

  /**
   * Batching strategy implementations
   */
  private createSimilarityBatch(requests: BatchRequest[]): BatchJob {
    const highestPriority = this.getHighestPriority(requests);
    
    return {
      id: `similarity_${Date.now()}_${Math.random()}`,
      requests,
      strategy: 'similarity',
      priority: highestPriority,
      createdAt: new Date(),
      status: 'pending',
      metadata: {
        similarityScore: this.calculateSimilarityScore(requests),
        features: this.extractCommonFeatures(requests)
      }
    };
  }

  private createProviderBatch(requests: BatchRequest[]): BatchJob {
    const highestPriority = this.getHighestPriority(requests);
    
    return {
      id: `provider_${Date.now()}_${Math.random()}`,
      requests,
      strategy: 'provider',
      priority: highestPriority,
      createdAt: new Date(),
      status: 'pending',
      metadata: {
        provider: requests[0].provider,
        providerRequests: requests.length
      }
    };
  }

  private createPriorityBatch(requests: BatchRequest[]): BatchJob {
    const priority = requests[0].priority; // All should have same priority
    
    return {
      id: `priority_${Date.now()}_${Math.random()}`,
      requests,
      strategy: 'priority',
      priority,
      createdAt: new Date(),
      status: 'pending',
      metadata: {
        priorityLevel: priority,
        requestCount: requests.length
      }
    };
  }

  private createTemporalBatch(requests: BatchRequest[]): BatchJob {
    const highestPriority = this.getHighestPriority(requests);
    
    return {
      id: `temporal_${Date.now()}_${Math.random()}`,
      requests,
      strategy: 'temporal',
      priority: highestPriority,
      createdAt: new Date(),
      status: 'pending',
      metadata: {
        timeWindow: this.calculateTimeWindow(requests),
        averageWait: this.calculateAverageWaitTime(requests)
      }
    };
  }

  private createEmergencyBatch(requests: BatchRequest[]): BatchJob {
    return {
      id: `emergency_${Date.now()}_${Math.random()}`,
      requests,
      strategy: 'emergency',
      priority: 'urgent',
      createdAt: new Date(),
      status: 'pending',
      metadata: {
        emergency: true,
        immediateProcessing: true
      }
    };
  }

  /**
   * Batch processing implementations
   */
  private async processSimilarityBatch(job: BatchJob): Promise<BatchResult> {
    const startTime = Date.now();
    const results: BatchResult['results'] = [];

    // Simulate similarity-based processing optimization
    const similarityScore = job.metadata.similarityScore || 0.8;
    const processingEfficiency = Math.min(similarityScore * 1.2, 1.0);
    
    for (const request of job.requests) {
      const requestStart = Date.now();
      
      try {
        // Simulate optimized processing based on similarity
        const processingTime = Math.random() * 200 * (1 - processingEfficiency * 0.3);
        await this.sleep(processingTime);
        
        const data = {
          result: `Processed via similarity batch: ${request.id}`,
          optimized: true,
          similarityScore,
          processingTime
        };

        results.push({
          requestId: request.id,
          success: true,
          data,
          duration: Date.now() - requestStart
        });
        
      } catch (error) {
        results.push({
          requestId: request.id,
          success: false,
          error,
          duration: Date.now() - requestStart
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    const efficiency = this.calculateBatchEfficiency(job, totalDuration);

    return {
      jobId: job.id,
      results,
      totalDuration,
      strategy: 'similarity',
      efficiency,
      metadata: {
        similarityOptimization: true,
        efficiencyGain: efficiency,
        averageProcessingTime: totalDuration / job.requests.length
      }
    };
  }

  private async processProviderBatch(job: BatchJob): Promise<BatchResult> {
    const startTime = Date.now();
    const results: BatchResult['results'] = [];

    // Simulate provider-specific optimizations
    const provider = job.metadata.provider;
    const providerEfficiency = this.getProviderEfficiency(provider);
    
    for (const request of job.requests) {
      const requestStart = Date.now();
      
      try {
        // Simulate provider-optimized processing
        const processingTime = Math.random() * 300 * (1 - providerEfficiency * 0.4);
        await this.sleep(processingTime);
        
        const data = {
          result: `Processed via ${provider} batch: ${request.id}`,
          provider,
          optimized: true,
          providerEfficiency
        };

        results.push({
          requestId: request.id,
          success: true,
          data,
          duration: Date.now() - requestStart
        });
        
      } catch (error) {
        results.push({
          requestId: request.id,
          success: false,
          error,
          duration: Date.now() - requestStart
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    const efficiency = this.calculateBatchEfficiency(job, totalDuration);

    return {
      jobId: job.id,
      results,
      totalDuration,
      strategy: 'provider',
      efficiency,
      metadata: {
        provider,
        providerOptimization: true,
        efficiencyGain: efficiency
      }
    };
  }

  private async processPriorityBatch(job: BatchJob): Promise<BatchResult> {
    const startTime = Date.now();
    const results: BatchResult['results'] = [];

    // Priority batches get faster processing
    const priorityBoost = job.priority === 'urgent' ? 0.8 : 
                         job.priority === 'high' ? 0.6 : 
                         job.priority === 'medium' ? 0.4 : 0.2;
    
    for (const request of job.requests) {
      const requestStart = Date.now();
      
      try {
        // Simulate priority-based processing
        const processingTime = Math.random() * 250 * (1 - priorityBoost);
        await this.sleep(processingTime);
        
        const data = {
          result: `Processed via ${job.priority} priority batch: ${request.id}`,
          priority: job.priority,
          optimized: true,
          priorityBoost
        };

        results.push({
          requestId: request.id,
          success: true,
          data,
          duration: Date.now() - requestStart
        });
        
      } catch (error) {
        results.push({
          requestId: request.id,
          success: false,
          error,
          duration: Date.now() - requestStart
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    const efficiency = this.calculateBatchEfficiency(job, totalDuration);

    return {
      jobId: job.id,
      results,
      totalDuration,
      strategy: 'priority',
      efficiency,
      metadata: {
        priorityLevel: job.priority,
        priorityOptimization: true,
        efficiencyGain: efficiency
      }
    };
  }

  private async processTemporalBatch(job: BatchJob): Promise<BatchResult> {
    const startTime = Date.now();
    const results: BatchResult['results'] = [];

    // Temporal batches benefit from temporal locality
    const timeWindow = job.metadata.timeWindow || 5000;
    const temporalEfficiency = Math.min(job.requests.length / 10, 1.0);
    
    for (const request of job.requests) {
      const requestStart = Date.now();
      
      try {
        // Simulate temporal optimization
        const processingTime = Math.random() * 180 * (1 - temporalEfficiency * 0.3);
        await this.sleep(processingTime);
        
        const data = {
          result: `Processed via temporal batch: ${request.id}`,
          timeWindow,
          optimized: true,
          temporalEfficiency
        };

        results.push({
          requestId: request.id,
          success: true,
          data,
          duration: Date.now() - requestStart
        });
        
      } catch (error) {
        results.push({
          requestId: request.id,
          success: false,
          error,
          duration: Date.now() - requestStart
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    const efficiency = this.calculateBatchEfficiency(job, totalDuration);

    return {
      jobId: job.id,
      results,
      totalDuration,
      strategy: 'temporal',
      efficiency,
      metadata: {
        temporalOptimization: true,
        timeWindow,
        efficiencyGain: efficiency
      }
    };
  }

  private async processEmergencyBatch(job: BatchJob): Promise<BatchResult> {
    const startTime = Date.now();
    const results: BatchResult['results'] = [];

    // Emergency processing with minimal delay
    for (const request of job.requests) {
      const requestStart = Date.now();
      
      try {
        // Minimal processing time for emergencies
        const processingTime = Math.random() * 50;
        await this.sleep(processingTime);
        
        const data = {
          result: `Emergency processed: ${request.id}`,
          emergency: true,
          fastTrack: true
        };

        results.push({
          requestId: request.id,
          success: true,
          data,
          duration: Date.now() - requestStart
        });
        
      } catch (error) {
        results.push({
          requestId: request.id,
          success: false,
          error,
          duration: Date.now() - requestStart
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    const efficiency = 0.95; // High efficiency for emergency processing

    return {
      jobId: job.id,
      results,
      totalDuration,
      strategy: 'emergency',
      efficiency,
      metadata: {
        emergencyProcessing: true,
        fastTrack: true,
        efficiencyGain: efficiency
      }
    };
  }

  /**
   * Process individual requests (fallback)
   */
  private async processIndividualRequests(requests: BatchRequest[]): Promise<void> {
    for (const request of requests) {
      this.pendingRequests.delete(request.id);
      
      try {
        // Simulate individual processing
        const processingTime = Math.random() * 500;
        await this.sleep(processingTime);
        
        const data = {
          result: `Individually processed: ${request.id}`,
          individual: true,
          processingTime
        };

        request.resolve(data);
        
      } catch (error) {
        request.reject(error);
      }
    }
  }

  /**
   * Helper methods
   */
  private areRequestsSimilar(req1: BatchRequest, req2: BatchRequest): boolean {
    // Simple similarity check based on data structure
    const data1 = JSON.stringify(req1.data);
    const data2 = JSON.stringify(req2.data);
    
    // Check for common patterns or keys
    const keys1 = new Set(Object.keys(req1.data || {}));
    const keys2 = new Set(Object.keys(req2.data || {}));
    const commonKeys = new Set([...keys1].filter(k => keys2.has(k)));
    
    const similarity = commonKeys.size / Math.max(keys1.size, keys2.size, 1);
    return similarity > 0.6;
  }

  private getBatchingStrategyKey(request: BatchRequest): string {
    // Create a key based on request characteristics
    return `${request.provider || 'unknown'}_${request.priority}_${request.agent || 'unknown'}`;
  }

  private calculateWaitTime(request: BatchRequest): number {
    const baseWaitTime = this.config.maxWaitTime;
    
    // Reduce wait time for higher priority requests
    const priorityMultipliers = {
      urgent: 0.1,
      high: 0.3,
      medium: 0.7,
      low: 1.0
    };

    return baseWaitTime * priorityMultipliers[request.priority];
  }

  private getHighestPriority(requests: BatchRequest[]): 'low' | 'medium' | 'high' | 'urgent' {
    const priorityOrder = ['urgent', 'high', 'medium', 'low'] as const;
    
    for (const priority of priorityOrder) {
      if (requests.some(r => r.priority === priority)) {
        return priority;
      }
    }
    
    return 'medium';
  }

  private calculateSimilarityScore(requests: BatchRequest[]): number {
    if (requests.length < 2) return 0;
    
    let totalSimilarity = 0;
    let comparisons = 0;
    
    for (let i = 0; i < requests.length; i++) {
      for (let j = i + 1; j < requests.length; j++) {
        if (this.areRequestsSimilar(requests[i], requests[j])) {
          totalSimilarity += 1;
        }
        comparisons++;
      }
    }
    
    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  private extractCommonFeatures(requests: BatchRequest[]): Record<string, any> {
    const features: Record<string, any> = {};
    
    // Extract common provider
    const providers = [...new Set(requests.map(r => r.provider).filter(Boolean))];
    if (providers.length === 1) {
      features.provider = providers[0];
    }
    
    // Extract common agent
    const agents = [...new Set(requests.map(r => r.agent).filter(Boolean))];
    if (agents.length === 1) {
      features.agent = agents[0];
    }
    
    return features;
  }

  private calculateTimeWindow(requests: BatchRequest[]): number {
    if (requests.length < 2) return 0;
    
    const timestamps = requests.map(r => r.timestamp.getTime()).sort();
    return timestamps[timestamps.length - 1] - timestamps[0];
  }

  private calculateAverageWaitTime(requests: BatchRequest[]): number {
    const now = Date.now();
    const totalWait = requests.reduce((sum, r) => sum + (now - r.timestamp.getTime()), 0);
    return totalWait / requests.length;
  }

  private getProviderEfficiency(provider?: string): number {
    // Simulate provider-specific efficiency values
    const efficiencies: Record<string, number> = {
      'openai': 0.85,
      'claude': 0.80,
      'gemini': 0.75,
      'default': 0.70
    };
    
    return efficiencies[provider || 'default'];
  }

  private calculateBatchEfficiency(job: BatchJob, totalDuration: number): number {
    // Calculate efficiency based on batch size and processing time
    const expectedIndividualTime = job.requests.length * 300; // 300ms per request
    const actualTime = totalDuration;
    
    const timeEfficiency = Math.max(0, 1 - (actualTime / expectedIndividualTime));
    const sizeEfficiency = Math.min(job.requests.length / this.config.maxBatchSize, 1);
    
    return (timeEfficiency * 0.7) + (sizeEfficiency * 0.3);
  }

  private updateMetrics(job: BatchJob, result: BatchResult, duration: number): void {
    // Update average batch size
    const totalBatches = this.metrics.batchesSent;
    this.metrics.averageBatchSize = (this.metrics.averageBatchSize * (totalBatches - 1) + job.requests.length) / totalBatches;
    
    // Update average processing time
    this.metrics.averageProcessingTime = (this.metrics.averageProcessingTime * (totalBatches - 1) + duration) / totalBatches;
    
    // Update efficiency gains
    this.metrics.efficiencyGains += result.efficiency;
    
    // Update wait time
    const averageWaitTime = this.calculateAverageWaitTime(job.requests);
    this.metrics.averageWaitTime = (this.metrics.averageWaitTime * (totalBatches - 1) + averageWaitTime) / totalBatches;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Public API methods
   */

  /**
   * Get batching metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Get pending requests count
   */
  getPendingRequestsCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Get active batches count
   */
  getActiveBatchesCount(): number {
    return this.activeBatches.size;
  }

  /**
   * Get processing queue status
   */
  getQueueStatus(): {
    queueLength: number;
    processingJobs: number;
    pendingRequests: number;
    strategies: string[];
  } {
    const processingJobs = Array.from(this.activeBatches.values())
      .filter(job => job.status === 'processing').length;

    return {
      queueLength: this.processingQueue.length,
      processingJobs,
      pendingRequests: this.pendingRequests.size,
      strategies: Array.from(this.batchStrategies.keys())
    };
  }

  /**
   * Update batching configuration
   */
  updateConfig(newConfig: Partial<BatchConfig>): void {
    Object.assign(this.config, newConfig);
    this.logger.info('Updated batching configuration', { newConfig });
  }

  /**
   * Force process all pending requests
   */
  forceBatchProcessing(): void {
    // Clear all timers
    for (const timer of this.batchingTimers.values()) {
      clearTimeout(timer);
    }
    this.batchingTimers.clear();

    // Process all pending requests immediately
    const allRequests = Array.from(this.pendingRequests.values());
    if (allRequests.length > 0) {
      this.processIndividualRequests(allRequests);
    }

    this.logger.info('Forced batch processing of all pending requests');
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      batchedRequests: 0,
      batchesSent: 0,
      averageBatchSize: 0,
      averageWaitTime: 0,
      averageProcessingTime: 0,
      efficiencyGains: 0,
      timeoutCount: 0,
      strategyUsage: new Map(),
      priorityDistribution: new Map()
    };
    
    this.logger.info('Reset batching metrics');
  }

  /**
   * Get batch statistics
   */
  getBatchStatistics(): {
    efficiency: number;
    throughputImprovement: number;
    averageBatchUtilization: number;
    strategiesPerformance: Array<{
      strategy: string;
      usage: number;
      averageEfficiency: number;
    }>;
  } {
    const totalBatches = this.metrics.batchesSent;
    const efficiency = totalBatches > 0 ? this.metrics.efficiencyGains / totalBatches : 0;
    
    const throughputImprovement = this.metrics.batchedRequests / Math.max(this.metrics.totalRequests, 1);
    const averageBatchUtilization = this.metrics.averageBatchSize / this.config.maxBatchSize;
    
    const strategiesPerformance = Array.from(this.metrics.strategyUsage.entries()).map(([strategy, usage]) => ({
      strategy,
      usage,
      averageEfficiency: this.batchStrategies.get(strategy)?.efficiency || 0
    }));

    return {
      efficiency,
      throughputImprovement,
      averageBatchUtilization,
      strategiesPerformance
    };
  }
}

export default RequestBatcherService;
