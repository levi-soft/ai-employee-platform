
// Billing and credits API client
import { BaseAPIClient } from './base-client';
import {
  CreditAccount,
  Transaction,
  BudgetLimit,
  TransactionListParams,
  PaginatedResponse,
} from '@ai-platform/shared-types';
import { API_ROUTES } from '@ai-platform/shared-types';

export class BillingClient extends BaseAPIClient {
  // Credit account management
  async getCreditAccount(userId?: string): Promise<CreditAccount> {
    const response = await this.get<CreditAccount>(
      userId ? `${API_ROUTES.BILLING.ACCOUNTS}/${userId}` : API_ROUTES.BILLING.ACCOUNTS
    );
    return response.data!;
  }

  async addCredits(
    amount: number,
    paymentMethodId?: string,
    description?: string
  ): Promise<Transaction> {
    const response = await this.post<Transaction>(
      `${API_ROUTES.BILLING.ACCOUNTS}/add-credits`,
      { amount, paymentMethodId, description }
    );
    return response.data!;
  }

  async getCreditBalance(userId?: string): Promise<{ balance: number; currency: string }> {
    const response = await this.get<{ balance: number; currency: string }>(
      userId 
        ? `${API_ROUTES.BILLING.ACCOUNTS}/${userId}/balance` 
        : `${API_ROUTES.BILLING.ACCOUNTS}/balance`
    );
    return response.data!;
  }

  // Transaction management
  async getTransactions(params?: TransactionListParams): Promise<PaginatedResponse<Transaction>> {
    return this.getPaginated<Transaction>(API_ROUTES.BILLING.TRANSACTIONS, params);
  }

  async getTransaction(id: string): Promise<Transaction> {
    const response = await this.get<Transaction>(
      `${API_ROUTES.BILLING.TRANSACTIONS}/${id}`
    );
    return response.data!;
  }

  async refundTransaction(id: string, reason?: string): Promise<Transaction> {
    const response = await this.post<Transaction>(
      `${API_ROUTES.BILLING.TRANSACTIONS}/${id}/refund`,
      { reason }
    );
    return response.data!;
  }

  // Budget limits
  async getBudgetLimits(userId?: string): Promise<BudgetLimit[]> {
    const response = await this.get<BudgetLimit[]>(
      userId 
        ? `${API_ROUTES.BILLING.BUDGET_LIMITS}?userId=${userId}`
        : API_ROUTES.BILLING.BUDGET_LIMITS
    );
    return response.data!;
  }

  async createBudgetLimit(budgetData: {
    limitAmount: number;
    period: 'daily' | 'weekly' | 'monthly' | 'yearly';
    alertThreshold: number;
    userId?: string;
  }): Promise<BudgetLimit> {
    const response = await this.post<BudgetLimit>(
      API_ROUTES.BILLING.BUDGET_LIMITS,
      budgetData
    );
    return response.data!;
  }

  async updateBudgetLimit(id: string, updates: Partial<BudgetLimit>): Promise<BudgetLimit> {
    const response = await this.patch<BudgetLimit>(
      `${API_ROUTES.BILLING.BUDGET_LIMITS}/${id}`,
      updates
    );
    return response.data!;
  }

  async deleteBudgetLimit(id: string): Promise<void> {
    await this.delete(`${API_ROUTES.BILLING.BUDGET_LIMITS}/${id}`);
  }

