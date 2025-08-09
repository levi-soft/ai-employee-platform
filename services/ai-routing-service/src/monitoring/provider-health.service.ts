
import { EventEmitter } from 'events';
import { logger } from '@ai-platform/shared-utils';
import { AIProviderType } from '../types/ai-types';

export interface ProviderHealthStatus {
  providerId: string;
  providerType: AIProviderType;
  isHealthy: boolean;
  lastCheck: Date;
  responseTime: number;
  availability: number;
  errorRate: number;
  consecutiveFailures: number;
  lastError?: string;
  metadata: {
    version?: string;
    region?: string;
    model?: string;
    endpoint?: string;
  };
}

export interface HealthCheckConfig {
  interval: number; // milliseconds
  timeout: number; // milliseconds
  retries: number;
  failureThreshold: number;
  recoveryThreshold: number;
  alertThresholds: {
    responseTime: number;
    errorRate: number;
    availability: number;
  };
}

export class ProviderHealthService extends EventEmitter {
  private healthStatus: Map<string, ProviderHealthStatus> = new Map();
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();
  private config: HealthCheckConfig;
  private isMonitoring = false;

  constructor(config: HealthCheckConfig) {
    super();
    this.config = config;
  }

  /**
   * Start health monitoring for all registered providers
   */
  async startMonitoring(): Promise<void> {
    if (this.isMonitoring) {
      logger.warn('Health monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    
    // Initialize health status for known providers
    await this.initializeProviders();
    
    // Start periodic health checks
    this.startPeriodicHealthChecks();
    
    logger.info('Provider health monitoring started', {
      interval: this.config.interval,
      providers: Array.from(this.healthStatus.keys())
    });
    
    this.emit('monitoringStarted');
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    
    // Clear all intervals
    this.healthCheckIntervals.forEach(interval => {
      clearInterval(interval);
    });
    this.healthCheckIntervals.clear();
    
    logger.info('Provider health monitoring stopped');
    this.emit('monitoringStopped');
  }

  /**
   * Initialize health status for all providers
   */
  private async initializeProviders(): Promise<void> {
    const providers = [
      {
        id: 'openai-gpt-4',
        type: 'openai' as AIProviderType,
        endpoint: 'https://api.openai.com/v1/chat/completions'
      },
      {
        id: 'openai-gpt-3.5',
        type: 'openai' as AIProviderType,
        endpoint: 'https://api.openai.com/v1/chat/completions'
      },
      {
        id: 'claude-3-sonnet',
        type: 'claude' as AIProviderType,
        endpoint: 'https://api.anthropic.com/v1/messages'
      },
      {
        id: 'claude-3-haiku',
        type: 'claude' as AIProviderType,
        endpoint: 'https://api.anthropic.com/v1/messages'
      },
      {
        id: 'gemini-pro',
        type: 'gemini' as AIProviderType,
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent'
      },
      {
        id: 'ollama-mistral',
        type: 'ollama' as AIProviderType,
        endpoint: 'http://localhost:11434/api/generate'
      }
    ];

    for (const provider of providers) {
      this.healthStatus.set(provider.id, {
        providerId: provider.id,
        providerType: provider.type,
        isHealthy: true,
        lastCheck: new Date(0),
        responseTime: 0,
        availability: 1.0,
        errorRate: 0,
        consecutiveFailures: 0,
        metadata: {
          endpoint: provider.endpoint
        }
      });
    }
  }

  /**
   * Start periodic health checks for all providers
   */
  private startPeriodicHealthChecks(): void {
    this.healthStatus.forEach((status, providerId) => {
      const interval = setInterval(async () => {
        await this.performHealthCheck(providerId);
      }, this.config.interval);
      
      this.healthCheckIntervals.set(providerId, interval);
      
      // Perform initial health check immediately
      setTimeout(() => this.performHealthCheck(providerId), 100);
    });
  }

  /**
   * Perform health check for a specific provider
   */
  async performHealthCheck(providerId: string): Promise<ProviderHealthStatus> {
    const status = this.healthStatus.get(providerId);
    if (!status) {
      throw new Error(`Provider ${providerId} not found`);
    }

    const startTime = Date.now();
    let isHealthy = false;
    let errorMessage: string | undefined;

    try {
      // Perform actual health check based on provider type
      isHealthy = await this.checkProviderEndpoint(status);
      
      if (isHealthy) {
        status.consecutiveFailures = 0;
        status.lastError = undefined;
      }
    } catch (error) {
      isHealthy = false;
      errorMessage = error instanceof Error ? error.message : 'Unknown error';
      status.consecutiveFailures++;
      status.lastError = errorMessage;
      
      logger.error('Provider health check failed', {
        providerId,
        error: errorMessage,
        consecutiveFailures: status.consecutiveFailures
      });
    }

    // Update metrics
    const responseTime = Date.now() - startTime;
    status.lastCheck = new Date();
    status.responseTime = (status.responseTime * 0.8) + (responseTime * 0.2); // Rolling average
    
    // Update availability (rolling average)
    const availabilityUpdate = isHealthy ? 1 : 0;
    status.availability = (status.availability * 0.9) + (availabilityUpdate * 0.1);
    
    // Update error rate (rolling average)
    const errorUpdate = isHealthy ? 0 : 1;
    status.errorRate = (status.errorRate * 0.9) + (errorUpdate * 0.1);
    
    // Determine if provider should be considered healthy
    const wasHealthy = status.isHealthy;
    status.isHealthy = this.determineHealthStatus(status);
    
    // Emit health status change events
    if (wasHealthy && !status.isHealthy) {
      logger.warn('Provider became unhealthy', { providerId, status });
      this.emit('providerUnhealthy', { providerId, status: { ...status } });
    } else if (!wasHealthy && status.isHealthy) {
      logger.info('Provider recovered', { providerId, status });
      this.emit('providerRecovered', { providerId, status: { ...status } });
    }
    
    // Check alert thresholds
    await this.checkAlertThresholds(providerId, status);
    
    this.emit('healthCheckCompleted', {
      providerId,
      status: { ...status },
      responseTime
    });
    
    return { ...status };
  }

  /**
   * Check provider endpoint based on provider type
   */
  private async checkProviderEndpoint(status: ProviderHealthStatus): Promise<boolean> {
    const { providerId, providerType, metadata } = status;
    
    try {
      switch (providerType) {
        case 'openai':
          return await this.checkOpenAIHealth(metadata.endpoint!);
        
        case 'claude':
          return await this.checkClaudeHealth(metadata.endpoint!);
        
        case 'gemini':
          return await this.checkGeminiHealth(metadata.endpoint!);
        
        case 'ollama':
          return await this.checkOllamaHealth(metadata.endpoint!);
        
        default:
          logger.warn('Unknown provider type for health check', { providerId, providerType });
          return false;
      }
    } catch (error) {
      logger.debug('Provider endpoint check failed', { providerId, error });
      return false;
    }
  }

  /**
   * Check OpenAI API health
   */
  private async checkOpenAIHealth(endpoint: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
      
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY || 'dummy-key'}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // Even if we get 401 (invalid key), it means the API is responding
      return response.status === 200 || response.status === 401;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check Claude API health
   */
  private async checkClaudeHealth(endpoint: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
      
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.CLAUDE_API_KEY || 'dummy-key',
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Health check' }]
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      // Even if we get 401 (invalid key), it means the API is responding
      return response.status < 500;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check Gemini API health
   */
  private async checkGeminiHealth(endpoint: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
      
      const apiKey = process.env.GEMINI_API_KEY || 'dummy-key';
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Health check' }] }],
            generationConfig: { maxOutputTokens: 1 }
          }),
          signal: controller.signal
        }
      );
      
