
import { PrismaClient } from '@prisma/client';
import { testUsers } from './users.fixture';

/**
 * Database test fixtures and utilities
 */
export class DatabaseFixture {
  private prisma: PrismaClient;
  
  constructor() {
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.TEST_DATABASE_URL,
        },
      },
    });
  }
  
  async setup(): Promise<void> {
    // Clean existing test data
    await this.cleanup();
    
    // Seed test users
    await this.seedUsers();
    
    // Seed other test data as needed
    await this.seedCreditAccounts();
    await this.seedAIAgents();
  }
  
  async cleanup(): Promise<void> {
    // Clean up in reverse order of dependencies
    await this.prisma.aIRequest.deleteMany();
    await this.prisma.transaction.deleteMany();
    await this.prisma.userPlugin.deleteMany();
    await this.prisma.plugin.deleteMany();
    await this.prisma.budgetLimit.deleteMany();
    await this.prisma.aIAgent.deleteMany();
    await this.prisma.creditAccount.deleteMany();
    await this.prisma.user.deleteMany();
  }
  
  private async seedUsers(): Promise<void> {
    for (const userData of testUsers) {
      await this.prisma.user.create({
        data: {
          id: userData.id,
          email: userData.email,
          name: userData.name,
          password: userData.password, // In real implementation, this would be hashed
          role: userData.role,
          isActive: userData.isActive,
        },
      });
    }
  }
  
  private async seedCreditAccounts(): Promise<void> {
    for (const user of testUsers) {
      await this.prisma.creditAccount.create({
        data: {
          userId: user.id,
          balance: user.role === 'ADMIN' ? 10000 : 1000,
          totalEarned: user.role === 'ADMIN' ? 10000 : 1000,
          totalSpent: 0,
        },
      });
    }
  }
  
  private async seedAIAgents(): Promise<void> {
    const aiAgents = [
      {
        id: 'test-gpt-4',
        name: 'Test GPT-4',
        provider: 'openai',
        model: 'gpt-4',
        costPerToken: 0.00003,
        isActive: true,
        capabilities: ['text-generation', 'code-generation', 'analysis'],
      },
      {
        id: 'test-claude-3',
        name: 'Test Claude 3',
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        costPerToken: 0.000075,
        isActive: true,
        capabilities: ['text-generation', 'analysis', 'reasoning'],
      },
    ];
    
    for (const agent of aiAgents) {
      await this.prisma.aIAgent.create({
        data: agent,
      });
    }
  }
  
  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export const databaseFixture = new DatabaseFixture();
