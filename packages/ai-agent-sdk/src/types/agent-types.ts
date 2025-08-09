
/**
 * Core types and interfaces for the AI Agent SDK
 */

// Agent Status Enum
export enum AgentStatus {
  IDLE = 'idle',
  INITIALIZING = 'initializing',
  PROCESSING = 'processing',
  ERROR = 'error',
  SHUTTING_DOWN = 'shutting_down',
  SHUTDOWN = 'shutdown'
}

// Agent Capability Types
export enum CapabilityType {
  TEXT_GENERATION = 'text_generation',
  TEXT_ANALYSIS = 'text_analysis',
  CODE_GENERATION = 'code_generation',
  QUESTION_ANSWERING = 'question_answering',
  SUMMARIZATION = 'summarization',
  TRANSLATION = 'translation',
  CLASSIFICATION = 'classification',
  EXTRACTION = 'extraction',
  CONVERSATION = 'conversation',
  REASONING = 'reasoning',
  CREATIVE_WRITING = 'creative_writing',
  DATA_ANALYSIS = 'data_analysis',
  IMAGE_ANALYSIS = 'image_analysis',
  MULTIMODAL = 'multimodal',
  FUNCTION_CALLING = 'function_calling'
}

export enum CapabilityLevel {
  BASIC = 1,
  INTERMEDIATE = 2,
  ADVANCED = 3,
  EXPERT = 4
}

// Core Interfaces
export interface AgentCapability {
  type: CapabilityType;
  level: CapabilityLevel;
  description?: string;
  parameters?: Record<string, any>;
}

export interface IAgentConfig {
  name: string;
  version: string;
  description?: string;
  author?: string;
  tags?: string[];
  maxConcurrentRequests?: number;
  timeout?: number;
  retryAttempts?: number;
  sandboxed?: boolean;
  securityLevel?: 'low' | 'medium' | 'high';
  parameters?: Record<string, any>;
  environment?: Record<string, string>;
}

export interface IAgentRequest {
  id?: string;
  type: string;
  content: string;
  parameters?: Record<string, any>;
  context?: Record<string, any>;
  requiredCapabilities?: AgentCapability[];
  priority?: number;
  timeout?: number;
  metadata?: Record<string, any>;
  streaming?: boolean;
}

export interface IAgentResponse {
  content: string;
  success: boolean;
  error?: string;
  metadata?: {
    requestId?: string;
    responseTime?: number;
    agentName?: string;
    agentVersion?: string;
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    model?: string;
    confidence?: number;
    [key: string]: any;
  };
}

export interface IAgentContext {
  userId?: string;
  sessionId?: string;
  conversationId?: string;
  userTier?: string;
  requestCount?: number;
  previousRequests?: IAgentRequest[];
  budget?: number;
  preferences?: Record<string, any>;
}

export interface AgentMetrics {
  requestsProcessed: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  totalResponseTime: number;
  startTime: number;
  lastActivity: number;
  uptime?: number;
  successRate?: number;
}

export interface IValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface IAgentBase {
  execute(request: IAgentRequest, context?: IAgentContext): Promise<IAgentResponse>;
  process(request: IAgentRequest): Promise<IAgentResponse>;
  getCapabilities(): AgentCapability[];
  validate(request: IAgentRequest): Promise<IValidationResult>;
  canHandle(request: IAgentRequest): boolean;
  getStatus(): AgentStatus;
  getConfig(): IAgentConfig;
  getMetrics(): AgentMetrics;
  updateConfig(config: Partial<IAgentConfig>): void;
  shutdown(): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; details: any }>;
}

// Testing Types
export interface ITestCase {
  id: string;
  name: string;
  description?: string;
  input: IAgentRequest;
  expectedOutput?: Partial<IAgentResponse>;
  expectedCapabilities?: CapabilityType[];
  timeout?: number;
  shouldFail?: boolean;
  tags?: string[];
}

export interface ITestSuite {
  name: string;
  description?: string;
  agentName: string;
  agentConfig: IAgentConfig;
  testCases: ITestCase[];
  setup?: () => Promise<void>;
  teardown?: () => Promise<void>;
}

export interface ITestResult {
  testCaseId: string;
  passed: boolean;
  error?: string;
  actualOutput?: IAgentResponse;
  executionTime: number;
  details?: Record<string, any>;
}

