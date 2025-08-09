
import { createLogger } from '@ai-platform/shared-utils';
import { PrismaClient } from '@prisma/client';

const logger = createLogger('credit-service');

export interface CreditTransaction {
  userId: number;
  amount: number;
  type: 'deduct' | 'add' | 'refund';
  description: string;
  metadata?: Record<string, any>;
  requestId?: string;
}

export interface CreditBalance {
  userId: number;
  balance: number;
  lastUpdated: Date;
  pendingDeductions: number;
  monthlyUsage: number;
  totalSpent: number;
}

export interface UsageRecord {
  userId: number;
  aiRequestId: string;
  agentId: string;
  tokensUsed: number;
  cost: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export class CreditService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get user's credit balance with detailed information
   */
  async getCreditBalance(userId: number): Promise<CreditBalance> {
    try {
      const creditAccount = await this.prisma.creditAccount.findUnique({
        where: { userId },
        include: {
          transactions: {
            where: {
              createdAt: {
                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
              },
            },
          },
        },
      });

      if (!creditAccount) {
        throw new Error(`Credit account not found for user ${userId}`);
      }

      // Calculate monthly usage from transactions
      const monthlyDeductions = creditAccount.transactions
        .filter(t => t.type === 'DEDUCT')
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      // Calculate total spent (all time deductions)
      const allDeductions = await this.prisma.transaction.aggregate({
        where: {
          creditAccountId: creditAccount.id,
          type: 'DEDUCT',
        },
        _sum: {
          amount: true,
        },
      });

      const balance: CreditBalance = {
        userId,
        balance: creditAccount.balance,
        lastUpdated: creditAccount.updatedAt,
        pendingDeductions: 0, // TODO: Implement pending transactions
        monthlyUsage: monthlyDeductions,
        totalSpent: Math.abs(allDeductions._sum.amount || 0),
      };

      logger.debug('Credit balance retrieved', {
        userId,
        balance: balance.balance,
        monthlyUsage: balance.monthlyUsage,
      });

      return balance;
    } catch (error) {
      logger.error('Failed to get credit balance', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Add credits to user's account
   */
  async addCredits(transaction: CreditTransaction): Promise<CreditBalance> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Get credit account
        const creditAccount = await tx.creditAccount.findUnique({
          where: { userId: transaction.userId },
        });

        if (!creditAccount) {
          throw new Error(`Credit account not found for user ${transaction.userId}`);
        }

        // Create transaction record
        await tx.transaction.create({
          data: {
            creditAccountId: creditAccount.id,
            amount: Math.abs(transaction.amount), // Ensure positive for add
            type: 'ADD',
            status: 'COMPLETED',
            description: transaction.description,
            metadata: transaction.metadata || {},
          },
        });

        // Update credit account balance
        const updatedAccount = await tx.creditAccount.update({
          where: { id: creditAccount.id },
          data: {
            balance: {
              increment: Math.abs(transaction.amount),
            },
          },
        });

        return updatedAccount;
      });

      logger.info('Credits added successfully', {
        userId: transaction.userId,
        amount: transaction.amount,
        newBalance: result.balance,
        description: transaction.description,
      });

      return this.getCreditBalance(transaction.userId);
    } catch (error) {
      logger.error('Failed to add credits', {
        userId: transaction.userId,
        amount: transaction.amount,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Deduct credits from user's account (for AI usage)
   */
  async deductCredits(transaction: CreditTransaction): Promise<CreditBalance> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Get credit account with lock
        const creditAccount = await tx.creditAccount.findUnique({
          where: { userId: transaction.userId },
        });

        if (!creditAccount) {
          throw new Error(`Credit account not found for user ${transaction.userId}`);
        }

        const deductionAmount = Math.abs(transaction.amount);

        // Check if user has sufficient balance
        if (creditAccount.balance < deductionAmount) {
          throw new Error(
            `Insufficient credits. Balance: ${creditAccount.balance}, Required: ${deductionAmount}`
          );
        }

        // Create transaction record
        await tx.transaction.create({
          data: {
            creditAccountId: creditAccount.id,
            amount: -deductionAmount, // Negative for deduction
            type: 'DEDUCT',
            status: 'COMPLETED',
            description: transaction.description,
            metadata: {
              ...transaction.metadata,
              requestId: transaction.requestId,
            },
          },
        });

        // Update credit account balance
        const updatedAccount = await tx.creditAccount.update({
          where: { id: creditAccount.id },
          data: {
            balance: {
              decrement: deductionAmount,
            },
          },
        });

        return updatedAccount;
      });

      logger.info('Credits deducted successfully', {
        userId: transaction.userId,
        amount: transaction.amount,
        newBalance: result.balance,
        description: transaction.description,
        requestId: transaction.requestId,
      });

      return this.getCreditBalance(transaction.userId);
    } catch (error) {
      logger.error('Failed to deduct credits', {
        userId: transaction.userId,
        amount: transaction.amount,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Process refund for a previous deduction
   */
  async refundCredits(transaction: CreditTransaction): Promise<CreditBalance> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Get credit account
        const creditAccount = await tx.creditAccount.findUnique({
          where: { userId: transaction.userId },
        });

        if (!creditAccount) {
          throw new Error(`Credit account not found for user ${transaction.userId}`);
        }

        // Create refund transaction record
        await tx.transaction.create({
          data: {
            creditAccountId: creditAccount.id,
            amount: Math.abs(transaction.amount), // Positive for refund
            type: 'REFUND',
            status: 'COMPLETED',
            description: transaction.description,
            metadata: {
              ...transaction.metadata,
              requestId: transaction.requestId,
              refundedAt: new Date().toISOString(),
            },
          },
        });

        // Update credit account balance
        const updatedAccount = await tx.creditAccount.update({
          where: { id: creditAccount.id },
          data: {
            balance: {
              increment: Math.abs(transaction.amount),
            },
          },
        });

        return updatedAccount;
      });

      logger.info('Credits refunded successfully', {
        userId: transaction.userId,
        amount: transaction.amount,
        newBalance: result.balance,
        description: transaction.description,
      });

      return this.getCreditBalance(transaction.userId);
    } catch (error) {
      logger.error('Failed to refund credits', {
        userId: transaction.userId,
        amount: transaction.amount,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Record AI usage for billing purposes
   */
  async recordUsage(usage: UsageRecord): Promise<void> {
    try {
      // First, find the credit account
      const creditAccount = await this.prisma.creditAccount.findUnique({
        where: { userId: usage.userId },
      });

      if (!creditAccount) {
        throw new Error(`Credit account not found for user ${usage.userId}`);
      }

      // Create AI request record
      await this.prisma.aIRequest.create({
        data: {
          userId: usage.userId,
          agentId: usage.agentId,
          tokensUsed: usage.tokensUsed,
          cost: usage.cost,
          metadata: usage.metadata || {},
        },
      });

      logger.info('Usage recorded successfully', {
        userId: usage.userId,
        aiRequestId: usage.aiRequestId,
        agentId: usage.agentId,
        tokensUsed: usage.tokensUsed,
        cost: usage.cost,
      });
    } catch (error) {
      logger.error('Failed to record usage', {
        userId: usage.userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get user's transaction history
   */
  async getTransactionHistory(
    userId: number,
    options: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
      type?: 'ADD' | 'DEDUCT' | 'REFUND';
    } = {}
  ): Promise<{
    transactions: any[];
    total: number;
    balance: number;
  }> {
    try {
      const { limit = 50, offset = 0, startDate, endDate, type } = options;

      const creditAccount = await this.prisma.creditAccount.findUnique({
        where: { userId },
      });

      if (!creditAccount) {
        throw new Error(`Credit account not found for user ${userId}`);
      }

      const where: any = {
        creditAccountId: creditAccount.id,
      };

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }

      if (type) {
        where.type = type;
      }

      const [transactions, total] = await Promise.all([
        this.prisma.transaction.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        this.prisma.transaction.count({ where }),
      ]);

      logger.debug('Transaction history retrieved', {
        userId,
        count: transactions.length,
        total,
      });

      return {
        transactions,
        total,
        balance: creditAccount.balance,
      };
    } catch (error) {
      logger.error('Failed to get transaction history', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get usage statistics for a user
   */
  async getUsageStats(
    userId: number,
    options: {
      startDate?: Date;
      endDate?: Date;
      groupBy?: 'day' | 'week' | 'month';
    } = {}
  ): Promise<{
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    dailyStats: Array<{
      date: string;
      requests: number;
      tokens: number;
      cost: number;
    }>;
  }> {
    try {
      const { startDate, endDate, groupBy = 'day' } = options;

      const where: any = { userId };

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = startDate;
        if (endDate) where.createdAt.lte = endDate;
      }

      // Get total stats
      const [totalStats, aiRequests] = await Promise.all([
        this.prisma.aIRequest.aggregate({
          where,
          _count: { id: true },
          _sum: { tokensUsed: true, cost: true },
        }),
        this.prisma.aIRequest.findMany({
          where,
          select: {
            createdAt: true,
            tokensUsed: true,
            cost: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

      // Group data by time period
      const dailyStats = this.groupUsageByPeriod(aiRequests, groupBy);

      const stats = {
        totalRequests: totalStats._count.id || 0,
        totalTokens: totalStats._sum.tokensUsed || 0,
        totalCost: totalStats._sum.cost || 0,
        dailyStats,
      };

      logger.debug('Usage statistics retrieved', {
        userId,
        totalRequests: stats.totalRequests,
        totalCost: stats.totalCost,
      });

      return stats;
    } catch (error) {
      logger.error('Failed to get usage statistics', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Check if user has sufficient credits for a request
   */
  async checkSufficientCredits(userId: number, requiredAmount: number): Promise<boolean> {
    try {
      const balance = await this.getCreditBalance(userId);
      return balance.balance >= requiredAmount;
    } catch (error) {
      logger.error('Failed to check credit sufficiency', {
        userId,
        requiredAmount,
        error: error.message,
      });
      return false;
    }
  }

  private groupUsageByPeriod(
    requests: Array<{ createdAt: Date; tokensUsed: number; cost: number }>,
    groupBy: 'day' | 'week' | 'month'
  ) {
    const groups = new Map<string, { requests: number; tokens: number; cost: number }>();

    for (const request of requests) {
      let key: string;
      
      switch (groupBy) {
        case 'day':
          key = request.createdAt.toISOString().split('T')[0];
          break;
        case 'week':
          const weekStart = new Date(request.createdAt);
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          key = weekStart.toISOString().split('T')[0];
          break;
        case 'month':
          key = request.createdAt.toISOString().substring(0, 7); // YYYY-MM
          break;
      }

      const existing = groups.get(key) || { requests: 0, tokens: 0, cost: 0 };
      existing.requests++;
      existing.tokens += request.tokensUsed;
      existing.cost += request.cost;
      groups.set(key, existing);
    }

    return Array.from(groups.entries()).map(([date, stats]) => ({
      date,
      ...stats,
    }));
  }
}

export default CreditService;
