
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';

export interface ProfilerConfig {
  enableProfiling: boolean;
  sampleInterval: number;
  maxProfileHistory: number;
  cpuProfilingEnabled: boolean;
  memoryProfilingEnabled: boolean;
  requestProfilingEnabled: boolean;
  databaseProfilingEnabled: boolean;
  slowRequestThreshold: number;
  hottestPathsCount: number;
  enableAlerts: boolean;
}

export interface PerformanceMetrics {
  timestamp: Date;
  cpuUsage: {
    user: number;
    system: number;
    total: number;
  };
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  };
  eventLoopDelay: number;
  activeHandles: number;
  activeRequests: number;
  uptime: number;
  loadAverage: number[];
}

export interface RequestProfile {
  requestId: string;
  method: string;
  path: string;
  startTime: Date;
  endTime?: Date;
  duration: number;
  cpuTime: number;
  memoryUsage: number;
  peakMemory: number;
  dbQueries: number;
  dbTime: number;
  status: number;
  error?: string;
  metadata: Record<string, any>;
}

export interface HotPath {
  path: string;
  method: string;
  count: number;
  averageDuration: number;
  totalDuration: number;
  minDuration: number;
  maxDuration: number;
  errorRate: number;
  last24Hours: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface BottleneckAnalysis {
  type: 'cpu' | 'memory' | 'database' | 'io' | 'network';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  frequency: number;
  impact: number;
  suggestedFixes: string[];
  affectedPaths: string[];
  firstDetected: Date;
  lastDetected: Date;
}

export interface PerformanceAlert {
  id: string;
  type: 'slow_request' | 'high_cpu' | 'memory_leak' | 'bottleneck';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  timestamp: Date;
  metrics: PerformanceMetrics;
  affectedRequests?: string[];
  suggestedActions: string[];
  resolved: boolean;
}

export interface DatabaseProfile {
  query: string;
  queryHash: string;
  executionTime: number;
  rowsReturned: number;
  timestamp: Date;
  requestId?: string;
  error?: string;
}

export class PerformanceProfilerService extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: ProfilerConfig;
  private metricsHistory: PerformanceMetrics[] = [];
  private requestProfiles: Map<string, RequestProfile> = new Map();
  private completedProfiles: RequestProfile[] = [];
  private hotPaths: Map<string, HotPath> = new Map();
  private bottlenecks: Map<string, BottleneckAnalysis> = new Map();
  private alerts: Map<string, PerformanceAlert> = new Map();
  private databaseProfiles: DatabaseProfile[] = [];
  
  private profilingInterval: NodeJS.Timeout | null = null;
  private eventLoopMonitor: any = null;
  private lastCpuUsage = process.cpuUsage();
  private startTime = Date.now();
  
  private metrics = {
    totalRequests: 0,
    slowRequests: 0,
    averageResponseTime: 0,
    requestsPerSecond: 0,
    errorRate: 0,
    p95ResponseTime: 0,
    p99ResponseTime: 0,
    bottlenecksDetected: 0,
    alertsGenerated: 0,
    dbQueryCount: 0,
    averageDbQueryTime: 0
  };

  constructor(config: Partial<ProfilerConfig> = {}) {
    super();
    this.logger = new Logger('PerformanceProfilerService');
    
    this.config = {
      enableProfiling: true,
      sampleInterval: 5000, // 5 seconds
      maxProfileHistory: 1000,
      cpuProfilingEnabled: true,
      memoryProfilingEnabled: true,
      requestProfilingEnabled: true,
      databaseProfilingEnabled: true,
      slowRequestThreshold: 2000, // 2 seconds
      hottestPathsCount: 20,
      enableAlerts: true,
      ...config
    };

    this.startProfiling();
  }

  /**
   * Start performance profiling
   */
  private startProfiling(): void {
    if (!this.config.enableProfiling) return;

    // Start metrics collection
    this.profilingInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.sampleInterval);

    // Initialize event loop monitoring
    this.initializeEventLoopMonitoring();

