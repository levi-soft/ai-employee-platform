
import { EventEmitter } from 'events';
import { logger } from '@ai-platform/shared-utils';
import { PrismaClient } from '@prisma/client';
import { AIAgent } from '../services/agent-registry.service';
import Redis from 'ioredis';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DeploymentConfig {
  agentId: string;
  environment: 'development' | 'staging' | 'production';
  strategy: 'rolling' | 'blue_green' | 'canary' | 'immediate';
  resources: {
    cpu: string;
    memory: string;
    replicas: number;
    maxSurge?: number;
    maxUnavailable?: number;
  };
  networking: {
    port: number;
    healthCheckPath: string;
    readinessPath?: string;
  };
  scaling: {
    minReplicas: number;
    maxReplicas: number;
    targetCPUUtilization: number;
    targetMemoryUtilization?: number;
  };
  rollback: {
    enabled: boolean;
    successThreshold: number;
    failureThreshold: number;
    timeoutMinutes: number;
  };
}

export interface DeploymentStatus {
  deploymentId: string;
  agentId: string;
  agentName: string;
  version: string;
  environment: string;
  status: 'pending' | 'deploying' | 'deployed' | 'failed' | 'rolling_back' | 'rolled_back';
  strategy: string;
  startTime: Date;
  endTime?: Date;
  progress: {
    current: number;
    total: number;
    percentage: number;
    stage: string;
    message: string;
  };
  health: {
    healthy: number;
    unhealthy: number;
    pending: number;
    total: number;
  };
  metrics: {
    successRate: number;
    averageResponseTime: number;
    errorRate: number;
    requestCount: number;
  };
  logs: DeploymentLog[];
}

export interface DeploymentLog {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  metadata?: Record<string, any>;
}

export interface DeploymentHistory {
  deploymentId: string;
  agentId: string;
  version: string;
  environment: string;
  status: string;
  strategy: string;
  duration: number;
  deployedBy: string;
  startTime: Date;
  endTime?: Date;
  rollbackInfo?: {
    rolledBackFrom: string;
    reason: string;
    timestamp: Date;
  };
}

export class AgentDeploymentService extends EventEmitter {
  private prisma: PrismaClient;
  private redis: Redis;
  private activeDeployments: Map<string, DeploymentStatus> = new Map();
  private deploymentQueue: Map<string, DeploymentConfig[]> = new Map();
  private monitoringInterval?: NodeJS.Timeout;

  private readonly DEPLOYMENT_KEY_PREFIX = 'ai:deployment:';
  private readonly DEPLOYMENT_QUEUE_KEY = 'ai:deployment:queue';
  private readonly DEPLOYMENT_HISTORY_KEY = 'ai:deployment:history';

  constructor(
    redisConfig: { host: string; port: number; password?: string; db: number }
  ) {
    super();
    this.prisma = new PrismaClient();
    this.redis = new Redis(redisConfig);
  }

  /**
   * Start the deployment service
   */
  async start(): Promise<void> {
    // Start monitoring active deployments
    this.monitoringInterval = setInterval(
      () => this.monitorActiveDeployments(),
      30000 // 30 seconds
    );

    // Process any queued deployments
    await this.processDeploymentQueue();

    logger.info('Agent deployment service started');
    this.emit('serviceStarted');
  }

  /**
   * Stop the deployment service
   */
  async stop(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    await this.prisma.$disconnect();
    await this.redis.quit();

    logger.info('Agent deployment service stopped');
    this.emit('serviceStopped');
  }

