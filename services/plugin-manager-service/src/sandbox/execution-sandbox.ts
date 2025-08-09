
import { Worker } from 'worker_threads';
import { createServiceLogger } from '@ai-platform/shared-utils';
import { z } from 'zod';
import * as vm from 'vm';
import * as crypto from 'crypto';
import * as path from 'path';

const logger = createServiceLogger('plugin-sandbox');

export interface SandboxOptions {
  maxExecutionTime?: number;
  maxMemory?: number;
  permissions?: string[];
  allowedModules?: string[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ExecutionResult {
  success: boolean;
  output?: any;
  error?: string;
  executionTime: number;
  memoryUsage: number;
}

export class ExecutionSandbox {
  private readonly defaultOptions: SandboxOptions = {
    maxExecutionTime: 30000, // 30 seconds
    maxMemory: 128 * 1024 * 1024, // 128MB
    permissions: [],
    allowedModules: ['lodash', 'moment', 'uuid', 'crypto']
  };

  private readonly dangerousPatterns = [
    // File system access
    /require\s*\(\s*['"]fs['"]/, 
    /require\s*\(\s*['"]child_process['"]/,
    /require\s*\(\s*['"]cluster['"]/,
    
    // Network access
    /require\s*\(\s*['"]http['"]/, 
    /require\s*\(\s*['"]https['"]/,
    /require\s*\(\s*['"]net['"]/,
    /require\s*\(\s*['"]dgram['"]/,
    
    // Process manipulation
    /process\.exit/, 
    /process\.kill/,
    /process\.env/,
    
    // Eval and dynamic code execution
    /eval\s*\(/,
    /Function\s*\(/,
    /new\s+Function/,
    
    // Global object manipulation
    /global\./,
    /globalThis\./,
    
    // Infinite loops (basic detection)
    /while\s*\(\s*true\s*\)/,
    /for\s*\(\s*;\s*;\s*\)/
  ];

  /**
   * Validate plugin code for security and syntax
   */
  async validatePlugin(code: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Check for dangerous patterns
      for (const pattern of this.dangerousPatterns) {
        if (pattern.test(code)) {
          errors.push(`Dangerous pattern detected: ${pattern.source}`);
        }
      }

      // Basic syntax validation
      try {
        new vm.Script(code);
      } catch (syntaxError) {
        errors.push(`Syntax error: ${syntaxError instanceof Error ? syntaxError.message : 'Unknown syntax error'}`);
      }

      // Check for required exports
      if (!code.includes('module.exports') && !code.includes('exports.')) {
        errors.push('Plugin must export functions using module.exports or exports');
      }

      // Check for main function
      if (!code.includes('exports.execute') && !code.includes('module.exports.execute')) {
        warnings.push('Plugin should export an "execute" function as the main entry point');
      }

      // Code length check
      if (code.length > 1024 * 1024) { // 1MB
        errors.push('Plugin code exceeds maximum size limit (1MB)');
      }

      // Check for potential memory leaks
      if (code.includes('setInterval') || code.includes('setTimeout')) {
        warnings.push('Plugin uses timers - ensure proper cleanup to prevent memory leaks');
      }

      logger.info('Plugin validation completed', {
        isValid: errors.length === 0,
        errorCount: errors.length,
        warningCount: warnings.length
      });

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };
    } catch (error) {
      logger.error('Plugin validation error', { error });
      return {
        isValid: false,
        errors: [`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
        warnings
      };
    }
  }

  /**
   * Execute plugin code in a sandboxed environment
   */
  async executePlugin(
    code: string,
    input: any,
    options: SandboxOptions = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const opts = { ...this.defaultOptions, ...options };

    logger.info('Executing plugin', {
      inputType: typeof input,
      maxExecutionTime: opts.maxExecutionTime,
      maxMemory: opts.maxMemory
    });

    try {
      // Create sandbox context
      const context = this.createSandboxContext(input, opts);
      
      // Wrap code in execution wrapper
      const wrappedCode = this.wrapPluginCode(code);
      
      // Create and run script
      const script = new vm.Script(wrappedCode, {
        filename: 'plugin.js',
        timeout: opts.maxExecutionTime
      });

      const result = script.runInContext(context, {
        timeout: opts.maxExecutionTime,
        breakOnSigint: true
      });

      const executionTime = Date.now() - startTime;
      const memoryUsage = process.memoryUsage().heapUsed;

      logger.info('Plugin executed successfully', {
        executionTime,
        memoryUsage,
        outputType: typeof result
      });

      return {
        success: true,
        output: result,
        executionTime,
        memoryUsage
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const memoryUsage = process.memoryUsage().heapUsed;

      logger.error('Plugin execution failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown execution error',
        executionTime,
        memoryUsage
      };
    }
  }

  /**
   * Create sandbox context with limited global objects
   */
  private createSandboxContext(input: any, options: SandboxOptions): vm.Context {
    const context = vm.createContext({
      // Input data
      input,
      
      // Safe globals
      console: {
        log: (...args: any[]) => logger.debug('Plugin log:', ...args),
        error: (...args: any[]) => logger.warn('Plugin error:', ...args),
        warn: (...args: any[]) => logger.warn('Plugin warn:', ...args),
        info: (...args: any[]) => logger.info('Plugin info:', ...args)
      },
      
      // Utility functions
      JSON: {
        parse: JSON.parse,
        stringify: JSON.stringify
      },
      
      // Math object
      Math,
      
      // Date object
      Date,
      
      // Array and Object
      Array,
      Object,
      
      // String operations
      String,
      RegExp,
      
      // Number operations
      Number,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      
      // Error handling
      Error,
      TypeError,
      ReferenceError,
      SyntaxError,
      
      // Safe crypto operations
      crypto: {
        randomUUID: crypto.randomUUID,
        createHash: (algorithm: string) => crypto.createHash(algorithm),
        randomBytes: (size: number) => crypto.randomBytes(size).toString('hex')
      },
      
      // Module system
      module: { exports: {} },
      exports: {},
      
      // Allowed modules (very limited set)
      require: this.createSafeRequire(options.allowedModules || []),
      
      // Buffer for data manipulation
      Buffer,
      
      // Timers (with limitations)
      setTimeout: (fn: Function, ms: number) => {
        if (ms > 5000) throw new Error('setTimeout delay cannot exceed 5 seconds');
        return setTimeout(fn, ms);
      },
      clearTimeout,
      
      // Immediate execution
      setImmediate,
      clearImmediate
    });

    return context;
  }

  /**
   * Create a safe require function that only allows whitelisted modules
   */
  private createSafeRequire(allowedModules: string[]): Function {
    return (moduleName: string) => {
      if (!allowedModules.includes(moduleName)) {
        throw new Error(`Module "${moduleName}" is not allowed in sandbox environment`);
      }

      try {
        // Only allow specific safe modules
        switch (moduleName) {
          case 'lodash':
            return require('lodash');
          case 'moment':
            return require('moment');
          case 'uuid':
            return require('uuid');
          case 'crypto':
            // Return limited crypto functionality
            return {
              randomUUID: crypto.randomUUID,
              createHash: (algorithm: string) => crypto.createHash(algorithm),
              randomBytes: (size: number) => crypto.randomBytes(size)
            };
          default:
            throw new Error(`Module "${moduleName}" is not available`);
        }
      } catch (error) {
        throw new Error(`Failed to load module "${moduleName}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };
  }

  /**
   * Wrap plugin code with execution framework
   */
  private wrapPluginCode(code: string): string {
    return `
      (function() {
        'use strict';
        
        // Plugin code
        ${code}
        
        // Execute main function if available
        try {
          if (typeof module.exports === 'function') {
            return module.exports(input);
          } else if (typeof module.exports === 'object' && typeof module.exports.execute === 'function') {
            return module.exports.execute(input);
          } else if (typeof exports.execute === 'function') {
            return exports.execute(input);
          } else {
            throw new Error('Plugin must export a function or an object with execute method');
          }
        } catch (error) {
          throw new Error('Plugin execution error: ' + error.message);
        }
      })();
    `;
  }

  /**
   * Create a worker thread for heavy plugin execution (future enhancement)
   */
  async executePluginInWorker(
    code: string,
    input: any,
    options: SandboxOptions = {}
  ): Promise<ExecutionResult> {
    // This is a placeholder for worker thread implementation
    // Would be used for long-running or CPU-intensive plugins
    return new Promise((resolve) => {
      resolve({
        success: false,
        error: 'Worker thread execution not implemented yet',
        executionTime: 0,
        memoryUsage: 0
      });
    });
  }
}