    this.logger.info('Performance profiling started');
  }

  /**
   * Start request profiling
   */
  startRequestProfile(
    requestId: string,
    method: string,
    path: string,
    metadata: Record<string, any> = {}
  ): void {
    
    if (!this.config.requestProfilingEnabled) return;

    const profile: RequestProfile = {
      requestId,
      method: method.toUpperCase(),
      path: this.normalizePath(path),
      startTime: new Date(),
      duration: 0,
      cpuTime: 0,
      memoryUsage: process.memoryUsage().heapUsed,
      peakMemory: process.memoryUsage().heapUsed,
      dbQueries: 0,
      dbTime: 0,
      status: 0,
      metadata
    };

    this.requestProfiles.set(requestId, profile);
    this.metrics.totalRequests++;

    this.logger.debug('Started request profiling', {
      requestId,
      method,
      path,
      memoryUsage: profile.memoryUsage
    });
  }

  /**
   * Update request profile memory peak
   */
  updateRequestMemory(requestId: string): void {
    const profile = this.requestProfiles.get(requestId);
    if (!profile) return;

    const currentMemory = process.memoryUsage().heapUsed;
    profile.peakMemory = Math.max(profile.peakMemory, currentMemory);
  }

  /**
   * Add database query to request profile
   */
  addDatabaseQuery(
    requestId: string,
    query: string,
    executionTime: number,
    rowsReturned: number = 0,
    error?: string
  ): void {
    
    if (!this.config.databaseProfilingEnabled) return;

    // Update request profile
    const profile = this.requestProfiles.get(requestId);
    if (profile) {
      profile.dbQueries++;
      profile.dbTime += executionTime;
    }

    // Create database profile
    const dbProfile: DatabaseProfile = {
      query: this.sanitizeQuery(query),
      queryHash: this.hashQuery(query),
      executionTime,
      rowsReturned,
      timestamp: new Date(),
      requestId,
      error
    };

    this.databaseProfiles.push(dbProfile);
    this.metrics.dbQueryCount++;
    this.metrics.averageDbQueryTime = 
      (this.metrics.averageDbQueryTime * (this.metrics.dbQueryCount - 1) + executionTime) / 
      this.metrics.dbQueryCount;

    // Keep database profiles manageable
    if (this.databaseProfiles.length > 10000) {
      this.databaseProfiles.splice(0, 5000);
    }

    // Check for slow queries
    if (executionTime > 1000) { // 1 second threshold
      this.generateAlert({
        type: 'bottleneck',
        severity: executionTime > 5000 ? 'critical' : 'high',
        title: 'Slow Database Query',
        description: `Database query took ${executionTime}ms: ${query.substring(0, 100)}...`,
        timestamp: new Date(),
        metrics: this.getCurrentMetrics(),
        affectedRequests: requestId ? [requestId] : [],
        suggestedActions: [
          'Review query optimization',
          'Check database indexes',
          'Consider query caching'
        ]
      });
    }

    this.logger.debug('Database query profiled', {
      requestId,
      executionTime,
      queryHash: dbProfile.queryHash,
      rowsReturned
    });
  }

  /**
   * End request profiling
   */
  endRequestProfile(requestId: string, status: number, error?: string): RequestProfile | null {
    const profile = this.requestProfiles.get(requestId);
    if (!profile) return null;

    const endTime = new Date();
    const cpuUsage = process.cpuUsage(this.lastCpuUsage);
    
    profile.endTime = endTime;
    profile.duration = endTime.getTime() - profile.startTime.getTime();
    profile.cpuTime = (cpuUsage.user + cpuUsage.system) / 1000; // Convert to ms
    profile.status = status;
    profile.error = error;

    // Remove from active profiles
    this.requestProfiles.delete(requestId);
    
    // Add to completed profiles
    this.completedProfiles.push(profile);
    this.updateHotPaths(profile);
    this.updateMetrics(profile);

    // Check for slow request
    if (profile.duration > this.config.slowRequestThreshold) {
      this.metrics.slowRequests++;
      
      if (this.config.enableAlerts) {
        this.generateAlert({
          type: 'slow_request',
          severity: profile.duration > 5000 ? 'critical' : 'high',
          title: 'Slow Request Detected',
          description: `${profile.method} ${profile.path} took ${profile.duration}ms`,
          timestamp: new Date(),
          metrics: this.getCurrentMetrics(),
          affectedRequests: [requestId],
          suggestedActions: [
            'Analyze request bottlenecks',
            'Optimize database queries',
            'Consider caching strategies'
          ]
        });
      }
    }

    // Keep completed profiles manageable
    if (this.completedProfiles.length > this.config.maxProfileHistory) {
      this.completedProfiles.splice(0, 500);
    }

    this.emit('requestProfileCompleted', profile);

    this.logger.debug('Request profiling completed', {
      requestId,
      duration: profile.duration,
      status: profile.status,
      cpuTime: profile.cpuTime,
      peakMemory: profile.peakMemory,
      dbQueries: profile.dbQueries
    });

    return profile;
  }

  /**
   * Get current performance metrics
   */
  getCurrentMetrics(): PerformanceMetrics {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage(this.lastCpuUsage);
    
    return {
      timestamp: new Date(),
      cpuUsage: {
        user: cpuUsage.user / 1000000, // Convert to seconds
        system: cpuUsage.system / 1000000,
        total: (cpuUsage.user + cpuUsage.system) / 1000000
      },
      memoryUsage: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
        external: memUsage.external
      },
      eventLoopDelay: this.getCurrentEventLoopDelay(),
      activeHandles: (process as any)._getActiveHandles ? (process as any)._getActiveHandles().length : 0,
      activeRequests: (process as any)._getActiveRequests ? (process as any)._getActiveRequests().length : 0,
      uptime: process.uptime(),
      loadAverage: []
    };
  }

  /**
   * Get performance metrics history
   */
  getMetricsHistory(timeWindow?: number): PerformanceMetrics[] {
    let metrics = [...this.metricsHistory];
    
    if (timeWindow) {
      const cutoff = Date.now() - timeWindow;
      metrics = metrics.filter(m => m.timestamp.getTime() > cutoff);
    }

    return metrics;
  }

  /**
   * Get hot paths analysis
   */
  getHotPaths(limit?: number): HotPath[] {
    const paths = Array.from(this.hotPaths.values())
      .sort((a, b) => {
        // Sort by total duration, then by count
        if (b.totalDuration !== a.totalDuration) {
          return b.totalDuration - a.totalDuration;
        }
        return b.count - a.count;
      });

    return limit ? paths.slice(0, limit) : paths;
  }

  /**
   * Get bottleneck analysis
   */
  getBottlenecks(): BottleneckAnalysis[] {
    return Array.from(this.bottlenecks.values())
      .sort((a, b) => {
        // Sort by impact, then by frequency
        if (b.impact !== a.impact) {
          return b.impact - a.impact;
        }
        return b.frequency - a.frequency;
      });
  }

  /**
   * Get recent performance alerts
   */
  getAlerts(resolved: boolean = false): PerformanceAlert[] {
    return Array.from(this.alerts.values())
      .filter(alert => alert.resolved === resolved)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get database query analysis
   */
  getDatabaseAnalysis(timeWindow: number = 3600000): {
    slowQueries: DatabaseProfile[];
    queryStats: Map<string, {
      count: number;
      averageTime: number;
      totalTime: number;
      errorCount: number;
    }>;
    topQueries: Array<{
      queryHash: string;
      query: string;
      count: number;
      averageTime: number;
      totalTime: number;
    }>;
  } {
    const cutoff = Date.now() - timeWindow;
    const recentQueries = this.databaseProfiles.filter(q => 
      q.timestamp.getTime() > cutoff
    );

    const slowQueries = recentQueries
      .filter(q => q.executionTime > 1000)
      .sort((a, b) => b.executionTime - a.executionTime)
      .slice(0, 50);

    const queryStats = new Map<string, any>();
    
    for (const query of recentQueries) {
      const stats = queryStats.get(query.queryHash) || {
        count: 0,
        averageTime: 0,
        totalTime: 0,
        errorCount: 0
      };

      stats.count++;
      stats.totalTime += query.executionTime;
      stats.averageTime = stats.totalTime / stats.count;
      if (query.error) stats.errorCount++;

      queryStats.set(query.queryHash, stats);
    }

    const topQueries = Array.from(queryStats.entries())
      .map(([queryHash, stats]) => {
        const sampleQuery = recentQueries.find(q => q.queryHash === queryHash);
        return {
          queryHash,
          query: sampleQuery?.query || '',
          ...stats
        };
      })
      .sort((a, b) => b.totalTime - a.totalTime)
      .slice(0, 20);

    return {
      slowQueries,
      queryStats,
      topQueries
    };
  }

  /**
   * Get request profiles
   */
  getRequestProfiles(filters: {
    path?: string;
    method?: string;
    status?: number;
    minDuration?: number;
    maxDuration?: number;
    limit?: number;
  } = {}): RequestProfile[] {
    
    let profiles = [...this.completedProfiles];

    // Apply filters
    if (filters.path) {
      profiles = profiles.filter(p => p.path.includes(filters.path!));
    }
    
    if (filters.method) {
      profiles = profiles.filter(p => p.method === filters.method);
    }
    
    if (filters.status) {
      profiles = profiles.filter(p => p.status === filters.status);
    }
    
    if (filters.minDuration) {
      profiles = profiles.filter(p => p.duration >= filters.minDuration!);
    }
    
    if (filters.maxDuration) {
      profiles = profiles.filter(p => p.duration <= filters.maxDuration!);
    }

    // Sort by duration (slowest first)
    profiles.sort((a, b) => b.duration - a.duration);

    return filters.limit ? profiles.slice(0, filters.limit) : profiles;
  }

  /**
   * Private helper methods
   */
  private collectMetrics(): void {
    const metrics = this.getCurrentMetrics();
    this.metricsHistory.push(metrics);

    // Keep history manageable
    if (this.metricsHistory.length > 10000) {
      this.metricsHistory.splice(0, 5000);
    }

    // Check for performance issues
    this.analyzePerformance(metrics);
    this.detectBottlenecks();

    this.emit('metricsCollected', metrics);
    
    // Update last CPU usage for next calculation
    this.lastCpuUsage = process.cpuUsage();
  }

  private analyzePerformance(metrics: PerformanceMetrics): void {
    // High CPU usage alert
    if (metrics.cpuUsage.total > 0.8 && this.config.enableAlerts) {
      this.generateAlert({
        type: 'high_cpu',
        severity: metrics.cpuUsage.total > 0.9 ? 'critical' : 'high',
        title: 'High CPU Usage',
        description: `CPU usage is ${(metrics.cpuUsage.total * 100).toFixed(1)}%`,
        timestamp: new Date(),
        metrics,
        suggestedActions: [
          'Identify CPU-intensive operations',
          'Consider horizontal scaling',
          'Review recent code changes'
        ]
      });
    }

    // High memory usage alert
    const memoryUtilization = (metrics.memoryUsage.heapUsed / metrics.memoryUsage.heapTotal);
    if (memoryUtilization > 0.85 && this.config.enableAlerts) {
      this.generateAlert({
        type: 'memory_leak',
        severity: memoryUtilization > 0.95 ? 'critical' : 'high',
        title: 'High Memory Usage',
        description: `Memory utilization is ${(memoryUtilization * 100).toFixed(1)}%`,
        timestamp: new Date(),
        metrics,
        suggestedActions: [
          'Check for memory leaks',
          'Clear unnecessary caches',
          'Consider memory optimization'
        ]
      });
    }
  }

  private detectBottlenecks(): void {
    // Analyze recent completed profiles for bottlenecks
    const recentProfiles = this.completedProfiles.slice(-100);
    const bottleneckAnalysis = new Map<string, any>();

    for (const profile of recentProfiles) {
      // Database bottleneck
      if (profile.dbTime > profile.duration * 0.5) {
        const key = 'database_bottleneck';
        const existing = bottleneckAnalysis.get(key) || {
          type: 'database',
          frequency: 0,
          impact: 0,
          affectedPaths: new Set()
        };
        
        existing.frequency++;
        existing.impact += profile.dbTime;
        existing.affectedPaths.add(`${profile.method} ${profile.path}`);
        bottleneckAnalysis.set(key, existing);
      }

      // CPU bottleneck
      if (profile.cpuTime > 1000) { // 1 second of CPU time
        const key = 'cpu_bottleneck';
        const existing = bottleneckAnalysis.get(key) || {
          type: 'cpu',
          frequency: 0,
          impact: 0,
          affectedPaths: new Set()
        };
        
        existing.frequency++;
        existing.impact += profile.cpuTime;
        existing.affectedPaths.add(`${profile.method} ${profile.path}`);
        bottleneckAnalysis.set(key, existing);
      }

      // Memory bottleneck
      const memoryGrowth = profile.peakMemory - profile.memoryUsage;
      if (memoryGrowth > 50000000) { // 50MB growth
        const key = 'memory_bottleneck';
        const existing = bottleneckAnalysis.get(key) || {
          type: 'memory',
          frequency: 0,
          impact: 0,
          affectedPaths: new Set()
        };
        
        existing.frequency++;
        existing.impact += memoryGrowth;
        existing.affectedPaths.add(`${profile.method} ${profile.path}`);
        bottleneckAnalysis.set(key, existing);
      }
    }

    // Update bottlenecks
    for (const [key, analysis] of bottleneckAnalysis.entries()) {
      if (analysis.frequency >= 3) { // Minimum frequency threshold
        const severity = analysis.frequency > 10 ? 'critical' :
                        analysis.frequency > 5 ? 'high' : 'medium';

        const bottleneck: BottleneckAnalysis = {
          type: analysis.type,
          description: this.getBottleneckDescription(analysis.type, analysis.frequency),
          severity,
          frequency: analysis.frequency,
          impact: analysis.impact,
          suggestedFixes: this.getBottleneckSuggestions(analysis.type),
          affectedPaths: Array.from(analysis.affectedPaths),
          firstDetected: this.bottlenecks.get(key)?.firstDetected || new Date(),
          lastDetected: new Date()
        };

        this.bottlenecks.set(key, bottleneck);
        this.metrics.bottlenecksDetected++;
      }
    }
  }

  private updateHotPaths(profile: RequestProfile): void {
    const pathKey = `${profile.method} ${profile.path}`;
    let hotPath = this.hotPaths.get(pathKey);

    if (!hotPath) {
      hotPath = {
        path: profile.path,
        method: profile.method,
        count: 0,
        averageDuration: 0,
        totalDuration: 0,
        minDuration: profile.duration,
        maxDuration: profile.duration,
        errorRate: 0,
        last24Hours: 0,
        trend: 'stable'
      };
      this.hotPaths.set(pathKey, hotPath);
    }

    // Update statistics
    hotPath.count++;
    hotPath.totalDuration += profile.duration;
    hotPath.averageDuration = hotPath.totalDuration / hotPath.count;
    hotPath.minDuration = Math.min(hotPath.minDuration, profile.duration);
    hotPath.maxDuration = Math.max(hotPath.maxDuration, profile.duration);

    // Update error rate
    if (profile.status >= 400) {
      const errors = hotPath.errorRate * (hotPath.count - 1) + 1;
      hotPath.errorRate = errors / hotPath.count;
    } else {
      hotPath.errorRate = (hotPath.errorRate * (hotPath.count - 1)) / hotPath.count;
    }

    // Update 24-hour count (simplified)
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (profile.startTime.getTime() > oneDayAgo) {
      hotPath.last24Hours++;
    }

    // Calculate trend (simplified)
    if (hotPath.count > 10) {
      const recentAvg = hotPath.totalDuration / Math.min(hotPath.count, 5);
      const overallAvg = hotPath.averageDuration;
      
      if (recentAvg > overallAvg * 1.2) {
        hotPath.trend = 'increasing';
      } else if (recentAvg < overallAvg * 0.8) {
        hotPath.trend = 'decreasing';
      } else {
        hotPath.trend = 'stable';
      }
    }
  }

  private updateMetrics(profile: RequestProfile): void {
    // Update average response time
    this.metrics.averageResponseTime = 
      (this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + profile.duration) / 
      this.metrics.totalRequests;

    // Update error rate
    if (profile.status >= 400) {
      this.metrics.errorRate = 
        (this.metrics.errorRate * (this.metrics.totalRequests - 1) + 1) / 
        this.metrics.totalRequests;
    } else {
      this.metrics.errorRate = 
        (this.metrics.errorRate * (this.metrics.totalRequests - 1)) / 
        this.metrics.totalRequests;
    }

    // Calculate percentiles (simplified)
    const recentDurations = this.completedProfiles
      .slice(-100)
      .map(p => p.duration)
      .sort((a, b) => a - b);

    if (recentDurations.length > 0) {
      this.metrics.p95ResponseTime = recentDurations[Math.floor(recentDurations.length * 0.95)];
      this.metrics.p99ResponseTime = recentDurations[Math.floor(recentDurations.length * 0.99)];
    }

    // Calculate requests per second (over last minute)
    const oneMinuteAgo = Date.now() - 60000;
    const recentRequests = this.completedProfiles.filter(p => 
      p.startTime.getTime() > oneMinuteAgo
    );
    this.metrics.requestsPerSecond = recentRequests.length / 60;
  }

  private generateAlert(alertData: Omit<PerformanceAlert, 'id' | 'resolved'>): void {
    const alertId = `${alertData.type}_${Date.now()}_${Math.random()}`;
    
    const alert: PerformanceAlert = {
      id: alertId,
      resolved: false,
      ...alertData
    };

    this.alerts.set(alertId, alert);
    this.metrics.alertsGenerated++;

    this.emit('performanceAlert', alert);

    this.logger.warn(`Performance alert: ${alert.title}`, {
      alertId,
      type: alert.type,
      severity: alert.severity,
      description: alert.description
    });

    // Auto-resolve certain types of alerts after some time
    if (alert.type === 'slow_request') {
      setTimeout(() => {
        this.resolveAlert(alertId);
      }, 300000); // 5 minutes
    }
  }

  private initializeEventLoopMonitoring(): void {
    // Simple event loop delay monitoring
    let start = process.hrtime.bigint();
    
    const measureDelay = () => {
      const now = process.hrtime.bigint();
      const delay = Number(now - start - BigInt(this.config.sampleInterval * 1000000)) / 1000000;
      this.eventLoopMonitor = Math.max(0, delay);
      start = process.hrtime.bigint();
      
      setTimeout(measureDelay, this.config.sampleInterval);
    };

    setTimeout(measureDelay, this.config.sampleInterval);
  }

  private getCurrentEventLoopDelay(): number {
    return this.eventLoopMonitor || 0;
  }

  private normalizePath(path: string): string {
    // Normalize dynamic path segments
    return path
      .replace(/\/\d+/g, '/:id')
      .replace(/\/[a-f0-9-]{36}/g, '/:uuid')
      .replace(/\?.*$/, ''); // Remove query parameters
  }

  private sanitizeQuery(query: string): string {
    // Remove sensitive data from queries
    return query
      .replace(/password\s*=\s*'[^']*'/gi, "password = '[REDACTED]'")
      .replace(/token\s*=\s*'[^']*'/gi, "token = '[REDACTED]'")
      .substring(0, 500); // Limit length
  }

  private hashQuery(query: string): string {
    // Simple hash function for query identification
    let hash = 0;
    const normalized = query.replace(/\s+/g, ' ').trim().toLowerCase();
    
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return hash.toString(36);
  }

  private getBottleneckDescription(type: string, frequency: number): string {
    const descriptions = {
      database: `Database operations causing slowdowns (${frequency} occurrences)`,
      cpu: `CPU-intensive operations detected (${frequency} occurrences)`,
      memory: `High memory usage patterns (${frequency} occurrences)`,
      io: `I/O operations bottleneck (${frequency} occurrences)`,
      network: `Network communication delays (${frequency} occurrences)`
    };

    return descriptions[type as keyof typeof descriptions] || `Performance bottleneck detected (${frequency} occurrences)`;
  }

  private getBottleneckSuggestions(type: string): string[] {
    const suggestions = {
      database: [
        'Optimize database queries',
        'Add appropriate indexes',
        'Consider query caching',
        'Implement connection pooling'
      ],
      cpu: [
        'Profile CPU-intensive functions',
        'Consider asynchronous processing',
        'Optimize algorithms',
        'Scale horizontally'
      ],
      memory: [
        'Check for memory leaks',
        'Optimize data structures',
        'Implement garbage collection tuning',
        'Consider memory caching strategies'
      ],
      io: [
        'Optimize file operations',
        'Implement async I/O',
        'Consider I/O caching',
        'Review disk performance'
      ],
      network: [
        'Optimize network requests',
        'Implement request batching',
        'Consider CDN usage',
        'Review network infrastructure'
      ]
    };

    return suggestions[type as keyof typeof suggestions] || ['Review and optimize the affected operations'];
  }

  /**
   * Public API methods
   */

  /**
   * Get profiler metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Resolve a performance alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.resolved = true;
    
    this.emit('alertResolved', alert);
    
    this.logger.info('Performance alert resolved', {
      alertId,
      type: alert.type,
      title: alert.title
    });

    return true;
  }

  /**
   * Clear resolved alerts
   */
  clearResolvedAlerts(): number {
    const resolvedAlerts = Array.from(this.alerts.values()).filter(a => a.resolved);
    
    resolvedAlerts.forEach(alert => {
      this.alerts.delete(alert.id);
    });

    this.logger.info('Cleared resolved alerts', {
      count: resolvedAlerts.length
    });

    return resolvedAlerts.length;
  }

  /**
   * Update profiler configuration
   */
  updateConfig(newConfig: Partial<ProfilerConfig>): void {
    Object.assign(this.config, newConfig);
    
    // Restart profiling if interval changed
    if (newConfig.sampleInterval && this.profilingInterval) {
      clearInterval(this.profilingInterval);
      this.profilingInterval = setInterval(() => {
        this.collectMetrics();
      }, this.config.sampleInterval);
    }

    this.logger.info('Profiler configuration updated', { newConfig });
  }

  /**
   * Reset profiler data
   */
  resetProfilerData(): void {
    this.metricsHistory.length = 0;
    this.completedProfiles.length = 0;
    this.databaseProfiles.length = 0;
    this.hotPaths.clear();
    this.bottlenecks.clear();
    
    // Keep only unresolved alerts
    const unresolvedAlerts = Array.from(this.alerts.values()).filter(a => !a.resolved);
    this.alerts.clear();
    unresolvedAlerts.forEach(alert => this.alerts.set(alert.id, alert));

    this.metrics = {
      totalRequests: 0,
      slowRequests: 0,
      averageResponseTime: 0,
      requestsPerSecond: 0,
      errorRate: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      bottlenecksDetected: 0,
      alertsGenerated: this.metrics.alertsGenerated, // Keep alert count
      dbQueryCount: 0,
      averageDbQueryTime: 0
    };

    this.logger.info('Profiler data reset');
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport(timeWindow: number = 3600000): {
    summary: {
      totalRequests: number;
      averageResponseTime: number;
      errorRate: number;
      slowRequests: number;
      throughput: number;
    };
    hotPaths: HotPath[];
    bottlenecks: BottleneckAnalysis[];
    alerts: PerformanceAlert[];
    databaseAnalysis: any;
    recommendations: string[];
  } {
    const dbAnalysis = this.getDatabaseAnalysis(timeWindow);
    const hotPaths = this.getHotPaths(10);
    const bottlenecks = this.getBottlenecks();
    const recentAlerts = this.getAlerts().slice(0, 20);

    const recommendations: string[] = [];

    // Generate recommendations based on analysis
    if (this.metrics.errorRate > 0.05) {
      recommendations.push('High error rate detected - review error handling and monitoring');
    }

    if (this.metrics.averageResponseTime > 2000) {
      recommendations.push('Average response time is high - consider performance optimizations');
    }

    if (bottlenecks.length > 0) {
      recommendations.push(`${bottlenecks.length} performance bottlenecks detected - prioritize resolution`);
    }

    if (dbAnalysis.slowQueries.length > 0) {
      recommendations.push(`${dbAnalysis.slowQueries.length} slow database queries found - optimize queries and indexes`);
    }

    return {
      summary: {
        totalRequests: this.metrics.totalRequests,
        averageResponseTime: this.metrics.averageResponseTime,
        errorRate: this.metrics.errorRate,
        slowRequests: this.metrics.slowRequests,
        throughput: this.metrics.requestsPerSecond
      },
      hotPaths,
      bottlenecks,
      alerts: recentAlerts,
      databaseAnalysis: dbAnalysis,
      recommendations
    };
  }

  /**
   * Stop performance profiling
   */
  stop(): void {
    if (this.profilingInterval) {
      clearInterval(this.profilingInterval);
      this.profilingInterval = null;
    }

    this.logger.info('Performance profiling stopped');
  }
}

export default PerformanceProfilerService;