  /**
   * Deploy an agent
   */
  async deployAgent(
    agent: AIAgent,
    config: DeploymentConfig,
    deployedBy: string
  ): Promise<string> {
    const deploymentId = `deploy-${agent.id}-${Date.now()}`;

    try {
      // Validate deployment configuration
      await this.validateDeploymentConfig(agent, config);

      // Create deployment status
      const deploymentStatus: DeploymentStatus = {
        deploymentId,
        agentId: agent.id,
        agentName: agent.name,
        version: agent.version,
        environment: config.environment,
        status: 'pending',
        strategy: config.strategy,
        startTime: new Date(),
        progress: {
          current: 0,
          total: 100,
          percentage: 0,
          stage: 'initializing',
          message: 'Preparing deployment'
        },
        health: {
          healthy: 0,
          unhealthy: 0,
          pending: 0,
          total: config.resources.replicas
        },
        metrics: {
          successRate: 0,
          averageResponseTime: 0,
          errorRate: 0,
          requestCount: 0
        },
        logs: []
      };

      // Store deployment status
      this.activeDeployments.set(deploymentId, deploymentStatus);
      await this.updateDeploymentInRedis(deploymentStatus);

      // Add deployment log
      await this.addDeploymentLog(deploymentId, 'info', 'Deployment initiated', {
        agent: agent.name,
        version: agent.version,
        environment: config.environment,
        deployedBy
      });

      // Start deployment process asynchronously
      this.executeDeployment(deploymentId, agent, config, deployedBy)
        .catch(error => {
          logger.error('Deployment execution failed', { deploymentId, error });
          this.updateDeploymentStatus(deploymentId, 'failed', error.message);
        });

      logger.info('Agent deployment started', {
        deploymentId,
        agentId: agent.id,
        environment: config.environment,
        strategy: config.strategy
      });

      this.emit('deploymentStarted', {
        deploymentId,
        agent,
        config,
        deployedBy
      });

      return deploymentId;

    } catch (error) {
      logger.error('Failed to start agent deployment', { error, agentId: agent.id });
      throw error;
    }
  }

  /**
   * Execute the deployment process
   */
  private async executeDeployment(
    deploymentId: string,
    agent: AIAgent,
    config: DeploymentConfig,
    deployedBy: string
  ): Promise<void> {
    const deployment = this.activeDeployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    try {
      // Update status to deploying
      await this.updateDeploymentStatus(deploymentId, 'deploying', 'Starting deployment process');

      // Execute deployment strategy
      switch (config.strategy) {
        case 'rolling':
          await this.executeRollingDeployment(deploymentId, agent, config);
          break;
        case 'blue_green':
          await this.executeBlueGreenDeployment(deploymentId, agent, config);
          break;
        case 'canary':
          await this.executeCanaryDeployment(deploymentId, agent, config);
          break;
        case 'immediate':
          await this.executeImmediateDeployment(deploymentId, agent, config);
          break;
        default:
          throw new Error(`Unknown deployment strategy: ${config.strategy}`);
      }

      // Verify deployment health
      await this.verifyDeploymentHealth(deploymentId, config);

      // Update status to deployed
      await this.updateDeploymentStatus(deploymentId, 'deployed', 'Deployment completed successfully');

      // Record deployment history
      await this.recordDeploymentHistory(deploymentId, deployedBy);

      this.emit('deploymentCompleted', {
        deploymentId,
        agent,
        duration: Date.now() - deployment.startTime.getTime()
      });

    } catch (error) {
      logger.error('Deployment execution failed', { deploymentId, error });
      
      // Handle rollback if enabled
      if (config.rollback.enabled) {
        await this.initiateRollback(deploymentId, error.message);
      } else {
        await this.updateDeploymentStatus(deploymentId, 'failed', error.message);
      }
      
      throw error;
    }
  }

  /**
   * Execute rolling deployment strategy
   */
  private async executeRollingDeployment(
    deploymentId: string,
    agent: AIAgent,
    config: DeploymentConfig
  ): Promise<void> {
    await this.addDeploymentLog(deploymentId, 'info', 'Starting rolling deployment');

    const totalReplicas = config.resources.replicas;
    const maxSurge = config.resources.maxSurge || Math.ceil(totalReplicas * 0.25);
    const maxUnavailable = config.resources.maxUnavailable || Math.floor(totalReplicas * 0.25);

    // Update progress
    await this.updateDeploymentProgress(deploymentId, 10, 'creating-resources', 'Creating deployment resources');

    // Generate deployment manifests
    const manifests = this.generateKubernetesManifests(agent, config);
    
    // Apply deployment manifests
    await this.applyKubernetesManifests(manifests, config.environment);
    
    await this.updateDeploymentProgress(deploymentId, 30, 'rolling-out', 'Rolling out new replicas');

    // Monitor rollout progress
    for (let i = 0; i < totalReplicas; i++) {
      await this.waitForReplicaReady(agent.id, config.environment, i + 1);
      
      const progress = 30 + ((i + 1) / totalReplicas) * 60;
      await this.updateDeploymentProgress(
        deploymentId, 
        progress, 
        'rolling-out', 
        `Deployed ${i + 1}/${totalReplicas} replicas`
      );
    }

    await this.updateDeploymentProgress(deploymentId, 90, 'finalizing', 'Finalizing deployment');
  }

