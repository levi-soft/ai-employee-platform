
/**
 * Test Scenario Fixtures
 * Provides complex test scenarios for integration testing
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { testUsers, aiAgents, sampleTransactions, sampleBudgetLimits } from './users.fixture';

export class TestScenarios {
  constructor(private prisma: PrismaClient) {}

  /**
   * Complete user setup scenario
   * Creates user with credit account, transactions, and budget limits
   */
  async setupCompleteUser(userOverride: Partial<typeof testUsers.employee> = {}) {
    const userData = { ...testUsers.employee, ...userOverride };
    const hashedPassword = await bcrypt.hash(userData.password, 10);

    // Create user with credit account
    const user = await this.prisma.user.create({
      data: {
        email: userData.email,
        password: hashedPassword,
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: userData.role,
        creditAccount: {
          create: {
            balance: 100,
            lastUpdated: new Date()
          }
        }
      },
      include: {
        creditAccount: true
      }
    });

    // Create sample transactions
    const transactions = await this.prisma.transaction.createMany({
      data: sampleTransactions.map(transaction => ({
        ...transaction,
        userId: user.id
      }))
    });

    // Create budget limits
    const budgetLimits = await this.prisma.budgetLimit.createMany({
      data: sampleBudgetLimits.map(limit => ({
        ...limit,
        userId: user.id
      }))
    });

    return {
      user,
      transactions,
      budgetLimits
    };
  }

  /**
   * AI Agent Pool Scenario
   * Creates multiple AI agents with different capabilities
   */
  async setupAIAgentPool() {
    const agents = await Promise.all(
      aiAgents.map(agent => 
        this.prisma.aIAgent.create({ data: agent })
      )
    );

    return agents;
  }

  /**
   * User with AI Usage History Scenario
   * Creates user with multiple AI requests across different agents
   */
  async setupUserWithAIUsage(userOverride: Partial<typeof testUsers.employee> = {}) {
    // First setup complete user
    const { user } = await this.setupCompleteUser(userOverride);
    
    // Setup AI agents
    const agents = await this.setupAIAgentPool();

    // Create AI requests for different agents
    const aiRequests = await Promise.all([
      // GPT-4 requests
      this.prisma.aIRequest.create({
        data: {
          userId: user.id,
          agentId: agents[0].id, // GPT-4
          prompt: 'Explain quantum computing in simple terms',
          response: 'Quantum computing is a type of computation that harnesses quantum mechanics...',
          tokensUsed: 150,
          cost: 4.5,
          status: 'COMPLETED',
          processingTime: 2500
        }
      }),
      // GPT-3.5 requests
      this.prisma.aIRequest.create({
        data: {
          userId: user.id,
          agentId: agents[1].id, // GPT-3.5
          prompt: 'Write a Python function to sort a list',
          response: 'Here is a Python function to sort a list:\n\ndef sort_list(arr):\n    return sorted(arr)',
          tokensUsed: 75,
          cost: 0.15,
          status: 'COMPLETED',
          processingTime: 1200
        }
      }),
      // Claude 3 requests
      this.prisma.aIRequest.create({
        data: {
          userId: user.id,
          agentId: agents[2].id, // Claude 3
          prompt: 'Analyze this business proposal',
          response: 'The business proposal shows strong market potential...',
          tokensUsed: 300,
          cost: 4.5,
          status: 'COMPLETED',
          processingTime: 3500
        }
      })
    ]);

    return {
      user,
      agents,
      aiRequests
    };
  }

  /**
   * Admin User Scenario
   * Creates admin user with full system access
   */
  async setupAdminUser() {
    const hashedPassword = await bcrypt.hash(testUsers.admin.password, 10);

    const admin = await this.prisma.user.create({
      data: {
        email: testUsers.admin.email,
        password: hashedPassword,
        firstName: testUsers.admin.firstName,
        lastName: testUsers.admin.lastName,
        role: testUsers.admin.role,
        creditAccount: {
          create: {
            balance: 1000, // Higher balance for admin
            lastUpdated: new Date()
          }
        }
      },
      include: {
        creditAccount: true
      }
    });

    return admin;
  }

  /**
   * Multi-User Organization Scenario
   * Creates multiple users representing an organization
   */
  async setupOrganizationScenario() {
    const admin = await this.setupAdminUser();
    
    // Create multiple employees
    const employees = await Promise.all([
      this.setupCompleteUser({ 
        email: 'emp1@org.com', 
        firstName: 'John', 
        lastName: 'Developer' 
      }),
      this.setupCompleteUser({ 
        email: 'emp2@org.com', 
        firstName: 'Jane', 
        lastName: 'Designer' 
      }),
      this.setupCompleteUser({ 
        email: 'emp3@org.com', 
        firstName: 'Bob', 
        lastName: 'Manager' 
      })
    ]);

    const agents = await this.setupAIAgentPool();

    return {
      admin,
      employees: employees.map(emp => emp.user),
      agents
    };
  }

  /**
   * High Usage Scenario
   * Creates user with high AI usage and complex transaction history
   */
  async setupHighUsageScenario() {
    const { user, agents } = await this.setupUserWithAIUsage({
      email: 'highuser@test.com',
      firstName: 'High',
      lastName: 'User'
    });

    // Create many additional AI requests
    const additionalRequests = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const randomAgent = agents[Math.floor(Math.random() * agents.length)];
        return this.prisma.aIRequest.create({
          data: {
            userId: user.id,
            agentId: randomAgent.id,
            prompt: `Test prompt ${i}`,
            response: `Test response ${i}`,
            tokensUsed: Math.floor(Math.random() * 500) + 50,
            cost: Math.random() * 10 + 1,
            status: 'COMPLETED',
            processingTime: Math.floor(Math.random() * 5000) + 1000
          }
        });
      })
    );

    // Create additional transactions
    const additionalTransactions = await this.prisma.transaction.createMany({
      data: Array.from({ length: 15 }, (_, i) => ({
        userId: user.id,
        type: i % 3 === 0 ? 'CREDIT' : 'DEBIT' as const,
        amount: Math.random() * 50 + 10,
        description: `High usage transaction ${i}`,
        status: 'COMPLETED' as const,
        reference: `HIGH_USAGE_${i}`
      }))
    });

    return {
      user,
      agents,
      aiRequests: additionalRequests,
      transactions: additionalTransactions
    };
  }

  /**
   * Budget Limit Testing Scenario
   * Creates user with various budget limits and usage patterns
   */
  async setupBudgetLimitScenario() {
    const { user } = await this.setupCompleteUser({
      email: 'budget@test.com',
      firstName: 'Budget',
      lastName: 'User'
    });

    // Create multiple budget limits with different periods
    const today = new Date();
    const thisWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    const budgetLimits = await Promise.all([
      this.prisma.budgetLimit.create({
        data: {
          userId: user.id,
          limitType: 'DAILY',
          amount: 25,
          period: today,
          currentUsage: 15 // Near limit
        }
      }),
      this.prisma.budgetLimit.create({
        data: {
          userId: user.id,
          limitType: 'WEEKLY',
          amount: 150,
          period: thisWeek,
          currentUsage: 120 // Near limit
        }
      }),
      this.prisma.budgetLimit.create({
        data: {
          userId: user.id,
          limitType: 'MONTHLY',
          amount: 500,
          period: thisMonth,
          currentUsage: 200 // Well below limit
        }
      })
    ]);

    return {
      user,
      budgetLimits
    };
  }

  /**
   * Plugin System Scenario
   * Creates users with plugin installations and usage
   */
  async setupPluginScenario() {
    const { user } = await this.setupCompleteUser({
      email: 'plugin@test.com',
      firstName: 'Plugin',
      lastName: 'User'
    });

    // Create sample plugins
    const plugins = await Promise.all([
      this.prisma.plugin.create({
        data: {
          name: 'Code Generator',
          description: 'Generates code in various languages',
          version: '1.0.0',
          author: 'AI Platform Team',
          category: 'DEVELOPMENT',
          isOfficial: true,
          isActive: true,
          config: {
            supportedLanguages: ['JavaScript', 'Python', 'TypeScript'],
            maxGenerationLength: 1000
          }
        }
      }),
      this.prisma.plugin.create({
        data: {
          name: 'Document Analyzer',
          description: 'Analyzes and summarizes documents',
          version: '1.2.0',
          author: 'AI Platform Team',
          category: 'PRODUCTIVITY',
          isOfficial: true,
          isActive: true,
          config: {
            supportedFormats: ['PDF', 'DOC', 'TXT'],
            maxFileSize: 10485760
          }
        }
      })
    ]);

    // Install plugins for user
    const userPlugins = await Promise.all(
      plugins.map(plugin =>
        this.prisma.userPlugin.create({
          data: {
            userId: user.id,
            pluginId: plugin.id,
            isEnabled: true,
            config: {},
            installedAt: new Date()
          }
        })
      )
    );

    return {
      user,
      plugins,
      userPlugins
    };
  }
}
