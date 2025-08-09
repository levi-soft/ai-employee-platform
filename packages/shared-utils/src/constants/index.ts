
// Platform constants and configuration
export const API_ROUTES = {
  AUTH: {
    LOGIN: '/auth/login',
    REGISTER: '/auth/register',
    REFRESH: '/auth/refresh',
    LOGOUT: '/auth/logout',
    PROFILE: '/auth/profile',
    CHANGE_PASSWORD: '/auth/change-password',
    RESET_PASSWORD: '/auth/reset-password',
    VERIFY_EMAIL: '/auth/verify-email',
    TWO_FACTOR_SETUP: '/auth/2fa/setup',
    TWO_FACTOR_VERIFY: '/auth/2fa/verify',
  },
  USERS: {
    LIST: '/users',
    GET: '/users/:id',
    CREATE: '/users',
    UPDATE: '/users/:id',
    DELETE: '/users/:id',
    SEARCH: '/users/search',
  },
  AI_AGENTS: {
    LIST: '/ai-agents',
    GET: '/ai-agents/:id',
    CREATE: '/ai-agents',
    UPDATE: '/ai-agents/:id',
    DELETE: '/ai-agents/:id',
    HEALTH: '/ai-agents/:id/health',
  },
  AI_REQUESTS: {
    LIST: '/ai-requests',
    GET: '/ai-requests/:id',
    CREATE: '/ai-requests',
    STREAM: '/ai-requests/stream',
    CANCEL: '/ai-requests/:id/cancel',
  },
  BILLING: {
    ACCOUNTS: '/billing/accounts',
    TRANSACTIONS: '/billing/transactions',
    BUDGET_LIMITS: '/billing/budget-limits',
    ANALYTICS: '/billing/analytics',
    INVOICES: '/billing/invoices',
  },
  PLUGINS: {
    LIST: '/plugins',
    GET: '/plugins/:id',
    INSTALL: '/plugins/:id/install',
    UNINSTALL: '/plugins/:id/uninstall',
    USER_PLUGINS: '/plugins/user',
    MARKETPLACE: '/plugins/marketplace',
  },
  NOTIFICATIONS: {
    LIST: '/notifications',
    MARK_READ: '/notifications/:id/read',
    MARK_ALL_READ: '/notifications/read-all',
    PREFERENCES: '/notifications/preferences',
  },
} as const;

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export const VALIDATION_RULES = {
  PASSWORD: {
    MIN_LENGTH: 8,
    MAX_LENGTH: 128,
    REQUIRE_UPPERCASE: true,
    REQUIRE_LOWERCASE: true,
    REQUIRE_NUMBERS: true,
    REQUIRE_SPECIAL: true,
  },
  EMAIL: {
    MAX_LENGTH: 254,
  },
  NAME: {
    MIN_LENGTH: 2,
    MAX_LENGTH: 50,
  },
  TOKEN_EXPIRY: {
    ACCESS_TOKEN: '15m',
    REFRESH_TOKEN: '30d',
    RESET_TOKEN: '1h',
    EMAIL_VERIFICATION: '24h',
  },
} as const;

export const AI_PROVIDERS = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GOOGLE: 'google',
  COHERE: 'cohere',
  OLLAMA: 'ollama',
  CUSTOM: 'custom',
} as const;

export const AI_CAPABILITIES = {
  TEXT_GENERATION: 'text-generation',
  CODE_GENERATION: 'code-generation',
  DATA_ANALYSIS: 'data-analysis',
  IMAGE_GENERATION: 'image-generation',
  TRANSLATION: 'translation',
  SUMMARIZATION: 'summarization',
  CONVERSATION: 'conversation',
  DOCUMENT_ANALYSIS: 'document-analysis',
} as const;

export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  EMPLOYEE: 'employee',
  VIEWER: 'viewer',
} as const;

export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

export const BUDGET_PERIODS = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
} as const;

export const TRANSACTION_TYPES = {
  CREDIT: 'credit',
  DEBIT: 'debit',
  REFUND: 'refund',
  BONUS: 'bonus',
} as const;

export const WEBSOCKET_EVENTS = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  AI_REQUEST_UPDATE: 'ai_request_update',
  NOTIFICATION: 'notification',
  CREDIT_UPDATE: 'credit_update',
  SYSTEM_ALERT: 'system_alert',
} as const;

export const CACHE_KEYS = {
  USER_SESSION: (userId: string) => `session:${userId}`,
  USER_PERMISSIONS: (userId: string) => `permissions:${userId}`,
  AI_AGENT_HEALTH: (agentId: string) => `agent:${agentId}:health`,
  PLUGIN_CONFIG: (pluginId: string) => `plugin:${pluginId}:config`,
  SYSTEM_HEALTH: 'system:health',
} as const;

export const RATE_LIMITS = {
  AUTH: {
    LOGIN_ATTEMPTS: 5,
    PASSWORD_RESET: 3,
    WINDOW_MINUTES: 15,
  },
  AI_REQUESTS: {
    PER_MINUTE: 60,
    PER_HOUR: 1000,
    PER_DAY: 10000,
  },
  API_GENERAL: {
    PER_MINUTE: 100,
    PER_HOUR: 5000,
  },
} as const;

export const ENCRYPTION = {
  BCRYPT_ROUNDS: 12,
  JWT_ALGORITHM: 'HS256',
  AES_ALGORITHM: 'aes-256-gcm',
  KEY_LENGTH: 32,
  IV_LENGTH: 16,
} as const;

export const FILE_UPLOAD = {
  MAX_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf', 'text/plain'],
  AVATAR_MAX_SIZE: 2 * 1024 * 1024, // 2MB
} as const;

export const NOTIFICATION_TYPES = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
} as const;

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  AUTHORIZATION_FAILED: 'AUTHORIZATION_FAILED',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  AI_AGENT_UNAVAILABLE: 'AI_AGENT_UNAVAILABLE',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