  /**
   * Execute blue-green deployment strategy
   */
  private async executeBlueGreenDeployment(
    deploymentId: string,
    agent: AIAgent,
    config: DeploymentConfig
  ): Promise<void> {
    await this.addDeploymentLog(deploymentId, 'info', 'Starting blue-green deployment');

    // Deploy to green environment
    await this.updateDeploymentProgress(deploymentId, 20, 'deploying-green', 'Deploying to green environment');
    
    const greenManifests = this.generateKubernetesManifests(agent, {
      ...config,
      environment: `${config.environment}-green` as any
    });
    
    await this.applyKubernetesManifests(greenManifests, `${config.environment}-green`);
    
    // Wait for green environment to be ready
    await this.updateDeploymentProgress(deploymentId, 50, 'testing-green', 'Testing green environment');
    await this.waitForEnvironmentHealthy(agent.id, `${config.environment}-green`);
    
    // Switch traffic to green
    await this.updateDeploymentProgress(deploymentId, 80, 'switching-traffic', 'Switching traffic to green');
    await this.switchTrafficToGreen(agent.id, config.environment);
    
    // Cleanup blue environment
    await this.updateDeploymentProgress(deploymentId, 95, 'cleanup', 'Cleaning up blue environment');
    await this.cleanupBlueEnvironment(agent.id, config.environment);
  }

  /**
   * Execute canary deployment strategy
   */
  private async executeCanaryDeployment(
    deploymentId: string,
    agent: AIAgent,
    config: DeploymentConfig
  ): Promise<void> {
    await this.addDeploymentLog(deploymentId, 'info', 'Starting canary deployment');

    const canaryReplicas = Math.max(1, Math.ceil(config.resources.replicas * 0.1)); // 10% canary
    
    // Deploy canary version
    await this.updateDeploymentProgress(deploymentId, 20, 'deploying-canary', 'Deploying canary version');
    
    const canaryManifests = this.generateKubernetesManifests(agent, {
      ...config,
      resources: { ...config.resources, replicas: canaryReplicas }
    });
    
    await this.applyKubernetesManifests(canaryManifests, config.environment);
    
    // Monitor canary metrics
    await this.updateDeploymentProgress(deploymentId, 40, 'monitoring-canary', 'Monitoring canary metrics');
    const canaryHealthy = await this.monitorCanaryHealth(deploymentId, agent.id, config);
    
    if (!canaryHealthy) {
      throw new Error('Canary deployment failed health checks');
    }
    
    // Gradually increase canary traffic
    const trafficSteps = [25, 50, 75, 100];
    for (let i = 0; i < trafficSteps.length; i++) {
      const trafficPercent = trafficSteps[i];
      
      await this.updateDeploymentProgress(
        deploymentId, 
        40 + (i + 1) * 15, 
        'scaling-canary', 
        `Scaling canary to ${trafficPercent}% traffic`
      );
      
      await this.scaleCanaryTraffic(agent.id, config.environment, trafficPercent);
      await this.sleep(60000); // Wait 1 minute between steps
      
      const stepHealthy = await this.monitorCanaryHealth(deploymentId, agent.id, config);
      if (!stepHealthy) {
        throw new Error(`Canary failed at ${trafficPercent}% traffic`);
      }
    }
  }

  /**
   * Execute immediate deployment strategy
   */
  private async executeImmediateDeployment(
    deploymentId: string,
    agent: AIAgent,
    config: DeploymentConfig
  ): Promise<void> {
    await this.addDeploymentLog(deploymentId, 'info', 'Starting immediate deployment');

    await this.updateDeploymentProgress(deploymentId, 25, 'stopping-old', 'Stopping old version');
    
    // Stop all existing replicas
    await this.stopExistingReplicas(agent.id, config.environment);
    
    await this.updateDeploymentProgress(deploymentId, 50, 'deploying-new', 'Deploying new version');
    
    // Deploy new version
    const manifests = this.generateKubernetesManifests(agent, config);
    await this.applyKubernetesManifests(manifests, config.environment);
    
    await this.updateDeploymentProgress(deploymentId, 75, 'starting-new', 'Starting new replicas');
    
    // Wait for all replicas to be ready
    await this.waitForEnvironmentHealthy(agent.id, config.environment);
  }

