
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';

export interface MemoryConfig {
  enableMemoryManagement: boolean;
  heapWarningThreshold: number; // Percentage of max heap
  heapCriticalThreshold: number;
  gcInterval: number;
  leakDetectionEnabled: boolean;
  leakThreshold: number; // MB growth per interval
  cacheMaxSize: number;
  requestMemoryLimit: number;
  emergencyCleanupEnabled: boolean;
  memoryProfilerEnabled: boolean;
}

export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  heapLimit: number;
  rss: number;
  external: number;
  arrayBuffers: number;
  heapUtilization: number;
  memoryLeakDetected: boolean;
  lastGcTime: Date | null;
  gcCount: number;
  cacheSize: number;
  requestCount: number;
  averageRequestMemory: number;
}

export interface MemoryAlert {
  type: 'warning' | 'critical' | 'leak' | 'emergency';
  message: string;
  timestamp: Date;
  memoryStats: MemoryStats;
  suggestedActions: string[];
  severity: number; // 1-10 scale
}

export interface RequestMemoryTracker {
  requestId: string;
  startMemory: number;
  peakMemory: number;
  endMemory: number;
  duration: number;
  memoryDelta: number;
  startTime: Date;
  endTime?: Date;
}

export interface MemoryCache {
  id: string;
  data: any;
  size: number;
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
  priority: number;
  ttl: number;
}

export interface CleanupStrategy {
  id: string;
  name: string;
  description: string;
  priority: number;
  condition: (stats: MemoryStats) => boolean;
  execute: () => Promise<number>; // Returns bytes freed
  enabled: boolean;
}

