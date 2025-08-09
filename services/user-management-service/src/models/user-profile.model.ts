
export interface UserProfile {
  id: string
  name: string
  email: string
  role: 'ADMIN' | 'EMPLOYEE'
  isActive: boolean
  emailVerified: boolean | null
  bio: string | null
  avatar: string | null
  lastLogin: Date | null
  createdAt: Date
  updatedAt: Date
  preferences: UserPreferences
  creditAccount?: {
    balance: number
    totalUsed: number
    budgetLimits: BudgetLimit[]
  }
  stats?: {
    totalRequests: number
    pluginsInstalled: number
  }
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system'
  notifications: {
    email: boolean
    push: boolean
    sms: boolean
  }
  defaultAgent?: string
  language?: string
  timezone?: string
}

export interface BudgetLimit {
  id: string
  limitType: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  amount: number
  period: string
  isActive: boolean
}

export interface UserActivity {
  id: string
  agentId: string
  tokensUsed: number
  cost: number
  responseTime: number | null
  createdAt: Date
  aiAgent: {
    name: string
    provider: string
  }
}

export interface ActivitySummary {
  requests: {
    total: number
    last30Days: number
    last7Days: number
    today: number
  }
  cost: {
    total: number
    last30Days: number
  }
  recentActivity: UserActivity[]
}

export interface UserPermission {
  resource: string
  actions: string[]
  conditions?: Record<string, any>
}

export interface Role {
  name: 'ADMIN' | 'EMPLOYEE'
  permissions: UserPermission[]
  description: string
}

export const ROLE_PERMISSIONS: Record<string, Role> = {
  ADMIN: {
    name: 'ADMIN',
    description: 'Full system access with user management capabilities',
    permissions: [
      {
        resource: 'users',
        actions: ['create', 'read', 'update', 'delete', 'manage_roles']
      },
      {
        resource: 'ai_agents',
        actions: ['create', 'read', 'update', 'delete', 'configure']
      },
      {
        resource: 'billing',
        actions: ['read', 'update', 'manage_credits', 'view_analytics']
      },
      {
        resource: 'plugins',
        actions: ['install', 'uninstall', 'configure', 'publish']
      },
      {
        resource: 'system',
        actions: ['configure', 'monitor', 'backup']
      }
    ]
  },
  EMPLOYEE: {
    name: 'EMPLOYEE',
    description: 'Standard user with AI agent access and profile management',
    permissions: [
      {
        resource: 'profile',
        actions: ['read', 'update'],
        conditions: { own_profile_only: true }
      },
      {
        resource: 'ai_agents',
        actions: ['read', 'use']
      },
      {
        resource: 'billing',
        actions: ['read'],
        conditions: { own_account_only: true }
      },
      {
        resource: 'plugins',
        actions: ['install', 'uninstall', 'use'],
        conditions: { approved_plugins_only: true }
      }
    ]
  }
}

export interface UserSearchResult {
  id: string
  name: string
  email: string
  role: 'ADMIN' | 'EMPLOYEE'
  avatar?: string
  isActive: boolean
}

export interface UserListItem {
  id: string
  name: string
  email: string
  role: 'ADMIN' | 'EMPLOYEE'
  isActive: boolean
  emailVerified: boolean | null
  lastLogin: Date | null
  createdAt: Date
  updatedAt: Date
  creditAccount?: {
    balance: number
    totalUsed: number
  }
}

export interface UserStats {
  total: number
  active: number
  inactive: number
  admins: number
  employees: number
}

export interface CreateUserRequest {
  name: string
  email: string
  password?: string
  role?: 'ADMIN' | 'EMPLOYEE'
  isActive?: boolean
}

export interface UpdateUserRequest {
  name?: string
  email?: string
  password?: string
  isActive?: boolean
}

export interface UpdateProfileRequest {
  name?: string
  bio?: string
  avatar?: string
  preferences?: Partial<UserPreferences>
}

export interface PaginatedUsersResponse {
  data: UserListItem[]
  pagination: {
    total: number
    page: number
    pages: number
    limit: number
  }
}

export interface PaginatedActivityResponse {
  data: UserActivity[]
  pagination: {
    total: number
    page: number
    pages: number
    limit: number
  }
}