      clearTimeout(timeoutId);
      
      // Even if we get 400 (invalid request), it means the API is responding
      return response.status < 500;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check Ollama health
   */
  private async checkOllamaHealth(endpoint: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
      
      const response = await fetch('http://localhost:11434/api/tags', {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      return response.status === 200;
    } catch (error) {
      // Ollama might not be running in all environments
      return false;
    }
  }

  /**
   * Determine overall health status based on metrics
   */
  private determineHealthStatus(status: ProviderHealthStatus): boolean {
    // Provider is unhealthy if:
    // 1. Consecutive failures exceed threshold
    // 2. Availability is below threshold
    // 3. Error rate is too high
    
    if (status.consecutiveFailures >= this.config.failureThreshold) {
      return false;
    }
    
    if (status.availability < this.config.alertThresholds.availability) {
      return false;
    }
    
    if (status.errorRate > this.config.alertThresholds.errorRate) {
      return false;
    }
    
    return true;
  }

  /**
   * Check if any alert thresholds are exceeded
   */
  private async checkAlertThresholds(
    providerId: string, 
    status: ProviderHealthStatus
  ): Promise<void> {
    const alerts: string[] = [];
    
    if (status.responseTime > this.config.alertThresholds.responseTime) {
      alerts.push(`High response time: ${status.responseTime.toFixed(0)}ms`);
    }
    
    if (status.errorRate > this.config.alertThresholds.errorRate) {
      alerts.push(`High error rate: ${(status.errorRate * 100).toFixed(1)}%`);
    }
    
    if (status.availability < this.config.alertThresholds.availability) {
      alerts.push(`Low availability: ${(status.availability * 100).toFixed(1)}%`);
    }
    
    if (alerts.length > 0) {
      this.emit('alertThresholdExceeded', {
        providerId,
        alerts,
        status: { ...status }
      });
      
      logger.warn('Provider alert thresholds exceeded', {
        providerId,
        alerts,
        metrics: {
          responseTime: status.responseTime,
          errorRate: status.errorRate,
          availability: status.availability
        }
      });
    }
  }

  /**
   * Get health status for a specific provider
   */
  async checkProviderHealth(providerId: string): Promise<boolean> {
    const status = this.healthStatus.get(providerId);
    
    if (!status) {
      logger.warn('Provider not found for health check', { providerId });
      return false;
    }
    
    // If last check was recent, return cached status
    const timeSinceLastCheck = Date.now() - status.lastCheck.getTime();
    if (timeSinceLastCheck < this.config.interval / 2) {
      return status.isHealthy;
    }
    
    // Perform fresh health check
    const updatedStatus = await this.performHealthCheck(providerId);
    return updatedStatus.isHealthy;
  }

  /**
   * Get health status for all providers
   */
  getAllProviderHealth(): Record<string, ProviderHealthStatus> {
    const healthStatuses: Record<string, ProviderHealthStatus> = {};
    
    this.healthStatus.forEach((status, providerId) => {
      healthStatuses[providerId] = { ...status };
    });
    
    return healthStatuses;
  }

  /**
   * Get healthy providers list
   */
  getHealthyProviders(): string[] {
    const healthyProviders: string[] = [];
    
    this.healthStatus.forEach((status, providerId) => {
      if (status.isHealthy) {
        healthyProviders.push(providerId);
      }
    });
    
    return healthyProviders;
  }

  /**
   * Force health check for a provider
   */
  async forceHealthCheck(providerId: string): Promise<ProviderHealthStatus> {
    const status = this.healthStatus.get(providerId);
    if (!status) {
      throw new Error(`Provider ${providerId} not found`);
    }
    
    return await this.performHealthCheck(providerId);
  }

  /**
   * Register a new provider for health monitoring
   */
  registerProvider(
    providerId: string, 
    providerType: AIProviderType, 
    endpoint: string,
    metadata: Record<string, any> = {}
  ): void {
    if (this.healthStatus.has(providerId)) {
      logger.warn('Provider already registered for health monitoring', { providerId });
      return;
    }
    
    this.healthStatus.set(providerId, {
      providerId,
      providerType,
      isHealthy: true,
      lastCheck: new Date(0),
      responseTime: 0,
      availability: 1.0,
      errorRate: 0,
      consecutiveFailures: 0,
      metadata: { endpoint, ...metadata }
    });
    
    // Start monitoring if already running
    if (this.isMonitoring) {
      const interval = setInterval(async () => {
        await this.performHealthCheck(providerId);
      }, this.config.interval);
      
      this.healthCheckIntervals.set(providerId, interval);
      
      // Perform initial health check
      setTimeout(() => this.performHealthCheck(providerId), 100);
    }
    
    logger.info('Provider registered for health monitoring', { providerId, providerType });
    this.emit('providerRegistered', { providerId, providerType });
  }

  /**
   * Unregister a provider from health monitoring
   */
  unregisterProvider(providerId: string): void {
    const interval = this.healthCheckIntervals.get(providerId);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(providerId);
    }
    
    this.healthStatus.delete(providerId);
    
    logger.info('Provider unregistered from health monitoring', { providerId });
    this.emit('providerUnregistered', { providerId });
  }
}

