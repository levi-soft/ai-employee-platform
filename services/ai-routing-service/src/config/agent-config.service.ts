
import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import { logger } from '@ai-platform/shared-utils';
import Redis from 'ioredis';
import { AIAgent } from '../services/agent-registry.service';

export interface AgentConfigTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  agentType: string;
  providerType: string;
  template: ConfigurationTemplate;
  constraints: ConfigurationConstraints;
  metadata: {
    version: string;
    author: string;
    lastUpdated: Date;
    usage: number;
    rating: number;
  };
}

export interface ConfigurationTemplate {
  parameters: ConfigParameter[];
  sections: ConfigSection[];
  presets: ConfigPreset[];
  validation: ValidationRule[];
}

export interface ConfigParameter {
  key: string;
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'select';
  defaultValue: any;
  required: boolean;
  category: string;
  options?: any[];
  constraints?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: any[];
  };
  dependencies?: {
    parameter: string;
    condition: any;
  }[];
}

export interface ConfigSection {
  id: string;
  name: string;
  description: string;
  parameters: string[];
  collapsible: boolean;
  expanded: boolean;
  order: number;
}

export interface ConfigPreset {
  id: string;
  name: string;
  description: string;
  configuration: Record<string, any>;
  useCase: string;
  tags: string[];
}

export interface ValidationRule {
  parameter: string;
  rule: string;
  errorMessage: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ConfigurationConstraints {
  maxInstances: number;
  allowedEnvironments: string[];
  requiredPermissions: string[];
  resourceLimits: {
    cpu?: { min: string; max: string };
    memory?: { min: string; max: string };
    storage?: { min: string; max: string };
  };
  networkPolicies: {
    inbound?: string[];
    outbound?: string[];
  };
}

export interface AgentConfiguration {
  agentId: string;
  configurationId: string;
  templateId?: string;
  name: string;
  description: string;
  environment: string;
  parameters: Record<string, any>;
  status: 'draft' | 'active' | 'inactive' | 'deprecated';
  version: string;
  metadata: {
    createdBy: string;
    createdAt: Date;
    updatedBy: string;
    updatedAt: Date;
    tags: string[];
    notes: string;
  };
  validation: {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
  };
}

export interface ValidationError {
  parameter: string;
  rule: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  suggestions?: string[];
}

export interface ConfigurationHistory {
  configurationId: string;
  version: string;
  changeType: 'created' | 'updated' | 'activated' | 'deactivated' | 'deleted';
  changes: ConfigurationChange[];
  changedBy: string;
  timestamp: Date;
  rollbackInfo?: {
    canRollback: boolean;
    reason?: string;
  };
}

export interface ConfigurationChange {
  parameter: string;
  oldValue: any;
  newValue: any;
  changeType: 'added' | 'modified' | 'removed';
}

export class AgentConfigService extends EventEmitter {
  private prisma: PrismaClient;
  private redis: Redis;
  private templates: Map<string, AgentConfigTemplate> = new Map();
  private configurations: Map<string, AgentConfiguration> = new Map();
  private configCache: Map<string, any> = new Map();

  private readonly TEMPLATE_KEY_PREFIX = 'ai:config:template:';
  private readonly CONFIG_KEY_PREFIX = 'ai:config:';
  private readonly HISTORY_KEY_PREFIX = 'ai:config:history:';
  private readonly CACHE_KEY_PREFIX = 'ai:config:cache:';

  constructor(
    redisConfig: { host: string; port: number; password?: string; db: number }
  ) {
    super();
    this.prisma = new PrismaClient();
    this.redis = new Redis(redisConfig);
  }

  /**
   * Initialize the configuration service
   */
  async initialize(): Promise<void> {
    try {
      // Load existing templates and configurations
      await this.loadTemplatesFromDatabase();
      await this.loadConfigurationsFromDatabase();
      
      // Initialize default templates
      await this.initializeDefaultTemplates();
      
      logger.info('Agent configuration service initialized', {
        templates: this.templates.size,
        configurations: this.configurations.size
      });
      
      this.emit('serviceInitialized');
      
    } catch (error) {
      logger.error('Failed to initialize agent configuration service', { error });
      throw error;
    }
  }

