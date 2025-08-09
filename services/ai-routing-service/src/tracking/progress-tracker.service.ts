
import { EventEmitter } from 'events';
import { logger } from '@ai-platform/shared-utils';

export interface ProgressEvent {
  taskId: string;
  userId: string;
  agentId: string;
  phase: string;
  progress: number;
  tokensProcessed: number;
  estimatedTokens: number;
  timeElapsed: number;
  estimatedTimeRemaining: number;
  metadata?: Record<string, any>;
}

export interface TaskProgress {
  taskId: string;
  userId: string;
  agentId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  phases: ProgressPhase[];
  currentPhase: number;
  overallProgress: number;
  totalTokensProcessed: number;
  estimatedTotalTokens: number;
  startTime: number;
  lastUpdateTime: number;
  completionTime?: number;
  error?: string;
  metadata: Record<string, any>;
}

export interface ProgressPhase {
  name: string;
  description: string;
  weight: number; // Relative weight for overall progress calculation
  progress: number;
  tokensProcessed: number;
  estimatedTokens: number;
  startTime?: number;
  completionTime?: number;
  status: 'pending' | 'active' | 'completed' | 'failed';
}

export interface ProgressConfiguration {
  enableRealTimeUpdates: boolean;
  updateInterval: number; // ms
  enableTokenTracking: boolean;
  enableTimeEstimation: boolean;
  phases: Omit<ProgressPhase, 'progress' | 'tokensProcessed' | 'startTime' | 'completionTime' | 'status'>[];
}

export class ProgressTrackerService extends EventEmitter {
  private activeTasks: Map<string, TaskProgress> = new Map();
  private taskConfigurations: Map<string, ProgressConfiguration> = new Map();
  private updateTimers: Map<string, NodeJS.Timeout> = new Map();

  // Default configuration
  private defaultConfig: ProgressConfiguration = {
    enableRealTimeUpdates: true,
    updateInterval: 1000, // 1 second
    enableTokenTracking: true,
    enableTimeEstimation: true,
    phases: [
      {
        name: 'initialization',
        description: 'Initializing request and selecting optimal agent',
        weight: 0.1,
        estimatedTokens: 0
      },
      {
        name: 'processing',
        description: 'Processing request with AI agent',
        weight: 0.8,
        estimatedTokens: 1000
      },
      {
        name: 'finalization',
        description: 'Finalizing response and cleanup',
        weight: 0.1,
        estimatedTokens: 0
      }
    ]
  };

  constructor() {
    super();
    this.setupCleanup();
  }

  /**
   * Start tracking progress for a new task
   */
  startTracking(
    taskId: string,
    userId: string,
    agentId: string,
    config?: Partial<ProgressConfiguration>
  ): TaskProgress {
    const finalConfig = { ...this.defaultConfig, ...config };
    this.taskConfigurations.set(taskId, finalConfig);

    // Initialize phases
    const phases: ProgressPhase[] = finalConfig.phases.map(phase => ({
      ...phase,
      progress: 0,
      tokensProcessed: 0,
      status: 'pending' as const
    }));

    const taskProgress: TaskProgress = {
      taskId,
      userId,
      agentId,
      status: 'pending',
      phases,
      currentPhase: 0,
      overallProgress: 0,
      totalTokensProcessed: 0,
      estimatedTotalTokens: phases.reduce((sum, phase) => sum + phase.estimatedTokens, 0),
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
      metadata: {}
    };

    this.activeTasks.set(taskId, taskProgress);

    // Start the first phase
    this.startPhase(taskId, 0);

    // Set up real-time updates if enabled
    if (finalConfig.enableRealTimeUpdates) {
      this.setupRealTimeUpdates(taskId, finalConfig.updateInterval);
    }

    logger.info('Progress tracking started', {
      taskId,
      userId,
      agentId,
      phaseCount: phases.length,
      estimatedTokens: taskProgress.estimatedTotalTokens
    });

    this.emit('trackingStarted', taskProgress);
    return taskProgress;
  }

