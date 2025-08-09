
import { Logger } from '@ai-platform/shared-utils';
import { Worker } from 'worker_threads';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';
import { 
  ISandboxConfig, 
  ISandboxResult, 
  ISandboxEnvironment, 
  IAgentRequest,
  IAgentResponse 
} from '../../../../packages/ai-agent-sdk/src/types/agent-types';

/**
 * Secure sandbox environment for running untrusted AI agents
 */
export class AgentSandboxService extends EventEmitter {
  private logger: Logger;
  private environments = new Map<string, ISandboxEnvironment>();
  private activeWorkers = new Map<string, Worker>();
  private readonly DEFAULT_CONFIG: ISandboxConfig = {
    timeoutMs: 30000,
    memoryLimitMB: 256,
    maxCpuUsage: 80,
    allowNetworking: false,
    allowFileSystem: false,
    securityLevel: 'high',
    allowedDomains: [],
    blockedDomains: ['*'],
    environment: {}
  };

  constructor() {
    super();
    this.logger = new Logger('AgentSandbox');
  }

  /**
   * Create a new sandbox environment
   */
  async createSandbox(agentId: string, config?: Partial<ISandboxConfig>): Promise<ISandboxEnvironment> {
    const sandboxId = this.generateSandboxId();
    const mergedConfig = { ...this.DEFAULT_CONFIG, ...config };

    this.logger.info('Creating sandbox environment', {
      sandboxId,
      agentId,
      securityLevel: mergedConfig.securityLevel
    });

    const environment: ISandboxEnvironment = {
      id: sandboxId,
      agentId,
      config: mergedConfig,
      status: 'idle',
      createdAt: new Date(),
      lastUsed: new Date()
    };

    this.environments.set(sandboxId, environment);

    // Validate sandbox configuration
    await this.validateSandboxConfig(mergedConfig);

    // Setup sandbox directory structure
    await this.setupSandboxDirectory(sandboxId);

    this.logger.info('Sandbox environment created successfully', {
      sandboxId,
      agentId
    });

    this.emit('sandboxCreated', { environment });
    return environment;
  }

