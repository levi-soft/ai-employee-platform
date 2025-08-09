
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';

export interface ConnectionPoolConfig {
  minConnections: number;
  maxConnections: number;
  acquireTimeout: number;
  connectionTimeout: number;
  idleTimeout: number;
  keepAliveInterval: number;
  enableHealthChecks: boolean;
  healthCheckInterval: number;
  retryAttempts: number;
  retryDelay: number;
  enableMetrics: boolean;
}

export interface Connection {
  id: string;
  url: string;
  provider: string;
  status: 'idle' | 'active' | 'connecting' | 'error' | 'closed';
  createdAt: Date;
  lastUsed: Date;
  activeRequests: number;
  totalRequests: number;
  errorCount: number;
  averageResponseTime: number;
  metadata: Record<string, any>;
}

export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  connectingConnections: number;
  errorConnections: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  averageQueueTime: number;
  peakConnections: number;
  poolUtilization: number;
  providerDistribution: Map<string, number>;
}

export interface ConnectionRequest {
  id: string;
  provider?: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  timeout: number;
  requestedAt: Date;
  metadata: Record<string, any>;
  resolve: (connection: Connection) => void;
  reject: (error: Error) => void;
}

export interface PoolProvider {
  id: string;
  name: string;
  baseUrl: string;
  maxConnectionsPerProvider: number;
  healthCheckEndpoint: string;
  connectionOptions: Record<string, any>;
  enabled: boolean;
  priority: number;
}

