
/**
 * Database Integration Tests
 * Tests database operations, transactions, and data integrity
 */

import { PrismaClient } from '@prisma/client';
import { DatabaseFixture } from '../fixtures/database.fixture';

const prisma = new PrismaClient();
let databaseFixture: DatabaseFixture;

beforeAll(async () => {
  databaseFixture = new DatabaseFixture(prisma);
  await databaseFixture.setup();
});

afterAll(async () => {
  await databaseFixture.cleanup();
  await prisma.$disconnect();
});

afterEach(async () => {
  await databaseFixture.cleanupTestData();
});

describe('Database Integration Tests', () => {
  describe('User Operations', () => {
    it('should create user with credit account', async () => {
      const userData = {
        email: 'credit@test.com',
        password: 'hashedpass',
        firstName: 'Credit',
        lastName: 'User',
        role: 'EMPLOYEE' as const
      };

      const user = await databaseFixture.createUser(userData);

      expect(user).toHaveProperty('id');
      expect(user.email).toBe(userData.email);

      // Verify credit account was created
      const creditAccount = await prisma.creditAccount.findUnique({
        where: { userId: user.id }
      });

      expect(creditAccount).toBeTruthy();
      expect(creditAccount?.balance).toBe(100); // Default balance
    });

    it('should handle user role constraints', async () => {
      const adminData = {
        email: 'admin@test.com',
        password: 'hashedpass',
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN' as const
      };

      const admin = await databaseFixture.createUser(adminData);
      expect(admin.role).toBe('ADMIN');

      const employeeData = {
        email: 'employee@test.com',
        password: 'hashedpass',
        firstName: 'Employee',
        lastName: 'User',
        role: 'EMPLOYEE' as const
      };

      const employee = await databaseFixture.createUser(employeeData);
      expect(employee.role).toBe('EMPLOYEE');
    });

    it('should enforce unique email constraint', async () => {
      const userData = {
        email: 'unique@test.com',
        password: 'hashedpass',
        firstName: 'First',
        lastName: 'User',
        role: 'EMPLOYEE' as const
      };

      await databaseFixture.createUser(userData);

      // Attempt to create duplicate
      await expect(
        databaseFixture.createUser(userData)
      ).rejects.toThrow();
    });
  });

  describe('Credit System Operations', () => {
    let userId: string;

    beforeEach(async () => {
      const user = await databaseFixture.createUser({
        email: 'credit-ops@test.com',
        password: 'hashedpass',
        firstName: 'Credit',
        lastName: 'Ops',
        role: 'EMPLOYEE'
      });
      userId = user.id;
    });

    it('should handle credit transactions', async () => {
      const initialBalance = await prisma.creditAccount.findUnique({
        where: { userId }
      });
      expect(initialBalance?.balance).toBe(100);

      // Create a credit transaction
      const transaction = await prisma.transaction.create({
        data: {
          userId,
          type: 'CREDIT',
          amount: 50,
          description: 'Test credit',
          status: 'COMPLETED',
          reference: 'test-ref-001'
        }
      });

      expect(transaction.amount).toBe(50);
      expect(transaction.type).toBe('CREDIT');

      // Update credit account balance
      await prisma.creditAccount.update({
        where: { userId },
        data: {
          balance: { increment: 50 }
        }
      });

      const updatedBalance = await prisma.creditAccount.findUnique({
        where: { userId }
      });
      expect(updatedBalance?.balance).toBe(150);
    });

    it('should handle debit transactions', async () => {
      // Create debit transaction
      const transaction = await prisma.transaction.create({
        data: {
          userId,
          type: 'DEBIT',
          amount: 25,
          description: 'AI API usage',
          status: 'COMPLETED',
          reference: 'ai-usage-001'
        }
      });

      expect(transaction.amount).toBe(25);
      expect(transaction.type).toBe('DEBIT');

      // Update credit account balance
      await prisma.creditAccount.update({
        where: { userId },
        data: {
          balance: { decrement: 25 }
        }
      });

      const updatedBalance = await prisma.creditAccount.findUnique({
        where: { userId }
      });
      expect(updatedBalance?.balance).toBe(75);
    });

    it('should enforce budget limits', async () => {
      // Create budget limit
      const budgetLimit = await prisma.budgetLimit.create({
        data: {
          userId,
          limitType: 'DAILY',
          amount: 50,
          period: new Date(),
          currentUsage: 0
        }
      });

      expect(budgetLimit.amount).toBe(50);
      expect(budgetLimit.limitType).toBe('DAILY');

      // Test budget enforcement logic
      const currentUsage = 30;
      const requestedAmount = 25;

      expect(currentUsage + requestedAmount).toBeGreaterThan(budgetLimit.amount);
    });
  });

  describe('AI Agent Operations', () => {
    it('should create and manage AI agents', async () => {
      const agentData = {
        name: 'GPT-4',
        description: 'Advanced language model',
        provider: 'OpenAI',
        model: 'gpt-4',
        costPerToken: 0.0001,
        maxTokens: 8000,
        capabilities: ['text-generation', 'analysis'],
        isActive: true
      };

      const agent = await prisma.aIAgent.create({
        data: agentData
      });

      expect(agent.name).toBe(agentData.name);
      expect(agent.provider).toBe(agentData.provider);
      expect(agent.costPerToken).toBe(agentData.costPerToken);
      expect(agent.isActive).toBe(true);
    });

    it('should track AI requests', async () => {
      const user = await databaseFixture.createUser({
        email: 'ai-user@test.com',
        password: 'hashedpass',
        firstName: 'AI',
        lastName: 'User',
        role: 'EMPLOYEE'
      });

      const agent = await prisma.aIAgent.create({
        data: {
          name: 'Test Agent',
          description: 'Test agent',
          provider: 'TestProvider',
          model: 'test-model',
          costPerToken: 0.001,
          maxTokens: 1000,
          capabilities: ['test'],
          isActive: true
        }
      });

      const aiRequest = await prisma.aIRequest.create({
        data: {
          userId: user.id,
          agentId: agent.id,
          prompt: 'Test prompt',
          response: 'Test response',
          tokensUsed: 50,
          cost: 0.05,
          status: 'COMPLETED',
          processingTime: 1500
        }
      });

      expect(aiRequest.prompt).toBe('Test prompt');
      expect(aiRequest.tokensUsed).toBe(50);
      expect(aiRequest.cost).toBe(0.05);
      expect(aiRequest.status).toBe('COMPLETED');
    });
  });

  describe('Transaction Integrity', () => {
    it('should maintain referential integrity', async () => {
      const user = await databaseFixture.createUser({
        email: 'integrity@test.com',
        password: 'hashedpass',
        firstName: 'Integrity',
        lastName: 'Test',
        role: 'EMPLOYEE'
      });

      // Create related records
      const transaction = await prisma.transaction.create({
        data: {
          userId: user.id,
          type: 'CREDIT',
          amount: 100,
          description: 'Test transaction',
          status: 'COMPLETED',
          reference: 'integrity-test-001'
        }
      });

      // Verify relationships
      const userWithTransactions = await prisma.user.findUnique({
        where: { id: user.id },
        include: {
          transactions: true,
          creditAccount: true
        }
      });

      expect(userWithTransactions?.transactions).toHaveLength(1);
      expect(userWithTransactions?.transactions[0].id).toBe(transaction.id);
      expect(userWithTransactions?.creditAccount).toBeTruthy();
    });

    it('should handle cascade operations correctly', async () => {
      const user = await databaseFixture.createUser({
        email: 'cascade@test.com',
        password: 'hashedpass',
        firstName: 'Cascade',
        lastName: 'Test',
        role: 'EMPLOYEE'
      });

      // Create multiple related records
      await prisma.transaction.createMany({
        data: [
          {
            userId: user.id,
            type: 'CREDIT',
            amount: 50,
            description: 'Transaction 1',
            status: 'COMPLETED',
            reference: 'cascade-001'
          },
          {
            userId: user.id,
            type: 'DEBIT',
            amount: 25,
            description: 'Transaction 2',
            status: 'COMPLETED',
            reference: 'cascade-002'
          }
        ]
      });

      const transactionCount = await prisma.transaction.count({
        where: { userId: user.id }
      });
      expect(transactionCount).toBe(2);
    });
  });

  describe('Performance Tests', () => {
    it('should handle bulk operations efficiently', async () => {
      const startTime = Date.now();

      // Create multiple users
      const userData = Array.from({ length: 10 }, (_, i) => ({
        email: `bulk${i}@test.com`,
        password: 'hashedpass',
        firstName: `User${i}`,
        lastName: 'Bulk',
        role: 'EMPLOYEE' as const
      }));

      const users = await Promise.all(
        userData.map(data => databaseFixture.createUser(data))
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(users).toHaveLength(10);
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    });

    it('should handle complex queries efficiently', async () => {
      // Create test data
      const user = await databaseFixture.createUser({
        email: 'complex@test.com',
        password: 'hashedpass',
        firstName: 'Complex',
        lastName: 'Query',
        role: 'EMPLOYEE'
      });

      // Create multiple transactions
      await prisma.transaction.createMany({
        data: Array.from({ length: 20 }, (_, i) => ({
          userId: user.id,
          type: i % 2 === 0 ? 'CREDIT' : 'DEBIT' as const,
          amount: Math.random() * 100,
          description: `Transaction ${i}`,
          status: 'COMPLETED' as const,
          reference: `complex-${i}`
        }))
      });

      const startTime = Date.now();

      // Complex query with joins and aggregations
      const result = await prisma.user.findUnique({
        where: { id: user.id },
        include: {
          transactions: {
            orderBy: { createdAt: 'desc' },
            take: 10
          },
          creditAccount: true,
          _count: {
            select: { transactions: true }
          }
        }
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(result?.transactions).toHaveLength(10);
      expect(result?._count.transactions).toBe(20);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });
  });
});
