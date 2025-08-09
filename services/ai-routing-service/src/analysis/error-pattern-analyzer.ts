
import { Logger } from '@ai-platform/shared-utils';
import { EventEmitter } from 'events';

export interface ErrorPattern {
  id: string;
  type: string;
  signature: string;
  count: number;
  firstOccurrence: Date;
  lastOccurrence: Date;
  frequency: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  trend: 'increasing' | 'decreasing' | 'stable';
  providers: string[];
  agents: string[];
  users: string[];
  contexts: string[];
  solutions: string[];
  metadata: Record<string, any>;
}

export interface ErrorAnalysis {
  patternId: string;
  confidence: number;
  rootCause?: string;
  impact: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
  predictedNextOccurrence?: Date;
  relationshipPatterns: string[];
  metadata: Record<string, any>;
}

export interface ErrorEvent {
  id: string;
  timestamp: Date;
  error: any;
  provider?: string;
  agent?: string;
  userId?: string;
  context?: string;
  requestId?: string;
  stackTrace?: string;
  metadata: Record<string, any>;
}

export interface AnalysisConfig {
  enableAnalysis: boolean;
  patternWindow: number; // Time window for pattern detection (ms)
  minOccurrences: number; // Minimum occurrences to consider a pattern
  severityThresholds: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  analysisInterval: number;
  retentionPeriod: number;
  similarityThreshold: number;
}

export interface PatternRule {
  id: string;
  name: string;
  condition: (events: ErrorEvent[]) => boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  recommendations: string[];
}

