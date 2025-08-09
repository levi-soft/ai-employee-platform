
import { EventEmitter } from 'events';
import { z } from 'zod';

/**
 * Base Plugin SDK for AI Employee Platform
 * Provides the foundation for all plugins
 */

// Plugin metadata schema
export const PluginMetadataSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.string().min(1).max(100),
  description: z.string().max(500),
  category: z.string().default('utility'),
  tags: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  compatibility: z.array(z.string()).default(['1.0.0'])
});

// Plugin configuration schema
export const PluginConfigSchema = z.object({
  timeout: z.number().min(1000).max(300000).default(30000), // 30 seconds default
  maxMemory: z.number().min(1024 * 1024).max(512 * 1024 * 1024).default(128 * 1024 * 1024), // 128MB default
  retries: z.number().min(0).max(3).default(0),
  environment: z.enum(['development', 'staging', 'production']).default('development')
});

// Plugin context schema
export const PluginContextSchema = z.object({
  userId: z.string(),
  organizationId: z.string().optional(),
  sessionId: z.string(),
  permissions: z.array(z.string()),
  environment: z.record(z.string()).default({}),
  timestamp: z.date().default(() => new Date())
});

export interface PluginMetadata {
  name: string;
  version: string;
  author: string;
  description: string;
  category?: string;
  tags?: string[];
  permissions?: string[];
  dependencies?: string[];
  compatibility?: string[];
}

export interface PluginConfig {
  timeout?: number;
  maxMemory?: number;
  retries?: number;
  environment?: 'development' | 'staging' | 'production';
}

export interface PluginContext {
  userId: string;
  organizationId?: string;
  sessionId: string;
  permissions: string[];
  environment?: Record<string, string>;
  timestamp?: Date;
}

export interface PluginResult {
  success: boolean;
  data?: any;
  error?: string;
  warnings?: string[];
  metrics?: {
    executionTime: number;
    memoryUsage: number;
    [key: string]: any;
  };
}

export interface PluginHooks {
  beforeExecute?: (context: PluginContext, input: any) => Promise<void>;
  afterExecute?: (context: PluginContext, result: PluginResult) => Promise<void>;
  onError?: (context: PluginContext, error: Error) => Promise<void>;
  onTimeout?: (context: PluginContext) => Promise<void>;
}

/**
 * Abstract base class for all plugins
 */
export abstract class PluginBase extends EventEmitter {
  protected metadata: PluginMetadata;
  protected config: PluginConfig;
  protected hooks: PluginHooks;
  protected logger: (message: string, data?: any) => void;

  constructor(
    metadata: PluginMetadata, 
    config: PluginConfig = {}, 
    hooks: PluginHooks = {}
  ) {
    super();
    
    // Validate metadata and config
    this.metadata = PluginMetadataSchema.parse(metadata);
    this.config = PluginConfigSchema.parse(config);
    this.hooks = hooks;
    
    // Setup logging
    this.logger = (message: string, data?: any) => {
      this.emit('log', { message, data, timestamp: new Date() });
    };

    this.logger('Plugin initialized', { 
      name: this.metadata.name, 
      version: this.metadata.version 
    });
  }

  /**
   * Get plugin metadata
   */
  getMetadata(): PluginMetadata {
    return { ...this.metadata };
  }

  /**
   * Get plugin configuration
   */
  getConfig(): PluginConfig {
    return { ...this.config };
  }

  /**
   * Validate plugin input
   */
  protected abstract validateInput(input: any): boolean;

  /**
   * Main execution method - must be implemented by plugins
   */
  abstract execute(context: PluginContext, input: any): Promise<PluginResult>;

  /**
   * Execute plugin with full lifecycle management
   */
  async run(context: PluginContext, input: any): Promise<PluginResult> {
    const startTime = Date.now();
    const validatedContext = PluginContextSchema.parse(context);
    
    this.logger('Plugin execution started', { 
      userId: validatedContext.userId,
      sessionId: validatedContext.sessionId
    });

    try {
      // Check permissions
      if (!this.checkPermissions(validatedContext.permissions)) {
        throw new Error(`Insufficient permissions. Required: ${this.metadata.permissions?.join(', ')}`);
      }

      // Validate input
      if (!this.validateInput(input)) {
        throw new Error('Invalid input provided to plugin');
      }

      // Execute before hook
      if (this.hooks.beforeExecute) {
        await this.hooks.beforeExecute(validatedContext, input);
      }

      // Execute plugin with timeout
      const result = await this.executeWithTimeout(validatedContext, input);
      
      // Add execution metrics
      result.metrics = {
        ...result.metrics,
        executionTime: Date.now() - startTime,
        memoryUsage: process.memoryUsage().heapUsed
      };

      // Execute after hook
      if (this.hooks.afterExecute) {
        await this.hooks.afterExecute(validatedContext, result);
      }

      this.logger('Plugin execution completed', {
        success: result.success,
        executionTime: result.metrics.executionTime
      });

      this.emit('completed', result);
      return result;

    } catch (error) {
      const pluginError = error instanceof Error ? error : new Error('Unknown plugin error');
      
      this.logger('Plugin execution failed', { 
        error: pluginError.message,
        executionTime: Date.now() - startTime
      });

      // Execute error hook
      if (this.hooks.onError) {
        await this.hooks.onError(validatedContext, pluginError);
      }

      const errorResult: PluginResult = {
        success: false,
        error: pluginError.message,
        metrics: {
          executionTime: Date.now() - startTime,
          memoryUsage: process.memoryUsage().heapUsed
        }
      };

      this.emit('error', errorResult);
      return errorResult;
    }
  }