export interface ITestSuiteResult {
  suiteName: string;
  agentName: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  executionTime: number;
  results: ITestResult[];
  coverage?: {
    capabilities: number;
    scenarios: number;
  };
}

// Marketplace Types
export interface IAgentPackage {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  authorEmail?: string;
  tags: string[];
  capabilities: AgentCapability[];
  pricing?: {
    type: 'free' | 'paid' | 'subscription';
    cost?: number;
    currency?: string;
  };
  dependencies?: string[];
  minimumVersion?: string;
  repository?: string;
  documentation?: string;
  license?: string;
  downloadCount?: number;
  rating?: number;
  reviews?: IAgentReview[];
  createdAt: Date;
  updatedAt: Date;
  verified?: boolean;
  security?: {
    level: 'low' | 'medium' | 'high';
    sandboxed: boolean;
    permissions: string[];
  };
}

export interface IAgentReview {
  id: string;
  userId: string;
  username: string;
  rating: number;
  comment?: string;
  createdAt: Date;
  verified?: boolean;
}

export interface IMarketplaceQuery {
  query?: string;
  capabilities?: CapabilityType[];
  tags?: string[];
  author?: string;
  pricing?: 'free' | 'paid' | 'subscription';
  minRating?: number;
  verified?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'relevance' | 'popularity' | 'rating' | 'created' | 'updated';
  sortOrder?: 'asc' | 'desc';
}

// Sandbox Types
export interface ISandboxConfig {
  timeoutMs: number;
  memoryLimitMB: number;
  maxCpuUsage: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  allowNetworking: boolean;
  allowFileSystem: boolean;
  allowedFiles?: string[];
  environment?: Record<string, string>;
  securityLevel: 'low' | 'medium' | 'high';
}

export interface ISandboxResult {
  success: boolean;
  output?: any;
  error?: string;
  executionTime: number;
  memoryUsed: number;
  cpuUsage: number;
  violations?: string[];
}

export interface ISandboxEnvironment {
  id: string;
  agentId: string;
  config: ISandboxConfig;
  status: 'idle' | 'running' | 'suspended' | 'terminated';
  createdAt: Date;
  lastUsed: Date;
}

// Event Types
export interface AgentEvent {
  type: 'initialize' | 'ready' | 'requestStart' | 'requestComplete' | 'requestError' | 'configUpdate' | 'shutdown';
  agentName: string;
  timestamp: Date;
  data?: any;
}

// Utility Types
export type AgentConstructor = new (config: IAgentConfig) => IAgentBase;

export interface IAgentRegistry {
  register(name: string, agentClass: AgentConstructor): void;
  unregister(name: string): void;
  get(name: string): AgentConstructor | undefined;
  list(): string[];
  create(name: string, config: IAgentConfig): IAgentBase | null;
}

// Streaming Types
export interface IStreamChunk {
  type: 'text' | 'data' | 'error' | 'end';
  content?: string;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

export interface IStreamHandler {
  onChunk(chunk: IStreamChunk): void;
  onEnd(): void;
  onError(error: Error): void;
}

// Performance Types
export interface IPerformanceMetrics {
  throughput: number; // requests per second
  latency: {
    p50: number;
    p95: number;
    p99: number;
  };
  errorRate: number;
  concurrency: number;
  resourceUsage: {
    cpu: number;
    memory: number;
  };
}

export interface IBenchmarkResult {
  agentName: string;
  agentVersion: string;
  testSuite: string;
  performance: IPerformanceMetrics;
  timestamp: Date;
  environment: {
    os: string;
    nodeVersion: string;
    cpuCount: number;
    totalMemory: number;
  };
}

// Plugin Types for extensibility
export interface IAgentPlugin {
  name: string;
  version: string;
  description?: string;
  hooks: {
    beforeProcess?: (request: IAgentRequest) => Promise<IAgentRequest>;
    afterProcess?: (response: IAgentResponse) => Promise<IAgentResponse>;
    onError?: (error: Error, request: IAgentRequest) => Promise<void>;
  };
}

// Configuration validation
export interface IConfigSchema {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    required?: boolean;
    default?: any;
    validation?: (value: any) => boolean | string;
    description?: string;
  };
}