export class ErrorPatternAnalyzer extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: AnalysisConfig;
  private errorEvents: Map<string, ErrorEvent> = new Map();
  private patterns: Map<string, ErrorPattern> = new Map();
  private analyses: Map<string, ErrorAnalysis> = new Map();
  private patternRules: Map<string, PatternRule> = new Map();
  private analysisInterval: NodeJS.Timeout | null = null;
  
  private metrics = {
    totalErrors: 0,
    patternsDetected: 0,
    analysesGenerated: 0,
    rulesTriggered: new Map<string, number>(),
    severityDistribution: new Map<string, number>(),
    providerErrors: new Map<string, number>(),
    agentErrors: new Map<string, number>(),
    trendChanges: 0
  };

  constructor(config: Partial<AnalysisConfig> = {}) {
    super();
    this.logger = new Logger('ErrorPatternAnalyzer');
    
    this.config = {
      enableAnalysis: true,
      patternWindow: 3600000, // 1 hour
      minOccurrences: 3,
      severityThresholds: {
        low: 5,
        medium: 15,
        high: 30,
        critical: 50
      },
      analysisInterval: 300000, // 5 minutes
      retentionPeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
      similarityThreshold: 0.7,
      ...config
    };

    this.initializePatternRules();
    this.startAnalysis();
  }

  /**
   * Initialize default pattern rules
   */
  private initializePatternRules(): void {
    // High error rate rule
    this.addPatternRule({
      id: 'high-error-rate',
      name: 'High Error Rate',
      condition: (events) => {
        const recentEvents = this.getRecentEvents(events, 600000); // Last 10 minutes
        return recentEvents.length > 10;
      },
      severity: 'high',
      description: 'Unusually high error rate detected',
      recommendations: [
        'Check system resources and capacity',
        'Review recent deployments',
        'Monitor provider health status'
      ]
    });

    // Provider failure pattern
    this.addPatternRule({
      id: 'provider-failure-cascade',
      name: 'Provider Failure Cascade',
      condition: (events) => {
        const providers = new Set(events.map(e => e.provider).filter(Boolean));
        return providers.size > 2 && events.length > 5;
      },
      severity: 'critical',
      description: 'Multiple providers failing simultaneously',
      recommendations: [
        'Activate emergency fallback mode',
        'Check external provider status pages',
        'Implement circuit breakers'
      ]
    });

    // Timeout pattern
    this.addPatternRule({
      id: 'timeout-spike',
      name: 'Timeout Spike',
      condition: (events) => {
        const timeoutEvents = events.filter(e => 
          e.error?.code === 'TIMEOUT' || e.error?.message?.includes('timeout')
        );
        return timeoutEvents.length > 5 && timeoutEvents.length / events.length > 0.5;
      },
      severity: 'high',
      description: 'High number of timeout errors detected',
      recommendations: [
        'Increase timeout thresholds',
        'Check network connectivity',
        'Scale backend resources'
      ]
    });

    // Authentication failure pattern
    this.addPatternRule({
      id: 'auth-failure-spike',
      name: 'Authentication Failure Spike',
      condition: (events) => {
        const authEvents = events.filter(e => 
          e.error?.status === 401 || e.error?.code === 'UNAUTHORIZED'
        );
        return authEvents.length > 8;
      },
      severity: 'medium',
      description: 'High number of authentication failures',
      recommendations: [
        'Check API keys and credentials',
        'Review rate limiting policies',
        'Monitor for potential security issues'
      ]
    });

    // Memory/Resource exhaustion pattern
    this.addPatternRule({
      id: 'resource-exhaustion',
      name: 'Resource Exhaustion',
      condition: (events) => {
        const resourceEvents = events.filter(e => 
          e.error?.message?.includes('memory') || 
          e.error?.message?.includes('resource') ||
          e.error?.code === 'OUT_OF_MEMORY'
        );
        return resourceEvents.length > 3;
      },
      severity: 'critical',
      description: 'System resource exhaustion detected',
      recommendations: [
        'Scale system resources immediately',
        'Enable graceful degradation',
        'Clear memory caches'
      ]
    });

    // Rate limiting pattern
    this.addPatternRule({
      id: 'rate-limit-exceeded',
      name: 'Rate Limit Exceeded',
      condition: (events) => {
        const rateLimitEvents = events.filter(e => 
          e.error?.status === 429 || e.error?.code === 'RATE_LIMIT_EXCEEDED'
        );
        return rateLimitEvents.length > 6;
      },
      severity: 'medium',
      description: 'Rate limiting thresholds being exceeded',
      recommendations: [
        'Implement intelligent request queuing',
        'Add request batching',
        'Review rate limiting policies'
      ]
    });
  }

  /**
   * Record an error event for analysis
   */
  recordError(errorEvent: Partial<ErrorEvent>): void {
    if (!this.config.enableAnalysis) return;

    const event: ErrorEvent = {
      id: errorEvent.id || `error_${Date.now()}_${Math.random()}`,
      timestamp: errorEvent.timestamp || new Date(),
      error: errorEvent.error,
      provider: errorEvent.provider,
      agent: errorEvent.agent,
      userId: errorEvent.userId,
      context: errorEvent.context,
      requestId: errorEvent.requestId,
      stackTrace: errorEvent.stackTrace,
      metadata: errorEvent.metadata || {}
    };

    this.errorEvents.set(event.id, event);
    this.metrics.totalErrors++;

    // Update provider/agent error counts
    if (event.provider) {
      const count = this.metrics.providerErrors.get(event.provider) || 0;
      this.metrics.providerErrors.set(event.provider, count + 1);
    }

    if (event.agent) {
      const count = this.metrics.agentErrors.get(event.agent) || 0;
      this.metrics.agentErrors.set(event.agent, count + 1);
    }

    this.logger.debug('Recorded error event', {
      eventId: event.id,
      provider: event.provider,
      agent: event.agent,
      errorCode: event.error?.code,
      timestamp: event.timestamp
    });

    // Emit event for real-time processing
    this.emit('errorRecorded', event);

    // Trigger immediate analysis for critical errors
    if (this.isCriticalError(event)) {
      setImmediate(() => this.analyzeRecentPatterns());
    }
  }

  /**
   * Add a pattern rule
   */
  addPatternRule(rule: PatternRule): void {
    this.patternRules.set(rule.id, rule);
    this.logger.info(`Added pattern rule: ${rule.name}`, {
      ruleId: rule.id,
      severity: rule.severity
    });
  }

  /**
   * Get current error patterns
   */
  getPatterns(options: {
    minSeverity?: 'low' | 'medium' | 'high' | 'critical';
    provider?: string;
    agent?: string;
    timeWindow?: number;
  } = {}): ErrorPattern[] {
    
    let patterns = Array.from(this.patterns.values());

    // Filter by minimum severity
    if (options.minSeverity) {
      const severityOrder = ['low', 'medium', 'high', 'critical'];
      const minIndex = severityOrder.indexOf(options.minSeverity);
      patterns = patterns.filter(p => 
        severityOrder.indexOf(p.severity) >= minIndex
      );
    }

    // Filter by provider
    if (options.provider) {
      patterns = patterns.filter(p => p.providers.includes(options.provider!));
    }

    // Filter by agent
    if (options.agent) {
      patterns = patterns.filter(p => p.agents.includes(options.agent!));
    }

    // Filter by time window
    if (options.timeWindow) {
      const cutoff = Date.now() - options.timeWindow;
      patterns = patterns.filter(p => 
        p.lastOccurrence.getTime() > cutoff
      );
    }

    return patterns.sort((a, b) => {
      // Sort by severity first, then by frequency
      const severityOrder = ['low', 'medium', 'high', 'critical'];
      const aSeverityIndex = severityOrder.indexOf(a.severity);
      const bSeverityIndex = severityOrder.indexOf(b.severity);
      
      if (aSeverityIndex !== bSeverityIndex) {
        return bSeverityIndex - aSeverityIndex;
      }
      
      return b.frequency - a.frequency;
    });
  }

  /**
   * Get analysis for a specific pattern
   */
  getAnalysis(patternId: string): ErrorAnalysis | null {
    return this.analyses.get(patternId) || null;
  }

  /**
   * Get all current analyses
   */
  getAllAnalyses(): ErrorAnalysis[] {
    return Array.from(this.analyses.values())
      .sort((a, b) => {
        const impactOrder = ['low', 'medium', 'high', 'critical'];
        return impactOrder.indexOf(b.impact) - impactOrder.indexOf(a.impact);
      });
  }

  /**
   * Start periodic analysis
   */
  private startAnalysis(): void {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
    }

    this.analysisInterval = setInterval(() => {
      this.analyzeRecentPatterns();
      this.cleanupOldData();
    }, this.config.analysisInterval);

    this.logger.info('Started error pattern analysis');
  }

  /**
   * Analyze recent error patterns
   */
  private analyzeRecentPatterns(): void {
    const recentEvents = this.getRecentErrorEvents();
    
    if (recentEvents.length === 0) return;

    this.logger.debug('Analyzing recent patterns', {
      eventCount: recentEvents.length,
      timeWindow: this.config.patternWindow
    });

    // Detect patterns using rules
    for (const [ruleId, rule] of this.patternRules.entries()) {
      try {
        if (rule.condition(recentEvents)) {
          this.handlePatternDetection(rule, recentEvents);
        }
      } catch (error) {
        this.logger.error('Pattern rule evaluation failed', {
          ruleId,
          error: error.message
        });
      }
    }

    // Detect similarity-based patterns
    this.detectSimilarityPatterns(recentEvents);

    // Update existing pattern trends
    this.updatePatternTrends();
  }

  /**
   * Handle pattern detection
   */
  private handlePatternDetection(rule: PatternRule, events: ErrorEvent[]): void {
    const patternId = `${rule.id}_${Date.now()}`;
    const signature = this.generatePatternSignature(rule.id, events);
    
    // Check if we already have this pattern
    const existingPattern = Array.from(this.patterns.values()).find(p => 
      p.signature === signature
    );

    if (existingPattern) {
      // Update existing pattern
      existingPattern.count += events.length;
      existingPattern.lastOccurrence = new Date();
      existingPattern.frequency = this.calculateFrequency(existingPattern);
      this.updatePatternData(existingPattern, events);
    } else {
      // Create new pattern
      const pattern: ErrorPattern = {
        id: patternId,
        type: rule.id,
        signature,
        count: events.length,
        firstOccurrence: new Date(Math.min(...events.map(e => e.timestamp.getTime()))),
        lastOccurrence: new Date(Math.max(...events.map(e => e.timestamp.getTime()))),
        frequency: events.length / (this.config.patternWindow / 60000), // per minute
        severity: rule.severity,
        trend: 'stable',
        providers: [...new Set(events.map(e => e.provider).filter(Boolean))],
        agents: [...new Set(events.map(e => e.agent).filter(Boolean))],
        users: [...new Set(events.map(e => e.userId).filter(Boolean))],
        contexts: [...new Set(events.map(e => e.context).filter(Boolean))],
        solutions: [...rule.recommendations],
        metadata: {
          ruleId: rule.id,
          ruleName: rule.name,
          description: rule.description,
          detectedAt: new Date(),
          eventIds: events.map(e => e.id)
        }
      };

      this.patterns.set(patternId, pattern);
      this.metrics.patternsDetected++;
      
      // Update severity distribution
      const severityCount = this.metrics.severityDistribution.get(pattern.severity) || 0;
      this.metrics.severityDistribution.set(pattern.severity, severityCount + 1);

      this.emit('patternDetected', pattern);
      
      this.logger.warn('New error pattern detected', {
        patternId,
        type: pattern.type,
        severity: pattern.severity,
        count: pattern.count,
        providers: pattern.providers,
        agents: pattern.agents
      });
    }

    // Update rule metrics
    const ruleCount = this.metrics.rulesTriggered.get(rule.id) || 0;
    this.metrics.rulesTriggered.set(rule.id, ruleCount + 1);

    // Generate analysis for the pattern
    this.generatePatternAnalysis(existingPattern || this.patterns.get(patternId)!);
  }

  /**
   * Detect similarity-based patterns
   */
  private detectSimilarityPatterns(events: ErrorEvent[]): void {
    const groups = this.groupSimilarErrors(events);
    
    for (const group of groups) {
      if (group.length >= this.config.minOccurrences) {
        const signature = this.generateSimilaritySignature(group);
        
        // Check if pattern already exists
        const existingPattern = Array.from(this.patterns.values()).find(p => 
          p.signature === signature && p.type === 'similarity'
        );

        if (!existingPattern) {
          const severity = this.calculateSeverityFromEvents(group);
          const patternId = `similarity_${Date.now()}_${Math.random()}`;
          
          const pattern: ErrorPattern = {
            id: patternId,
            type: 'similarity',
            signature,
            count: group.length,
            firstOccurrence: new Date(Math.min(...group.map(e => e.timestamp.getTime()))),
            lastOccurrence: new Date(Math.max(...group.map(e => e.timestamp.getTime()))),
            frequency: group.length / (this.config.patternWindow / 60000),
            severity,
            trend: 'stable',
            providers: [...new Set(group.map(e => e.provider).filter(Boolean))],
            agents: [...new Set(group.map(e => e.agent).filter(Boolean))],
            users: [...new Set(group.map(e => e.userId).filter(Boolean))],
            contexts: [...new Set(group.map(e => e.context).filter(Boolean))],
            solutions: this.generateRecommendations(group),
            metadata: {
              similarityBased: true,
              commonFeatures: this.extractCommonFeatures(group),
              detectedAt: new Date(),
              eventIds: group.map(e => e.id)
            }
          };

          this.patterns.set(patternId, pattern);
          this.metrics.patternsDetected++;

          this.emit('similarityPatternDetected', pattern);
          
          this.logger.info('Similarity-based pattern detected', {
            patternId,
            severity,
            count: group.length,
            commonFeatures: pattern.metadata.commonFeatures
          });
        }
      }
    }
  }

  /**
   * Generate pattern analysis
   */
  private generatePatternAnalysis(pattern: ErrorPattern): void {
    const analysis: ErrorAnalysis = {
      patternId: pattern.id,
      confidence: this.calculateConfidence(pattern),
      rootCause: this.identifyRootCause(pattern),
      impact: this.calculateImpact(pattern),
      recommendations: this.generateAnalysisRecommendations(pattern),
      predictedNextOccurrence: this.predictNextOccurrence(pattern),
      relationshipPatterns: this.findRelatedPatterns(pattern),
      metadata: {
        analysisDate: new Date(),
        patternAge: Date.now() - pattern.firstOccurrence.getTime(),
        frequencyTrend: pattern.trend,
        affectedProviders: pattern.providers.length,
        affectedAgents: pattern.agents.length,
        affectedUsers: pattern.users.length
      }
    };

    this.analyses.set(pattern.id, analysis);
    this.metrics.analysesGenerated++;

    this.emit('analysisGenerated', { pattern, analysis });

    this.logger.info('Generated pattern analysis', {
      patternId: pattern.id,
      confidence: analysis.confidence,
      impact: analysis.impact,
      rootCause: analysis.rootCause
    });
  }

  /**
   * Helper methods for pattern analysis
   */
  private getRecentErrorEvents(): ErrorEvent[] {
    const cutoff = Date.now() - this.config.patternWindow;
    return Array.from(this.errorEvents.values())
      .filter(event => event.timestamp.getTime() > cutoff)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  private getRecentEvents(events: ErrorEvent[], window: number): ErrorEvent[] {
    const cutoff = Date.now() - window;
    return events.filter(event => event.timestamp.getTime() > cutoff);
  }

  private isCriticalError(event: ErrorEvent): boolean {
    return event.error?.status >= 500 || 
           event.error?.code === 'SYSTEM_FAILURE' ||
           event.error?.code === 'OUT_OF_MEMORY' ||
           event.error?.severity === 'critical';
  }

  private generatePatternSignature(ruleId: string, events: ErrorEvent[]): string {
    const features = [
      ruleId,
      [...new Set(events.map(e => e.provider).filter(Boolean))].sort().join(','),
      [...new Set(events.map(e => e.agent).filter(Boolean))].sort().join(','),
      [...new Set(events.map(e => e.error?.code).filter(Boolean))].sort().join(',')
    ];
    
    return features.join('|');
  }

  private generateSimilaritySignature(events: ErrorEvent[]): string {
    const commonFeatures = this.extractCommonFeatures(events);
    return `similarity|${JSON.stringify(commonFeatures)}`;
  }

  private groupSimilarErrors(events: ErrorEvent[]): ErrorEvent[][] {
    const groups: ErrorEvent[][] = [];
    const processed = new Set<string>();

    for (const event of events) {
      if (processed.has(event.id)) continue;

      const similarEvents = events.filter(e => 
        !processed.has(e.id) && this.areEventsSimilar(event, e)
      );

      if (similarEvents.length >= this.config.minOccurrences) {
        groups.push(similarEvents);
        similarEvents.forEach(e => processed.add(e.id));
      }
    }

    return groups;
  }

  private areEventsSimilar(event1: ErrorEvent, event2: ErrorEvent): boolean {
    const features1 = this.extractEventFeatures(event1);
    const features2 = this.extractEventFeatures(event2);
    
    const similarity = this.calculateFeatureSimilarity(features1, features2);
    return similarity >= this.config.similarityThreshold;
  }

  private extractEventFeatures(event: ErrorEvent): Record<string, any> {
    return {
      provider: event.provider,
      agent: event.agent,
      errorCode: event.error?.code,
      errorStatus: event.error?.status,
      errorMessage: this.normalizeErrorMessage(event.error?.message),
      context: event.context
    };
  }

  private extractCommonFeatures(events: ErrorEvent[]): Record<string, any> {
    const features: Record<string, any> = {};
    const eventFeatures = events.map(e => this.extractEventFeatures(e));
    
    // Find common features across all events
    for (const key of Object.keys(eventFeatures[0] || {})) {
      const values = eventFeatures.map(f => f[key]).filter(Boolean);
      const uniqueValues = [...new Set(values)];
      
      if (uniqueValues.length === 1 && values.length >= events.length * 0.8) {
        features[key] = uniqueValues[0];
      }
    }
    
    return features;
  }

  private calculateFeatureSimilarity(features1: Record<string, any>, features2: Record<string, any>): number {
    const allKeys = new Set([...Object.keys(features1), ...Object.keys(features2)]);
    let matches = 0;
    let total = 0;

    for (const key of allKeys) {
      total++;
      if (features1[key] === features2[key]) {
        matches++;
      }
    }

    return total > 0 ? matches / total : 0;
  }

  private normalizeErrorMessage(message?: string): string {
    if (!message) return '';
    
    // Remove timestamps, IDs, and other variable content
    return message
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '[TIMESTAMP]')
      .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, '[UUID]')
      .replace(/\d+/g, '[NUMBER]')
      .toLowerCase();
  }

  private calculateSeverityFromEvents(events: ErrorEvent[]): 'low' | 'medium' | 'high' | 'critical' {
    const count = events.length;
    const thresholds = this.config.severityThresholds;

    if (count >= thresholds.critical) return 'critical';
    if (count >= thresholds.high) return 'high';
    if (count >= thresholds.medium) return 'medium';
    return 'low';
  }

  private calculateFrequency(pattern: ErrorPattern): number {
    const duration = pattern.lastOccurrence.getTime() - pattern.firstOccurrence.getTime();
    const minutes = Math.max(duration / 60000, 1); // At least 1 minute
    return pattern.count / minutes;
  }

  private updatePatternData(pattern: ErrorPattern, events: ErrorEvent[]): void {
    // Update providers, agents, users, contexts
    const newProviders = events.map(e => e.provider).filter(Boolean);
    const newAgents = events.map(e => e.agent).filter(Boolean);
    const newUsers = events.map(e => e.userId).filter(Boolean);
    const newContexts = events.map(e => e.context).filter(Boolean);

    pattern.providers = [...new Set([...pattern.providers, ...newProviders])];
    pattern.agents = [...new Set([...pattern.agents, ...newAgents])];
    pattern.users = [...new Set([...pattern.users, ...newUsers])];
    pattern.contexts = [...new Set([...pattern.contexts, ...newContexts])];

    // Update metadata
    pattern.metadata.eventIds = [...(pattern.metadata.eventIds || []), ...events.map(e => e.id)];
    pattern.metadata.lastUpdated = new Date();
  }

  private updatePatternTrends(): void {
    for (const pattern of this.patterns.values()) {
      const oldTrend = pattern.trend;
      pattern.trend = this.calculateTrend(pattern);
      
      if (oldTrend !== pattern.trend) {
        this.metrics.trendChanges++;
        this.emit('trendChanged', {
          patternId: pattern.id,
          oldTrend,
          newTrend: pattern.trend
        });
      }
    }
  }

  private calculateTrend(pattern: ErrorPattern): 'increasing' | 'decreasing' | 'stable' {
    // Simple trend calculation based on recent frequency
    const recentWindow = 900000; // 15 minutes
    const olderWindow = 1800000; // 30 minutes
    
    const recentEvents = Array.from(this.errorEvents.values())
      .filter(e => e.timestamp.getTime() > Date.now() - recentWindow)
      .filter(e => (pattern.metadata.eventIds || []).includes(e.id));
    
    const olderEvents = Array.from(this.errorEvents.values())
      .filter(e => {
        const time = e.timestamp.getTime();
        return time > Date.now() - olderWindow && time <= Date.now() - recentWindow;
      })
      .filter(e => (pattern.metadata.eventIds || []).includes(e.id));

    const recentFreq = recentEvents.length / (recentWindow / 60000);
    const olderFreq = olderEvents.length / (recentWindow / 60000);

    const changeThreshold = 0.2;
    const change = olderFreq > 0 ? (recentFreq - olderFreq) / olderFreq : 0;

    if (change > changeThreshold) return 'increasing';
    if (change < -changeThreshold) return 'decreasing';
    return 'stable';
  }

  private calculateConfidence(pattern: ErrorPattern): number {
    let confidence = 0.5; // Base confidence

    // More occurrences = higher confidence
    confidence += Math.min(pattern.count / 20, 0.3);

    // Multiple providers/agents = higher confidence
    confidence += (pattern.providers.length - 1) * 0.05;
    confidence += (pattern.agents.length - 1) * 0.05;

    // Recent occurrences = higher confidence
    const timeSinceLastOccurrence = Date.now() - pattern.lastOccurrence.getTime();
    if (timeSinceLastOccurrence < 300000) confidence += 0.1; // Last 5 minutes

    // Stable/increasing trend = higher confidence
    if (pattern.trend === 'increasing') confidence += 0.1;
    else if (pattern.trend === 'stable') confidence += 0.05;

    return Math.min(Math.max(confidence, 0), 1);
  }

  private identifyRootCause(pattern: ErrorPattern): string | undefined {
    // Simple rule-based root cause identification
    if (pattern.providers.length > 2) {
      return 'Multiple provider failures suggest infrastructure or network issues';
    }

    if (pattern.type === 'timeout-spike') {
      return 'High timeout rates suggest resource contention or network latency';
    }

    if (pattern.type === 'auth-failure-spike') {
      return 'Authentication failures may indicate credential or permission issues';
    }

    if (pattern.type === 'resource-exhaustion') {
      return 'System resource limits being exceeded';
    }

    if (pattern.frequency > 10) {
      return 'High frequency errors suggest systematic issue';
    }

    return undefined;
  }

  private calculateImpact(pattern: ErrorPattern): 'low' | 'medium' | 'high' | 'critical' {
    let impactScore = 0;

    // Base on pattern severity
    const severityScores = { low: 1, medium: 2, high: 3, critical: 4 };
    impactScore += severityScores[pattern.severity];

    // Factor in affected users
    impactScore += Math.min(pattern.users.length / 10, 2);

    // Factor in frequency
    if (pattern.frequency > 5) impactScore += 1;
    if (pattern.frequency > 15) impactScore += 1;

    // Factor in provider/agent spread
    if (pattern.providers.length > 1) impactScore += 1;
    if (pattern.agents.length > 2) impactScore += 1;

    if (impactScore >= 6) return 'critical';
    if (impactScore >= 4) return 'high';
    if (impactScore >= 2) return 'medium';
    return 'low';
  }

  private generateRecommendations(events: ErrorEvent[]): string[] {
    const recommendations: string[] = [];
    
    // Generic recommendations based on error patterns
    const errorCodes = [...new Set(events.map(e => e.error?.code).filter(Boolean))];
    
    if (errorCodes.includes('TIMEOUT')) {
      recommendations.push('Increase timeout thresholds', 'Check network connectivity');
    }
    
    if (errorCodes.includes('RATE_LIMIT_EXCEEDED')) {
      recommendations.push('Implement request queuing', 'Review rate limiting policies');
    }
    
    if (errorCodes.some(code => code?.includes('AUTH'))) {
      recommendations.push('Check authentication credentials', 'Review access permissions');
    }

    return recommendations.length > 0 ? recommendations : ['Monitor pattern for additional insights'];
  }

  private generateAnalysisRecommendations(pattern: ErrorPattern): string[] {
    const recommendations = [...pattern.solutions];
    
    // Add analysis-specific recommendations
    if (pattern.trend === 'increasing') {
      recommendations.push('Priority: Immediate attention required due to increasing trend');
    }
    
    if (pattern.users.length > 10) {
      recommendations.push('High user impact: Consider service announcement');
    }
    
    if (pattern.frequency > 20) {
      recommendations.push('Critical: Activate emergency response procedures');
    }

    return [...new Set(recommendations)]; // Remove duplicates
  }

  private predictNextOccurrence(pattern: ErrorPattern): Date | undefined {
    if (pattern.frequency <= 0) return undefined;
    
    // Simple prediction based on average frequency
    const avgInterval = (60 / pattern.frequency) * 60000; // Convert to milliseconds
    return new Date(pattern.lastOccurrence.getTime() + avgInterval);
  }

  private findRelatedPatterns(pattern: ErrorPattern): string[] {
    const related: string[] = [];
    
    for (const [id, otherPattern] of this.patterns.entries()) {
      if (id === pattern.id) continue;
      
      // Check for overlap in providers, agents, or contexts
      const hasOverlap = 
        pattern.providers.some(p => otherPattern.providers.includes(p)) ||
        pattern.agents.some(a => otherPattern.agents.includes(a)) ||
        pattern.contexts.some(c => otherPattern.contexts.includes(c));
      
      if (hasOverlap) {
        related.push(id);
      }
    }
    
    return related;
  }

  private cleanupOldData(): void {
    const cutoff = Date.now() - this.config.retentionPeriod;
    
    // Clean up old events
    for (const [id, event] of this.errorEvents.entries()) {
      if (event.timestamp.getTime() < cutoff) {
        this.errorEvents.delete(id);
      }
    }
    
    // Clean up old patterns
    for (const [id, pattern] of this.patterns.entries()) {
      if (pattern.lastOccurrence.getTime() < cutoff) {
        this.patterns.delete(id);
        this.analyses.delete(id);
      }
    }
    
    this.logger.debug('Cleaned up old error data');
  }

  /**
   * Public API methods
   */

  /**
   * Get error analysis metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Get recent error events
   */
  getRecentErrorEvents(timeWindow?: number): ErrorEvent[] {
    const window = timeWindow || this.config.patternWindow;
    const cutoff = Date.now() - window;
    
    return Array.from(this.errorEvents.values())
      .filter(event => event.timestamp.getTime() > cutoff)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Force pattern analysis
   */
  forceAnalysis(): void {
    this.analyzeRecentPatterns();
    this.logger.info('Forced pattern analysis completed');
  }

  /**
   * Clear all patterns and analyses
   */
  clearPatterns(): void {
    this.patterns.clear();
    this.analyses.clear();
    this.logger.info('Cleared all patterns and analyses');
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<AnalysisConfig>): void {
    Object.assign(this.config, newConfig);
    this.logger.info('Updated analysis configuration');
  }

  /**
   * Get pattern statistics
   */
  getPatternStatistics(): {
    totalPatterns: number;
    severityDistribution: Record<string, number>;
    topProviders: Array<{provider: string, count: number}>;
    topAgents: Array<{agent: string, count: number}>;
    trendDistribution: Record<string, number>;
  } {
    const patterns = Array.from(this.patterns.values());
    
    const severityDistribution: Record<string, number> = {};
    const trendDistribution: Record<string, number> = {};
    
    patterns.forEach(p => {
      severityDistribution[p.severity] = (severityDistribution[p.severity] || 0) + 1;
      trendDistribution[p.trend] = (trendDistribution[p.trend] || 0) + 1;
    });

    const topProviders = Array.from(this.metrics.providerErrors.entries())
      .map(([provider, count]) => ({provider, count}))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const topAgents = Array.from(this.metrics.agentErrors.entries())
      .map(([agent, count]) => ({agent, count}))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalPatterns: patterns.length,
      severityDistribution,
      topProviders,
      topAgents,
      trendDistribution
    };
  }

  /**
   * Stop analysis
   */
  stop(): void {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
    
    this.logger.info('Stopped error pattern analysis');
  }
}

export default ErrorPatternAnalyzer;
