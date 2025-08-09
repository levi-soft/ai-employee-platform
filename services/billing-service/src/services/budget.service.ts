
import { createLogger } from '@ai-platform/shared-utils';
import { PrismaClient } from '@prisma/client';

const logger = createLogger('budget-service');

export interface BudgetLimit {
  id: string;
  userId: number;
  type: 'daily' | 'weekly' | 'monthly';
  amount: number;
  currentSpent: number;
  resetDate: Date;
  isActive: boolean;
  alertThresholds: number[]; // Percentages (e.g., [50, 75, 90])
  notifications: {
    email: boolean;
    push: boolean;
  };
  metadata?: Record<string, any>;
}

export interface BudgetAlert {
  id: string;
  userId: number;
  budgetLimitId: string;
  threshold: number;
  currentSpent: number;
  budgetAmount: number;
  alertType: 'approaching' | 'exceeded' | 'reset';
  triggeredAt: Date;
  acknowledged: boolean;
}

export interface BudgetUsage {
  userId: number;
  daily: {
    spent: number;
    limit?: number;
    remaining?: number;
    percentage?: number;
  };
  weekly: {
    spent: number;
    limit?: number;
    remaining?: number;
    percentage?: number;
  };
  monthly: {
    spent: number;
    limit?: number;
    remaining?: number;
    percentage?: number;
  };
}

