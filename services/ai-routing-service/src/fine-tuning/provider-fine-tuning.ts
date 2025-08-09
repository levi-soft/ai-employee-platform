
import { logger } from '@ai-platform/shared-utils';

export interface FineTuningDataset {
  id: string;
  name: string;
  description: string;
  provider: 'openai' | 'claude' | 'gemini' | 'local';
  dataFormat: 'jsonl' | 'csv' | 'parquet' | 'custom';
  size: number; // number of examples
  quality: 'high' | 'medium' | 'low';
  domain: string;
  examples: FineTuningExample[];
  metadata: {
    createdAt: number;
    updatedAt: number;
    version: string;
    tags: string[];
  };
}

export interface FineTuningExample {
  input: string;
  output: string;
  metadata?: {
    quality_score?: number;
    complexity?: 'simple' | 'medium' | 'complex';
    category?: string;
    source?: string;
  };
}

export interface FineTuningJob {
  id: string;
  provider: string;
  model: string;
  datasetId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number; // 0-100
  config: FineTuningConfig;
  metrics: FineTuningMetrics;
  startTime: number;
  endTime?: number;
  resultModel?: {
    id: string;
    name: string;
    performance: ModelPerformance;
  };
  error?: string;
}

export interface FineTuningConfig {
  epochs: number;
  batchSize: number;
  learningRate: number;
  validationSplit: number;
  earlyStoppingPatience: number;
  warmupSteps?: number;
  weightDecay?: number;
  dropoutRate?: number;
  gradientClipping?: number;
  customParameters?: Record<string, any>;
}

export interface FineTuningMetrics {
  loss: number[];
  validationLoss: number[];
  accuracy: number[];
  validationAccuracy: number[];
  perplexity?: number[];
  bleuScore?: number[];
  rougeScore?: number[];
  customMetrics?: Record<string, number[]>;
}

export interface ModelPerformance {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  perplexity?: number;
  bleuScore?: number;
  rougeScore?: number;
  inferenceSpeed: number; // tokens per second
  memoryUsage: number; // MB
  qualityScore: number; // 0-100
}

export interface FineTuningStrategy {
  name: string;
  description: string;
  provider: string;
  config: FineTuningConfig;
  requirements: {
    minDatasetSize: number;
    maxDatasetSize: number;
    recommendedQuality: string[];
    supportedDomains: string[];
  };
  expectedResults: {
    accuracyImprovement: string;
    trainingTime: string;
    resourceRequirements: string;
  };
}

export class ProviderFineTuningService {
  private datasets: Map<string, FineTuningDataset> = new Map();
  private jobs: Map<string, FineTuningJob> = new Map();
  private strategies: Map<string, FineTuningStrategy> = new Map();
  private activeJobs: Map<string, AbortController> = new Map();

  constructor() {
    this.setupDefaultStrategies();
    this.setupMonitoring();
  }

