
// API-related types and interfaces
import { BaseEntity, PaginationParams, SearchParams } from '../common';

// AI Agent Types
export interface AIAgent extends BaseEntity {
  name: string;
  provider: AIProvider;
  model: string;
  capabilities: AICapability[];
  costPerToken: number;
  maxTokens: number;
  status: AIAgentStatus;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
  responseTimeMs: number;
  configuration: Record<string, any>;
}

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'cohere' | 'ollama' | 'custom';

export type AICapability = 
  | 'text-generation' 
  | 'code-generation' 
  | 'data-analysis' 
  | 'image-generation' 
  | 'translation' 
  | 'summarization' 
  | 'conversation' 
  | 'document-analysis';

export type AIAgentStatus = 'active' | 'inactive' | 'maintenance';

// AI Request Types
export interface AIRequest extends BaseEntity {
  userId: string;
  agentId: string;
  prompt: string;
  response?: string;
  tokensUsed: number;
  cost: number;
  responseTimeMs: number;
  status: AIRequestStatus;
  metadata?: Record<string, any>;
}

export type AIRequestStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface AIRequestCreate {
  prompt: string;
  agentId?: string;
  maxTokens?: number;
  temperature?: number;
  capabilities?: AICapability[];
  metadata?: Record<string, any>;
}

export interface AIRequestResponse {
  id: string;
  response: string;
  tokensUsed: number;
  cost: number;
  responseTimeMs: number;
  agentUsed: string;
}

// Credit and Billing Types
export interface CreditAccount extends BaseEntity {
  userId: string;
  balance: number;
  totalSpent: number;
  currency: string;
}

export interface Transaction extends BaseEntity {
  userId: string;
  accountId: string;
  amount: number;
  type: TransactionType;
  status: TransactionStatus;
  description: string;
  aiRequestId?: string;
  metadata?: Record<string, any>;
}

export type TransactionType = 'credit' | 'debit' | 'refund' | 'bonus';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface BudgetLimit extends BaseEntity {
  userId: string;
  limitAmount: number;
  currentSpent: number;
  period: BudgetPeriod;
  alertThreshold: number;
  isActive: boolean;
}

export type BudgetPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

// Plugin Types
export interface Plugin extends BaseEntity {
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  isOfficial: boolean;
  isActive: boolean;
  downloadCount: number;
  rating: number;
  configuration?: Record<string, any>;
}

export interface UserPlugin extends BaseEntity {
  userId: string;
  pluginId: string;
  isEnabled: boolean;
  configuration?: Record<string, any>;
  installedAt: Date;
}

// API Endpoint Types
export interface UserListParams extends PaginationParams, SearchParams {
  role?: string;
  status?: string;
}

export interface AIAgentListParams extends PaginationParams, SearchParams {
  provider?: AIProvider;
  capability?: AICapability;
  status?: AIAgentStatus;
}

export interface AIRequestListParams extends PaginationParams, SearchParams {
  userId?: string;
  agentId?: string;
  status?: AIRequestStatus;
  dateFrom?: string;
  dateTo?: string;
}

export interface TransactionListParams extends PaginationParams, SearchParams {
  userId?: string;
  type?: TransactionType;
  status?: TransactionStatus;
}

export interface PluginListParams extends PaginationParams, SearchParams {
  category?: string;
  isOfficial?: boolean;
  tags?: string[];
}

// Analytics Types
export interface UsageAnalytics {
  totalRequests: number;
  totalCost: number;
  averageResponseTime: number;
  topAgents: AgentUsageStats[];
  dailyUsage: DailyUsageStats[];
  costByProvider: ProviderCostStats[];
}

export interface AgentUsageStats {
  agentId: string;
  agentName: string;
  requestCount: number;
  totalCost: number;
  averageResponseTime: number;
}

export interface DailyUsageStats {
  date: string;
  requestCount: number;
  cost: number;
  uniqueUsers: number;
}

export interface ProviderCostStats {
  provider: AIProvider;
  totalCost: number;
  requestCount: number;
  percentage: number;
}

// WebSocket Types
export interface WebSocketMessage<T = any> {
  type: string;
  payload: T;
  timestamp: Date;
  id?: string;
}

export interface NotificationMessage {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  read: boolean;
  createdAt: Date;
  metadata?: Record<string, any>;
}

export interface RealtimeUpdate {
  resource: string;
  action: 'create' | 'update' | 'delete';
  data: any;
  userId?: string;
}