  /**
   * Update progress for a specific phase
   */
  updatePhaseProgress(
    taskId: string,
    phaseIndex: number,
    progress: number,
    tokensProcessed?: number,
    metadata?: Record<string, any>
  ): boolean {
    const task = this.activeTasks.get(taskId);
    if (!task || phaseIndex >= task.phases.length) {
      return false;
    }

    const phase = task.phases[phaseIndex];
    phase.progress = Math.min(100, Math.max(0, progress));
    
    if (tokensProcessed !== undefined) {
      phase.tokensProcessed = tokensProcessed;
    }

    // Update task metadata if provided
    if (metadata) {
      task.metadata = { ...task.metadata, ...metadata };
    }

    // Update overall progress
    this.calculateOverallProgress(taskId);

    // Mark phase as completed if at 100%
    if (phase.progress >= 100 && phase.status === 'active') {
      this.completePhase(taskId, phaseIndex);
    }

    task.lastUpdateTime = Date.now();

    const progressEvent = this.createProgressEvent(taskId);
    if (progressEvent) {
      this.emit('progressUpdate', progressEvent);
    }

    return true;
  }

  /**
   * Update current phase progress (convenience method)
   */
  updateCurrentPhase(
    taskId: string,
    progress: number,
    tokensProcessed?: number,
    metadata?: Record<string, any>
  ): boolean {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      return false;
    }