  /**
   * Generate Kubernetes manifests for agent deployment
   */
  private generateKubernetesManifests(agent: AIAgent, config: DeploymentConfig): string[] {
    const appName = `agent-${agent.id}`;
    const namespace = config.environment;
    
    const deployment = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${appName}
  namespace: ${namespace}
  labels:
    app: ${appName}
    agent: ${agent.id}
    version: ${agent.version}
spec:
  replicas: ${config.resources.replicas}
  selector:
    matchLabels:
      app: ${appName}
  template:
    metadata:
      labels:
        app: ${appName}
        agent: ${agent.id}
        version: ${agent.version}
    spec:
      containers:
      - name: agent
        image: ai-platform/agent:${agent.version}
        ports:
        - containerPort: ${config.networking.port}
        env:
        - name: AGENT_ID
          value: "${agent.id}"
        - name: ENVIRONMENT
          value: "${config.environment}"
        resources:
          requests:
            cpu: ${config.resources.cpu}
            memory: ${config.resources.memory}
          limits:
            cpu: ${config.resources.cpu}
            memory: ${config.resources.memory}
        livenessProbe:
          httpGet:
            path: ${config.networking.healthCheckPath}
            port: ${config.networking.port}
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: ${config.networking.readinessPath || config.networking.healthCheckPath}
            port: ${config.networking.port}
          initialDelaySeconds: 5
          periodSeconds: 5
`;

    const service = `
apiVersion: v1
kind: Service
metadata:
  name: ${appName}
  namespace: ${namespace}
  labels:
    app: ${appName}
spec:
  selector:
    app: ${appName}
  ports:
  - port: 80
    targetPort: ${config.networking.port}
    protocol: TCP
  type: ClusterIP
`;

    const hpa = `
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${appName}
  namespace: ${namespace}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${appName}
  minReplicas: ${config.scaling.minReplicas}
  maxReplicas: ${config.scaling.maxReplicas}
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: ${config.scaling.targetCPUUtilization}
${config.scaling.targetMemoryUtilization ? `
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: ${config.scaling.targetMemoryUtilization}
` : ''}
`;

    return [deployment, service, hpa];
  }

  /**
   * Apply Kubernetes manifests
   */
  private async applyKubernetesManifests(manifests: string[], environment: string): Promise<void> {
    for (const manifest of manifests) {
      try {
        // In a real implementation, this would use kubectl or Kubernetes client
        // For now, we'll simulate the deployment
        await this.sleep(2000); // Simulate deployment time
        
        logger.debug('Applied Kubernetes manifest', { environment });
      } catch (error) {
        logger.error('Failed to apply Kubernetes manifest', { error, environment });
        throw error;
      }
    }
  }

  /**
   * Wait for replica to be ready
   */
  private async waitForReplicaReady(agentId: string, environment: string, replicaNumber: number): Promise<void> {
    // Simulate waiting for replica to be ready
    await this.sleep(3000 + Math.random() * 2000);
    
    logger.debug('Replica ready', { agentId, environment, replicaNumber });
  }

  /**
   * Wait for environment to be healthy
   */
  private async waitForEnvironmentHealthy(agentId: string, environment: string): Promise<void> {
    const maxWaitTime = 5 * 60 * 1000; // 5 minutes
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      try {
        // In a real implementation, this would check actual health endpoints
        const isHealthy = await this.checkEnvironmentHealth(agentId, environment);
        
        if (isHealthy) {
          logger.info('Environment is healthy', { agentId, environment });
          return;
        }
        
        await this.sleep(5000); // Wait 5 seconds before checking again
        
      } catch (error) {
        logger.warn('Health check failed', { error, agentId, environment });
        await this.sleep(5000);
      }
    }
    
    throw new Error(`Environment failed to become healthy within timeout: ${environment}`);
  }

  /**
   * Check environment health
   */
  private async checkEnvironmentHealth(agentId: string, environment: string): Promise<boolean> {
    // Simulate health check
    // In a real implementation, this would check actual health endpoints
    return Math.random() > 0.1; // 90% chance of being healthy
  }

  /**
   * Monitor canary health
   */
  private async monitorCanaryHealth(
    deploymentId: string, 
    agentId: string, 
    config: DeploymentConfig
  ): Promise<boolean> {
    const monitoringDuration = 5 * 60 * 1000; // 5 minutes
    const checkInterval = 30 * 1000; // 30 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < monitoringDuration) {
      // Simulate getting metrics
      const metrics = {
        successRate: 0.95 + Math.random() * 0.05,
        errorRate: Math.random() * 0.05,
        averageResponseTime: 1000 + Math.random() * 2000
      };
      
      // Update deployment metrics
      const deployment = this.activeDeployments.get(deploymentId);
      if (deployment) {
        deployment.metrics = {
          ...deployment.metrics,
          ...metrics,
          requestCount: deployment.metrics.requestCount + Math.floor(Math.random() * 100)
        };
        await this.updateDeploymentInRedis(deployment);
      }
      
      // Check if metrics are within acceptable thresholds
      if (metrics.successRate < config.rollback.successThreshold || 
          metrics.errorRate > config.rollback.failureThreshold) {
        
        await this.addDeploymentLog(deploymentId, 'error', 'Canary metrics below threshold', metrics);
        return false;
      }
      
      await this.sleep(checkInterval);
    }
    
    return true;
  }

  /**
   * Scale canary traffic
   */
  private async scaleCanaryTraffic(agentId: string, environment: string, percentage: number): Promise<void> {
    // Simulate scaling canary traffic
    await this.sleep(2000);
    logger.info('Scaled canary traffic', { agentId, environment, percentage });
  }

  /**
   * Switch traffic to green environment (blue-green)
   */
  private async switchTrafficToGreen(agentId: string, environment: string): Promise<void> {
    // Simulate switching traffic
    await this.sleep(3000);
    logger.info('Switched traffic to green', { agentId, environment });
  }

  /**
   * Cleanup blue environment
   */
  private async cleanupBlueEnvironment(agentId: string, environment: string): Promise<void> {
    // Simulate cleanup
    await this.sleep(2000);
    logger.info('Cleaned up blue environment', { agentId, environment });
  }

  /**
   * Stop existing replicas
   */
  private async stopExistingReplicas(agentId: string, environment: string): Promise<void> {
    // Simulate stopping replicas
    await this.sleep(5000);
    logger.info('Stopped existing replicas', { agentId, environment });
  }

  /**
   * Verify deployment health
   */
  private async verifyDeploymentHealth(deploymentId: string, config: DeploymentConfig): Promise<void> {
    await this.updateDeploymentProgress(deploymentId, 95, 'verifying', 'Verifying deployment health');
    
    // Simulate health verification
    await this.sleep(3000);
    
    const deployment = this.activeDeployments.get(deploymentId);
    if (deployment) {
      deployment.health = {
        healthy: config.resources.replicas,
        unhealthy: 0,
        pending: 0,
        total: config.resources.replicas
      };
      await this.updateDeploymentInRedis(deployment);
    }
  }

  /**
   * Initiate rollback
   */
  private async initiateRollback(deploymentId: string, reason: string): Promise<void> {
    await this.updateDeploymentStatus(deploymentId, 'rolling_back', `Rolling back due to: ${reason}`);
    await this.addDeploymentLog(deploymentId, 'warn', 'Initiating rollback', { reason });
    
    try {
      // Simulate rollback process
      await this.sleep(10000);
      
      await this.updateDeploymentStatus(deploymentId, 'rolled_back', 'Rollback completed');
      await this.addDeploymentLog(deploymentId, 'info', 'Rollback completed successfully');
      
      this.emit('deploymentRolledBack', { deploymentId, reason });
      
    } catch (error) {
      logger.error('Rollback failed', { deploymentId, error });
      await this.updateDeploymentStatus(deploymentId, 'failed', `Rollback failed: ${error.message}`);
    }
  }

  /**
   * Update deployment status
   */
  private async updateDeploymentStatus(
    deploymentId: string, 
    status: DeploymentStatus['status'], 
    message: string
  ): Promise<void> {
    const deployment = this.activeDeployments.get(deploymentId);
    if (deployment) {
      deployment.status = status;
      deployment.progress.message = message;
      
      if (status === 'deployed' || status === 'failed' || status === 'rolled_back') {
        deployment.endTime = new Date();
        deployment.progress.percentage = 100;
      }
      
      await this.updateDeploymentInRedis(deployment);
      
      this.emit('deploymentStatusChanged', {
        deploymentId,
        status,
        message
      });
    }
  }

  /**
   * Update deployment progress
   */
  private async updateDeploymentProgress(
    deploymentId: string,
    percentage: number,
    stage: string,
    message: string
  ): Promise<void> {
    const deployment = this.activeDeployments.get(deploymentId);
    if (deployment) {
      deployment.progress = {
        current: percentage,
        total: 100,
        percentage,
        stage,
        message
      };
      
      await this.updateDeploymentInRedis(deployment);
      
      this.emit('deploymentProgressChanged', {
        deploymentId,
        progress: deployment.progress
      });
    }
  }

  /**
   * Add deployment log
   */
  private async addDeploymentLog(
    deploymentId: string,
    level: DeploymentLog['level'],
    message: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const deployment = this.activeDeployments.get(deploymentId);
    if (deployment) {
      const log: DeploymentLog = {
        timestamp: new Date(),
        level,
        message,
        metadata
      };
      
      deployment.logs.push(log);
      
      // Keep only last 100 logs
      if (deployment.logs.length > 100) {
        deployment.logs = deployment.logs.slice(-100);
      }
      
      await this.updateDeploymentInRedis(deployment);
      
      this.emit('deploymentLogAdded', {
        deploymentId,
        log
      });
    }
  }

  /**
   * Update deployment in Redis
   */
  private async updateDeploymentInRedis(deployment: DeploymentStatus): Promise<void> {
    const key = `${this.DEPLOYMENT_KEY_PREFIX}${deployment.deploymentId}`;
    await this.redis.setex(key, 86400, JSON.stringify(deployment)); // 24 hours
  }

  /**
   * Get deployment status
   */
  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus | null> {
    let deployment = this.activeDeployments.get(deploymentId);
    
    if (!deployment) {
      // Try to load from Redis
      const key = `${this.DEPLOYMENT_KEY_PREFIX}${deploymentId}`;
      const deploymentData = await this.redis.get(key);
      
      if (deploymentData) {
        deployment = JSON.parse(deploymentData);
        if (deployment) {
          this.activeDeployments.set(deploymentId, deployment);
        }
      }
    }
    
    return deployment || null;
  }

  /**
   * Get active deployments for an agent
   */
  async getActiveDeployments(agentId?: string): Promise<DeploymentStatus[]> {
    let deployments = Array.from(this.activeDeployments.values());
    
    if (agentId) {
      deployments = deployments.filter(d => d.agentId === agentId);
    }
    
    return deployments.filter(d => 
      ['pending', 'deploying', 'rolling_back'].includes(d.status)
    );
  }

  /**
   * Cancel deployment
   */
  async cancelDeployment(deploymentId: string, reason: string): Promise<boolean> {
    const deployment = this.activeDeployments.get(deploymentId);
    
    if (!deployment || !['pending', 'deploying'].includes(deployment.status)) {
      return false;
    }
    
    await this.addDeploymentLog(deploymentId, 'warn', 'Deployment cancelled', { reason });
    await this.updateDeploymentStatus(deploymentId, 'failed', `Cancelled: ${reason}`);
    
    this.emit('deploymentCancelled', { deploymentId, reason });
    
    return true;
  }

  /**
   * Rollback to previous version
   */
  async rollbackDeployment(
    agentId: string,
    environment: string,
    targetVersion?: string
  ): Promise<string> {
    // Find target version from history if not specified
    if (!targetVersion) {
      const history = await this.getDeploymentHistory(agentId, environment, 2);
      if (history.length < 2) {
        throw new Error('No previous version found for rollback');
      }
      targetVersion = history[1].version;
    }
    
    // Get agent with target version
    const agent = await this.prisma.aIAgent.findFirst({
      where: {
        id: agentId,
        version: targetVersion
      }
    });
    
    if (!agent) {
      throw new Error(`Agent version ${targetVersion} not found`);
    }
    
    // Create rollback deployment config
    const config: DeploymentConfig = {
      agentId,
      environment: environment as any,
      strategy: 'rolling',
      resources: {
        cpu: '100m',
        memory: '256Mi',
        replicas: 3
      },
      networking: {
        port: 8080,
        healthCheckPath: '/health'
      },
      scaling: {
        minReplicas: 1,
        maxReplicas: 10,
        targetCPUUtilization: 70
      },
      rollback: {
        enabled: false, // Don't rollback a rollback
        successThreshold: 0.95,
        failureThreshold: 0.1,
        timeoutMinutes: 10
      }
    };
    
    const convertedAgent: AIAgent = {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      type: agent.type as any,
      category: agent.category,
      provider: agent.provider,
      model: agent.model,
      version: agent.version,
      capabilities: JSON.parse(agent.capabilities || '[]'),
      configuration: JSON.parse(agent.configuration || '{}'),
      deployment: JSON.parse(agent.deployment || '{}'),
      metadata: JSON.parse(agent.metadata || '{}'),
      status: agent.status as any,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt
    };
    
    return this.deployAgent(convertedAgent, config, 'system-rollback');
  }

  /**
   * Record deployment history
   */
  private async recordDeploymentHistory(deploymentId: string, deployedBy: string): Promise<void> {
    const deployment = this.activeDeployments.get(deploymentId);
    if (!deployment) {
      return;
    }
    
    const history: DeploymentHistory = {
      deploymentId,
      agentId: deployment.agentId,
      version: deployment.version,
      environment: deployment.environment,
      status: deployment.status,
      strategy: deployment.strategy,
      duration: deployment.endTime ? 
        deployment.endTime.getTime() - deployment.startTime.getTime() : 0,
      deployedBy,
      startTime: deployment.startTime,
      endTime: deployment.endTime
    };
    
    // Store in Redis
    await this.redis.lpush(
      `${this.DEPLOYMENT_HISTORY_KEY}:${deployment.agentId}:${deployment.environment}`,
      JSON.stringify(history)
    );
    
    // Keep only last 50 deployments
    await this.redis.ltrim(
      `${this.DEPLOYMENT_HISTORY_KEY}:${deployment.agentId}:${deployment.environment}`,
      0, 49
    );
  }

  /**
   * Get deployment history
   */
  async getDeploymentHistory(
    agentId: string,
    environment: string,
    limit = 10
  ): Promise<DeploymentHistory[]> {
    const historyData = await this.redis.lrange(
      `${this.DEPLOYMENT_HISTORY_KEY}:${agentId}:${environment}`,
      0, limit - 1
    );
    
    return historyData.map(data => JSON.parse(data));
  }

  /**
   * Validate deployment configuration
   */
  private async validateDeploymentConfig(agent: AIAgent, config: DeploymentConfig): Promise<void> {
    // Basic validation
    if (config.resources.replicas <= 0) {
      throw new Error('Replicas must be greater than 0');
    }
    
    if (config.scaling.minReplicas > config.scaling.maxReplicas) {
      throw new Error('Min replicas cannot be greater than max replicas');
    }
    
    if (!['development', 'staging', 'production'].includes(config.environment)) {
      throw new Error('Invalid environment');
    }
    
    if (!['rolling', 'blue_green', 'canary', 'immediate'].includes(config.strategy)) {
      throw new Error('Invalid deployment strategy');
    }
    
    // Check if agent exists and is deployable
    if (agent.status !== 'active') {
      throw new Error('Cannot deploy inactive agent');
    }
  }

  /**
   * Process deployment queue
   */
  private async processDeploymentQueue(): Promise<void> {
    // Implementation for processing queued deployments
    // This would be used for scheduling deployments
  }

  /**
   * Monitor active deployments
   */
  private async monitorActiveDeployments(): Promise<void> {
    const activeDeployments = Array.from(this.activeDeployments.values())
      .filter(d => ['deploying', 'rolling_back'].includes(d.status));
    
    for (const deployment of activeDeployments) {
      try {
        // Update deployment health and metrics
        await this.updateDeploymentHealth(deployment);
      } catch (error) {
        logger.error('Failed to monitor deployment', {
          deploymentId: deployment.deploymentId,
          error
        });
      }
    }
  }

  /**
   * Update deployment health during monitoring
   */
  private async updateDeploymentHealth(deployment: DeploymentStatus): Promise<void> {
    // Simulate health updates
    const isHealthy = Math.random() > 0.1; // 90% chance of being healthy
    
    if (isHealthy) {
      deployment.health.healthy = deployment.health.total;
      deployment.health.unhealthy = 0;
    } else {
      deployment.health.unhealthy = Math.floor(Math.random() * deployment.health.total);
      deployment.health.healthy = deployment.health.total - deployment.health.unhealthy;
    }
    
    await this.updateDeploymentInRedis(deployment);
  }

  /**
   * Utility function to sleep
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