export class BudgetService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create or update a budget limit
   */
  async setBudgetLimit(data: {
    userId: number;
    type: BudgetLimit['type'];
    amount: number;
    alertThresholds?: number[];
    notifications?: { email: boolean; push: boolean };
  }): Promise<BudgetLimit> {
    try {
      logger.info('Setting budget limit', {
        userId: data.userId,
        type: data.type,
        amount: data.amount,
      });

      const resetDate = this.calculateResetDate(data.type);

      // Check if budget limit already exists
      const existingLimit = await this.prisma.budgetLimit.findFirst({
        where: {
          userId: data.userId,
          type: data.type.toUpperCase(),
        },
      });

      let budgetLimit;

      if (existingLimit) {
        // Update existing limit
        budgetLimit = await this.prisma.budgetLimit.update({
          where: { id: existingLimit.id },
          data: {
            amount: data.amount,
            resetDate,
            alertThresholds: data.alertThresholds || [50, 75, 90],
            notifications: data.notifications || { email: true, push: true },
            isActive: true,
          },
        });
      } else {
        // Create new limit
        budgetLimit = await this.prisma.budgetLimit.create({
          data: {
            userId: data.userId,
            type: data.type.toUpperCase(),
            amount: data.amount,
            currentSpent: 0,
            resetDate,
            isActive: true,
            alertThresholds: data.alertThresholds || [50, 75, 90],
            notifications: data.notifications || { email: true, push: true },
          },
        });
      }

      logger.info('Budget limit set successfully', {
        budgetLimitId: budgetLimit.id,
        userId: data.userId,
        type: data.type,
        amount: data.amount,
      });

      return this.mapDatabaseBudgetToLimit(budgetLimit);
    } catch (error) {
      logger.error('Failed to set budget limit', {
        userId: data.userId,
        type: data.type,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get user's budget limits
   */
  async getBudgetLimits(userId: number): Promise<BudgetLimit[]> {
    try {
      const budgetLimits = await this.prisma.budgetLimit.findMany({
        where: { userId, isActive: true },
        orderBy: { type: 'asc' },
      });

      return budgetLimits.map(this.mapDatabaseBudgetToLimit.bind(this));
    } catch (error) {
      logger.error('Failed to get budget limits', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get budget usage summary
   */
  async getBudgetUsage(userId: number): Promise<BudgetUsage> {
    try {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(startOfDay);
      startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Get spending for each period
      const [dailySpent, weeklySpent, monthlySpent, budgetLimits] = await Promise.all([
        this.getSpentAmount(userId, startOfDay, now),
        this.getSpentAmount(userId, startOfWeek, now),
        this.getSpentAmount(userId, startOfMonth, now),
        this.getBudgetLimits(userId),
      ]);

      const budgetMap = new Map(budgetLimits.map(b => [b.type, b]));

      const usage: BudgetUsage = {
        userId,
        daily: {
          spent: dailySpent,
          limit: budgetMap.get('daily')?.amount,
          remaining: budgetMap.get('daily') ? Math.max(0, budgetMap.get('daily')!.amount - dailySpent) : undefined,
          percentage: budgetMap.get('daily') ? (dailySpent / budgetMap.get('daily')!.amount) * 100 : undefined,
        },
        weekly: {
          spent: weeklySpent,
          limit: budgetMap.get('weekly')?.amount,
          remaining: budgetMap.get('weekly') ? Math.max(0, budgetMap.get('weekly')!.amount - weeklySpent) : undefined,
          percentage: budgetMap.get('weekly') ? (weeklySpent / budgetMap.get('weekly')!.amount) * 100 : undefined,
        },
        monthly: {
          spent: monthlySpent,
          limit: budgetMap.get('monthly')?.amount,
          remaining: budgetMap.get('monthly') ? Math.max(0, budgetMap.get('monthly')!.amount - monthlySpent) : undefined,
          percentage: budgetMap.get('monthly') ? (monthlySpent / budgetMap.get('monthly')!.amount) * 100 : undefined,
        },
      };

      logger.debug('Budget usage retrieved', {
        userId,
        dailySpent,
        weeklySpent,
        monthlySpent,
      });

      return usage;
    } catch (error) {
      logger.error('Failed to get budget usage', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Check if a transaction would exceed budget limits
   */
  async checkBudgetLimits(userId: number, amount: number): Promise<{
    canProceed: boolean;
    exceededLimits: Array<{
      type: BudgetLimit['type'];
      currentSpent: number;
      limit: number;
      wouldExceed: number;
    }>;
    warnings: Array<{
      type: BudgetLimit['type'];
      currentSpent: number;
      limit: number;
      percentage: number;
    }>;
  }> {
    try {
      const usage = await this.getBudgetUsage(userId);
      const budgetLimits = await this.getBudgetLimits(userId);

      const exceededLimits: any[] = [];
      const warnings: any[] = [];

      for (const limit of budgetLimits) {
        const currentSpent = this.getCurrentSpent(usage, limit.type);
        const newTotal = currentSpent + amount;
        const percentage = (newTotal / limit.amount) * 100;

        if (newTotal > limit.amount) {
          exceededLimits.push({
            type: limit.type,
            currentSpent,
            limit: limit.amount,
            wouldExceed: newTotal - limit.amount,
          });
        } else if (percentage >= 75) { // Warning at 75%
          warnings.push({
            type: limit.type,
            currentSpent,
            limit: limit.amount,
            percentage,
          });
        }
      }

      const canProceed = exceededLimits.length === 0;

      logger.debug('Budget limits checked', {
        userId,
        amount,
        canProceed,
        exceededCount: exceededLimits.length,
        warningsCount: warnings.length,
      });

      return {
        canProceed,
        exceededLimits,
        warnings,
      };
    } catch (error) {
      logger.error('Failed to check budget limits', {
        userId,
        amount,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Record spending and check for alerts
   */
  async recordSpending(userId: number, amount: number, description: string): Promise<BudgetAlert[]> {
    try {
      logger.info('Recording spending', {
        userId,
        amount,
        description,
      });

      const alerts: BudgetAlert[] = [];
      const budgetLimits = await this.getBudgetLimits(userId);

      for (const limit of budgetLimits) {
        // Update current spent amount
        const periodStart = this.getPeriodStartDate(limit.type);
        const currentSpent = await this.getSpentAmount(userId, periodStart, new Date());
        const newSpent = currentSpent + amount;

        await this.prisma.budgetLimit.update({
          where: { id: limit.id },
          data: { currentSpent: newSpent },
        });

        // Check for threshold alerts
        const percentage = (newSpent / limit.amount) * 100;

        for (const threshold of limit.alertThresholds) {
          const previousPercentage = (currentSpent / limit.amount) * 100;
          
          if (percentage >= threshold && previousPercentage < threshold) {
            // Create alert
            const alertType: BudgetAlert['alertType'] = 
              percentage >= 100 ? 'exceeded' : 'approaching';

            const alert = await this.createBudgetAlert({
              userId,
              budgetLimitId: limit.id,
              threshold,
              currentSpent: newSpent,
              budgetAmount: limit.amount,
              alertType,
            });

            alerts.push(alert);
          }
        }
      }

      if (alerts.length > 0) {
        logger.info('Budget alerts triggered', {
          userId,
          alertsCount: alerts.length,
        });
      }

      return alerts;
    } catch (error) {
      logger.error('Failed to record spending', {
        userId,
        amount,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get user's budget alerts
   */
  async getBudgetAlerts(
    userId: number,
    options: {
      acknowledged?: boolean;
      limit?: number;
      startDate?: Date;
      endDate?: Date;
    } = {}
  ): Promise<BudgetAlert[]> {
    try {
      const { acknowledged, limit = 50, startDate, endDate } = options;

      const where: any = { userId };

      if (acknowledged !== undefined) {
        where.acknowledged = acknowledged;
      }

      if (startDate || endDate) {
        where.triggeredAt = {};
        if (startDate) where.triggeredAt.gte = startDate;
        if (endDate) where.triggeredAt.lte = endDate;
      }

      const alerts = await this.prisma.budgetAlert.findMany({
        where,
        orderBy: { triggeredAt: 'desc' },
        take: limit,
        include: {
          budgetLimit: true,
        },
      });

      return alerts.map(this.mapDatabaseAlertToBudgetAlert.bind(this));
    } catch (error) {
      logger.error('Failed to get budget alerts', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Acknowledge budget alerts
   */
  async acknowledgeBudgetAlert(alertId: string): Promise<BudgetAlert> {
    try {
      const updatedAlert = await this.prisma.budgetAlert.update({
        where: { id: alertId },
        data: { acknowledged: true },
        include: { budgetLimit: true },
      });

      logger.info('Budget alert acknowledged', {
        alertId,
        userId: updatedAlert.userId,
      });

      return this.mapDatabaseAlertToBudgetAlert(updatedAlert);
    } catch (error) {
      logger.error('Failed to acknowledge budget alert', {
        alertId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Reset budget limits (called by scheduled job)
   */
  async resetBudgetLimits(): Promise<void> {
    try {
      const now = new Date();

      // Find budget limits that need to be reset
      const limitsToReset = await this.prisma.budgetLimit.findMany({
        where: {
          isActive: true,
          resetDate: {
            lte: now,
          },
        },
      });

      for (const limit of limitsToReset) {
        const newResetDate = this.calculateResetDate(limit.type as BudgetLimit['type']);
        
        await this.prisma.budgetLimit.update({
          where: { id: limit.id },
          data: {
            currentSpent: 0,
            resetDate: newResetDate,
          },
        });

        // Create reset alert
        await this.createBudgetAlert({
          userId: limit.userId,
          budgetLimitId: limit.id,
          threshold: 0,
          currentSpent: 0,
          budgetAmount: limit.amount,
          alertType: 'reset',
        });

        logger.info('Budget limit reset', {
          budgetLimitId: limit.id,
          userId: limit.userId,
          type: limit.type,
          newResetDate,
        });
      }

      logger.info('Budget limits reset completed', {
        resetCount: limitsToReset.length,
      });
    } catch (error) {
      logger.error('Failed to reset budget limits', {
        error: error.message,
      });
      throw error;
    }
  }

  private async getSpentAmount(userId: number, startDate: Date, endDate: Date): Promise<number> {
    const result = await this.prisma.transaction.aggregate({
      where: {
        creditAccount: { userId },
        type: 'DEDUCT',
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      _sum: { amount: true },
    });

    return Math.abs(result._sum.amount || 0);
  }

  private getCurrentSpent(usage: BudgetUsage, type: BudgetLimit['type']): number {
    switch (type) {
      case 'daily':
        return usage.daily.spent;
      case 'weekly':
        return usage.weekly.spent;
      case 'monthly':
        return usage.monthly.spent;
      default:
        return 0;
    }
  }

  private calculateResetDate(type: BudgetLimit['type']): Date {
    const now = new Date();
    
    switch (type) {
      case 'daily':
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow;
      case 'weekly':
        const nextWeek = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + (7 - nextWeek.getDay()));
        nextWeek.setHours(0, 0, 0, 0);
        return nextWeek;
      case 'monthly':
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return nextMonth;
      default:
        return new Date();
    }
  }

  private getPeriodStartDate(type: BudgetLimit['type']): Date {
    const now = new Date();
    
    switch (type) {
      case 'daily':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case 'weekly':
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        return startOfWeek;
      case 'monthly':
        return new Date(now.getFullYear(), now.getMonth(), 1);
      default:
        return now;
    }
  }

  private async createBudgetAlert(data: {
    userId: number;
    budgetLimitId: string;
    threshold: number;
    currentSpent: number;
    budgetAmount: number;
    alertType: BudgetAlert['alertType'];
  }): Promise<BudgetAlert> {
    const alert = await this.prisma.budgetAlert.create({
      data: {
        userId: data.userId,
        budgetLimitId: data.budgetLimitId,
        threshold: data.threshold,
        currentSpent: data.currentSpent,
        budgetAmount: data.budgetAmount,
        alertType: data.alertType.toUpperCase(),
        triggeredAt: new Date(),
        acknowledged: false,
      },
      include: {
        budgetLimit: true,
      },
    });

    return this.mapDatabaseAlertToBudgetAlert(alert);
  }

  private mapDatabaseBudgetToLimit(budget: any): BudgetLimit {
    return {
      id: budget.id,
      userId: budget.userId,
      type: budget.type.toLowerCase() as BudgetLimit['type'],
      amount: budget.amount,
      currentSpent: budget.currentSpent,
      resetDate: budget.resetDate,
      isActive: budget.isActive,
      alertThresholds: budget.alertThresholds as number[],
      notifications: budget.notifications as { email: boolean; push: boolean },
      metadata: budget.metadata as Record<string, any>,
    };
  }

  private mapDatabaseAlertToBudgetAlert(alert: any): BudgetAlert {
    return {
      id: alert.id,
      userId: alert.userId,
      budgetLimitId: alert.budgetLimitId,
      threshold: alert.threshold,
      currentSpent: alert.currentSpent,
      budgetAmount: alert.budgetAmount,
      alertType: alert.alertType.toLowerCase() as BudgetAlert['alertType'],
      triggeredAt: alert.triggeredAt,
      acknowledged: alert.acknowledged,
    };
  }
}

export default BudgetService;
