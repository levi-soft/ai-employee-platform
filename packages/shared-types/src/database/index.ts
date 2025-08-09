
// Database-related types (Prisma model types)
export interface DatabaseUser {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'EMPLOYEE' | 'VIEWER';
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'SUSPENDED';
  lastLoginAt?: Date;
  emailVerifiedAt?: Date;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseCreditAccount {
  id: string;
  userId: string;
  balance: number;
  totalSpent: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseAIAgent {
  id: string;
  name: string;
  provider: string;
  model: string;
  capabilities: string[];
  costPerToken: number;
  maxTokens: number;
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';
  configuration: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseTransaction {
  id: string;
  userId: string;
  accountId: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT' | 'REFUND' | 'BONUS';
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  description: string;
  aiRequestId?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseAIRequest {
  id: string;
  userId: string;
  agentId: string;
  prompt: string;
  response?: string;
  tokensUsed: number;
  cost: number;
  responseTimeMs: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabasePlugin {
  id: string;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseUserPlugin {
  id: string;
  userId: string;
  pluginId: string;
  isEnabled: boolean;
  configuration?: Record<string, any>;
  installedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DatabaseBudgetLimit {
  id: string;
  userId: string;
  limitAmount: number;
  currentSpent: number;
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  alertThreshold: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
