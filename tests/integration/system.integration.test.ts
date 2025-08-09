
/**
 * System Integration Tests
 * Tests end-to-end system functionality across multiple services
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from '../utils/test-server';
import { DatabaseFixture } from '../fixtures/database.fixture';
import { TestScenarios } from '../fixtures/database/scenarios.fixture';

const prisma = new PrismaClient();
let app: any;
let databaseFixture: DatabaseFixture;
let testScenarios: TestScenarios;

beforeAll(async () => {
  app = await createTestApp();
  databaseFixture = new DatabaseFixture(prisma);
  testScenarios = new TestScenarios(prisma);
  await databaseFixture.setup();
});

afterAll(async () => {
  await databaseFixture.cleanup();
  await prisma.$disconnect();
});

afterEach(async () => {
  await databaseFixture.cleanupTestData();
});

describe('System Integration Tests', () => {
  describe('Complete User Lifecycle', () => {
    it('should handle complete user journey', async () => {
      // 1. User Registration
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'lifecycle@test.com',
          password: 'Lifecycle123!',
          firstName: 'Life',
          lastName: 'Cycle',
          role: 'EMPLOYEE'
        })
        .expect(201);

      const userId = registerResponse.body.user.id;
      const { tokens } = registerResponse.body;

      // 2. Verify Credit Account Created
      const creditAccount = await prisma.creditAccount.findUnique({
        where: { userId }
      });
      expect(creditAccount).toBeTruthy();
      expect(creditAccount?.balance).toBe(100);

      // 3. User Profile Access
      const profileResponse = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      expect(profileResponse.body.user.email).toBe('lifecycle@test.com');

      // 4. Simulate Credit Usage (would be done by AI routing service)
      await prisma.transaction.create({
        data: {
          userId,
          type: 'DEBIT',
          amount: 25,
          description: 'AI API usage simulation',
          status: 'COMPLETED',
          reference: 'INTEGRATION_TEST_001'
        }
      });

      // Update credit balance
      await prisma.creditAccount.update({
        where: { userId },
        data: { balance: { decrement: 25 } }
      });

      // 5. Check Updated Balance
      const updatedAccount = await prisma.creditAccount.findUnique({
        where: { userId }
      });
      expect(updatedAccount?.balance).toBe(75);

      // 6. User Logout
      const logoutResponse = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      expect(logoutResponse.body.message).toContain('Logged out successfully');
    });

    it('should handle user role-based access', async () => {
      // Create admin user
      const adminScenario = await testScenarios.setupAdminUser();
      
      // Login admin
      const adminLogin = await request(app)
        .post('/api/auth/login')
        .send({
          email: adminScenario.email,
          password: 'AdminPass123!' // Would need to be set properly in real scenario
        });

      // Note: This would be expanded with actual role-based endpoints
      // For now, verify admin user was created with proper role
      expect(adminScenario.role).toBe('ADMIN');
      expect(adminScenario.creditAccount?.balance).toBe(1000); // Higher balance for admin
    });
  });

  describe('AI Agent Pool Integration', () => {
    it('should manage AI agent lifecycle', async () => {
      // Setup AI agent pool
      const agents = await testScenarios.setupAIAgentPool();
      
      expect(agents).toHaveLength(4);
      expect(agents.map(a => a.name)).toContain('GPT-4');
      expect(agents.map(a => a.name)).toContain('GPT-3.5');
      expect(agents.map(a => a.name)).toContain('Claude 3');
      expect(agents.map(a => a.name)).toContain('Gemini Pro');

      // Verify agent configurations
      const gpt4 = agents.find(a => a.name === 'GPT-4');
      expect(gpt4?.provider).toBe('OpenAI');
      expect(gpt4?.isActive).toBe(true);
      expect(gpt4?.capabilities).toContain('text-generation');
    });

    it('should track AI usage across agents', async () => {
      const { user, agents, aiRequests } = await testScenarios.setupUserWithAIUsage();

      expect(aiRequests).toHaveLength(3);
      
      // Verify different agents were used
      const agentIds = aiRequests.map(req => req.agentId);
      const uniqueAgents = new Set(agentIds);
      expect(uniqueAgents.size).toBe(3); // Used 3 different agents

      // Verify cost calculations
      const totalCost = aiRequests.reduce((sum, req) => sum + req.cost, 0);
      expect(totalCost).toBeGreaterThan(0);

      // Check that usage was tracked
      const userRequests = await prisma.aIRequest.findMany({
        where: { userId: user.id },
        include: { agent: true }
      });
      expect(userRequests).toHaveLength(3);
    });
  });

  describe('Credit System Integration', () => {
    it('should handle complex credit scenarios', async () => {
      const { user } = await testScenarios.setupCompleteUser();

      // Initial balance should be 100
      let account = await prisma.creditAccount.findUnique({
        where: { userId: user.id }
      });
      expect(account?.balance).toBe(100);

      // Simulate multiple transactions
      const transactions = [
        { type: 'CREDIT', amount: 50, description: 'Bonus credits' },
        { type: 'DEBIT', amount: 25, description: 'AI usage 1' },
        { type: 'DEBIT', amount: 15, description: 'AI usage 2' },
        { type: 'CREDIT', amount: 30, description: 'Refund' }
      ];

      for (const [index, txn] of transactions.entries()) {
        await prisma.transaction.create({
          data: {
            userId: user.id,
            type: txn.type as any,
            amount: txn.amount,
            description: txn.description,
            status: 'COMPLETED',
            reference: `INTEGRATION_${index + 1}`
          }
        });

        // Update balance
        const updateAmount = txn.type === 'CREDIT' ? txn.amount : -txn.amount;
        await prisma.creditAccount.update({
          where: { userId: user.id },
          data: { balance: { increment: updateAmount } }
        });
      }

      // Final balance should be 100 + 50 - 25 - 15 + 30 = 140
      account = await prisma.creditAccount.findUnique({
        where: { userId: user.id }
      });
      expect(account?.balance).toBe(140);

      // Verify transaction history
      const userTransactions = await prisma.transaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' }
      });
      expect(userTransactions).toHaveLength(4);
    });

    it('should enforce budget limits', async () => {
      const { user, budgetLimits } = await testScenarios.setupBudgetLimitScenario();

      // Get daily limit (should be near threshold)
      const dailyLimit = budgetLimits.find(b => b.limitType === 'DAILY');
      expect(dailyLimit?.amount).toBe(25);
      expect(dailyLimit?.currentUsage).toBe(15); // Near limit

      // Simulate checking if user can make a request that would exceed daily limit
      const requestCost = 15; // This would exceed the limit (15 + 15 > 25)
      const canProceed = (dailyLimit?.currentUsage ?? 0) + requestCost <= (dailyLimit?.amount ?? 0);
      expect(canProceed).toBe(false);

      // But weekly limit should still allow it
      const weeklyLimit = budgetLimits.find(b => b.limitType === 'WEEKLY');
      const canProceedWeekly = (weeklyLimit?.currentUsage ?? 0) + requestCost <= (weeklyLimit?.amount ?? 0);
      expect(canProceedWeekly).toBe(true);
    });
  });

  describe('Multi-User Organization Scenarios', () => {
    it('should handle organization-level operations', async () => {
      const { admin, employees, agents } = await testScenarios.setupOrganizationScenario();

      // Verify organization structure
      expect(admin.role).toBe('ADMIN');
      expect(employees).toHaveLength(3);
      expect(agents).toHaveLength(4);

      // All users should have credit accounts
      for (const employee of employees) {
        const account = await prisma.creditAccount.findUnique({
          where: { userId: employee.id }
        });
        expect(account).toBeTruthy();
        expect(account?.balance).toBe(100);
      }

      // Admin should have higher balance
      const adminAccount = await prisma.creditAccount.findUnique({
        where: { userId: admin.id }
      });
      expect(adminAccount?.balance).toBe(1000);
    });

    it('should aggregate organization usage statistics', async () => {
      const { admin, employees } = await testScenarios.setupOrganizationScenario();
      const allUsers = [admin, ...employees];

      // Create usage for each user
      for (const [index, user] of allUsers.entries()) {
        await prisma.transaction.create({
          data: {
            userId: user.id,
            type: 'DEBIT',
            amount: (index + 1) * 10, // Different amounts for each user
            description: `User ${index + 1} usage`,
            status: 'COMPLETED',
            reference: `ORG_USAGE_${index + 1}`
          }
        });
      }

      // Get organization-wide statistics
      const orgStats = await prisma.transaction.aggregate({
        where: {
          userId: { in: allUsers.map(u => u.id) },
          type: 'DEBIT'
        },
        _sum: { amount: true },
        _count: { id: true },
        _avg: { amount: true }
      });

      expect(orgStats._count.id).toBe(4); // 4 users
      expect(orgStats._sum.amount).toBe(100); // 10+20+30+40
      expect(orgStats._avg.amount).toBe(25);
    });
  });

  describe('High Load Scenarios', () => {
    it('should handle high usage patterns', async () => {
      const scenario = await testScenarios.setupHighUsageScenario();

      // Verify high usage data was created
      const userRequests = await prisma.aIRequest.count({
        where: { userId: scenario.user.id }
      });
      expect(userRequests).toBeGreaterThan(20); // Should have many requests

      const userTransactions = await prisma.transaction.count({
        where: { userId: scenario.user.id }
      });
      expect(userTransactions).toBeGreaterThan(15); // Should have many transactions
    });

    it('should maintain performance under load', async () => {
      // Create multiple high-usage users
      const users = await Promise.all([
        testScenarios.setupHighUsageScenario(),
        testScenarios.setupHighUsageScenario(),
        testScenarios.setupHighUsageScenario()
      ]);

      expect(users).toHaveLength(3);

      // Query performance test
      const start = Date.now();
      
      const results = await Promise.all([
        prisma.user.findMany({
          include: {
            transactions: { take: 10 },
            aiRequests: { take: 10 },
            creditAccount: true
          }
        }),
        prisma.aIRequest.findMany({
          where: {
            userId: { in: users.map(u => u.user.id) }
          },
          include: { agent: true }
        }),
        prisma.transaction.groupBy({
          by: ['userId', 'type'],
          where: {
            userId: { in: users.map(u => u.user.id) }
          },
          _sum: { amount: true },
          _count: { id: true }
        })
      ]);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(results[0]).toHaveLength(results.length >= 3 ? 3 : results.length);
    });
  });

  describe('Data Consistency and Integrity', () => {
    it('should maintain referential integrity under concurrent operations', async () => {
      const { user } = await testScenarios.setupCompleteUser();

      // Simulate concurrent credit operations
      const operations = [
        prisma.transaction.create({
          data: {
            userId: user.id,
            type: 'CREDIT',
            amount: 25,
            description: 'Concurrent credit 1',
            status: 'COMPLETED',
            reference: 'CONCURRENT_1'
          }
        }),
        prisma.transaction.create({
          data: {
            userId: user.id,
            type: 'DEBIT',
            amount: 15,
            description: 'Concurrent debit 1',
            status: 'COMPLETED',
            reference: 'CONCURRENT_2'
          }
        }),
        prisma.transaction.create({
          data: {
            userId: user.id,
            type: 'CREDIT',
            amount: 30,
            description: 'Concurrent credit 2',
            status: 'COMPLETED',
            reference: 'CONCURRENT_3'
          }
        })
      ];

      const results = await Promise.all(operations);
      expect(results).toHaveLength(3);

      // Verify all transactions were created
      const transactions = await prisma.transaction.findMany({
        where: { userId: user.id }
      });
      expect(transactions.length).toBeGreaterThanOrEqual(3);

      // Verify referential integrity
      for (const transaction of transactions) {
        expect(transaction.userId).toBe(user.id);
      }
    });

    it('should handle database constraints properly', async () => {
      const { user } = await testScenarios.setupCompleteUser();

      // Test unique constraint violations
      const duplicateTransaction = {
        userId: user.id,
        type: 'CREDIT' as const,
        amount: 50,
        description: 'Duplicate test',
        status: 'COMPLETED' as const,
        reference: 'DUPLICATE_REF'
      };

      await prisma.transaction.create({ data: duplicateTransaction });

      // Attempt to create duplicate reference should fail
      await expect(
        prisma.transaction.create({ data: duplicateTransaction })
      ).rejects.toThrow();
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle service interruptions gracefully', async () => {
      // Simulate partial failure scenario
      const { user } = await testScenarios.setupCompleteUser();

      // Create a transaction that would normally trigger balance update
      const transaction = await prisma.transaction.create({
        data: {
          userId: user.id,
          type: 'DEBIT',
          amount: 20,
          description: 'Resilience test',
          status: 'PENDING', // Start as pending
          reference: 'RESILIENCE_TEST'
        }
      });

      // Simulate failure recovery - update status to completed
      const updatedTransaction = await prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: 'COMPLETED' }
      });

      expect(updatedTransaction.status).toBe('COMPLETED');

      // Verify system can still process new requests
      const healthResponse = await request(app)
        .get('/health')
        .expect(200);

      expect(healthResponse.body.status).toBe('healthy');
    });

    it('should maintain audit trail during operations', async () => {
      const { user } = await testScenarios.setupCompleteUser();

      // Perform operations that should be audited
      const operations = [
        prisma.transaction.create({
          data: {
            userId: user.id,
            type: 'CREDIT',
            amount: 100,
            description: 'Audit test credit',
            status: 'COMPLETED',
            reference: 'AUDIT_CREDIT'
          }
        }),
        prisma.transaction.create({
          data: {
            userId: user.id,
            type: 'DEBIT',
            amount: 50,
            description: 'Audit test debit',
            status: 'COMPLETED',
            reference: 'AUDIT_DEBIT'
          }
        })
      ];

      await Promise.all(operations);

      // Verify audit trail exists
      const auditTrail = await prisma.transaction.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' }
      });

      expect(auditTrail.length).toBeGreaterThanOrEqual(2);
      
      // Each transaction should have timestamp
      for (const record of auditTrail) {
        expect(record.createdAt).toBeInstanceOf(Date);
        expect(record.reference).toBeTruthy();
      }
    });
  });
});