  // Analytics and reporting
  async getBillingAnalytics(params?: {
    dateFrom?: Date;
    dateTo?: Date;
    userId?: string;
  }): Promise<{
    totalSpent: number;
    totalTransactions: number;
    averageTransactionAmount: number;
    spendingTrend: Array<{
      date: string;
      amount: number;
    }>;
    topSpenders: Array<{
      userId: string;
      userName: string;
      totalSpent: number;
    }>;
    spendingByCategory: Array<{
      category: string;
      amount: number;
      percentage: number;
    }>;
  }> {
    const queryParams = {
      ...(params?.dateFrom && { dateFrom: params.dateFrom.toISOString() }),
      ...(params?.dateTo && { dateTo: params.dateTo.toISOString() }),
      ...(params?.userId && { userId: params.userId }),
    };

    const response = await this.get<{
      totalSpent: number;
      totalTransactions: number;
      averageTransactionAmount: number;
      spendingTrend: Array<{
        date: string;
        amount: number;
      }>;
      topSpenders: Array<{
        userId: string;
        userName: string;
        totalSpent: number;
      }>;
      spendingByCategory: Array<{
        category: string;
        amount: number;
        percentage: number;
      }>;
    }>(API_ROUTES.BILLING.ANALYTICS, { params: queryParams });
    
    return response.data!;
  }

  async getUsageCost(
    aiRequestId: string
  ): Promise<{
    baseTokenCost: number;
    additionalFees: number;
    totalCost: number;
    breakdown: Array<{
      description: string;
      amount: number;
    }>;
  }> {
    const response = await this.get<{
      baseTokenCost: number;
      additionalFees: number;
      totalCost: number;
      breakdown: Array<{
        description: string;
        amount: number;
      }>;
    }>(`/billing/usage-cost/${aiRequestId}`);
    
    return response.data!;
  }

  // Invoice management
  async getInvoices(params?: {
    userId?: string;
    status?: 'pending' | 'paid' | 'overdue' | 'cancelled';
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<Array<{
    id: string;
    userId: string;
    amount: number;
    status: string;
    dueDate: Date;
    createdAt: Date;
    items: Array<{
      description: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }>;
  }>> {
    const queryParams = {
      ...(params?.userId && { userId: params.userId }),
      ...(params?.status && { status: params.status }),
      ...(params?.dateFrom && { dateFrom: params.dateFrom.toISOString() }),
      ...(params?.dateTo && { dateTo: params.dateTo.toISOString() }),
    };

    const response = await this.get<Array<{
      id: string;
      userId: string;
      amount: number;
      status: string;
      dueDate: string;
      createdAt: string;
      items: Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        total: number;
      }>;
    }>>(API_ROUTES.BILLING.INVOICES, { params: queryParams });
    
    return response.data!.map(invoice => ({
      ...invoice,
      dueDate: new Date(invoice.dueDate),
      createdAt: new Date(invoice.createdAt),
    }));
  }

  async generateInvoice(userId: string, periodStart: Date, periodEnd: Date): Promise<{
    id: string;
    downloadUrl: string;
  }> {
    const response = await this.post<{
      id: string;
      downloadUrl: string;
    }>(`${API_ROUTES.BILLING.INVOICES}/generate`, {
      userId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    });
    
    return response.data!;
  }

  // Payment methods
  async getPaymentMethods(): Promise<Array<{
    id: string;
    type: 'card' | 'bank_account';
    last4: string;
    brand?: string;
    expiryMonth?: number;
    expiryYear?: number;
    isDefault: boolean;
  }>> {
    const response = await this.get<Array<{
      id: string;
      type: 'card' | 'bank_account';
      last4: string;
      brand?: string;
      expiryMonth?: number;
      expiryYear?: number;
      isDefault: boolean;
    }>>('/billing/payment-methods');
    
    return response.data!;
  }

  async addPaymentMethod(paymentMethodData: {
    type: 'card' | 'bank_account';
    token: string;
    setAsDefault?: boolean;
  }): Promise<{
    id: string;
    setupIntent?: string;
  }> {
    const response = await this.post<{
      id: string;
      setupIntent?: string;
    }>('/billing/payment-methods', paymentMethodData);
    
    return response.data!;
  }

  async deletePaymentMethod(id: string): Promise<void> {
    await this.delete(`/billing/payment-methods/${id}`);
  }

  async setDefaultPaymentMethod(id: string): Promise<void> {
    await this.post(`/billing/payment-methods/${id}/set-default`);
  }
}
