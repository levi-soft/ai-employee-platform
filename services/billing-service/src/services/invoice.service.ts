
import { createLogger } from '@ai-platform/shared-utils';
import { PrismaClient } from '@prisma/client';
import StripeIntegration from '../integrations/stripe.integration';

const logger = createLogger('invoice-service');

export interface InvoiceData {
  userId: number;
  amount: number;
  description: string;
  dueDate?: Date;
  items: InvoiceItem[];
  metadata?: Record<string, any>;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface GeneratedInvoice {
  id: string;
  userId: number;
  invoiceNumber: string;
  amount: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  issuedDate: Date;
  dueDate: Date;
  paidDate?: Date;
  items: InvoiceItem[];
  stripeInvoiceId?: string;
  downloadUrl?: string;
  metadata: Record<string, any>;
}

export class InvoiceService {
  private prisma: PrismaClient;
  private stripe: StripeIntegration;

  constructor(prisma: PrismaClient, stripe: StripeIntegration) {
    this.prisma = prisma;
    this.stripe = stripe;
  }

  /**
   * Generate a new invoice
   */
  async generateInvoice(invoiceData: InvoiceData): Promise<GeneratedInvoice> {
    try {
      const invoiceNumber = await this.generateInvoiceNumber();
      
      logger.info('Generating invoice', {
        userId: invoiceData.userId,
        amount: invoiceData.amount,
        invoiceNumber,
      });

      // Create invoice in database
      const invoice = await this.prisma.$transaction(async (tx) => {
        // Create invoice record
        const newInvoice = await tx.invoice.create({
          data: {
            userId: invoiceData.userId,
            invoiceNumber,
            amount: invoiceData.amount,
            currency: 'USD',
            status: 'DRAFT',
            issuedDate: new Date(),
            dueDate: invoiceData.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
            items: invoiceData.items,
            metadata: invoiceData.metadata || {},
          },
        });

        return newInvoice;
      });

      const generatedInvoice: GeneratedInvoice = {
        id: invoice.id,
        userId: invoice.userId,
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amount,
        currency: invoice.currency,
        status: this.mapInvoiceStatus(invoice.status),
        issuedDate: invoice.issuedDate,
        dueDate: invoice.dueDate,
        paidDate: invoice.paidDate || undefined,
        items: invoice.items as InvoiceItem[],
        stripeInvoiceId: invoice.stripeInvoiceId || undefined,
        metadata: invoice.metadata as Record<string, any>,
      };

      logger.info('Invoice generated successfully', {
        invoiceId: invoice.id,
        invoiceNumber,
        userId: invoiceData.userId,
      });

      return generatedInvoice;
    } catch (error) {
      logger.error('Failed to generate invoice', {
        userId: invoiceData.userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Send invoice to customer via Stripe
   */
  async sendInvoice(invoiceId: string): Promise<GeneratedInvoice> {
    try {
      logger.info('Sending invoice', { invoiceId });

      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { user: true },
      });

      if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      if (invoice.status === 'SENT' || invoice.status === 'PAID') {
        throw new Error(`Invoice ${invoiceId} is already ${invoice.status}`);
      }

      // Get user's Stripe customer ID
      let customerId = invoice.user.stripeCustomerId;
      
      if (!customerId) {
        // Create Stripe customer if doesn't exist
        const customer = await this.stripe.createCustomer({
          email: invoice.user.email,
          name: `${invoice.user.firstName} ${invoice.user.lastName}`.trim(),
          userId: invoice.user.id,
          metadata: {
            platform: 'ai-employee-platform',
          },
        });
        
        customerId = customer.id;
        
        // Update user with Stripe customer ID
        await this.prisma.user.update({
          where: { id: invoice.user.id },
          data: { stripeCustomerId: customerId },
        });
      }

      // Create and send Stripe invoice
      const stripeInvoice = await this.stripe.createInvoice({
        customerId,
        amount: Math.round(invoice.amount * 100), // Convert to cents
        description: `AI Employee Platform Invoice #${invoice.invoiceNumber}`,
        userId: invoice.user.id,
        metadata: {
          platformInvoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
        },
      });

      // Update invoice with Stripe details
      const updatedInvoice = await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'SENT',
          stripeInvoiceId: stripeInvoice.id,
          sentDate: new Date(),
        },
        include: { user: true },
      });

      logger.info('Invoice sent successfully', {
        invoiceId,
        stripeInvoiceId: stripeInvoice.id,
        userId: invoice.user.id,
      });

      return this.mapDatabaseInvoiceToGenerated(updatedInvoice);
    } catch (error) {
      logger.error('Failed to send invoice', {
        invoiceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Mark invoice as paid
   */
  async markInvoicePaid(invoiceId: string, paidDate?: Date): Promise<GeneratedInvoice> {
    try {
      logger.info('Marking invoice as paid', { invoiceId });

      const updatedInvoice = await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'PAID',
          paidDate: paidDate || new Date(),
        },
        include: { user: true },
      });

      logger.info('Invoice marked as paid', {
        invoiceId,
        userId: updatedInvoice.user.id,
        paidDate: updatedInvoice.paidDate,
      });

      return this.mapDatabaseInvoiceToGenerated(updatedInvoice);
    } catch (error) {
      logger.error('Failed to mark invoice as paid', {
        invoiceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get invoice by ID
   */
  async getInvoice(invoiceId: string): Promise<GeneratedInvoice | null> {
    try {
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { user: true },
      });

      return invoice ? this.mapDatabaseInvoiceToGenerated(invoice) : null;
    } catch (error) {
      logger.error('Failed to get invoice', {
        invoiceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get user's invoices
   */
  async getUserInvoices(
    userId: number,
    options: {
      limit?: number;
      offset?: number;
      status?: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
      startDate?: Date;
      endDate?: Date;
    } = {}
  ): Promise<{
    invoices: GeneratedInvoice[];
    total: number;
  }> {
    try {
      const { limit = 50, offset = 0, status, startDate, endDate } = options;

      const where: any = { userId };

      if (status) {
        where.status = status.toUpperCase();
      }

      if (startDate || endDate) {
        where.issuedDate = {};
        if (startDate) where.issuedDate.gte = startDate;
        if (endDate) where.issuedDate.lte = endDate;
      }

      const [invoices, total] = await Promise.all([
        this.prisma.invoice.findMany({
          where,
          include: { user: true },
          orderBy: { issuedDate: 'desc' },
          take: limit,
          skip: offset,
        }),
        this.prisma.invoice.count({ where }),
      ]);

      const generatedInvoices = invoices.map(this.mapDatabaseInvoiceToGenerated.bind(this));

      logger.debug('User invoices retrieved', {
        userId,
        count: invoices.length,
        total,
      });

      return {
        invoices: generatedInvoices,
        total,
      };
    } catch (error) {
      logger.error('Failed to get user invoices', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Cancel an invoice
   */
  async cancelInvoice(invoiceId: string, reason?: string): Promise<GeneratedInvoice> {
    try {
      logger.info('Cancelling invoice', { invoiceId, reason });

      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
      });

      if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
      }

      if (invoice.status === 'PAID') {
        throw new Error(`Cannot cancel paid invoice ${invoiceId}`);
      }

      const updatedInvoice = await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'CANCELLED',
          metadata: {
            ...invoice.metadata,
            cancelledDate: new Date().toISOString(),
            cancelReason: reason,
          },
        },
        include: { user: true },
      });

      logger.info('Invoice cancelled successfully', {
        invoiceId,
        reason,
      });

      return this.mapDatabaseInvoiceToGenerated(updatedInvoice);
    } catch (error) {
      logger.error('Failed to cancel invoice', {
        invoiceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get invoice statistics
   */
  async getInvoiceStatistics(
    userId?: number,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    totalInvoices: number;
    totalAmount: number;
    paidAmount: number;
    pendingAmount: number;
    overdueAmount: number;
    statusBreakdown: Record<string, number>;
  }> {
    try {
      const where: any = {};

      if (userId) {
        where.userId = userId;
      }

      if (startDate || endDate) {
        where.issuedDate = {};
        if (startDate) where.issuedDate.gte = startDate;
        if (endDate) where.issuedDate.lte = endDate;
      }

      const [invoices, stats] = await Promise.all([
        this.prisma.invoice.findMany({
          where,
          select: {
            amount: true,
            status: true,
            dueDate: true,
          },
        }),
        this.prisma.invoice.aggregate({
          where,
          _count: { id: true },
          _sum: { amount: true },
        }),
      ]);

      const now = new Date();
      const statusBreakdown: Record<string, number> = {};
      let paidAmount = 0;
      let pendingAmount = 0;
      let overdueAmount = 0;

      for (const invoice of invoices) {
        const status = invoice.status.toLowerCase();
        statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;

        if (invoice.status === 'PAID') {
          paidAmount += invoice.amount;
        } else if (invoice.status === 'SENT') {
          if (invoice.dueDate < now) {
            overdueAmount += invoice.amount;
          } else {
            pendingAmount += invoice.amount;
          }
        }
      }

      const statistics = {
        totalInvoices: stats._count.id || 0,
        totalAmount: stats._sum.amount || 0,
        paidAmount,
        pendingAmount,
        overdueAmount,
        statusBreakdown,
      };

      logger.debug('Invoice statistics calculated', {
        userId,
        statistics,
      });

      return statistics;
    } catch (error) {
      logger.error('Failed to get invoice statistics', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  private async generateInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    
    // Get the count of invoices for this month
    const count = await this.prisma.invoice.count({
      where: {
        invoiceNumber: {
          startsWith: `INV-${year}${month}`,
        },
      },
    });

    const sequence = String(count + 1).padStart(4, '0');
    return `INV-${year}${month}-${sequence}`;
  }

  private mapInvoiceStatus(dbStatus: string): GeneratedInvoice['status'] {
    const statusMap: Record<string, GeneratedInvoice['status']> = {
      'DRAFT': 'draft',
      'SENT': 'sent',
      'PAID': 'paid',
      'OVERDUE': 'overdue',
      'CANCELLED': 'cancelled',
    };

    return statusMap[dbStatus] || 'draft';
  }

  private mapDatabaseInvoiceToGenerated(invoice: any): GeneratedInvoice {
    return {
      id: invoice.id,
      userId: invoice.userId,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      currency: invoice.currency,
      status: this.mapInvoiceStatus(invoice.status),
      issuedDate: invoice.issuedDate,
      dueDate: invoice.dueDate,
      paidDate: invoice.paidDate || undefined,
      items: invoice.items as InvoiceItem[],
      stripeInvoiceId: invoice.stripeInvoiceId || undefined,
      downloadUrl: invoice.downloadUrl || undefined,
      metadata: invoice.metadata as Record<string, any>,
    };
  }
}

export default InvoiceService;