    return this.updatePhaseProgress(taskId, task.currentPhase, progress, tokensProcessed, metadata);
  }

  /**
   * Advance to next phase
   */
  nextPhase(taskId: string): boolean {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      return false;
    }

    // Complete current phase if not already completed
    if (task.phases[task.currentPhase].status === 'active') {
      this.completePhase(taskId, task.currentPhase);
    }

    // Move to next phase
    if (task.currentPhase + 1 < task.phases.length) {
      task.currentPhase++;
      this.startPhase(taskId, task.currentPhase);
      return true;
    }

    // No more phases, complete the task
    this.completeTask(taskId);
    return false;
  }

  /**
   * Complete task successfully
   */
  completeTask(taskId: string, metadata?: Record<string, any>): boolean {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      return false;
    }

    task.status = 'completed';
    task.overallProgress = 100;
    task.completionTime = Date.now();
    task.lastUpdateTime = Date.now();

    if (metadata) {
      task.metadata = { ...task.metadata, ...metadata };
    }

    // Complete all remaining phases
    for (let i = task.currentPhase; i < task.phases.length; i++) {
      if (task.phases[i].status !== 'completed') {
        task.phases[i].progress = 100;
        task.phases[i].status = 'completed';
        task.phases[i].completionTime = Date.now();
      }
    }

    this.cleanupTask(taskId);

    logger.info('Task completed successfully', {
      taskId,
      totalTime: task.completionTime - task.startTime,
      totalTokens: task.totalTokensProcessed
    });

    this.emit('taskCompleted', task);
    return true;
  }

  /**
   * Fail task with error
   */
  failTask(taskId: string, error: string, metadata?: Record<string, any>): boolean {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      return false;
    }

    task.status = 'failed';
    task.error = error;
    task.completionTime = Date.now();
    task.lastUpdateTime = Date.now();

    if (metadata) {
      task.metadata = { ...task.metadata, ...metadata };
    }

    // Mark current phase as failed
    if (task.currentPhase < task.phases.length) {
      task.phases[task.currentPhase].status = 'failed';
      task.phases[task.currentPhase].completionTime = Date.now();
    }

    this.cleanupTask(taskId);

    logger.error('Task failed', {
      taskId,
      error,
      totalTime: task.completionTime - task.startTime,
      currentPhase: task.phases[task.currentPhase]?.name
    });

    this.emit('taskFailed', { task, error });
    return true;
  }

  /**
   * Get current progress for a task
   */
  getProgress(taskId: string): TaskProgress | null {
    return this.activeTasks.get(taskId) || null;
  }

  /**
   * Get all active tasks
   */
  getActiveTasks(): TaskProgress[] {
    return Array.from(this.activeTasks.values());
  }

  /**
   * Get tasks for specific user
   */
  getUserTasks(userId: string): TaskProgress[] {
    return Array.from(this.activeTasks.values()).filter(task => task.userId === userId);
  }

  /**
   * Cancel task
   */
  cancelTask(taskId: string): boolean {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      return false;
    }

    task.status = 'failed';
    task.error = 'Task cancelled by user';
    task.completionTime = Date.now();

    this.cleanupTask(taskId);
    this.emit('taskCancelled', task);
    return true;
  }

  private startPhase(taskId: string, phaseIndex: number): void {
    const task = this.activeTasks.get(taskId);
    if (!task || phaseIndex >= task.phases.length) {
      return;
    }

    const phase = task.phases[phaseIndex];
    phase.status = 'active';
    phase.startTime = Date.now();
    task.status = 'processing';

    logger.debug('Phase started', {
      taskId,
      phaseIndex,
      phaseName: phase.name,
      phaseDescription: phase.description
    });

    this.emit('phaseStarted', { taskId, phaseIndex, phase });
  }

  private completePhase(taskId: string, phaseIndex: number): void {
    const task = this.activeTasks.get(taskId);
    if (!task || phaseIndex >= task.phases.length) {
      return;
    }

    const phase = task.phases[phaseIndex];
    phase.status = 'completed';
    phase.progress = 100;
    phase.completionTime = Date.now();

    logger.debug('Phase completed', {
      taskId,
      phaseIndex,
      phaseName: phase.name,
      duration: phase.completionTime - (phase.startTime || 0)
    });

    this.emit('phaseCompleted', { taskId, phaseIndex, phase });
  }

  private calculateOverallProgress(taskId: string): void {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      return;
    }

    let totalWeight = 0;
    let weightedProgress = 0;
    let totalTokens = 0;

    for (const phase of task.phases) {
      totalWeight += phase.weight;
      weightedProgress += (phase.progress / 100) * phase.weight;
      totalTokens += phase.tokensProcessed;
    }

    task.overallProgress = totalWeight > 0 ? (weightedProgress / totalWeight) * 100 : 0;
    task.totalTokensProcessed = totalTokens;
  }

  private createProgressEvent(taskId: string): ProgressEvent | null {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      return null;
    }

    const currentPhase = task.phases[task.currentPhase];
    const timeElapsed = Date.now() - task.startTime;
    
    // Estimate remaining time based on current progress
    let estimatedTimeRemaining = 0;
    if (task.overallProgress > 0) {
      const totalEstimatedTime = (timeElapsed / task.overallProgress) * 100;
      estimatedTimeRemaining = Math.max(0, totalEstimatedTime - timeElapsed);
    }

    return {
      taskId,
      userId: task.userId,
      agentId: task.agentId,
      phase: currentPhase?.name || 'unknown',
      progress: task.overallProgress,
      tokensProcessed: task.totalTokensProcessed,
      estimatedTokens: task.estimatedTotalTokens,
      timeElapsed,
      estimatedTimeRemaining,
      metadata: {
        currentPhase: task.currentPhase,
        phaseProgress: currentPhase?.progress || 0,
        status: task.status,
        ...task.metadata
      }
    };
  }

  private setupRealTimeUpdates(taskId: string, interval: number): void {
    const timer = setInterval(() => {
      const progressEvent = this.createProgressEvent(taskId);
      if (progressEvent) {
        this.emit('realtimeUpdate', progressEvent);
      }
    }, interval);

    this.updateTimers.set(taskId, timer);
  }

  private cleanupTask(taskId: string): void {
    // Clear update timer
    const timer = this.updateTimers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.updateTimers.delete(taskId);
    }

    // Remove configuration
    this.taskConfigurations.delete(taskId);

    // Keep task in memory for a short time for final status queries
    setTimeout(() => {
      this.activeTasks.delete(taskId);
    }, 30000); // 30 seconds
  }

  private setupCleanup(): void {
    // Clean up stale tasks every 10 minutes
    setInterval(() => {
      const now = Date.now();
      const maxAge = 60 * 60 * 1000; // 1 hour

      for (const [taskId, task] of this.activeTasks.entries()) {
        const lastActivity = task.completionTime || task.lastUpdateTime;
        if (now - lastActivity > maxAge) {
          logger.warn('Cleaning up stale task', { taskId });
          this.cleanupTask(taskId);
          this.activeTasks.delete(taskId);
        }
      }
    }, 10 * 60 * 1000);

    // Clean up on process exit
    process.on('SIGINT', () => {
      for (const timer of this.updateTimers.values()) {
        clearInterval(timer);
      }
    });
  }
}

export default new ProgressTrackerService();