export class ConnectionPoolService extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: ConnectionPoolConfig;
  private connections: Map<string, Connection> = new Map();
  private connectionQueue: ConnectionRequest[] = [];
  private providers: Map<string, PoolProvider> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  
  private stats: PoolStats = {
    totalConnections: 0,
    activeConnections: 0,
    idleConnections: 0,
    connectingConnections: 0,
    errorConnections: 0,
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    averageResponseTime: 0,
    averageQueueTime: 0,
    peakConnections: 0,
    poolUtilization: 0,
    providerDistribution: new Map()
  };

  constructor(config: Partial<ConnectionPoolConfig> = {}) {
    super();
    this.logger = new Logger('ConnectionPoolService');
    
    this.config = {
      minConnections: 5,
      maxConnections: 50,
      acquireTimeout: 30000,
      connectionTimeout: 10000,
      idleTimeout: 300000, // 5 minutes
      keepAliveInterval: 60000, // 1 minute
      enableHealthChecks: true,
      healthCheckInterval: 30000, // 30 seconds
      retryAttempts: 3,
      retryDelay: 1000,
      enableMetrics: true,
      ...config
    };

    this.initializeProviders();
    this.startMaintenanceTasks();
  }

  /**
   * Initialize default providers
   */
  private initializeProviders(): void {
    const defaultProviders: PoolProvider[] = [
      {
        id: 'openai',
        name: 'OpenAI API',
        baseUrl: 'https://api.openai.com',
        maxConnectionsPerProvider: 20,
        healthCheckEndpoint: '/v1/models',
        connectionOptions: {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        },
        enabled: true,
        priority: 1
      },
      {
        id: 'claude',
        name: 'Claude API',
        baseUrl: 'https://api.anthropic.com',
        maxConnectionsPerProvider: 15,
        healthCheckEndpoint: '/v1/messages',
        connectionOptions: {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        },
        enabled: true,
        priority: 2
      },
      {
        id: 'gemini',
        name: 'Gemini API',
        baseUrl: 'https://generativelanguage.googleapis.com',
        maxConnectionsPerProvider: 15,
        healthCheckEndpoint: '/v1/models',
        connectionOptions: {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        },
        enabled: true,
        priority: 3
      }
    ];

    defaultProviders.forEach(provider => {
      this.addProvider(provider);
    });
  }

  /**
   * Add a provider to the pool
   */
  addProvider(provider: PoolProvider): void {
    this.providers.set(provider.id, provider);
    this.logger.info(`Added provider: ${provider.name}`, {
      providerId: provider.id,
      maxConnections: provider.maxConnectionsPerProvider,
      enabled: provider.enabled
    });

    // Initialize minimum connections for this provider
    if (provider.enabled) {
      setImmediate(() => this.ensureMinimumConnections(provider.id));
    }
  }

  /**
   * Acquire a connection from the pool
   */
  async acquireConnection(options: {
    provider?: string;
    priority?: 'low' | 'normal' | 'high' | 'critical';
    timeout?: number;
    metadata?: Record<string, any>;
  } = {}): Promise<Connection> {
    
    const requestId = `req_${Date.now()}_${Math.random()}`;
    const timeout = options.timeout || this.config.acquireTimeout;
    const priority = options.priority || 'normal';
    
    this.stats.totalRequests++;

    this.logger.debug('Acquiring connection', {
      requestId,
      provider: options.provider,
      priority,
      timeout
    });

    return new Promise((resolve, reject) => {
      // Try to find an available connection immediately
      const connection = this.findAvailableConnection(options.provider);
      
      if (connection) {
        this.assignConnection(connection, requestId);
        resolve(connection);
        return;
      }

      // No available connection, check if we can create a new one
      if (this.canCreateNewConnection(options.provider)) {
        this.createConnection(options.provider)
          .then(newConnection => {
            this.assignConnection(newConnection, requestId);
            resolve(newConnection);
          })
          .catch(error => {
            this.logger.error('Failed to create new connection', {
              error: error.message,
              provider: options.provider
            });
            reject(error);
          });
        return;
      }

      // Queue the request
      const request: ConnectionRequest = {
        id: requestId,
        provider: options.provider,
        priority,
        timeout,
        requestedAt: new Date(),
        metadata: options.metadata || {},
        resolve,
        reject
      };

      this.queueRequest(request);

      // Set timeout for the request
      setTimeout(() => {
        if (this.removeFromQueue(requestId)) {
          const error = new Error(`Connection acquire timeout after ${timeout}ms`);
          this.stats.failedRequests++;
          reject(error);
        }
      }, timeout);
    });
  }

  /**
   * Release a connection back to the pool
   */
  async releaseConnection(connection: Connection, error?: Error): Promise<void> {
    if (!this.connections.has(connection.id)) {
      this.logger.warn('Attempting to release unknown connection', {
        connectionId: connection.id
      });
      return;
    }

    connection.activeRequests = Math.max(0, connection.activeRequests - 1);
    connection.lastUsed = new Date();

    if (error) {
      connection.errorCount++;
      connection.status = 'error';
      
      this.logger.warn('Connection released with error', {
        connectionId: connection.id,
        error: error.message,
        errorCount: connection.errorCount
      });

      // Close connection if too many errors
      if (connection.errorCount > this.config.retryAttempts) {
        await this.closeConnection(connection.id);
        return;
      }
    } else {
      connection.status = 'idle';
      this.stats.successfulRequests++;
    }

    this.updateStats();
    
    // Try to assign connection to queued request
    this.processQueue();

    this.emit('connectionReleased', {
      connectionId: connection.id,
      provider: connection.provider,
      hasError: !!error,
      activeRequests: connection.activeRequests
    });

    this.logger.debug('Connection released', {
      connectionId: connection.id,
      provider: connection.provider,
      status: connection.status,
      activeRequests: connection.activeRequests
    });
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Get connection details
   */
  getConnections(provider?: string): Connection[] {
    let connections = Array.from(this.connections.values());
    
    if (provider) {
      connections = connections.filter(conn => conn.provider === provider);
    }

    return connections.map(conn => ({ ...conn }));
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    queueLength: number;
    averageWaitTime: number;
    priorityDistribution: Map<string, number>;
    oldestRequestAge: number;
  } {
    const now = Date.now();
    const priorityDistribution = new Map<string, number>();
    let totalWaitTime = 0;
    let oldestRequestAge = 0;

    for (const request of this.connectionQueue) {
      const waitTime = now - request.requestedAt.getTime();
      totalWaitTime += waitTime;
      oldestRequestAge = Math.max(oldestRequestAge, waitTime);

      const count = priorityDistribution.get(request.priority) || 0;
      priorityDistribution.set(request.priority, count + 1);
    }

    const averageWaitTime = this.connectionQueue.length > 0 ? 
      totalWaitTime / this.connectionQueue.length : 0;

    return {
      queueLength: this.connectionQueue.length,
      averageWaitTime,
      priorityDistribution,
      oldestRequestAge
    };
  }

  /**
   * Private helper methods
   */
  private findAvailableConnection(provider?: string): Connection | null {
    const connections = Array.from(this.connections.values())
      .filter(conn => {
        if (provider && conn.provider !== provider) return false;
        return conn.status === 'idle' && conn.activeRequests === 0;
      })
      .sort((a, b) => {
        // Prefer connections with fewer total requests and less errors
        const aScore = a.totalRequests + (a.errorCount * 10);
        const bScore = b.totalRequests + (b.errorCount * 10);
        return aScore - bScore;
      });

    return connections[0] || null;
  }

  private canCreateNewConnection(provider?: string): boolean {
    const totalConnections = this.connections.size;
    
    if (totalConnections >= this.config.maxConnections) {
      return false;
    }

    if (provider) {
      const providerConnections = this.getProviderConnectionCount(provider);
      const providerConfig = this.providers.get(provider);
      
      if (providerConfig && 
          providerConnections >= providerConfig.maxConnectionsPerProvider) {
        return false;
      }
    }

    return true;
  }

  private getProviderConnectionCount(provider: string): number {
    return Array.from(this.connections.values())
      .filter(conn => conn.provider === provider).length;
  }

  private async createConnection(provider?: string): Promise<Connection> {
    // Select provider if not specified
    const selectedProvider = provider || this.selectBestProvider();
    const providerConfig = this.providers.get(selectedProvider);
    
    if (!providerConfig) {
      throw new Error(`Unknown provider: ${selectedProvider}`);
    }

    if (!providerConfig.enabled) {
      throw new Error(`Provider is disabled: ${selectedProvider}`);
    }

    const connectionId = `conn_${selectedProvider}_${Date.now()}_${Math.random()}`;
    
    const connection: Connection = {
      id: connectionId,
      url: providerConfig.baseUrl,
      provider: selectedProvider,
      status: 'connecting',
      createdAt: new Date(),
      lastUsed: new Date(),
      activeRequests: 0,
      totalRequests: 0,
      errorCount: 0,
      averageResponseTime: 0,
      metadata: {
        providerConfig: providerConfig.connectionOptions,
        createdBy: 'pool'
      }
    };

    this.connections.set(connectionId, connection);
    this.updateProviderDistribution(selectedProvider, 1);

    try {
      // Simulate connection establishment
      await this.establishConnection(connection, providerConfig);
      
      connection.status = 'idle';
      this.stats.totalConnections++;
      
      this.emit('connectionCreated', {
        connectionId,
        provider: selectedProvider,
        totalConnections: this.connections.size
      });

      this.logger.info('Connection created successfully', {
        connectionId,
        provider: selectedProvider,
        totalConnections: this.connections.size
      });

      return connection;

    } catch (error) {
      connection.status = 'error';
      connection.errorCount++;
      
      this.logger.error('Failed to create connection', {
        connectionId,
        provider: selectedProvider,
        error: error.message
      });

      // Remove failed connection
      this.connections.delete(connectionId);
      this.updateProviderDistribution(selectedProvider, -1);
      
      throw error;
    }
  }

  private selectBestProvider(): string {
    const enabledProviders = Array.from(this.providers.values())
      .filter(p => p.enabled)
      .sort((a, b) => a.priority - b.priority);

    if (enabledProviders.length === 0) {
      throw new Error('No enabled providers available');
    }

    // Select provider with least connections relative to its capacity
    let bestProvider = enabledProviders[0];
    let bestRatio = 1;

    for (const provider of enabledProviders) {
      const currentConnections = this.getProviderConnectionCount(provider.id);
      const ratio = currentConnections / provider.maxConnectionsPerProvider;
      
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestProvider = provider;
      }
    }

    return bestProvider.id;
  }

  private async establishConnection(
    connection: Connection, 
    providerConfig: PoolProvider
  ): Promise<void> {
    
    const startTime = Date.now();
    
    try {
      // Simulate network connection establishment
      await this.simulateNetworkConnection(
        providerConfig.baseUrl, 
        this.config.connectionTimeout
      );

      // Perform health check if enabled
      if (this.config.enableHealthChecks) {
        await this.performHealthCheck(connection, providerConfig);
      }

      const duration = Date.now() - startTime;
      connection.averageResponseTime = duration;

      this.logger.debug('Connection established', {
        connectionId: connection.id,
        duration,
        provider: connection.provider
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Connection establishment failed', {
        connectionId: connection.id,
        duration,
        provider: connection.provider,
        error: error.message
      });
      
      throw error;
    }
  }

  private async simulateNetworkConnection(url: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const delay = 100 + Math.random() * 500; // 100-600ms
      
      const timer = setTimeout(() => {
        if (Math.random() < 0.95) { // 95% success rate
          resolve();
        } else {
          reject(new Error('Simulated connection failure'));
        }
      }, delay);

      // Respect timeout
      setTimeout(() => {
        clearTimeout(timer);
        reject(new Error(`Connection timeout after ${timeout}ms`));
      }, timeout);
    });
  }

  private async performHealthCheck(
    connection: Connection, 
    providerConfig: PoolProvider
  ): Promise<void> {
    
    const startTime = Date.now();
    
    try {
      // Simulate health check request
      await this.simulateHealthCheckRequest(
        providerConfig.baseUrl + providerConfig.healthCheckEndpoint
      );

      const duration = Date.now() - startTime;
      connection.metadata.lastHealthCheck = new Date();
      connection.metadata.healthCheckDuration = duration;

    } catch (error) {
      connection.metadata.lastHealthCheckError = error.message;
      throw new Error(`Health check failed: ${error.message}`);
    }
  }

  private async simulateHealthCheckRequest(endpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const delay = 50 + Math.random() * 200; // 50-250ms
      
      setTimeout(() => {
        if (Math.random() < 0.98) { // 98% success rate for health checks
          resolve();
        } else {
          reject(new Error('Health check failed'));
        }
      }, delay);
    });
  }

  private assignConnection(connection: Connection, requestId: string): void {
    connection.status = 'active';
    connection.activeRequests++;
    connection.totalRequests++;
    connection.lastUsed = new Date();
    connection.metadata.lastRequestId = requestId;

    this.updateStats();

    this.emit('connectionAssigned', {
      connectionId: connection.id,
      requestId,
      provider: connection.provider,
      activeRequests: connection.activeRequests
    });
  }

  private queueRequest(request: ConnectionRequest): void {
    // Insert request based on priority
    let insertIndex = this.connectionQueue.length;
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    const requestPriority = priorityOrder[request.priority];

    for (let i = 0; i < this.connectionQueue.length; i++) {
      const queuedPriority = priorityOrder[this.connectionQueue[i].priority];
      if (requestPriority < queuedPriority) {
        insertIndex = i;
        break;
      }
    }

    this.connectionQueue.splice(insertIndex, 0, request);

    this.emit('requestQueued', {
      requestId: request.id,
      priority: request.priority,
      queuePosition: insertIndex,
      queueLength: this.connectionQueue.length
    });

    this.logger.debug('Request queued', {
      requestId: request.id,
      priority: request.priority,
      queuePosition: insertIndex,
      queueLength: this.connectionQueue.length
    });
  }

  private processQueue(): void {
    while (this.connectionQueue.length > 0) {
      const request = this.connectionQueue[0];
      const connection = this.findAvailableConnection(request.provider);

      if (!connection) {
        // Try to create new connection if possible
        if (this.canCreateNewConnection(request.provider)) {
          const queuedRequest = this.connectionQueue.shift()!;
          
          this.createConnection(request.provider)
            .then(newConnection => {
              this.assignConnection(newConnection, queuedRequest.id);
              queuedRequest.resolve(newConnection);
            })
            .catch(error => {
              queuedRequest.reject(error);
            });
        } else {
          break; // No connections available and can't create new ones
        }
      } else {
        const queuedRequest = this.connectionQueue.shift()!;
        this.assignConnection(connection, queuedRequest.id);
        
        const queueTime = Date.now() - queuedRequest.requestedAt.getTime();
        this.stats.averageQueueTime = (this.stats.averageQueueTime + queueTime) / 2;
        
        queuedRequest.resolve(connection);
      }
    }
  }

  private removeFromQueue(requestId: string): boolean {
    const index = this.connectionQueue.findIndex(req => req.id === requestId);
    
    if (index !== -1) {
      this.connectionQueue.splice(index, 1);
      return true;
    }
    
    return false;
  }

  private async closeConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    
    if (!connection) {
      return;
    }

    connection.status = 'closed';
    this.connections.delete(connectionId);
    
    // Update stats
    this.stats.totalConnections--;
    this.updateProviderDistribution(connection.provider, -1);
    this.updateStats();

    this.emit('connectionClosed', {
      connectionId,
      provider: connection.provider,
      totalConnections: this.connections.size,
      reason: connection.errorCount > this.config.retryAttempts ? 'error_limit' : 'manual'
    });

    this.logger.info('Connection closed', {
      connectionId,
      provider: connection.provider,
      totalConnections: this.connections.size,
      errorCount: connection.errorCount
    });

    // Ensure minimum connections
    setImmediate(() => this.ensureMinimumConnections(connection.provider));
  }

  private updateStats(): void {
    const connections = Array.from(this.connections.values());
    
    this.stats.totalConnections = connections.length;
    this.stats.activeConnections = connections.filter(c => c.status === 'active').length;
    this.stats.idleConnections = connections.filter(c => c.status === 'idle').length;
    this.stats.connectingConnections = connections.filter(c => c.status === 'connecting').length;
    this.stats.errorConnections = connections.filter(c => c.status === 'error').length;
    
    this.stats.peakConnections = Math.max(this.stats.peakConnections, this.stats.totalConnections);
    this.stats.poolUtilization = this.config.maxConnections > 0 ? 
      (this.stats.totalConnections / this.config.maxConnections) * 100 : 0;

    // Calculate average response time
    const responseTimes = connections
      .filter(c => c.averageResponseTime > 0)
      .map(c => c.averageResponseTime);
    
    if (responseTimes.length > 0) {
      this.stats.averageResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    }
  }

  private updateProviderDistribution(provider: string, delta: number): void {
    const current = this.stats.providerDistribution.get(provider) || 0;
    const updated = Math.max(0, current + delta);
    
    if (updated === 0) {
      this.stats.providerDistribution.delete(provider);
    } else {
      this.stats.providerDistribution.set(provider, updated);
    }
  }

  private async ensureMinimumConnections(provider: string): Promise<void> {
    const providerConfig = this.providers.get(provider);
    
    if (!providerConfig || !providerConfig.enabled) {
      return;
    }

    const currentConnections = this.getProviderConnectionCount(provider);
    const minRequired = Math.min(this.config.minConnections, providerConfig.maxConnectionsPerProvider);
    
    if (currentConnections < minRequired) {
      const needed = minRequired - currentConnections;
      
      this.logger.debug('Creating minimum connections', {
        provider,
        current: currentConnections,
        needed,
        minimum: minRequired
      });

      const promises = [];
      for (let i = 0; i < needed; i++) {
        if (this.canCreateNewConnection(provider)) {
          promises.push(this.createConnection(provider).catch(error => {
            this.logger.warn('Failed to create minimum connection', {
              provider,
              error: error.message
            });
          }));
        }
      }

      await Promise.allSettled(promises);
    }
  }

  private startMaintenanceTasks(): void {
    // Health checks
    if (this.config.enableHealthChecks) {
      this.healthCheckInterval = setInterval(() => {
        this.performPoolHealthChecks();
      }, this.config.healthCheckInterval);
    }

    // Keep-alive and idle timeout
    this.keepAliveInterval = setInterval(() => {
      this.performMaintenanceTasks();
    }, this.config.keepAliveInterval);

    this.logger.info('Started connection pool maintenance tasks');
  }

  private async performPoolHealthChecks(): Promise<void> {
    const connections = Array.from(this.connections.values())
      .filter(conn => conn.status === 'idle' || conn.status === 'active');

    const healthCheckPromises = connections.map(async (connection) => {
      const provider = this.providers.get(connection.provider);
      
      if (!provider) {
        return;
      }

      try {
        await this.performHealthCheck(connection, provider);
        
        if (connection.status === 'error') {
          connection.status = 'idle';
          connection.errorCount = Math.max(0, connection.errorCount - 1);
        }
        
      } catch (error) {
        connection.errorCount++;
        connection.status = 'error';
        
        if (connection.errorCount > this.config.retryAttempts) {
          await this.closeConnection(connection.id);
        }
      }
    });

    await Promise.allSettled(healthCheckPromises);
  }

  private async performMaintenanceTasks(): Promise<void> {
    const now = Date.now();
    const idleTimeout = this.config.idleTimeout;
    const connectionsToClose: string[] = [];

    // Find idle connections that have exceeded timeout
    for (const [id, connection] of this.connections.entries()) {
      if (connection.status === 'idle' && 
          connection.activeRequests === 0 &&
          now - connection.lastUsed.getTime() > idleTimeout) {
        
        // Don't close if it would go below minimum
        const providerConnections = this.getProviderConnectionCount(connection.provider);
        if (providerConnections > this.config.minConnections) {
          connectionsToClose.push(id);
        }
      }
    }

    // Close idle connections
    for (const connectionId of connectionsToClose) {
      await this.closeConnection(connectionId);
    }

    // Ensure minimum connections for each provider
    for (const [providerId, provider] of this.providers.entries()) {
      if (provider.enabled) {
        await this.ensureMinimumConnections(providerId);
      }
    }

    // Process any queued requests
    this.processQueue();
  }

  /**
   * Public API methods
   */

  /**
   * Enable/disable a provider
   */
  setProviderEnabled(providerId: string, enabled: boolean): void {
    const provider = this.providers.get(providerId);
    
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    provider.enabled = enabled;
    
    this.logger.info(`Provider ${enabled ? 'enabled' : 'disabled'}`, {
      providerId,
      providerName: provider.name
    });

    if (enabled) {
      // Ensure minimum connections
      setImmediate(() => this.ensureMinimumConnections(providerId));
    } else {
      // Close all connections for this provider
      const connectionsToClose = Array.from(this.connections.values())
        .filter(conn => conn.provider === providerId)
        .map(conn => conn.id);

      connectionsToClose.forEach(id => this.closeConnection(id));
    }

    this.emit('providerToggled', {
      providerId,
      enabled,
      providerName: provider.name
    });
  }

  /**
   * Update provider configuration
   */
  updateProvider(providerId: string, updates: Partial<PoolProvider>): void {
    const provider = this.providers.get(providerId);
    
    if (!provider) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    Object.assign(provider, updates);
    
    this.logger.info('Provider updated', {
      providerId,
      updates
    });

    this.emit('providerUpdated', {
      providerId,
      updates
    });
  }

  /**
   * Force close all connections
   */
  async closeAllConnections(): Promise<void> {
    const connectionIds = Array.from(this.connections.keys());
    const closePromises = connectionIds.map(id => this.closeConnection(id));
    
    await Promise.allSettled(closePromises);
    
    this.logger.info('All connections closed', {
      closedCount: connectionIds.length
    });
  }

  /**
   * Drain the pool (close connections when idle)
   */
  async drain(): Promise<void> {
    // Stop accepting new requests by clearing providers
    const enabledProviders = Array.from(this.providers.values())
      .filter(p => p.enabled)
      .map(p => p.id);

    enabledProviders.forEach(id => {
      this.setProviderEnabled(id, false);
    });

    // Wait for all active connections to become idle, then close them
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const activeConnections = Array.from(this.connections.values())
          .filter(conn => conn.status === 'active' || conn.activeRequests > 0);

        if (activeConnections.length === 0) {
          clearInterval(checkInterval);
          this.closeAllConnections().then(() => resolve());
        }
      }, 100);

      // Force close after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        this.closeAllConnections().then(() => resolve());
      }, 30000);
    });
  }

  /**
   * Update pool configuration
   */
  updateConfig(newConfig: Partial<ConnectionPoolConfig>): void {
    const oldConfig = { ...this.config };
    Object.assign(this.config, newConfig);
    
    this.logger.info('Pool configuration updated', {
      oldConfig,
      newConfig
    });

    // Restart maintenance tasks if intervals changed
    if (newConfig.healthCheckInterval && this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = setInterval(() => {
        this.performPoolHealthChecks();
      }, this.config.healthCheckInterval);
    }

    if (newConfig.keepAliveInterval && this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = setInterval(() => {
        this.performMaintenanceTasks();
      }, this.config.keepAliveInterval);
    }

    this.emit('configUpdated', {
      oldConfig,
      newConfig
    });
  }

  /**
   * Get provider information
   */
  getProviders(): Map<string, PoolProvider> {
    return new Map(this.providers);
  }

  /**
   * Reset pool statistics
   */
  resetStats(): void {
    this.stats = {
      totalConnections: this.stats.totalConnections, // Keep current connection count
      activeConnections: this.stats.activeConnections,
      idleConnections: this.stats.idleConnections,
      connectingConnections: this.stats.connectingConnections,
      errorConnections: this.stats.errorConnections,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      averageQueueTime: 0,
      peakConnections: this.stats.totalConnections,
      poolUtilization: this.stats.poolUtilization,
      providerDistribution: new Map(this.stats.providerDistribution)
    };
    
    this.logger.info('Pool statistics reset');
  }

  /**
   * Stop all maintenance tasks
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    this.logger.info('Connection pool maintenance stopped');
  }
}

export default ConnectionPoolService;
