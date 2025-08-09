
import { EventEmitter } from 'events';
import { Logger } from '@ai-platform/shared-utils';
import { 
  IAgentBase, 
  IAgentConfig, 
  IAgentContext, 
  IAgentRequest, 
  IAgentResponse,
  AgentCapability,
  AgentStatus,
  AgentMetrics,
  IValidationResult
} from '../types/agent-types';

/**
 * Base class for all AI agents in the platform
 * Provides core functionality, lifecycle management, and standardized interfaces
 */
export abstract class AgentBase extends EventEmitter implements IAgentBase {
  protected logger: Logger;
  protected config: IAgentConfig;
  protected status: AgentStatus = AgentStatus.IDLE;
  protected metrics: AgentMetrics;
  protected context?: IAgentContext;

  constructor(config: IAgentConfig) {
    super();
    this.config = config;
    this.logger = new Logger(`Agent:${config.name}`);
    this.metrics = {
      requestsProcessed: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      totalResponseTime: 0,
      startTime: Date.now(),
      lastActivity: Date.now()
    };

    this.initialize();
  }

  // Abstract methods that must be implemented by concrete agents
  abstract process(request: IAgentRequest): Promise<IAgentResponse>;
  abstract getCapabilities(): AgentCapability[];
  abstract validate(request: IAgentRequest): Promise<IValidationResult>;

  /**
   * Initialize the agent
   */
  protected initialize(): void {
    this.status = AgentStatus.INITIALIZING;
    this.logger.info('Agent initializing', { 
      name: this.config.name,
      version: this.config.version,
      capabilities: this.getCapabilities().length
    });

    this.emit('initialize');
    this.status = AgentStatus.IDLE;
    this.emit('ready');
  }

  /**
   * Execute a request with full lifecycle management
   */
  async execute(request: IAgentRequest, context?: IAgentContext): Promise<IAgentResponse> {
    const startTime = Date.now();
    const requestId = request.id || this.generateRequestId();
    
    this.context = context;
    this.status = AgentStatus.PROCESSING;
    this.metrics.lastActivity = startTime;

    this.logger.info('Processing request', {
      requestId,
      type: request.type,
      capabilities: request.requiredCapabilities
    });

    this.emit('requestStart', { requestId, request });

    try {
      // Validate request
      const validationResult = await this.validate(request);
      if (!validationResult.isValid) {
        throw new Error(`Validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Process request
      const response = await this.process({
        ...request,
        id: requestId
      });

      // Update metrics
      const responseTime = Date.now() - startTime;
      this.updateMetrics(true, responseTime);

      this.logger.info('Request processed successfully', {
        requestId,
        responseTime,
        outputTokens: response.metadata?.outputTokens || 0
      });

      this.emit('requestComplete', { requestId, response, responseTime });
      
      return {
        ...response,
        metadata: {
          ...response.metadata,
          requestId,
          responseTime,
          agentName: this.config.name,
          agentVersion: this.config.version
        }
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.updateMetrics(false, responseTime);

      this.logger.error('Request processing failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        responseTime
      });

      this.emit('requestError', { requestId, error, responseTime });

      throw error;
    } finally {
      this.status = AgentStatus.IDLE;
      this.context = undefined;
    }
  }

  /**
   * Check if agent can handle a specific request
   */
  canHandle(request: IAgentRequest): boolean {
    const requiredCapabilities = request.requiredCapabilities || [];
    const agentCapabilities = this.getCapabilities();

    return requiredCapabilities.every(required =>
      agentCapabilities.some(capability => 
        capability.type === required.type && 
        capability.level >= required.level
      )
    );
  }

  /**
   * Get current agent status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Get agent configuration
   */
  getConfig(): IAgentConfig {
    return { ...this.config };
  }

  /**
   * Get agent metrics
   */
  getMetrics(): AgentMetrics {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startTime,
      successRate: this.metrics.requestsProcessed > 0 
        ? this.metrics.successfulRequests / this.metrics.requestsProcessed 
        : 0
    };
  }

  /**
   * Update agent configuration
   */
  updateConfig(newConfig: Partial<IAgentConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Configuration updated', { config: newConfig });
    this.emit('configUpdate', newConfig);
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.status = AgentStatus.SHUTTING_DOWN;
    this.logger.info('Agent shutting down');
    this.emit('shutdown');

    // Wait for any ongoing processing to complete
    if (this.status === AgentStatus.PROCESSING) {
      await new Promise(resolve => {
        const checkStatus = () => {
          if (this.status !== AgentStatus.PROCESSING) {
            resolve(void 0);
          } else {
            setTimeout(checkStatus, 100);
          }
        };
        checkStatus();
      });
    }

    this.removeAllListeners();
    this.status = AgentStatus.SHUTDOWN;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ healthy: boolean; details: any }> {
    try {
      const capabilities = this.getCapabilities();
      const metrics = this.getMetrics();
      
      return {
        healthy: this.status !== AgentStatus.ERROR && this.status !== AgentStatus.SHUTDOWN,
        details: {
          status: this.status,
          capabilities: capabilities.length,
          metrics,
          lastActivity: new Date(this.metrics.lastActivity).toISOString()
        }
      };
    } catch (error) {
      return {
        healthy: false,
        details: {
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  /**
   * Update metrics
   */
  private updateMetrics(success: boolean, responseTime: number): void {
    this.metrics.requestsProcessed++;
    this.metrics.totalResponseTime += responseTime;
    this.metrics.averageResponseTime = this.metrics.totalResponseTime / this.metrics.requestsProcessed;

    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `${this.config.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Stream response support for real-time processing
   */
  protected async *streamResponse(request: IAgentRequest): AsyncGenerator<Partial<IAgentResponse>, IAgentResponse, unknown> {
    // Default implementation - override in concrete agents for streaming
    const response = await this.process(request);
    yield response;
    return response;
  }

  /**
   * Batch processing support
   */
  async processBatch(requests: IAgentRequest[]): Promise<IAgentResponse[]> {
    const responses: IAgentResponse[] = [];
    
    for (const request of requests) {
      try {
        const response = await this.execute(request);
        responses.push(response);
      } catch (error) {
        responses.push({
          content: '',
          success: false,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            requestId: request.id,
            agentName: this.config.name,
            agentVersion: this.config.version
          }
        });
      }
    }

    return responses;
  }
}

/**
 * Factory for creating agent instances
 */
export class AgentFactory {
  private static agents = new Map<string, typeof AgentBase>();

  static register(name: string, agentClass: typeof AgentBase): void {
    this.agents.set(name, agentClass);
  }

  static create(name: string, config: IAgentConfig): AgentBase | null {
    const AgentClass = this.agents.get(name);
    if (!AgentClass) {
      return null;
    }
    return new AgentClass(config);
  }

  static getRegisteredAgents(): string[] {
    return Array.from(this.agents.keys());
  }
}

/**
 * Agent decorator for automatic registration
 */
export function Agent(name: string) {
  return function<T extends typeof AgentBase>(constructor: T) {
    AgentFactory.register(name, constructor);
    return constructor;
  };
}
