
/**
 * API Testing Configuration
 * Central configuration for automated API tests
 */

export interface TestConfig {
  baseUrl: string
  apiVersion: string
  timeout: number
  retries: number
  auth: {
    adminUser: {
      email: string
      password: string
    }
    testUser: {
      name: string
      email: string
      password: string
    }
  }
  endpoints: {
    [key: string]: string
  }
  testData: {
    [key: string]: any
  }
}

export const testConfig: TestConfig = {
  baseUrl: process.env.API_BASE_URL || 'http://localhost:8080',
  apiVersion: process.env.API_VERSION || 'v1',
  timeout: parseInt(process.env.TEST_TIMEOUT || '10000'),
  retries: parseInt(process.env.TEST_RETRIES || '3'),
  
  auth: {
    adminUser: {
      email: 'john@doe.com', // Pre-seeded admin user
      password: 'johndoe123'
    },
    testUser: {
      name: 'API Test User',
      email: `api-test-${Date.now()}@example.com`,
      password: 'TestPassword123!'
    }
  },

  endpoints: {
    // Authentication endpoints
    register: '/auth/register',
    login: '/auth/login',
    logout: '/auth/logout',
    refresh: '/auth/refresh',
    profile: '/auth/profile',
    verify: '/auth/verify',
    
    // User management endpoints
    users: '/users',
    userById: '/users/:id',
    
    // AI routing endpoints
    aiRoute: '/ai/route',
    aiAgents: '/ai/agents',
    aiRequests: '/ai/requests',
    
    // Billing endpoints
    credits: '/billing/credits',
    transactions: '/billing/transactions',
    
    // Plugin endpoints
    plugins: '/plugins',
    pluginById: '/plugins/:id',
    installPlugin: '/plugins/:id/install',
    
    // Notification endpoints
    notificationPreferences: '/notifications/preferences',
    notificationHistory: '/notifications/history'
  },

  testData: {
    // Valid test user data
    validUser: {
      name: 'Valid Test User',
      email: 'valid.test@example.com',
      password: 'ValidPassword123!'
    },
    
    // Invalid test data for validation tests
    invalidUsers: [
      {
        name: '',
        email: 'test@example.com',
        password: 'ValidPassword123!'
      },
      {
        name: 'Test User',
        email: 'invalid-email',
        password: 'ValidPassword123!'
      },
      {
        name: 'Test User',
        email: 'test@example.com',
        password: '123' // Too short
      }
    ],

    // AI request test data
    aiRequests: [
      {
        prompt: 'Write a professional email about project status',
        capabilities: ['text-generation'],
        priority: 'normal',
        maxCost: 1.00
      },
      {
        prompt: 'Create a Python function to calculate Fibonacci sequence',
        capabilities: ['code-generation'],
        priority: 'high',
        maxCost: 2.00
      },
      {
        prompt: 'Analyze this data and provide insights',
        capabilities: ['analysis'],
        priority: 'normal',
        maxCost: 1.50
      }
    ],

    // Credit purchase test data
    creditPurchases: [
      {
        amount: 25.00,
        paymentMethod: 'pm_card_visa_test',
        description: 'Test credit purchase - $25'
      },
      {
        amount: 50.00,
        paymentMethod: 'pm_card_mastercard_test',
        description: 'Test credit purchase - $50'
      }
    ],

    // Notification preferences test data
    notificationPreferences: [
      {
        type: 'credit_low',
        channels: {
          email: true,
          push: true,
          sms: false
        },
        frequency: 'immediate',
        quietHours: {
          enabled: true,
          startTime: '22:00',
          endTime: '08:00',
          timezone: 'America/New_York'
        }
      },
      {
        type: 'ai_request_complete',
        channels: {
          email: false,
          push: true,
          sms: false
        },
        frequency: 'immediate'
      }
    ]
  }
}

// Utility functions for test configuration
export class TestUtils {
  static generateUniqueEmail(): string {
    return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@example.com`
  }

  static generateTestUser() {
    return {
      name: `Test User ${Math.random().toString(36).substr(2, 9)}`,
      email: this.generateUniqueEmail(),
      password: 'TestPassword123!'
    }
  }

  static buildUrl(endpoint: string, params?: Record<string, string>): string {
    let url = `${testConfig.baseUrl}/${testConfig.apiVersion}${endpoint}`
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url = url.replace(`:${key}`, value)
      })
    }
    
    return url
  }

  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  static async retryOperation<T>(
    operation: () => Promise<T>,
    retries: number = testConfig.retries,
    delay: number = 1000
  ): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await operation()
      } catch (error) {
        if (i === retries - 1) throw error
        await this.sleep(delay * (i + 1)) // Exponential backoff
      }
    }
    throw new Error('All retry attempts failed')
  }
}

// Test environment validation
export function validateTestEnvironment(): void {
  const requiredEnvVars = [
    'API_BASE_URL',
    'DATABASE_HOST',
    'DATABASE_NAME'
  ]

  const missingVars = requiredEnvVars.filter(
    varName => !process.env[varName]
  )

  if (missingVars.length > 0) {
    console.warn(`Missing environment variables: ${missingVars.join(', ')}`)
    console.warn('Using default values for testing')
  }

  // Validate base URL is accessible
  if (!testConfig.baseUrl.startsWith('http')) {
    throw new Error('Invalid API_BASE_URL: must start with http or https')
  }

  console.log(`Test Configuration:`)
  console.log(`- Base URL: ${testConfig.baseUrl}`)
  console.log(`- API Version: ${testConfig.apiVersion}`)
  console.log(`- Timeout: ${testConfig.timeout}ms`)
  console.log(`- Retries: ${testConfig.retries}`)
}

export default testConfig