  /**
   * Create a new fine-tuning dataset
   */
  async createDataset(
    name: string,
    description: string,
    provider: string,
    examples: FineTuningExample[],
    options: {
      domain?: string;
      tags?: string[];
      validateQuality?: boolean;
    } = {}
  ): Promise<FineTuningDataset> {
    try {
      logger.info('Creating fine-tuning dataset', {
        name,
        provider,
        exampleCount: examples.length,
        domain: options.domain
      });

      // Validate dataset quality if requested
      if (options.validateQuality) {
        await this.validateDatasetQuality(examples);
      }

      const dataset: FineTuningDataset = {
        id: this.generateId(),
        name,
        description,
        provider: provider as any,
        dataFormat: 'jsonl',
        size: examples.length,
        quality: await this.assessDatasetQuality(examples),
        domain: options.domain || 'general',
        examples,
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: '1.0.0',
          tags: options.tags || []
        }
      };

      this.datasets.set(dataset.id, dataset);

      logger.info('Dataset created successfully', {
        datasetId: dataset.id,
        quality: dataset.quality,
        size: dataset.size
      });

      return dataset;

    } catch (error) {
      logger.error('Dataset creation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Start a fine-tuning job
   */
  async startFineTuning(
    datasetId: string,
    baseModel: string,
    provider: string,
    config?: Partial<FineTuningConfig>,
    strategyName?: string
  ): Promise<string> {
    try {
      const dataset = this.datasets.get(datasetId);
      if (!dataset) {
        throw new Error(`Dataset ${datasetId} not found`);
      }

      if (dataset.provider !== provider) {
        throw new Error(`Dataset provider (${dataset.provider}) doesn't match requested provider (${provider})`);
      }

      // Get fine-tuning strategy
      const strategy = strategyName ? this.strategies.get(strategyName) : this.getDefaultStrategy(provider);
      if (!strategy) {
        throw new Error(`No strategy available for provider ${provider}`);
      }

      // Validate dataset against strategy requirements
      this.validateDatasetForStrategy(dataset, strategy);

      const finalConfig = { ...strategy.config, ...config };
      
      const job: FineTuningJob = {
        id: this.generateId(),
        provider,
        model: baseModel,
        datasetId,
        status: 'pending',
        progress: 0,
        config: finalConfig,
        metrics: this.initializeMetrics(),
        startTime: Date.now()
      };

      this.jobs.set(job.id, job);

      logger.info('Fine-tuning job started', {
        jobId: job.id,
        provider,
        model: baseModel,
        datasetSize: dataset.size,
        strategy: strategyName || 'default'
      });

      // Start the actual fine-tuning process
      this.executeFineTuning(job);

      return job.id;

    } catch (error) {
      logger.error('Failed to start fine-tuning', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Monitor fine-tuning job progress
   */
  getJobStatus(jobId: string): FineTuningJob | null {
    return this.jobs.get(jobId) || null;
  }

  /**
   * Cancel a running fine-tuning job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    if (job.status === 'completed' || job.status === 'failed') {
      return false;
    }

    try {
      // Cancel the running job
      const controller = this.activeJobs.get(jobId);
      if (controller) {
        controller.abort();
        this.activeJobs.delete(jobId);
      }

      // Update job status
      job.status = 'cancelled';
      job.endTime = Date.now();

      logger.info('Fine-tuning job cancelled', { jobId });
      return true;

    } catch (error) {
      logger.error('Failed to cancel job', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Evaluate fine-tuned model performance
   */
  async evaluateModel(
    jobId: string,
    testDataset?: FineTuningExample[]
  ): Promise<ModelPerformance> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'completed') {
      throw new Error('Job not found or not completed');
    }

    try {
      const dataset = testDataset || this.datasets.get(job.datasetId)?.examples.slice(-100);
      if (!dataset) {
        throw new Error('No test dataset available');
      }

      logger.info('Evaluating model performance', {
        jobId,
        testSize: dataset.length
      });

      const performance = await this.runModelEvaluation(job, dataset);

      logger.info('Model evaluation completed', {
        jobId,
        accuracy: performance.accuracy,
        qualityScore: performance.qualityScore
      });

      return performance;

    } catch (error) {
      logger.error('Model evaluation failed', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get fine-tuning recommendations
   */
  async getRecommendations(
    datasetId: string,
    targetProvider: string
  ): Promise<{
    recommendations: string[];
    suggestedConfig: FineTuningConfig;
    estimatedTime: string;
    expectedImprovement: string;
  }> {
    const dataset = this.datasets.get(datasetId);
    if (!dataset) {
      throw new Error(`Dataset ${datasetId} not found`);
    }

    try {
      const analysis = await this.analyzeDataset(dataset);
      const recommendations = this.generateRecommendations(analysis, targetProvider);
      const suggestedConfig = this.suggestOptimalConfig(analysis, targetProvider);

      return {
        recommendations: recommendations.suggestions,
        suggestedConfig,
        estimatedTime: recommendations.estimatedTime,
        expectedImprovement: recommendations.expectedImprovement
      };

    } catch (error) {
      logger.error('Failed to generate recommendations', {
        datasetId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Compare multiple fine-tuning results
   */
  async compareModels(jobIds: string[]): Promise<{
    comparison: Array<{
      jobId: string;
      performance: ModelPerformance;
      rank: number;
      strengths: string[];
      weaknesses: string[];
    }>;
    recommendations: string[];
    bestModel: string;
  }> {
    try {
      const results = [];

      for (const jobId of jobIds) {
        const job = this.jobs.get(jobId);
        if (!job || job.status !== 'completed') {
          continue;
        }

        const performance = await this.evaluateModel(jobId);
        const analysis = this.analyzeModelStrengths(performance);

        results.push({
          jobId,
          performance,
          rank: 0, // Will be calculated
          strengths: analysis.strengths,
          weaknesses: analysis.weaknesses
        });
      }

      // Rank models by overall performance score
      results.sort((a, b) => this.calculateOverallScore(b.performance) - this.calculateOverallScore(a.performance));
      results.forEach((result, index) => {
        result.rank = index + 1;
      });

      const recommendations = this.generateComparisonRecommendations(results);
      const bestModel = results.length > 0 ? results[0].jobId : '';

      logger.info('Model comparison completed', {
        modelCount: results.length,
        bestModel
      });

      return {
        comparison: results,
        recommendations,
        bestModel
      };

    } catch (error) {
      logger.error('Model comparison failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get all datasets
   */
  getDatasets(): FineTuningDataset[] {
    return Array.from(this.datasets.values());
  }

  /**
   * Get all jobs
   */
  getJobs(): FineTuningJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get available strategies
   */
  getStrategies(): FineTuningStrategy[] {
    return Array.from(this.strategies.values());
  }

  private async executeFineTuning(job: FineTuningJob): Promise<void> {
    const controller = new AbortController();
    this.activeJobs.set(job.id, controller);

    try {
      job.status = 'running';
      
      // Simulate fine-tuning process
      await this.simulateFineTuning(job, controller.signal);
      
      if (!controller.signal.aborted) {
        job.status = 'completed';
        job.progress = 100;
        job.endTime = Date.now();
        
        // Generate result model
        job.resultModel = {
          id: `ft-${job.id}`,
          name: `Fine-tuned ${job.model}`,
          performance: await this.simulateModelPerformance()
        };

        logger.info('Fine-tuning completed successfully', {
          jobId: job.id,
          duration: job.endTime - job.startTime
        });
      }

    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.endTime = Date.now();

      logger.error('Fine-tuning failed', {
        jobId: job.id,
        error: job.error
      });

    } finally {
      this.activeJobs.delete(job.id);
    }
  }

  private async simulateFineTuning(job: FineTuningJob, signal: AbortSignal): Promise<void> {
    const totalSteps = job.config.epochs * 10; // Simulate steps per epoch
    
    for (let step = 0; step < totalSteps; step++) {
      if (signal.aborted) {
        throw new Error('Job was cancelled');
      }

      // Simulate training step
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Update progress
      job.progress = Math.round((step / totalSteps) * 100);
      
      // Update metrics
      const epoch = Math.floor(step / 10);
      if (step % 10 === 0) {
        job.metrics.loss[epoch] = 2.0 - (epoch * 0.1) + Math.random() * 0.1;
        job.metrics.validationLoss[epoch] = 2.1 - (epoch * 0.08) + Math.random() * 0.1;
        job.metrics.accuracy[epoch] = 0.5 + (epoch * 0.05) + Math.random() * 0.05;
        job.metrics.validationAccuracy[epoch] = 0.45 + (epoch * 0.04) + Math.random() * 0.05;
      }
    }
  }

  private async simulateModelPerformance(): Promise<ModelPerformance> {
    return {
      accuracy: 0.85 + Math.random() * 0.1,
      precision: 0.82 + Math.random() * 0.1,
      recall: 0.79 + Math.random() * 0.1,
      f1Score: 0.81 + Math.random() * 0.08,
      perplexity: 15 + Math.random() * 5,
      inferenceSpeed: 25 + Math.random() * 15,
      memoryUsage: 4000 + Math.random() * 2000,
      qualityScore: 75 + Math.random() * 20
    };
  }

  private async validateDatasetQuality(examples: FineTuningExample[]): Promise<void> {
    if (examples.length < 10) {
      throw new Error('Dataset too small - minimum 10 examples required');
    }

    const avgInputLength = examples.reduce((sum, ex) => sum + ex.input.length, 0) / examples.length;
    const avgOutputLength = examples.reduce((sum, ex) => sum + ex.output.length, 0) / examples.length;

    if (avgInputLength < 10) {
      throw new Error('Average input length too short');
    }

    if (avgOutputLength < 5) {
      throw new Error('Average output length too short');
    }

    // Check for duplicates
    const uniqueInputs = new Set(examples.map(ex => ex.input));
    if (uniqueInputs.size < examples.length * 0.9) {
      logger.warn('Dataset contains many duplicate inputs');
    }
  }

  private async assessDatasetQuality(examples: FineTuningExample[]): Promise<'high' | 'medium' | 'low'> {
    // Simple quality assessment based on various factors
    let score = 0;

    // Size factor
    if (examples.length >= 1000) score += 30;
    else if (examples.length >= 100) score += 20;
    else if (examples.length >= 50) score += 10;

    // Diversity factor
    const uniqueInputs = new Set(examples.map(ex => ex.input)).size;
    const diversityRatio = uniqueInputs / examples.length;
    score += diversityRatio * 30;

    // Length factor
    const avgInputLength = examples.reduce((sum, ex) => sum + ex.input.length, 0) / examples.length;
    if (avgInputLength > 100) score += 20;
    else if (avgInputLength > 50) score += 15;
    else if (avgInputLength > 20) score += 10;

    // Quality metadata factor
    const withQualityScore = examples.filter(ex => ex.metadata?.quality_score).length;
    if (withQualityScore > examples.length * 0.5) score += 20;

    if (score >= 80) return 'high';
    if (score >= 60) return 'medium';
    return 'low';
  }

  private validateDatasetForStrategy(dataset: FineTuningDataset, strategy: FineTuningStrategy): void {
    const req = strategy.requirements;

    if (dataset.size < req.minDatasetSize) {
      throw new Error(`Dataset too small: ${dataset.size} < ${req.minDatasetSize}`);
    }

    if (dataset.size > req.maxDatasetSize) {
      throw new Error(`Dataset too large: ${dataset.size} > ${req.maxDatasetSize}`);
    }

    if (!req.recommendedQuality.includes(dataset.quality)) {
      logger.warn('Dataset quality not optimal for this strategy', {
        datasetQuality: dataset.quality,
        recommendedQuality: req.recommendedQuality
      });
    }

    if (req.supportedDomains.length > 0 && !req.supportedDomains.includes(dataset.domain)) {
      logger.warn('Dataset domain not specifically supported by this strategy', {
        datasetDomain: dataset.domain,
        supportedDomains: req.supportedDomains
      });
    }
  }

  private async analyzeDataset(dataset: FineTuningDataset): Promise<any> {
    const examples = dataset.examples;
    
    return {
      size: examples.length,
      quality: dataset.quality,
      domain: dataset.domain,
      averageInputLength: examples.reduce((sum, ex) => sum + ex.input.length, 0) / examples.length,
      averageOutputLength: examples.reduce((sum, ex) => sum + ex.output.length, 0) / examples.length,
      complexity: this.assessComplexity(examples),
      diversity: this.assessDiversity(examples)
    };
  }

  private generateRecommendations(analysis: any, provider: string): any {
    const suggestions: string[] = [];
    let estimatedTime = '2-4 hours';
    let expectedImprovement = '10-20% accuracy improvement';

    if (analysis.size < 100) {
      suggestions.push('Consider collecting more training examples (current: ' + analysis.size + ', recommended: 100+)');
      estimatedTime = '1-2 hours';
      expectedImprovement = '5-15% accuracy improvement';
    }

    if (analysis.quality === 'low') {
      suggestions.push('Improve dataset quality by adding quality scores and validation');
    }

    if (analysis.complexity === 'low') {
      suggestions.push('Add more complex examples to improve model capabilities');
    }

    if (analysis.diversity < 0.8) {
      suggestions.push('Increase dataset diversity to improve generalization');
    }

    if (provider === 'openai' && analysis.size > 10000) {
      estimatedTime = '6-12 hours';
      expectedImprovement = '20-35% accuracy improvement';
    }

    return {
      suggestions,
      estimatedTime,
      expectedImprovement
    };
  }

  private suggestOptimalConfig(analysis: any, provider: string): FineTuningConfig {
    const baseConfig = this.getDefaultStrategy(provider)?.config || this.getDefaultConfig();

    // Adjust based on dataset analysis
    if (analysis.size < 100) {
      baseConfig.epochs = Math.max(baseConfig.epochs * 1.5, 10);
      baseConfig.learningRate *= 0.8;
    }

    if (analysis.complexity === 'high') {
      baseConfig.learningRate *= 0.7;
      baseConfig.epochs = Math.min(baseConfig.epochs * 1.3, 20);
    }

    if (analysis.quality === 'low') {
      baseConfig.validationSplit = Math.max(baseConfig.validationSplit, 0.2);
      baseConfig.earlyStoppingPatience *= 1.5;
    }

    return baseConfig;
  }

  private async runModelEvaluation(job: FineTuningJob, testDataset: FineTuningExample[]): Promise<ModelPerformance> {
    // Simulate model evaluation
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return job.resultModel?.performance || await this.simulateModelPerformance();
  }

  private analyzeModelStrengths(performance: ModelPerformance): { strengths: string[]; weaknesses: string[] } {
    const strengths: string[] = [];
    const weaknesses: string[] = [];

    if (performance.accuracy > 0.9) strengths.push('High accuracy');
    else if (performance.accuracy < 0.7) weaknesses.push('Low accuracy');

    if (performance.inferenceSpeed > 30) strengths.push('Fast inference');
    else if (performance.inferenceSpeed < 15) weaknesses.push('Slow inference');

    if (performance.memoryUsage < 4000) strengths.push('Memory efficient');
    else if (performance.memoryUsage > 8000) weaknesses.push('High memory usage');

    if (performance.qualityScore > 85) strengths.push('High quality responses');
    else if (performance.qualityScore < 70) weaknesses.push('Quality concerns');

    return { strengths, weaknesses };
  }

  private calculateOverallScore(performance: ModelPerformance): number {
    return (
      performance.accuracy * 0.3 +
      performance.f1Score * 0.2 +
      (performance.inferenceSpeed / 50) * 0.2 +
      (performance.qualityScore / 100) * 0.2 +
      (1 - performance.memoryUsage / 10000) * 0.1
    );
  }

  private generateComparisonRecommendations(results: any[]): string[] {
    const recommendations: string[] = [];

    if (results.length === 0) {
      return ['No models to compare'];
    }

    const best = results[0];
    const worst = results[results.length - 1];

    if (best.performance.accuracy > worst.performance.accuracy + 0.1) {
      recommendations.push(`Model ${best.jobId} shows significantly better accuracy (+${((best.performance.accuracy - worst.performance.accuracy) * 100).toFixed(1)}%)`);
    }

    if (best.performance.inferenceSpeed > worst.performance.inferenceSpeed * 1.5) {
      recommendations.push(`Model ${best.jobId} is ${(best.performance.inferenceSpeed / worst.performance.inferenceSpeed).toFixed(1)}x faster`);
    }

    recommendations.push(`Consider using model ${best.jobId} for production deployment`);

    return recommendations;
  }

  private assessComplexity(examples: FineTuningExample[]): 'low' | 'medium' | 'high' {
    const avgInputLength = examples.reduce((sum, ex) => sum + ex.input.length, 0) / examples.length;
    const avgOutputLength = examples.reduce((sum, ex) => sum + ex.output.length, 0) / examples.length;

    if (avgInputLength > 200 || avgOutputLength > 100) return 'high';
    if (avgInputLength > 100 || avgOutputLength > 50) return 'medium';
    return 'low';
  }

  private assessDiversity(examples: FineTuningExample[]): number {
    const uniqueInputs = new Set(examples.map(ex => ex.input));
    return uniqueInputs.size / examples.length;
  }

  private initializeMetrics(): FineTuningMetrics {
    return {
      loss: [],
      validationLoss: [],
      accuracy: [],
      validationAccuracy: []
    };
  }

  private getDefaultStrategy(provider: string): FineTuningStrategy | undefined {
    return this.strategies.get(`${provider}_default`);
  }

  private getDefaultConfig(): FineTuningConfig {
    return {
      epochs: 3,
      batchSize: 4,
      learningRate: 5e-5,
      validationSplit: 0.1,
      earlyStoppingPatience: 3,
      warmupSteps: 100,
      weightDecay: 0.01
    };
  }

  private generateId(): string {
    return `ft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private setupDefaultStrategies(): void {
    const strategies: FineTuningStrategy[] = [
      {
        name: 'openai_default',
        description: 'Default fine-tuning strategy for OpenAI models',
        provider: 'openai',
        config: {
          epochs: 4,
          batchSize: 4,
          learningRate: 3e-5,
          validationSplit: 0.1,
          earlyStoppingPatience: 3
        },
        requirements: {
          minDatasetSize: 10,
          maxDatasetSize: 50000,
          recommendedQuality: ['medium', 'high'],
          supportedDomains: ['general', 'code', 'chat', 'classification']
        },
        expectedResults: {
          accuracyImprovement: '15-30%',
          trainingTime: '2-6 hours',
          resourceRequirements: 'Medium GPU usage'
        }
      },
      {
        name: 'claude_advanced',
        description: 'Advanced fine-tuning strategy for Claude models',
        provider: 'claude',
        config: {
          epochs: 5,
          batchSize: 2,
          learningRate: 2e-5,
          validationSplit: 0.15,
          earlyStoppingPatience: 5,
          weightDecay: 0.01
        },
        requirements: {
          minDatasetSize: 50,
          maxDatasetSize: 20000,
          recommendedQuality: ['high'],
          supportedDomains: ['reasoning', 'analysis', 'creative']
        },
        expectedResults: {
          accuracyImprovement: '20-40%',
          trainingTime: '3-8 hours',
          resourceRequirements: 'High GPU usage'
        }
      },
      {
        name: 'local_efficient',
        description: 'Efficient fine-tuning for local models',
        provider: 'local',
        config: {
          epochs: 6,
          batchSize: 8,
          learningRate: 1e-4,
          validationSplit: 0.2,
          earlyStoppingPatience: 4,
          gradientClipping: 1.0
        },
        requirements: {
          minDatasetSize: 100,
          maxDatasetSize: 100000,
          recommendedQuality: ['medium', 'high'],
          supportedDomains: ['general', 'domain-specific']
        },
        expectedResults: {
          accuracyImprovement: '10-25%',
          trainingTime: '4-12 hours',
          resourceRequirements: 'Variable (CPU/GPU)'
        }
      }
    ];

    strategies.forEach(strategy => {
      this.strategies.set(strategy.name, strategy);
    });

    logger.info('Default fine-tuning strategies loaded', {
      strategyCount: this.strategies.size
    });
  }

  private setupMonitoring(): void {
    // Monitor active jobs every 30 seconds
    setInterval(() => {
      const activeJobCount = Array.from(this.jobs.values())
        .filter(job => job.status === 'running').length;
      
      if (activeJobCount > 0) {
        logger.debug('Fine-tuning jobs status', {
          activeJobs: activeJobCount,
          totalJobs: this.jobs.size
        });
      }
    }, 30000);

    // Clean up old completed jobs every hour
    setInterval(() => {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
      const jobsToDelete = Array.from(this.jobs.entries())
        .filter(([_, job]) => job.endTime && job.endTime < cutoff)
        .map(([id]) => id);

      jobsToDelete.forEach(id => this.jobs.delete(id));

      if (jobsToDelete.length > 0) {
        logger.info('Cleaned up old fine-tuning jobs', {
          deletedCount: jobsToDelete.length
        });
      }
    }, 60 * 60 * 1000);
  }
}

export default new ProviderFineTuningService();