  /**
   * Create a new configuration template
   */
  async createTemplate(
    templateData: Omit<AgentConfigTemplate, 'id' | 'metadata'>
  ): Promise<AgentConfigTemplate> {
    const templateId = `template-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    const template: AgentConfigTemplate = {
      id: templateId,
      ...templateData,
      metadata: {
        version: '1.0.0',
        author: 'system',
        lastUpdated: new Date(),
        usage: 0,
        rating: 0
      }
    };

    try {
      // Validate template
      await this.validateTemplate(template);
      
      // Store in database
      await this.prisma.configTemplate.create({
        data: {
          id: template.id,
          name: template.name,
          description: template.description,
          category: template.category,
          agentType: template.agentType,
          providerType: template.providerType,
          template: JSON.stringify(template.template),
          constraints: JSON.stringify(template.constraints),
          metadata: JSON.stringify(template.metadata)
        }
      });
      
      // Store in cache
      this.templates.set(templateId, template);
      
      // Store in Redis
      await this.redis.setex(
        `${this.TEMPLATE_KEY_PREFIX}${templateId}`,
        3600,
        JSON.stringify(template)
      );
      
      logger.info('Configuration template created', {
        templateId,
        name: template.name,
        category: template.category
      });
      
      this.emit('templateCreated', { template });
      
      return template;
      
    } catch (error) {
      logger.error('Failed to create configuration template', { error, templateData });
      throw error;
    }
  }

  /**
   * Get configuration template by ID
   */
  async getTemplate(templateId: string): Promise<AgentConfigTemplate | null> {
    let template = this.templates.get(templateId);
    
    if (!template) {
      // Try to load from Redis
      const templateData = await this.redis.get(`${this.TEMPLATE_KEY_PREFIX}${templateId}`);
      if (templateData) {
        template = JSON.parse(templateData);
        if (template) {
          this.templates.set(templateId, template);
        }
      }
    }
    
    if (!template) {
      // Try to load from database
      const dbTemplate = await this.prisma.configTemplate.findUnique({
        where: { id: templateId }
      });
      
      if (dbTemplate) {
        template = this.convertDbTemplateToTemplate(dbTemplate);
        this.templates.set(templateId, template);
      }
    }
    
    return template || null;
  }

  /**
   * Create agent configuration from template
   */
  async createConfigurationFromTemplate(
    agentId: string,
    templateId: string,
    overrides: {
      name: string;
      description: string;
      environment: string;
      parameters?: Record<string, any>;
      createdBy: string;
    }
  ): Promise<AgentConfiguration> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    const configurationId = `config-${agentId}-${Date.now()}`;
    
    // Merge template parameters with overrides
    const parameters: Record<string, any> = {};
    
    // Set default values from template
    for (const param of template.template.parameters) {
      parameters[param.key] = param.defaultValue;
    }
    
    // Apply overrides
    if (overrides.parameters) {
      Object.assign(parameters, overrides.parameters);
    }

    const configuration: AgentConfiguration = {
      agentId,
      configurationId,
      templateId,
      name: overrides.name,
      description: overrides.description,
      environment: overrides.environment,
      parameters,
      status: 'draft',
      version: '1.0.0',
      metadata: {
        createdBy: overrides.createdBy,
        createdAt: new Date(),
        updatedBy: overrides.createdBy,
        updatedAt: new Date(),
        tags: [],
        notes: ''
      },
      validation: {
        isValid: false,
        errors: [],
        warnings: []
      }
    };

    // Validate configuration
    await this.validateConfiguration(configuration, template);
    
    // Store configuration
    await this.saveConfiguration(configuration);
    
    // Increment template usage
    template.metadata.usage++;
    await this.updateTemplate(templateId, { metadata: template.metadata });
    
    logger.info('Configuration created from template', {
      configurationId,
      agentId,
      templateId,
      environment: overrides.environment
    });
    
    this.emit('configurationCreated', { configuration });
    
    return configuration;
  }

  /**
   * Create custom agent configuration
   */
  async createCustomConfiguration(
    agentId: string,
    configData: {
      name: string;
      description: string;
      environment: string;
      parameters: Record<string, any>;
      createdBy: string;
    }
  ): Promise<AgentConfiguration> {
    const configurationId = `config-${agentId}-${Date.now()}`;
    
    const configuration: AgentConfiguration = {
      agentId,
      configurationId,
      name: configData.name,
      description: configData.description,
      environment: configData.environment,
      parameters: configData.parameters,
      status: 'draft',
      version: '1.0.0',
      metadata: {
        createdBy: configData.createdBy,
        createdAt: new Date(),
        updatedBy: configData.createdBy,
        updatedAt: new Date(),
        tags: [],
        notes: ''
      },
      validation: {
        isValid: false,
        errors: [],
        warnings: []
      }
    };

    // Basic validation for custom configuration
    await this.validateCustomConfiguration(configuration);
    
    // Store configuration
    await this.saveConfiguration(configuration);
    
    logger.info('Custom configuration created', {
      configurationId,
      agentId,
      environment: configData.environment
    });
    
    this.emit('configurationCreated', { configuration });
    
    return configuration;
  }

  /**
   * Update agent configuration
   */
  async updateConfiguration(
    configurationId: string,
    updates: {
      name?: string;
      description?: string;
      parameters?: Record<string, any>;
      tags?: string[];
      notes?: string;
      updatedBy: string;
    }
  ): Promise<AgentConfiguration> {
    const configuration = await this.getConfiguration(configurationId);
    if (!configuration) {
      throw new Error(`Configuration ${configurationId} not found`);
    }

    // Create configuration history record before updating
    await this.recordConfigurationChange(configuration, updates);

    // Update configuration
    const updatedConfiguration: AgentConfiguration = {
      ...configuration,
      name: updates.name || configuration.name,
      description: updates.description || configuration.description,
      parameters: { ...configuration.parameters, ...(updates.parameters || {}) },
      metadata: {
        ...configuration.metadata,
        updatedBy: updates.updatedBy,
        updatedAt: new Date(),
        tags: updates.tags || configuration.metadata.tags,
        notes: updates.notes || configuration.metadata.notes
      },
      version: this.incrementVersion(configuration.version)
    };

    // Re-validate configuration
    const template = configuration.templateId ? 
      await this.getTemplate(configuration.templateId) : null;
    
    if (template) {
      await this.validateConfiguration(updatedConfiguration, template);
    } else {
      await this.validateCustomConfiguration(updatedConfiguration);
    }
    
    // Save updated configuration
    await this.saveConfiguration(updatedConfiguration);
    
    logger.info('Configuration updated', {
      configurationId,
      version: updatedConfiguration.version,
      updatedBy: updates.updatedBy
    });
    
    this.emit('configurationUpdated', { 
      configuration: updatedConfiguration,
      previousConfiguration: configuration 
    });
    
    return updatedConfiguration;
  }

  /**
   * Activate configuration
   */
  async activateConfiguration(configurationId: string, activatedBy: string): Promise<void> {
    const configuration = await this.getConfiguration(configurationId);
    if (!configuration) {
      throw new Error(`Configuration ${configurationId} not found`);
    }

    if (!configuration.validation.isValid) {
      throw new Error('Cannot activate configuration with validation errors');
    }

    // Deactivate other configurations for the same agent/environment
    await this.deactivateOtherConfigurations(
      configuration.agentId, 
      configuration.environment,
      configurationId
    );

    // Update configuration status
    configuration.status = 'active';
    configuration.metadata.updatedBy = activatedBy;
    configuration.metadata.updatedAt = new Date();
    
    await this.saveConfiguration(configuration);
    
    // Record history
    await this.recordConfigurationChange(configuration, { status: 'active' }, 'activated');
    
    logger.info('Configuration activated', {
      configurationId,
      agentId: configuration.agentId,
      environment: configuration.environment
    });
    
    this.emit('configurationActivated', { configuration });
  }

  /**
   * Get active configuration for agent/environment
   */
  async getActiveConfiguration(agentId: string, environment: string): Promise<AgentConfiguration | null> {
    // Check cache first
    const cacheKey = `${this.CACHE_KEY_PREFIX}active:${agentId}:${environment}`;
    const cachedConfig = await this.redis.get(cacheKey);
    
    if (cachedConfig) {
      return JSON.parse(cachedConfig);
    }

    // Find active configuration
    const configurations = Array.from(this.configurations.values())
      .filter(config => 
        config.agentId === agentId && 
        config.environment === environment && 
        config.status === 'active'
      );

    const activeConfig = configurations[0] || null;
    
    if (activeConfig) {
      // Cache for 5 minutes
      await this.redis.setex(cacheKey, 300, JSON.stringify(activeConfig));
    }
    
    return activeConfig;
  }

  /**
   * Get configuration by ID
   */
  async getConfiguration(configurationId: string): Promise<AgentConfiguration | null> {
    let configuration = this.configurations.get(configurationId);
    
    if (!configuration) {
      // Try to load from Redis
      const configData = await this.redis.get(`${this.CONFIG_KEY_PREFIX}${configurationId}`);
      if (configData) {
        configuration = JSON.parse(configData);
        if (configuration) {
          this.configurations.set(configurationId, configuration);
        }
      }
    }
    
    if (!configuration) {
      // Try to load from database
      const dbConfig = await this.prisma.agentConfiguration.findUnique({
        where: { id: configurationId }
      });
      
      if (dbConfig) {
        configuration = this.convertDbConfigurationToConfiguration(dbConfig);
        this.configurations.set(configurationId, configuration);
      }
    }
    
    return configuration || null;
  }

  /**
   * Get configurations for agent
   */
  async getAgentConfigurations(agentId: string): Promise<AgentConfiguration[]> {
    return Array.from(this.configurations.values())
      .filter(config => config.agentId === agentId);
  }

  /**
   * Clone configuration
   */
  async cloneConfiguration(
    sourceConfigurationId: string,
    newName: string,
    clonedBy: string
  ): Promise<AgentConfiguration> {
    const sourceConfig = await this.getConfiguration(sourceConfigurationId);
    if (!sourceConfig) {
      throw new Error(`Source configuration ${sourceConfigurationId} not found`);
    }

    const configurationId = `config-${sourceConfig.agentId}-${Date.now()}`;
    
    const clonedConfiguration: AgentConfiguration = {
      ...sourceConfig,
      configurationId,
      name: newName,
      status: 'draft',
      version: '1.0.0',
      metadata: {
        ...sourceConfig.metadata,
        createdBy: clonedBy,
        createdAt: new Date(),
        updatedBy: clonedBy,
        updatedAt: new Date(),
        notes: `Cloned from ${sourceConfig.name}`
      }
    };
    
    await this.saveConfiguration(clonedConfiguration);
    
    logger.info('Configuration cloned', {
      sourceId: sourceConfigurationId,
      clonedId: configurationId,
      clonedBy
    });
    
    this.emit('configurationCloned', { 
      sourceConfiguration: sourceConfig,
      clonedConfiguration 
    });
    
    return clonedConfiguration;
  }

  /**
   * Validate configuration against template
   */
  private async validateConfiguration(
    configuration: AgentConfiguration,
    template: AgentConfigTemplate
  ): Promise<void> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Validate required parameters
    for (const param of template.template.parameters) {
      const value = configuration.parameters[param.key];
      
      if (param.required && (value === undefined || value === null || value === '')) {
        errors.push({
          parameter: param.key,
          rule: 'required',
          message: `${param.name} is required`,
          severity: 'error'
        });
        continue;
      }
      
      if (value !== undefined && value !== null) {
        // Type validation
        const typeValid = this.validateParameterType(value, param.type);
        if (!typeValid) {
          errors.push({
            parameter: param.key,
            rule: 'type',
            message: `${param.name} must be of type ${param.type}`,
            severity: 'error'
          });
        }
        
        // Constraint validation
        if (param.constraints) {
          const constraintErrors = this.validateParameterConstraints(value, param);
          errors.push(...constraintErrors);
        }
      }
    }

    // Apply template validation rules
    for (const rule of template.template.validation) {
      const ruleError = this.applyValidationRule(configuration, rule);
      if (ruleError) {
        if (ruleError.severity === 'error') {
          errors.push(ruleError);
        } else {
          warnings.push(ruleError);
        }
      }
    }

    configuration.validation = {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate custom configuration
   */
  private async validateCustomConfiguration(configuration: AgentConfiguration): Promise<void> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Basic validation for custom configurations
    const requiredFields = ['maxTokens', 'temperature', 'timeout'];
    
    for (const field of requiredFields) {
      if (configuration.parameters[field] === undefined) {
        errors.push({
          parameter: field,
          rule: 'required',
          message: `${field} is required for custom configuration`,
          severity: 'error'
        });
      }
    }

    // Validate common parameters
    if (configuration.parameters.maxTokens && 
        (configuration.parameters.maxTokens <= 0 || configuration.parameters.maxTokens > 200000)) {
      errors.push({
        parameter: 'maxTokens',
        rule: 'range',
        message: 'maxTokens must be between 1 and 200000',
        severity: 'error'
      });
    }

    if (configuration.parameters.temperature && 
        (configuration.parameters.temperature < 0 || configuration.parameters.temperature > 2)) {
      errors.push({
        parameter: 'temperature',
        rule: 'range',
        message: 'temperature must be between 0 and 2',
        severity: 'error'
      });
    }

    configuration.validation = {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate parameter type
   */
  private validateParameterType(value: any, expectedType: string): boolean {
    switch (expectedType) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'select':
        return true; // Select validation is handled by constraints
      default:
        return true;
    }
  }

  /**
   * Validate parameter constraints
   */
  private validateParameterConstraints(value: any, param: ConfigParameter): ValidationError[] {
    const errors: ValidationError[] = [];
    const constraints = param.constraints;
    
    if (!constraints) {
      return errors;
    }

    // Min/Max validation for numbers
    if (typeof value === 'number') {
      if (constraints.min !== undefined && value < constraints.min) {
        errors.push({
          parameter: param.key,
          rule: 'min',
          message: `${param.name} must be at least ${constraints.min}`,
          severity: 'error'
        });
      }
      
      if (constraints.max !== undefined && value > constraints.max) {
        errors.push({
          parameter: param.key,
          rule: 'max',
          message: `${param.name} must be at most ${constraints.max}`,
          severity: 'error'
        });
      }
    }

    // Pattern validation for strings
    if (typeof value === 'string' && constraints.pattern) {
      const regex = new RegExp(constraints.pattern);
      if (!regex.test(value)) {
        errors.push({
          parameter: param.key,
          rule: 'pattern',
          message: `${param.name} does not match required format`,
          severity: 'error'
        });
      }
    }

    // Enum validation
    if (constraints.enum && !constraints.enum.includes(value)) {
      errors.push({
        parameter: param.key,
        rule: 'enum',
        message: `${param.name} must be one of: ${constraints.enum.join(', ')}`,
        severity: 'error'
      });
    }

    return errors;
  }

  /**
   * Apply validation rul