  /**
   * Execute agent code in sandbox
   */
  async executeInSandbox(
    sandboxId: string,
    agentCode: string,
    request: IAgentRequest
  ): Promise<ISandboxResult> {
    const environment = this.environments.get(sandboxId);
    if (!environment) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    this.logger.info('Executing code in sandbox', {
      sandboxId,
      agentId: environment.agentId,
      requestId: request.id
    });

    // Update environment status
    environment.status = 'running';
    environment.lastUsed = new Date();

    const startTime = Date.now();
    const violations: string[] = [];

    try {
      // Create worker thread for sandbox execution
      const worker = await this.createWorker(environment, agentCode, request);
      this.activeWorkers.set(sandboxId, worker);

      const result = await Promise.race([
        this.executeInWorker(worker, environment, request),
        this.createTimeoutPromise(environment.config.timeoutMs)
      ]);

      const executionTime = Date.now() - startTime;

      // Terminate worker
      await worker.terminate();
      this.activeWorkers.delete(sandboxId);

      // Update environment status
      environment.status = 'idle';

      const sandboxResult: ISandboxResult = {
        success: true,
        output: result,
        executionTime,
        memoryUsed: await this.getMemoryUsage(sandboxId),
        cpuUsage: 0, // Would be calculated from actual metrics
        violations
      };

      this.logger.info('Sandbox execution completed', {
        sandboxId,
        executionTime,
        success: sandboxResult.success
      });

      this.emit('executionComplete', { sandboxId, result: sandboxResult });
      return sandboxResult;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      // Clean up worker if still running
      const worker = this.activeWorkers.get(sandboxId);
      if (worker) {
        await worker.terminate();
        this.activeWorkers.delete(sandboxId);
      }

      environment.status = 'idle';

      const sandboxResult: ISandboxResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        memoryUsed: 0,
        cpuUsage: 0,
        violations
      };

      this.logger.error('Sandbox execution failed', {
        sandboxId,
        error: sandboxResult.error,
        executionTime
      });

      this.emit('executionError', { sandboxId, error });
      return sandboxResult;
    }
  }

  /**
   * Execute agent request in sandbox (high-level interface)
   */
  async executeAgent(
    agentId: string,
    agentCode: string,
    request: IAgentRequest,
    config?: Partial<ISandboxConfig>
  ): Promise<IAgentResponse> {
    try {
      // Create sandbox environment
      const environment = await this.createSandbox(agentId, config);

      try {
        // Execute in sandbox
        const result = await this.executeInSandbox(environment.id, agentCode, request);

        if (!result.success) {
          return {
            content: '',
            success: false,
            error: result.error || 'Sandbox execution failed',
            metadata: {
              requestId: request.id,
              executionTime: result.executionTime,
              sandboxId: environment.id,
              violations: result.violations
            }
          };
        }

        return {
          content: result.output?.content || '',
          success: true,
          metadata: {
            requestId: request.id,
            executionTime: result.executionTime,
            sandboxId: environment.id,
            memoryUsed: result.memoryUsed,
            cpuUsage: result.cpuUsage
          }
        };

      } finally {
        // Clean up sandbox
        await this.destroySandbox(environment.id);
      }

    } catch (error) {
      this.logger.error('Agent execution failed', {
        agentId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        content: '',
        success: false,
        error: error instanceof Error ? error.message : 'Agent execution failed',
        metadata: {
          requestId: request.id
        }
      };
    }
  }

  /**
   * Destroy sandbox environment
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    const environment = this.environments.get(sandboxId);
    if (!environment) {
      return;
    }

    this.logger.info('Destroying sandbox environment', { sandboxId });

    try {
      // Terminate any running workers
      const worker = this.activeWorkers.get(sandboxId);
      if (worker) {
        await worker.terminate();
        this.activeWorkers.delete(sandboxId);
      }

      // Update environment status
      environment.status = 'terminated';

      // Clean up sandbox directory
      await this.cleanupSandboxDirectory(sandboxId);

      // Remove from tracking
      this.environments.delete(sandboxId);

      this.logger.info('Sandbox environment destroyed', { sandboxId });
      this.emit('sandboxDestroyed', { sandboxId });

    } catch (error) {
      this.logger.error('Failed to destroy sandbox', {
        sandboxId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get sandbox environment info
   */
  getSandbox(sandboxId: string): ISandboxEnvironment | undefined {
    return this.environments.get(sandboxId);
  }

  /**
   * List all sandbox environments
   */
  listSandboxes(): ISandboxEnvironment[] {
    return Array.from(this.environments.values());
  }

  /**
   * Get active sandboxes for an agent
   */
  getAgentSandboxes(agentId: string): ISandboxEnvironment[] {
    return Array.from(this.environments.values())
      .filter(env => env.agentId === agentId);
  }

  /**
   * Suspend sandbox environment
   */
  async suspendSandbox(sandboxId: string): Promise<void> {
    const environment = this.environments.get(sandboxId);
    if (!environment) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    const worker = this.activeWorkers.get(sandboxId);
    if (worker) {
      await worker.terminate();
      this.activeWorkers.delete(sandboxId);
    }

    environment.status = 'suspended';
    this.logger.info('Sandbox suspended', { sandboxId });
    this.emit('sandboxSuspended', { sandboxId });
  }

  /**
   * Create worker thread for sandbox execution
   */
  private async createWorker(
    environment: ISandboxEnvironment,
    agentCode: string,
    request: IAgentRequest
  ): Promise<Worker> {
    const workerCode = this.generateWorkerCode(environment, agentCode, request);
    
    // Write worker code to temporary file
    const workerPath = path.join('/tmp', `sandbox-worker-${environment.id}.js`);
    await fs.writeFile(workerPath, workerCode);

    const worker = new Worker(workerPath, {
      resourceLimits: {
        maxOldGenerationSizeMb: environment.config.memoryLimitMB,
        maxYoungGenerationSizeMb: Math.floor(environment.config.memoryLimitMB / 4)
      },
      env: environment.config.environment
    });

    // Clean up worker file after creation
    worker.once('exit', async () => {
      try {
        await fs.unlink(workerPath);
      } catch (error) {
        // Ignore cleanup errors
      }
    });

    return worker;
  }

  /**
   * Execute code in worker thread
   */
  private async executeInWorker(
    worker: Worker,
    environment: ISandboxEnvironment,
    request: IAgentRequest
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Execution timeout'));
      }, environment.config.timeoutMs);

      worker.once('message', (result) => {
        clearTimeout(timeout);
        resolve(result);
      });

      worker.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      worker.once('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`Worker exited with code ${code}`));
        }
      });

      // Send request to worker
      worker.postMessage({
        type: 'execute',
        request
      });
    });
  }

  /**
   * Generate worker code with security restrictions
   */
  private generateWorkerCode(
    environment: ISandboxEnvironment,
    agentCode: string,
    request: IAgentRequest
  ): string {
    return `
const { parentPort } = require('worker_threads');

// Security restrictions
const originalRequire = require;
require = function(module) {
  const blockedModules = ['fs', 'child_process', 'cluster', 'http', 'https', 'net', 'dgram'];
  if (blockedModules.includes(module)) {
    throw new Error('Module access denied: ' + module);
  }
  return originalRequire(module);
};

// Disable global access to sensitive APIs
delete global.process;
delete global.Buffer;
delete global.setTimeout;
delete global.setInterval;

// Mock console for logging
const logs = [];
console = {
  log: (...args) => logs.push(['log', ...args]),
  error: (...args) => logs.push(['error', ...args]),
  warn: (...args) => logs.push(['warn', ...args]),
  info: (...args) => logs.push(['info', ...args])
};

// Agent execution function
async function executeAgent(request) {
  try {
    ${agentCode}
    
    // Assume agent exports a process function
    if (typeof process === 'function') {
      return await process(request);
    } else {
      throw new Error('Agent must export a process function');
    }
  } catch (error) {
    throw error;
  }
}

// Message handler
parentPort.on('message', async (message) => {
  if (message.type === 'execute') {
    try {
      const result = await executeAgent(message.request);
      parentPort.postMessage({
        success: true,
        content: result.content || result,
        metadata: {
          ...result.metadata,
          logs
        }
      });
    } catch (error) {
      parentPort.postMessage({
        success: false,
        error: error.message,
        metadata: { logs }
      });
    }
  }
});
    `;
  }

  /**
   * Create timeout promise
   */
  private createTimeoutPromise(timeoutMs: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  /**
   * Validate sandbox configuration
   */
  private async validateSandboxConfig(config: ISandboxConfig): Promise<void> {
    // Validate timeout
    if (config.timeoutMs <= 0 || config.timeoutMs > 300000) { // Max 5 minutes
      throw new Error('Invalid timeout: must be between 1ms and 300000ms');
    }

    // Validate memory limit
    if (config.memoryLimitMB <= 0 || config.memoryLimitMB > 1024) { // Max 1GB
      throw new Error('Invalid memory limit: must be between 1MB and 1024MB');
    }

    // Validate CPU usage
    if (config.maxCpuUsage <= 0 || config.maxCpuUsage > 100) {
      throw new Error('Invalid CPU usage: must be between 1% and 100%');
    }

    // Validate security level
    const validLevels = ['low', 'medium', 'high'];
    if (!validLevels.includes(config.securityLevel)) {
      throw new Error('Invalid security level: must be low, medium, or high');
    }
  }

  /**
   * Setup sandbox directory structure
   */
  private async setupSandboxDirectory(sandboxId: string): Promise<void> {
    const sandboxDir = path.join('/tmp', 'sandboxes', sandboxId);
    
    try {
      await fs.mkdir(sandboxDir, { recursive: true });
      await fs.writeFile(path.join(sandboxDir, '.sandboxinfo'), JSON.stringify({
        id: sandboxId,
        created: new Date().toISOString()
      }));
    } catch (error) {
      this.logger.error('Failed to setup sandbox directory', {
        sandboxId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error('Failed to setup sandbox directory');
    }
  }

  /**
   * Cleanup sandbox directory
   */
  private async cleanupSandboxDirectory(sandboxId: string): Promise<void> {
    const sandboxDir = path.join('/tmp', 'sandboxes', sandboxId);
    
    try {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    } catch (error) {
      this.logger.warn('Failed to cleanup sandbox directory', {
        sandboxId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't throw - cleanup is not critical
    }
  }

  /**
   * Get memory usage for sandbox
   */
  private async getMemoryUsage(sandboxId: string): Promise<number> {
    // In a real implementation, this would get actual memory usage
    // For now, return a mock value
    return Math.floor(Math.random() * 100);
  }

  /**
   * Generate unique sandbox ID
   */
  private generateSandboxId(): string {
    return `sandbox-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleanup inactive sandboxes
   */
  async cleanupInactiveSandboxes(maxIdleTimeMs = 300000): Promise<void> { // 5 minutes default
    const now = Date.now();
    const toCleanup: string[] = [];

    for (const [sandboxId, environment] of this.environments) {
      if (environment.status === 'idle' && 
          now - environment.lastUsed.getTime() > maxIdleTimeMs) {
        toCleanup.push(sandboxId);
      }
    }

    this.logger.info('Cleaning up inactive sandboxes', { count: toCleanup.length });

    for (const sandboxId of toCleanup) {
      try {
        await this.destroySandbox(sandboxId);
      } catch (error) {
        this.logger.error('Failed to cleanup sandbox', {
          sandboxId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Get sandbox statistics
   */
  getStatistics(): {
    totalSandboxes: number;
    activeSandboxes: number;
    idleSandboxes: number;
    suspendedSandboxes: number;
  } {
    const environments = Array.from(this.environments.values());
    
    return {
      totalSandboxes: environments.length,
      activeSandboxes: environments.filter(env => env.status === 'running').length,
      idleSandboxes: environments.filter(env => env.status === 'idle').length,
      suspendedSandboxes: environments.filter(env => env.status === 'suspended').length
    };
  }
}
