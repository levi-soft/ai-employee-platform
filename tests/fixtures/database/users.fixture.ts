
/**
 * User Test Fixtures
 * Provides standardized test users for integration tests
 */

export const testUsers = {
  admin: {
    email: 'admin@fixture.com',
    password: 'AdminPass123!',
    firstName: 'Admin',
    lastName: 'User',
    role: 'ADMIN' as const
  },
  employee: {
    email: 'employee@fixture.com',
    password: 'EmployeePass123!',
    firstName: 'Employee',
    lastName: 'User',
    role: 'EMPLOYEE' as const
  },
  manager: {
    email: 'manager@fixture.com',
    password: 'ManagerPass123!',
    firstName: 'Manager',
    lastName: 'User',
    role: 'EMPLOYEE' as const
  }
};

export const aiAgents = [
  {
    name: 'GPT-4',
    description: 'Advanced language model for complex tasks',
    provider: 'OpenAI',
    model: 'gpt-4',
    costPerToken: 0.00003,
    maxTokens: 8000,
    capabilities: ['text-generation', 'analysis', 'coding', 'reasoning'],
    isActive: true
  },
  {
    name: 'GPT-3.5',
    description: 'Fast and efficient language model',
    provider: 'OpenAI',
    model: 'gpt-3.5-turbo',
    costPerToken: 0.000002,
    maxTokens: 4000,
    capabilities: ['text-generation', 'conversation'],
    isActive: true
  },
  {
    name: 'Claude 3',
    description: 'Anthropic Claude model',
    provider: 'Anthropic',
    model: 'claude-3-sonnet',
    costPerToken: 0.000015,
    maxTokens: 4000,
    capabilities: ['text-generation', 'analysis', 'safety'],
    isActive: true
  },
  {
    name: 'Gemini Pro',
    description: 'Google Gemini Pro model',
    provider: 'Google',
    model: 'gemini-pro',
    costPerToken: 0.000001,
    maxTokens: 2000,
    capabilities: ['text-generation', 'multimodal'],
    isActive: true
  }
];

export const sampleTransactions = [
  {
    type: 'CREDIT' as const,
    amount: 100,
    description: 'Initial credit bonus',
    status: 'COMPLETED' as const,
    reference: 'INIT_BONUS_001'
  },
  {
    type: 'DEBIT' as const,
    amount: 15,
    description: 'GPT-4 API usage',
    status: 'COMPLETED' as const,
    reference: 'GPT4_USAGE_001'
  },
  {
    type: 'DEBIT' as const,
    amount: 5,
    description: 'GPT-3.5 API usage',
    status: 'COMPLETED' as const,
    reference: 'GPT35_USAGE_001'
  },
  {
    type: 'CREDIT' as const,
    amount: 50,
    description: 'Monthly credit allocation',
    status: 'COMPLETED' as const,
    reference: 'MONTHLY_ALLOC_001'
  }
];

export const sampleBudgetLimits = [
  {
    limitType: 'DAILY' as const,
    amount: 50,
    period: new Date(),
    currentUsage: 0
  },
  {
    limitType: 'WEEKLY' as const,
    amount: 300,
    period: new Date(),
    currentUsage: 0
  },
  {
    limitType: 'MONTHLY' as const,
    amount: 1000,
    period: new Date(),
    currentUsage: 0
  }
];

export const sampleAIRequests = [
  {
    prompt: 'Explain quantum computing in simple terms',
    response: 'Quantum computing is a type of computation that harnesses quantum mechanics...',
    tokensUsed: 150,
    cost: 4.5,
    status: 'COMPLETED' as const,
    processingTime: 2500
  },
  {
    prompt: 'Write a Python function to sort a list',
    response: 'Here is a Python function to sort a list:\n\ndef sort_list(arr):\n    return sorted(arr)',
    tokensUsed: 75,
    cost: 2.25,
    status: 'COMPLETED' as const,
    processingTime: 1200
  },
  {
    prompt: 'Analyze this business proposal',
    response: 'The business proposal shows strong market potential with the following key points...',
    tokensUsed: 300,
    cost: 9.0,
    status: 'COMPLETED' as const,
    processingTime: 3500
  }
];

export const createTestUserData = (override: Partial<typeof testUsers.employee> = {}) => ({
  ...testUsers.employee,
  ...override,
  email: override.email || `test${Date.now()}@example.com`
});

export const createTestAgentData = (override: Partial<typeof aiAgents[0]> = {}) => ({
  ...aiAgents[0],
  ...override,
  name: override.name || `TestAgent${Date.now()}`
});

export const createTestTransactionData = (userId: string, override: Partial<typeof sampleTransactions[0]> = {}) => ({
  ...sampleTransactions[0],
  ...override,
  userId,
  reference: override.reference || `TEST_${Date.now()}`
});