export class MemoryManagerService extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: MemoryConfig;
  private memoryCache: Map<string, MemoryCache> = new Map();
  private requestTrackers: Map<string, RequestMemoryTracker> = new Map();
  private cleanupStrategies: Map<string, CleanupStrategy> = new Map();
  private memoryHistory: MemoryStats[] = [];
  private monitoringInterval: NodeJS.Timeout | null = null;
  private lastGcTime: Date | null = null;
  private gcCount: number = 0;
  private alertHistory: MemoryAlert[] = [];
  
  private metrics = {
    totalRequests: 0,
    memoryLeaksDetected: 0,
    emergencyCleanups: 0,
    averageRequestMemory: 0,
    peakMemoryUsage: 0,
    totalBytesFreed: 0,
    cleanupOperations: 0,
    alertsGenerated: 0
  };

  constructor(config: Partial<MemoryConfig> = {}) {
    super();
    this.logger = new Logger('MemoryManagerService');
    
    this.config = {
      enableMemoryManagement: true,
      heapWarningThreshold: 80,
      heapCriticalThreshold: 90,
      gcInterval: 30000, // 30 seconds
      leakDetectionEnabled: true,
      leakThreshold: 50, // 50MB growth per interval
      cacheMaxSize: 100000000, // 100MB
      requestMemoryLimit: 50000000, // 50MB per request
      emergencyCleanupEnabled: true,
      memoryProfilerEnabled: true,
      ...config
    };

    this.initializeCleanupStrategies();
    this.startMonitoring();
  }

  /**
   * Initialize memory cleanup strategies
   */
  private initializeCleanupStrategies(): void {
    // Cache cleanup strategy
    this.registerCleanupStrategy({
      id: 'cache-cleanup',
      name: 'Cache Cleanup',
      description: 'Clear old and unused cache entries',
      priority: 1,
      enabled: true,
      condition: (stats) => stats.heapUtilization > 70,
      execute: async () => this.cleanupCache()
    });

    // Request tracker cleanup
    this.registerCleanupStrategy({
      id: 'tracker-cleanup',
      name: 'Request Tracker Cleanup',
      description: 'Remove old request tracking data',
      priority: 2,
      enabled: true,
      condition: (stats) => this.requestTrackers.size > 1000,
      execute: async () => this.cleanupRequestTrackers()
    });

    // Force garbage collection
    this.registerCleanupStrategy({
      id: 'force-gc',
      name: 'Force Garbage Collection',
      description: 'Trigger garbage collection manually',
      priority: 3,
      enabled: true,
      condition: (stats) => stats.heapUtilization > 75,
      execute: async () => this.forceGarbageCollection()
    });

    // Memory history cleanup
    this.registerCleanupStrategy({
      id: 'history-cleanup',
      name: 'Memory History Cleanup',
      description: 'Trim old memory history data',
      priority: 4,
      enabled: true,
      condition: (stats) => this.memoryHistory.length > 1000,
      execute: async () => this.cleanupMemoryHistory()
    });

    // Emergency cleanup
    this.registerCleanupStrategy({
      id: 'emergency-cleanup',
      name: 'Emergency Cleanup',
      description: 'Emergency memory cleanup for critical situations',
      priority: 0,
      enabled: true,
      condition: (stats) => stats.heapUtilization > 95,
      execute: async () => this.performEmergencyCleanup()
    });
  }

  /**
   * Register a cleanup strategy
   */
  registerCleanupStrategy(strategy: CleanupStrategy): void {
    this.cleanupStrategies.set(strategy.id, strategy);
    this.logger.info(`Registered cleanup strategy: ${strategy.name}`, {
      strategyId: strategy.id,
      priority: strategy.priority
    });
  }

  /**
   * Start memory request tracking
   */
  startRequestTracking(requestId: string): void {
    if (!this.config.memoryProfilerEnabled) return;

    const memStats = process.memoryUsage();
    
    const tracker: RequestMemoryTracker = {
      requestId,
      startMemory: memStats.heapUsed,
      peakMemory: memStats.heapUsed,
      endMemory: 0,
      duration: 0,
      memoryDelta: 0,
      startTime: new Date()
    };

    this.requestTrackers.set(requestId, tracker);
    this.metrics.totalRequests++;

    this.logger.debug('Started memory tracking', {
      requestId,
      startMemory: tracker.startMemory,
      totalTrackers: this.requestTrackers.size
    });
  }

  /**
   * Update peak memory for request
   */
  updateRequestMemory(requestId: string): void {
    if (!this.config.memoryProfilerEnabled) return;

    const tracker = this.requestTrackers.get(requestId);
    if (!tracker) return;

    const currentMemory = process.memoryUsage().heapUsed;
    tracker.peakMemory = Math.max(tracker.peakMemory, currentMemory);

    // Check if request is using too much memory
    const requestMemoryUsage = tracker.peakMemory - tracker.startMemory;
    if (requestMemoryUsage > this.config.requestMemoryLimit) {
      this.generateAlert({
        type: 'warning',
        message: `Request ${requestId} using excessive memory: ${this.formatBytes(requestMemoryUsage)}`,
        timestamp: new Date(),
        memoryStats: this.getCurrentMemoryStats(),
        suggestedActions: [
          'Consider request optimization',
          'Check for memory leaks in request handling',
          'Implement request memory limits'
        ],
        severity: 6
      });
    }
  }

  /**
   * End memory request tracking
   */
  endRequestTracking(requestId: string): RequestMemoryTracker | null {
    if (!this.config.memoryProfilerEnabled) return null;

    const tracker = this.requestTrackers.get(requestId);
    if (!tracker) return null;

    const endTime = new Date();
    const memStats = process.memoryUsage();
    
    tracker.endTime = endTime;
    tracker.endMemory = memStats.heapUsed;
    tracker.duration = endTime.getTime() - tracker.startTime.getTime();
    tracker.memoryDelta = tracker.endMemory - tracker.startMemory;

    // Update average request memory
    this.metrics.averageRequestMemory = 
      (this.metrics.averageRequestMemory * (this.metrics.totalRequests - 1) + 
       Math.abs(tracker.memoryDelta)) / this.metrics.totalRequests;

    this.emit('requestTrackingCompleted', {
      requestId,
      memoryDelta: tracker.memoryDelta,
      peakMemory: tracker.peakMemory,
      duration: tracker.duration
    });

    this.logger.debug('Completed memory tracking', {
      requestId,
      memoryDelta: tracker.memoryDelta,
      peakMemory: tracker.peakMemory,
      duration: tracker.duration
    });

    return tracker;
  }

  /**
   * Add item to memory cache
   */
  setCacheItem(key: string, data: any, options: {
    ttl?: number;
    priority?: number;
  } = {}): boolean {
    try {
      const size = this.calculateDataSize(data);
      const currentCacheSize = this.getCurrentCacheSize();

      // Check cache size limits
      if (currentCacheSize + size > this.config.cacheMaxSize) {
        // Try to free space
        const spaceFreed = this.freeCacheSpace(size);
        if (spaceFreed < size) {
          this.logger.warn('Insufficient cache space', {
            required: size,
            freed: spaceFreed,
            maxSize: this.config.cacheMaxSize
          });
          return false;
        }
      }

      const cacheItem: MemoryCache = {
        id: key,
        data,
        size,
        createdAt: new Date(),
        lastAccessed: new Date(),
        accessCount: 0,
        priority: options.priority || 5,
        ttl: options.ttl || 3600000 // 1 hour default
      };

      this.memoryCache.set(key, cacheItem);

      this.logger.debug('Cache item set', {
        key,
        size,
        cacheSize: this.getCurrentCacheSize(),
        itemCount: this.memoryCache.size
      });

      return true;

    } catch (error) {
      this.logger.error('Failed to set cache item', {
        key,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get item from memory cache
   */
  getCacheItem(key: string): any {
    const item = this.memoryCache.get(key);
    
    if (!item) {
      return null;
    }

    // Check expiration
    const now = Date.now();
    if (now - item.createdAt.getTime() > item.ttl) {
      this.memoryCache.delete(key);
      return null;
    }

    // Update access info
    item.lastAccessed = new Date();
    item.accessCount++;

    return item.data;
  }

  /**
   * Remove item from memory cache
   */
  removeCacheItem(key: string): boolean {
    return this.memoryCache.delete(key);
  }

  /**
   * Get current memory statistics
   */
  getCurrentMemoryStats(): MemoryStats {
    const memUsage = process.memoryUsage();
    const heapLimit = this.getHeapLimit();
    const heapUtilization = (memUsage.heapUsed / heapLimit) * 100;
    
    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      heapLimit,
      rss: memUsage.rss,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
      heapUtilization,
      memoryLeakDetected: this.detectMemoryLeak(),
      lastGcTime: this.lastGcTime,
      gcCount: this.gcCount,
      cacheSize: this.getCurrentCacheSize(),
      requestCount: this.requestTrackers.size,
      averageRequestMemory: this.metrics.averageRequestMemory
    };
  }

  /**
   * Get memory usage history
   */
  getMemoryHistory(maxEntries: number = 100): MemoryStats[] {
    return this.memoryHistory.slice(-maxEntries);
  }

  /**
   * Get recent memory alerts
   */
  getRecentAlerts(maxAlerts: number = 50): MemoryAlert[] {
    return this.alertHistory.slice(-maxAlerts);
  }

  /**
   * Force memory cleanup
   */
  async forceCleanup(): Promise<number> {
    this.logger.info('Forcing memory cleanup');
    
    const currentStats = this.getCurrentMemoryStats();
    const applicableStrategies = Array.from(this.cleanupStrategies.values())
      .filter(strategy => strategy.enabled && strategy.condition(currentStats))
      .sort((a, b) => a.priority - b.priority);

    let totalFreed = 0;

    for (const strategy of applicableStrategies) {
      try {
        const freed = await strategy.execute();
        totalFreed += freed;
        
        this.logger.info('Cleanup strategy executed', {
          strategy: strategy.name,
          bytesFreed: freed,
          totalFreed
        });

        this.emit('cleanupExecuted', {
          strategy: strategy.name,
          bytesFreed: freed,
          totalFreed
        });

      } catch (error) {
        this.logger.error('Cleanup strategy failed', {
          strategy: strategy.name,
          error: error.message
        });
      }
    }

    this.metrics.totalBytesFreed += totalFreed;
    this.metrics.cleanupOperations++;

    return totalFreed;
  }

  /**
   * Private helper methods
   */
  private startMonitoring(): void {
    if (!this.config.enableMemoryManagement) return;

    this.monitoringInterval = setInterval(() => {
      this.performMonitoringCycle();
    }, this.config.gcInterval);

    this.logger.info('Started memory monitoring');
  }

  private performMonitoringCycle(): void {
    const stats = this.getCurrentMemoryStats();
    
    // Store in history
    this.memoryHistory.push(stats);
    
    // Keep history size manageable
    if (this.memoryHistory.length > 2000) {
      this.memoryHistory.splice(0, 1000);
    }

    // Update peak memory usage
    this.metrics.peakMemoryUsage = Math.max(this.metrics.peakMemoryUsage, stats.heapUsed);

    // Check for alerts
    this.checkMemoryAlerts(stats);

    // Perform leak detection
    if (this.config.leakDetectionEnabled && stats.memoryLeakDetected) {
      this.handleMemoryLeak(stats);
    }

    // Auto cleanup if needed
    this.performAutoCleanup(stats);

    this.emit('memoryStatsUpdated', stats);
  }

  private checkMemoryAlerts(stats: MemoryStats): void {
    // Critical threshold
    if (stats.heapUtilization > this.config.heapCriticalThreshold) {
      this.generateAlert({
        type: 'critical',
        message: `Critical memory usage: ${stats.heapUtilization.toFixed(1)}%`,
        timestamp: new Date(),
        memoryStats: stats,
        suggestedActions: [
          'Immediate cleanup required',
          'Consider restarting service',
          'Review memory-intensive operations'
        ],
        severity: 9
      });
    }
    // Warning threshold
    else if (stats.heapUtilization > this.config.heapWarningThreshold) {
      this.generateAlert({
        type: 'warning',
        message: `High memory usage: ${stats.heapUtilization.toFixed(1)}%`,
        timestamp: new Date(),
        memoryStats: stats,
        suggestedActions: [
          'Monitor memory usage closely',
          'Consider cleanup operations',
          'Check for memory leaks'
        ],
        severity: 6
      });
    }

    // Memory leak alert
    if (stats.memoryLeakDetected) {
      this.generateAlert({
        type: 'leak',
        message: 'Potential memory leak detected',
        timestamp: new Date(),
        memoryStats: stats,
        suggestedActions: [
          'Investigate memory growth patterns',
          'Check for unclosed resources',
          'Review recent code changes'
        ],
        severity: 8
      });
    }
  }

  private generateAlert(alert: MemoryAlert): void {
    this.alertHistory.push(alert);
    this.metrics.alertsGenerated++;

    // Keep alert history manageable
    if (this.alertHistory.length > 1000) {
      this.alertHistory.splice(0, 500);
    }

    this.emit('memoryAlert', alert);

    this.logger.warn(`Memory alert: ${alert.type}`, {
      message: alert.message,
      severity: alert.severity,
      heapUtilization: alert.memoryStats.heapUtilization
    });
  }

  private detectMemoryLeak(): boolean {
    if (this.memoryHistory.length < 5) return false;

    const recent = this.memoryHistory.slice(-5);
    const oldestMemory = recent[0].heapUsed;
    const newestMemory = recent[recent.length - 1].heapUsed;
    
    const growthMB = (newestMemory - oldestMemory) / (1024 * 1024);
    
    return growthMB > this.config.leakThreshold;
  }

  private handleMemoryLeak(stats: MemoryStats): void {
    this.metrics.memoryLeaksDetected++;
    
    this.logger.error('Memory leak detected', {
      heapUsed: stats.heapUsed,
      heapUtilization: stats.heapUtilization,
      requestCount: stats.requestCount
    });

    // Trigger cleanup
    setImmediate(() => this.forceCleanup());
  }

  private performAutoCleanup(stats: MemoryStats): void {
    const needsCleanup = 
      stats.heapUtilization > this.config.heapWarningThreshold ||
      stats.memoryLeakDetected ||
      this.getCurrentCacheSize() > this.config.cacheMaxSize * 0.8;

    if (needsCleanup) {
      setImmediate(() => this.forceCleanup());
    }
  }

  private async cleanupCache(): Promise<number> {
    const beforeSize = this.getCurrentCacheSize();
    const now = Date.now();
    let freedBytes = 0;

    // Remove expired items
    for (const [key, item] of this.memoryCache.entries()) {
      if (now - item.createdAt.getTime() > item.ttl) {
        freedBytes += item.size;
        this.memoryCache.delete(key);
      }
    }

    // If still over limit, remove least recently used items
    const remainingItems = Array.from(this.memoryCache.values())
      .sort((a, b) => {
        // Sort by priority (lower = higher priority) then by last accessed
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.lastAccessed.getTime() - b.lastAccessed.getTime();
      });

    const targetSize = this.config.cacheMaxSize * 0.7; // Target 70% of max
    let currentSize = this.getCurrentCacheSize();

    for (const item of remainingItems) {
      if (currentSize <= targetSize) break;
      
      this.memoryCache.delete(item.id);
      freedBytes += item.size;
      currentSize -= item.size;
    }

    const afterSize = this.getCurrentCacheSize();
    this.logger.debug('Cache cleanup completed', {
      beforeSize,
      afterSize,
      freedBytes,
      itemsRemaining: this.memoryCache.size
    });

    return freedBytes;
  }

  private async cleanupRequestTrackers(): Promise<number> {
    const beforeCount = this.requestTrackers.size;
    const cutoffTime = Date.now() - 3600000; // 1 hour ago
    let freedBytes = 0;

    for (const [requestId, tracker] of this.requestTrackers.entries()) {
      if (tracker.startTime.getTime() < cutoffTime && tracker.endTime) {
        // Estimate memory used by tracker
        freedBytes += 1000; // Approximate size of tracker object
        this.requestTrackers.delete(requestId);
      }
    }

    const afterCount = this.requestTrackers.size;
    this.logger.debug('Request tracker cleanup completed', {
      beforeCount,
      afterCount,
      freedBytes
    });

    return freedBytes;
  }

  private async forceGarbageCollection(): Promise<number> {
    const beforeHeap = process.memoryUsage().heapUsed;
    
    if (global.gc) {
      global.gc();
      this.gcCount++;
      this.lastGcTime = new Date();
    } else {
      // Force some garbage collection by creating pressure
      const dummy = new Array(10000).fill(0).map(() => ({ data: Math.random() }));
      dummy.length = 0;
    }

    const afterHeap = process.memoryUsage().heapUsed;
    const freedBytes = Math.max(0, beforeHeap - afterHeap);

    this.logger.debug('Garbage collection completed', {
      beforeHeap,
      afterHeap,
      freedBytes,
      gcAvailable: !!global.gc
    });

    return freedBytes;
  }

  private async cleanupMemoryHistory(): Promise<number> {
    const beforeCount = this.memoryHistory.length;
    const keepCount = 1000;
    
    if (beforeCount > keepCount) {
      this.memoryHistory.splice(0, beforeCount - keepCount);
    }

    const afterCount = this.memoryHistory.length;
    const freedBytes = (beforeCount - afterCount) * 500; // Estimate

    this.logger.debug('Memory history cleanup completed', {
      beforeCount,
      afterCount,
      freedBytes
    });

    return freedBytes;
  }

  private async performEmergencyCleanup(): Promise<number> {
    this.logger.warn('Performing emergency memory cleanup');
    this.metrics.emergencyCleanups++;

    let totalFreed = 0;

    // Clear all caches aggressively
    const cacheSize = this.getCurrentCacheSize();
    this.memoryCache.clear();
    totalFreed += cacheSize;

    // Clear old request trackers
    const trackerCount = this.requestTrackers.size;
    this.requestTrackers.clear();
    totalFreed += trackerCount * 1000;

    // Clear most of the history
    const historyCount = this.memoryHistory.length;
    this.memoryHistory.splice(0, Math.floor(historyCount * 0.9));
    totalFreed += Math.floor(historyCount * 0.9) * 500;

    // Force GC
    const gcFreed = await this.forceGarbageCollection();
    totalFreed += gcFreed;

    this.generateAlert({
      type: 'emergency',
      message: `Emergency cleanup completed. Freed ${this.formatBytes(totalFreed)}`,
      timestamp: new Date(),
      memoryStats: this.getCurrentMemoryStats(),
      suggestedActions: [
        'Monitor system stability',
        'Consider service restart',
        'Review memory usage patterns'
      ],
      severity: 10
    });

    return totalFreed;
  }

  private calculateDataSize(data: any): number {
    try {
      // Rough estimation of object size
      const jsonString = JSON.stringify(data);
      return Buffer.byteLength(jsonString, 'utf8');
    } catch (error) {
      // Fallback estimation
      return 1000;
    }
  }

  private getCurrentCacheSize(): number {
    let totalSize = 0;
    for (const item of this.memoryCache.values()) {
      totalSize += item.size;
    }
    return totalSize;
  }

  private freeCacheSpace(requiredSpace: number): number {
    const items = Array.from(this.memoryCache.values())
      .sort((a, b) => {
        // Remove low priority and least recently used items first
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.lastAccessed.getTime() - b.lastAccessed.getTime();
      });

    let freedSpace = 0;
    
    for (const item of items) {
      if (freedSpace >= requiredSpace) break;
      
      this.memoryCache.delete(item.id);
      freedSpace += item.size;
    }

    return freedSpace;
  }

  private getHeapLimit(): number {
    // Try to get actual heap limit from V8
    try {
      if (process.memoryUsage().heapTotal) {
        // Estimate based on typical Node.js defaults
        return Math.max(process.memoryUsage().heapTotal * 2, 1400 * 1024 * 1024); // ~1.4GB default
      }
    } catch (error) {
      // Fallback
    }
    
    return 1400 * 1024 * 1024; // 1.4GB default limit
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Public API methods
   */

  /**
   * Get memory manager metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Get request tracking information
   */
  getRequestTrackers(completed: boolean = false): RequestMemoryTracker[] {
    return Array.from(this.requestTrackers.values())
      .filter(tracker => completed ? !!tracker.endTime : !tracker.endTime)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  /**
   * Get cache information
   */
  getCacheInfo(): {
    itemCount: number;
    totalSize: number;
    maxSize: number;
    utilizationPercent: number;
    topItems: Array<{
      key: string;
      size: number;
      accessCount: number;
      age: number;
    }>;
  } {
    const totalSize = this.getCurrentCacheSize();
    const topItems = Array.from(this.memoryCache.values())
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, 10)
      .map(item => ({
        key: item.id,
        size: item.size,
        accessCount: item.accessCount,
        age: Date.now() - item.createdAt.getTime()
      }));

    return {
      itemCount: this.memoryCache.size,
      totalSize,
      maxSize: this.config.cacheMaxSize,
      utilizationPercent: (totalSize / this.config.cacheMaxSize) * 100,
      topItems
    };
  }

  /**
   * Update memory manager configuration
   */
  updateConfig(newConfig: Partial<MemoryConfig>): void {
    Object.assign(this.config, newConfig);
    this.logger.info('Memory manager configuration updated', { newConfig });

    // Restart monitoring if interval changed
    if (newConfig.gcInterval && this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = setInterval(() => {
        this.performMonitoringCycle();
      }, this.config.gcInterval);
    }
  }

  /**
   * Clear all cache items
   */
  clearCache(): number {
    const beforeSize = this.getCurrentCacheSize();
    this.memoryCache.clear();
    
    this.logger.info('Cache cleared', {
      bytesFreed: beforeSize,
      itemsCleared: this.memoryCache.size
    });

    return beforeSize;
  }

  /**
   * Reset memory manager statistics
   */
  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      memoryLeaksDetected: 0,
      emergencyCleanups: 0,
      averageRequestMemory: 0,
      peakMemoryUsage: 0,
      totalBytesFreed: 0,
      cleanupOperations: 0,
      alertsGenerated: 0
    };
    
    this.memoryHistory.length = 0;
    this.alertHistory.length = 0;
    
    this.logger.info('Memory manager metrics reset');
  }

  /**
   * Stop memory monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.logger.info('Memory monitoring stopped');
  }
}

export default MemoryManagerService;
