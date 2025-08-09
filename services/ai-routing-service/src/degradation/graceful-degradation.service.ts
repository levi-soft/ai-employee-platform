
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';

export interface DegradationConfig {
  enableDegradation: boolean;
  responseTimeThreshold: number;
  errorRateThreshold: number;
  memoryThreshold: number;
  cpuThreshold: number;
  degradationLevels: DegradationLevel[];
  recoveryThreshold: number;
  monitoringInterval: number;
}

export interface DegradationLevel {
  id: string;
  name: string;
  priority: number;
  triggers: DegradationTrigger[];
  actions: DegradationAction[];
  qualityReduction: number;
  performanceImprovement: number;
  description: string;
}

export interface DegradationTrigger {
  type: 'error_rate' | 'response_time' | 'memory_usage' | 'cpu_usage' | 'request_volume' | 'custom';
  threshold: number;
  duration: number; // milliseconds
  operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
}

export interface DegradationAction {
  type: 'reduce_quality' | 'disable_features' | 'cache_responses' | 'limit_requests' | 'simplify_processing' | 'custom';
  parameters: Record<string, any>;
  enabled: boolean;
}

export interface SystemMetrics {
  responseTime: number;
  errorRate: number;
  memoryUsage: number;
  cpuUsage: number;
  requestVolume: number;
  activeConnections: number;
  timestamp: Date;
}

export interface DegradationState {
  level: DegradationLevel | null;
  isActive: boolean;
  activatedAt?: Date;
  reason: string[];
  metrics: SystemMetrics;
  actionsActive: string[];
  nextEvaluation: Date;
}

export interface DegradedResponse {
  data: any;
  metadata: {
    degraded: true;
    level: string;
    qualityReduction: number;
    reason: string[];
    timestamp: Date;
    originalRequest?: any;
  };
}