  /**
   * Execute plugin with timeout protection
   */
  private executeWithTimeout(context: PluginContext, input: any): Promise<PluginResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(async () => {
        this.logger('Plugin execution timed out', { 
          timeout: this.config.timeout 
        });
        
        if (this.hooks.onTimeout) {
          await this.hooks.onTimeout(context);
        }
        
        reject(new Error(`Plugin execution timed out after ${this.config.timeout}ms`));
      }, this.config.timeout);

      this.execute(context, input)
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  /**
   * Check if user has required permissions
   */
  private checkPermissions(userPermissions: string[]): boolean {
    if (!this.metadata.permissions || this.metadata.permissions.length === 0) {
      return true; // No permissions required
    }

    // Admin permission overrides all
    if (userPermissions.includes('admin')) {
      return true;
    }

    // Check each required permission
    return this.metadata.permissions.every(permission => 
      userPermissions.includes(permission)
    );
  }

  /**
   * Plugin status check
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      // Basic health check - can be overridden by specific plugins
      const memoryUsage = process.memoryUsage().heapUsed;
      const maxMemory = this.config.maxMemory || 128 * 1024 * 1024;
      
      if (memoryUsage > maxMemory * 0.9) {
        return {
          healthy: false,
          message: `High memory usage: ${Math.round(memoryUsage / 1024 / 1024)}MB`
        };
      }

      return {
        healthy: true,
        message: 'Plugin is healthy'
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Health check failed'
      };
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.logger('Plugin cleanup started');
    
    // Remove all listeners
    this.removeAllListeners();
    
    this.logger('Plugin cleanup completed');
  }
}

/**
 * Utility class for building simple function-based plugins
 */
export class SimpleFunctionPlugin extends PluginBase {
  private executeFunction: (context: PluginContext, input: any) => Promise<any>;
  private inputValidator: (input: any) => boolean;

  constructor(
    metadata: PluginMetadata,
    executeFunction: (context: PluginContext, input: any) => Promise<any>,
    inputValidator: (input: any) => boolean = () => true,
    config: PluginConfig = {},
    hooks: PluginHooks = {}
  ) {
    super(metadata, config, hooks);
    this.executeFunction = executeFunction;
    this.inputValidator = inputValidator;
  }

  protected validateInput(input: any): boolean {
    return this.inputValidator(input);
  }

  async execute(context: PluginContext, input: any): Promise<PluginResult> {
    try {
      const data = await this.executeFunction(context, input);
      return {
        success: true,
        data
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown execution error'
      };
    }
  }
}

/**
 * Plugin registry for managing multiple plugins
 */
export class PluginRegistry {
  private plugins: Map<string, PluginBase> = new Map();
  private logger: (message: string, data?: any) => void;

  constructor() {
    this.logger = (message: string, data?: any) => {
      console.log(`[PluginRegistry] ${message}`, data || '');
    };
  }

  /**
   * Register a plugin
   */
  register(plugin: PluginBase): void {
    const metadata = plugin.getMetadata();
    const key = `${metadata.name}@${metadata.version}`;
    
    this.plugins.set(key, plugin);
    this.logger('Plugin registered', { name: metadata.name, version: metadata.version });
  }

  /**
   * Get a plugin by name and version
   */
  get(name: string, version?: string): PluginBase | undefined {
    if (version) {
      return this.plugins.get(`${name}@${version}`);
    }
    
    // Find latest version if no version specified
    const pluginEntries = Array.from(this.plugins.entries())
      .filter(([key]) => key.startsWith(`${name}@`))
      .sort(([a], [b]) => b.localeCompare(a)); // Simple version sort
    
    return pluginEntries[0]?.[1];
  }

  /**
   * List all registered plugins
   */
  list(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map(plugin => plugin.getMetadata());
  }

  /**
   * Unregister a plugin
   */
  unregister(name: string, version: string): boolean {
    const key = `${name}@${version}`;
    const plugin = this.plugins.get(key);
    
    if (plugin) {
      plugin.cleanup();
      this.plugins.delete(key);
      this.logger('Plugin unregistered', { name, version });
      return true;
    }
    
    return false;
  }

  /**
   * Execute a plugin by name
   */
  async execute(
    name: string, 
    context: PluginContext, 
    input: any, 
    version?: string
  ): Promise<PluginResult> {
    const plugin = this.get(name, version);
    
    if (!plugin) {
      return {
        success: false,
        error: `Plugin ${name}${version ? `@${version}` : ''} not found`
      };
    }
    
    return plugin.run(context, input);
  }
}

// Export commonly used types and classes
export type { 
  PluginMetadata, 
  PluginConfig, 
  PluginContext, 
  PluginResult, 
  PluginHooks 
};

export {
  PluginMetadataSchema,
  PluginConfigSchema,
  PluginContextSchema
};