export class GracefulDegradationService extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: DegradationConfig;
  private currentState: DegradationState;
  private systemMetrics: SystemMetrics[] = [];
  private metricsWindow = 60000; // 1 minute
  private monitoringInterval: NodeJS.Timeout | null = null;
  
  private metrics = {
    degradationsActivated: 0,
    degradationsRecovered: 0,
    levelChanges: 0,
    responsesDegraded: 0,
    qualityImpact: 0,
    performanceGains: 0,
    triggersActivated: new Map<string, number>()
  };

  private responseTemplates: Map<string, any> = new Map();

  constructor(config: Partial<DegradationConfig> = {}) {
    super();
    this.logger = new Logger('GracefulDegradationService');
    
    this.config = {
      enableDegradation: true,
      responseTimeThreshold: 5000,
      errorRateThreshold: 0.1,
      memoryThreshold: 0.85,
      cpuThreshold: 0.8,
      recoveryThreshold: 0.7,
      monitoringInterval: 5000,
      degradationLevels: [],
      ...config
    };

    // Initialize with default degradation levels if none provided
    if (this.config.degradationLevels.length === 0) {
      this.config.degradationLevels = this.getDefaultDegradationLevels();
    }

    this.currentState = {
      level: null,
      isActive: false,
      reason: [],
      metrics: this.createInitialMetrics(),
      actionsActive: [],
      nextEvaluation: new Date()
    };

    this.initializeResponseTemplates();
    this.startMonitoring();
  }

  /**
   * Get default degradation levels
   */
  private getDefaultDegradationLevels(): DegradationLevel[] {
    return [
      {
        id: 'level1',
        name: 'Light Degradation',
        priority: 1,
        triggers: [
          { type: 'response_time', threshold: 3000, duration: 30000, operator: 'gt' },
          { type: 'error_rate', threshold: 0.05, duration: 30000, operator: 'gt' }
        ],
        actions: [
          { type: 'reduce_quality', parameters: { reduction: 0.1 }, enabled: true },
          { type: 'cache_responses', parameters: { ttl: 300 }, enabled: true }
        ],
        qualityReduction: 0.1,
        performanceImprovement: 0.15,
        description: 'Slight quality reduction with aggressive caching'
      },
      {
        id: 'level2',
        name: 'Moderate Degradation',
        priority: 2,
        triggers: [
          { type: 'response_time', threshold: 5000, duration: 60000, operator: 'gt' },
          { type: 'error_rate', threshold: 0.1, duration: 30000, operator: 'gt' },
          { type: 'memory_usage', threshold: 0.8, duration: 60000, operator: 'gt' }
        ],
        actions: [
          { type: 'reduce_quality', parameters: { reduction: 0.25 }, enabled: true },
          { type: 'disable_features', parameters: { features: ['detailed_analysis', 'enhanced_formatting'] }, enabled: true },
          { type: 'limit_requests', parameters: { maxConcurrent: 50 }, enabled: true }
        ],
        qualityReduction: 0.25,
        performanceImprovement: 0.3,
        description: 'Disable non-essential features and limit concurrency'
      },
      {
        id: 'level3',
        name: 'Heavy Degradation',
        priority: 3,
        triggers: [
          { type: 'response_time', threshold: 8000, duration: 60000, operator: 'gt' },
          { type: 'error_rate', threshold: 0.2, duration: 30000, operator: 'gt' },
          { type: 'memory_usage', threshold: 0.9, duration: 30000, operator: 'gt' },
          { type: 'cpu_usage', threshold: 0.85, duration: 30000, operator: 'gt' }
        ],
        actions: [
          { type: 'reduce_quality', parameters: { reduction: 0.5 }, enabled: true },
          { type: 'disable_features', parameters: { features: ['complex_analysis', 'multimodal_processing', 'context_awareness'] }, enabled: true },
          { type: 'simplify_processing', parameters: { maxTokens: 1000, skipOptimization: true }, enabled: true }
        ],
        qualityReduction: 0.5,
        performanceImprovement: 0.6,
        description: 'Minimal processing with basic responses only'
      },
      {
        id: 'emergency',
        name: 'Emergency Mode',
        priority: 4,
        triggers: [
          { type: 'error_rate', threshold: 0.5, duration: 10000, operator: 'gt' },
          { type: 'memory_usage', threshold: 0.95, duration: 10000, operator: 'gt' }
        ],
        actions: [
          { type: 'cache_responses', parameters: { useStatic: true }, enabled: true },
          { type: 'disable_features', parameters: { features: ['*'] }, enabled: true }
        ],
        qualityReduction: 0.8,
        performanceImprovement: 0.9,
        description: 'Emergency mode with static responses only'
      }
    ];
  }

  /**
   * Initialize response templates for degraded responses
   */
  private initializeResponseTemplates(): void {
    this.responseTemplates.set('light', {
      general: 'I can help with that, though my response may be slightly simplified due to current system load.',
      analysis: 'Here\'s a basic analysis of your request. For more detailed insights, please try again later.',
      creative: 'Here\'s a creative response, though it may be less elaborate than usual.'
    });

    this.responseTemplates.set('moderate', {
      general: 'I can provide a basic response to your request. Some advanced features are temporarily unavailable.',
      analysis: 'Here\'s a simplified analysis. Advanced analysis features are currently limited.',
      creative: 'I can offer a basic creative response. Enhanced creativity features are temporarily reduced.'
    });

    this.responseTemplates.set('heavy', {
      general: 'I can provide only basic responses due to high system load. Please try again later for full functionality.',
      analysis: 'Basic analysis only. Complex analytical features are currently unavailable.',
      creative: 'Simple response provided. Creative features are currently limited.'
    });

    this.responseTemplates.set('emergency', {
      general: 'Service is experiencing high load. Please try again in a few minutes.',
      analysis: 'Analysis services are temporarily unavailable due to system constraints.',
      creative: 'Creative services are temporarily unavailable. Please try again later.'
    });
  }

  /**
   * Process request with graceful degradation
   */
  async processRequest(
    originalRequest: any,
    processingFunction: () => Promise<any>
  ): Promise<DegradedResponse | { data: any }> {
    
    if (!this.config.enableDegradation || !this.currentState.isActive) {
      // No degradation active, process normally
      try {
        const result = await processingFunction();
        return { data: result };
      } catch (error) {
        // If processing fails and degradation is enabled, fall back to degraded response
        if (this.config.enableDegradation) {
          return this.generateDegradedResponse(originalRequest, 'Processing failed, providing fallback response');
        }
        throw error;
      }
    }

    // Degradation is active
    const level = this.currentState.level;
    if (!level) {
      // Fallback to normal processing
      const result = await processingFunction();
      return { data: result };
    }

    this.metrics.responsesDegraded++;
    this.metrics.qualityImpact += level.qualityReduction;

    this.logger.info('Processing request with degradation', {
      level: level.name,
      qualityReduction: level.qualityReduction,
      actionsActive: this.currentState.actionsActive
    });

    // Apply degradation actions
    const degradedResult = await this.applyDegradationActions(
      originalRequest,
      processingFunction,
      level
    );

    return {
      data: degradedResult,
      metadata: {
        degraded: true,
        level: level.name,
        qualityReduction: level.qualityReduction,
        reason: this.currentState.reason,
        timestamp: new Date(),
        originalRequest: this.shouldIncludeOriginalRequest(level) ? originalRequest : undefined
      }
    };
  }

  /**
   * Apply degradation actions to request processing
   */
  private async applyDegradationActions(
    originalRequest: any,
    processingFunction: () => Promise<any>,
    level: DegradationLevel
  ): Promise<any> {
    
    let result: any;

    for (const action of level.actions) {
      if (!action.enabled) continue;

      try {
        switch (action.type) {
          case 'reduce_quality':
            result = await this.reduceQuality(originalRequest, processingFunction, action.parameters);
            break;
            
          case 'disable_features':
            result = await this.disableFeatures(originalRequest, processingFunction, action.parameters);
            break;
            
          case 'cache_responses':
            result = await this.cacheResponse(originalRequest, processingFunction, action.parameters);
            break;
            
          case 'limit_requests':
            result = await this.limitRequest(originalRequest, processingFunction, action.parameters);
            break;
            
          case 'simplify_processing':
            result = await this.simplifyProcessing(originalRequest, processingFunction, action.parameters);
            break;
            
          case 'custom':
            result = await this.customAction(originalRequest, processingFunction, action.parameters);
            break;
        }

        if (result) {
          this.logger.debug('Applied degradation action', {
            action: action.type,
            level: level.name
          });
          return result;
        }

      } catch (error) {
        this.logger.warn('Degradation action failed', {
          action: action.type,
          error: error.message
        });
      }
    }

    // If all actions failed, return static response
    return this.generateStaticResponse(originalRequest, level);
  }

  /**
   * Quality reduction action
   */
  private async reduceQuality(
    originalRequest: any,
    processingFunction: () => Promise<any>,
    parameters: any
  ): Promise<any> {
    
    try {
      // Try to process with reduced parameters
      const result = await this.processWithReducedQuality(processingFunction, parameters.reduction);
      return result;
    } catch (error) {
      // Fallback to template response
      return this.generateTemplateResponse(originalRequest, 'light');
    }
  }

  /**
   * Feature disabling action
   */
  private async disableFeatures(
    originalRequest: any,
    processingFunction: () => Promise<any>,
    parameters: any
  ): Promise<any> {
    
    const disabledFeatures = parameters.features || [];
    
    if (disabledFeatures.includes('*')) {
      // All features disabled, return static response
      return this.generateTemplateResponse(originalRequest, 'emergency');
    }

    try {
      // Process with disabled features
      const result = await this.processWithDisabledFeatures(processingFunction, disabledFeatures);
      return result;
    } catch (error) {
      return this.generateTemplateResponse(originalRequest, 'moderate');
    }
  }

  /**
   * Response caching action
   */
  private async cacheResponse(
    originalRequest: any,
    processingFunction: () => Promise<any>,
    parameters: any
  ): Promise<any> {
    
    if (parameters.useStatic) {
      // Return static cached response
      return this.generateTemplateResponse(originalRequest, 'emergency');
    }

    // Try to use cached response if available
    const cacheKey = this.generateCacheKey(originalRequest);
    const cachedResponse = await this.getCachedResponse(cacheKey);
    
    if (cachedResponse) {
      this.logger.debug('Using cached response for degraded request');
      return cachedResponse;
    }

    // No cache available, process and cache
    try {
      const result = await processingFunction();
      await this.setCachedResponse(cacheKey, result, parameters.ttl || 300);
      return result;
    } catch (error) {
      return this.generateTemplateResponse(originalRequest, 'moderate');
    }
  }

  /**
   * Request limiting action
   */
  private async limitRequest(
    originalRequest: any,
    processingFunction: () => Promise<any>,
    parameters: any
  ): Promise<any> {
    
    const maxConcurrent = parameters.maxConcurrent || 10;
    
    // Check current concurrent requests
    if (this.getCurrentConcurrentRequests() > maxConcurrent) {
      this.logger.info('Request rejected due to concurrency limit', {
        current: this.getCurrentConcurrentRequests(),
        limit: maxConcurrent
      });
      
      return this.generateTemplateResponse(originalRequest, 'moderate');
    }

    try {
      return await processingFunction();
    } catch (error) {
      return this.generateTemplateResponse(originalRequest, 'moderate');
    }
  }

  /**
   * Processing simplification action
   */
  private async simplifyProcessing(
    originalRequest: any,
    processingFunction: () => Promise<any>,
    parameters: any
  ): Promise<any> {
    
    try {
      // Process with simplified parameters
      const result = await this.processSimplified(processingFunction, parameters);
      return result;
    } catch (error) {
      return this.generateTemplateResponse(originalRequest, 'heavy');
    }
  }

  /**
   * Custom action handler
   */
  private async customAction(
    originalRequest: any,
    processingFunction: () => Promise<any>,
    parameters: any
  ): Promise<any> {
    
    // Implement custom logic based on parameters
    this.logger.debug('Executing custom degradation action', { parameters });
    
    try {
      return await processingFunction();
    } catch (error) {
      return this.generateTemplateResponse(originalRequest, 'moderate');
    }
  }

  /**
   * Generate degraded response when normal processing fails
   */
  private generateDegradedResponse(originalRequest: any, reason: string): DegradedResponse {
    const level = this.currentState.level || this.config.degradationLevels[0];
    
    return {
      data: this.generateTemplateResponse(originalRequest, 'light'),
      metadata: {
        degraded: true,
        level: level.name,
        qualityReduction: level.qualityReduction,
        reason: [reason],
        timestamp: new Date(),
        originalRequest: originalRequest
      }
    };
  }

  /**
   * Generate template response based on degradation level
   */
  private generateTemplateResponse(originalRequest: any, templateType: string): any {
    const templates = this.responseTemplates.get(templateType);
    if (!templates) {
      return {
        message: 'Service is currently experiencing degraded performance. Please try again later.',
        status: 'degraded'
      };
    }

    // Determine response type based on request
    const requestType = this.classifyRequest(originalRequest);
    const template = templates[requestType] || templates.general;

    return {
      message: template,
      status: 'degraded',
      type: templateType,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate static response for emergency mode
   */
  private generateStaticResponse(originalRequest: any, level: DegradationLevel): any {
    return {
      message: 'Service is currently operating in emergency mode. Please try again later.',
      status: 'emergency',
      level: level.name,
      timestamp: new Date().toISOString(),
      supportContact: 'support@ai-platform.com'
    };
  }

  /**
   * Monitor system metrics and evaluate degradation triggers
   */
  private startMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      this.updateSystemMetrics();
      this.evaluateDegradationTriggers();
    }, this.config.monitoringInterval);

    this.logger.info('Started graceful degradation monitoring');
  }

  /**
   * Update current system metrics
   */
  private updateSystemMetrics(): void {
    // Simulate system metrics
    const metrics: SystemMetrics = {
      responseTime: 1000 + Math.random() * 3000,
      errorRate: Math.random() * 0.15,
      memoryUsage: 0.5 + Math.random() * 0.4,
      cpuUsage: 0.3 + Math.random() * 0.5,
      requestVolume: Math.floor(Math.random() * 1000),
      activeConnections: Math.floor(Math.random() * 200),
      timestamp: new Date()
    };

    this.systemMetrics.push(metrics);
    
    // Keep only recent metrics
    const cutoff = Date.now() - this.metricsWindow;
    this.systemMetrics = this.systemMetrics.filter(m => m.timestamp.getTime() > cutoff);

    this.currentState.metrics = metrics;
  }

  /**
   * Evaluate degradation triggers
   */
  private evaluateDegradationTriggers(): void {
    if (Date.now() < this.currentState.nextEvaluation.getTime()) {
      return; // Too early for next evaluation
    }

    const triggeredLevels = this.config.degradationLevels
      .filter(level => this.isLevelTriggered(level))
      .sort((a, b) => b.priority - a.priority); // Highest priority first

    const newLevel = triggeredLevels[0] || null;

    // Check for recovery if currently degraded
    if (this.currentState.isActive && this.shouldRecover()) {
      this.recoverFromDegradation();
      return;
    }

    // Check for degradation level change
    if (!this.currentState.level && newLevel) {
      this.activateDegradation(newLevel);
    } else if (this.currentState.level && newLevel && this.currentState.level.id !== newLevel.id) {
      this.changeDegradationLevel(newLevel);
    }

    // Schedule next evaluation
    this.currentState.nextEvaluation = new Date(Date.now() + this.config.monitoringInterval);
  }

  /**
   * Check if degradation level should be triggered
   */
  private isLevelTriggered(level: DegradationLevel): boolean {
    return level.triggers.every(trigger => this.isTriggerActive(trigger));
  }

  /**
   * Check if individual trigger is active
   */
  private isTriggerActive(trigger: DegradationTrigger): boolean {
    const recentMetrics = this.getRecentMetrics(trigger.duration);
    if (recentMetrics.length === 0) return false;

    let value: number;
    switch (trigger.type) {
      case 'response_time':
        value = recentMetrics.reduce((sum, m) => sum + m.responseTime, 0) / recentMetrics.length;
        break;
      case 'error_rate':
        value = recentMetrics.reduce((sum, m) => sum + m.errorRate, 0) / recentMetrics.length;
        break;
      case 'memory_usage':
        value = recentMetrics.reduce((sum, m) => sum + m.memoryUsage, 0) / recentMetrics.length;
        break;
      case 'cpu_usage':
        value = recentMetrics.reduce((sum, m) => sum + m.cpuUsage, 0) / recentMetrics.length;
        break;
      case 'request_volume':
        value = recentMetrics.reduce((sum, m) => sum + m.requestVolume, 0) / recentMetrics.length;
        break;
      default:
        return false;
    }

    return this.compareValues(value, trigger.threshold, trigger.operator);
  }

  /**
   * Compare values based on operator
   */
  private compareValues(value: number, threshold: number, operator: string): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return Math.abs(value - threshold) < 0.001;
      default: return false;
    }
  }

  /**
   * Get recent metrics within duration
   */
  private getRecentMetrics(duration: number): SystemMetrics[] {
    const cutoff = Date.now() - duration;
    return this.systemMetrics.filter(m => m.timestamp.getTime() > cutoff);
  }

  /**
   * Check if system should recover from degradation
   */
  private shouldRecover(): boolean {
    if (!this.currentState.level) return false;

    const recentMetrics = this.getRecentMetrics(30000); // Last 30 seconds
    if (recentMetrics.length === 0) return false;

    const avgErrorRate = recentMetrics.reduce((sum, m) => sum + m.errorRate, 0) / recentMetrics.length;
    const avgResponseTime = recentMetrics.reduce((sum, m) => sum + m.responseTime, 0) / recentMetrics.length;

    return avgErrorRate < this.config.errorRateThreshold * this.config.recoveryThreshold &&
           avgResponseTime < this.config.responseTimeThreshold * this.config.recoveryThreshold;
  }

  /**
   * Activate degradation
   */
  private activateDegradation(level: DegradationLevel): void {
    this.currentState.level = level;
    this.currentState.isActive = true;
    this.currentState.activatedAt = new Date();
    this.currentState.reason = this.getActivationReasons(level);
    this.currentState.actionsActive = level.actions
      .filter(action => action.enabled)
      .map(action => action.type);

    this.metrics.degradationsActivated++;
    this.metrics.levelChanges++;

    // Track triggers
    level.triggers.forEach(trigger => {
      const count = this.metrics.triggersActivated.get(trigger.type) || 0;
      this.metrics.triggersActivated.set(trigger.type, count + 1);
    });

    this.emit('degradationActivated', {
      level: level.name,
      reason: this.currentState.reason,
      metrics: this.currentState.metrics
    });

    this.logger.warn('Degradation activated', {
      level: level.name,
      priority: level.priority,
      qualityReduction: level.qualityReduction,
      reason: this.currentState.reason
    });
  }

  /**
   * Change degradation level
   */
  private changeDegradationLevel(newLevel: DegradationLevel): void {
    const previousLevel = this.currentState.level;
    
    this.currentState.level = newLevel;
    this.currentState.reason = this.getActivationReasons(newLevel);
    this.currentState.actionsActive = newLevel.actions
      .filter(action => action.enabled)
      .map(action => action.type);

    this.metrics.levelChanges++;

    this.emit('degradationLevelChanged', {
      previousLevel: previousLevel?.name,
      newLevel: newLevel.name,
      reason: this.currentState.reason,
      metrics: this.currentState.metrics
    });

    this.logger.warn('Degradation level changed', {
      from: previousLevel?.name,
      to: newLevel.name,
      reason: this.currentState.reason
    });
  }

  /**
   * Recover from degradation
   */
  private recoverFromDegradation(): void {
    const previousLevel = this.currentState.level;
    
    this.currentState.level = null;
    this.currentState.isActive = false;
    this.currentState.reason = [];
    this.currentState.actionsActive = [];
    delete this.currentState.activatedAt;

    this.metrics.degradationsRecovered++;

    this.emit('degradationRecovered', {
      previousLevel: previousLevel?.name,
      duration: this.currentState.activatedAt ? 
        Date.now() - this.currentState.activatedAt.getTime() : 0,
      metrics: this.currentState.metrics
    });

    this.logger.info('Recovered from degradation', {
      previousLevel: previousLevel?.name,
      duration: this.currentState.activatedAt ? 
        Date.now() - this.currentState.activatedAt.getTime() : 0
    });
  }

  /**
   * Get activation reasons for level
   */
  private getActivationReasons(level: DegradationLevel): string[] {
    const reasons: string[] = [];
    
    level.triggers.forEach(trigger => {
      if (this.isTriggerActive(trigger)) {
        reasons.push(`${trigger.type} exceeded threshold: ${trigger.threshold}`);
      }
    });

    return reasons;
  }

  /**
   * Helper methods for degradation actions
   */
  private async processWithReducedQuality(
    processingFunction: () => Promise<any>,
    reduction: number
  ): Promise<any> {
    // Simulate quality reduction by adding noise or limiting detail
    const result = await processingFunction();
    
    if (typeof result === 'string') {
      return result.substring(0, Math.floor(result.length * (1 - reduction))) + '...';
    }
    
    return result;
  }

  private async processWithDisabledFeatures(
    processingFunction: () => Promise<any>,
    disabledFeatures: string[]
  ): Promise<any> {
    // Process with limited functionality
    return await processingFunction();
  }

  private async processSimplified(
    processingFunction: () => Promise<any>,
    parameters: any
  ): Promise<any> {
    // Simplified processing
    return await processingFunction();
  }

  private generateCacheKey(request: any): string {
    return `degraded:${JSON.stringify(request)}`;
  }

  private async getCachedResponse(key: string): Promise<any> {
    // Simulate cache lookup
    return null; // No cache implementation in this example
  }

  private async setCachedResponse(key: string, value: any, ttl: number): Promise<void> {
    // Simulate cache setting
  }

  private getCurrentConcurrentRequests(): number {
    // Simulate concurrent request count
    return Math.floor(Math.random() * 100);
  }

  private classifyRequest(request: any): string {
    // Simple classification logic
    if (request?.type === 'analysis') return 'analysis';
    if (request?.type === 'creative') return 'creative';
    return 'general';
  }

  private shouldIncludeOriginalRequest(level: DegradationLevel): boolean {
    return level.priority <= 2; // Only include for light/moderate degradation
  }

  private createInitialMetrics(): SystemMetrics {
    return {
      responseTime: 1000,
      errorRate: 0.01,
      memoryUsage: 0.5,
      cpuUsage: 0.3,
      requestVolume: 100,
      activeConnections: 50,
      timestamp: new Date()
    };
  }

  /**
   * Public API methods
   */

  /**
   * Get current degradation state
   */
  getCurrentState(): DegradationState {
    return { ...this.currentState };
  }

  /**
   * Get system metrics
   */
  getSystemMetrics(): SystemMetrics[] {
    return [...this.systemMetrics];
  }

  /**
   * Get degradation metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Force degradation level (for testing)
   */
  forceDegradationLevel(levelId: string | null): void {
    if (levelId === null) {
      this.recoverFromDegradation();
      return;
    }

    const level = this.config.degradationLevels.find(l => l.id === levelId);
    if (level) {
      this.activateDegradation(level);
      this.logger.warn('Forced degradation level', { levelId });
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<DegradationConfig>): void {
    Object.assign(this.config, newConfig);
    this.logger.info('Updated degradation configuration');
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      degradationsActivated: 0,
      degradationsRecovered: 0,
      levelChanges: 0,
      responsesDegraded: 0,
      qualityImpact: 0,
      performanceGains: 0,
      triggersActivated: new Map()
    };
    
    this.logger.info('Reset degradation metrics');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    this.logger.info('Stopped degradation monitoring');
  }
}

export default GracefulDegradationService;
