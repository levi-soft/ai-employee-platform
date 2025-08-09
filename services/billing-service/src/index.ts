
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '@ai-platform/shared-utils';

// Import services and routes
import CreditService from './services/credit.service';
import StripeIntegration from './integrations/stripe.integration';
import InvoiceService from './services/invoice.service';
import BudgetService from './services/budget.service';
import AnalyticsService from './services/analytics.service';

const logger = createLogger('billing-service');
const app = express();
const prisma = new PrismaClient();

// Initialize services
const stripeIntegration = new StripeIntegration({
  secretKey: process.env.STRIPE_SECRET_KEY || 'sk_test_mock_key',
  publicKey: process.env.STRIPE_PUBLIC_KEY || 'pk_test_mock_key',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock_secret',
});

const creditService = new CreditService(prisma);
const invoiceService = new InvoiceService(prisma, stripeIntegration);
const budgetService = new BudgetService(prisma);
const analyticsService = new AnalyticsService(prisma);

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use(limiter);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'billing-service',
      version: '1.0.0',
      checks: {
        database: 'connected',
        stripe: 'configured',
      },
    });
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'billing-service',
      error: error.message,
    });
  }
});

// Credit Management Routes
app.get('/api/billing/credits/balance/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const balance = await creditService.getCreditBalance(userId);
    res.json(balance);
  } catch (error) {
    logger.error('Failed to get credit balance', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/billing/credits/add', async (req, res) => {
  try {
    const transaction = req.body;
    const balance = await creditService.addCredits(transaction);
    res.json(balance);
  } catch (error) {
    logger.error('Failed to add credits', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/billing/credits/deduct', async (req, res) => {
  try {
    const transaction = req.body;
    const balance = await creditService.deductCredits(transaction);
    res.json(balance);
  } catch (error) {
    logger.error('Failed to deduct credits', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/billing/credits/refund', async (req, res) => {
  try {
    const transaction = req.body;
    const balance = await creditService.refundCredits(transaction);
    res.json(balance);
  } catch (error) {
    logger.error('Failed to refund credits', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/billing/credits/transactions/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const options = {
      limit: parseInt(req.query.limit as string) || 50,
      offset: parseInt(req.query.offset as string) || 0,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      type: req.query.type as any,
    };
    const history = await creditService.getTransactionHistory(userId, options);
    res.json(history);
  } catch (error) {
    logger.error('Failed to get transaction history', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// Invoice Management Routes
app.post('/api/billing/invoices/generate', async (req, res) => {
  try {
    const invoiceData = req.body;
    const invoice = await invoiceService.generateInvoice(invoiceData);
    res.json(invoice);
  } catch (error) {
    logger.error('Failed to generate invoice', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/billing/invoices/:invoiceId/send', async (req, res) => {
  try {
    const invoiceId = req.params.invoiceId;
    const invoice = await invoiceService.sendInvoice(invoiceId);
    res.json(invoice);
  } catch (error) {
    logger.error('Failed to send invoice', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/billing/invoices/:invoiceId', async (req, res) => {
  try {
    const invoiceId = req.params.invoiceId;
    const invoice = await invoiceService.getInvoice(invoiceId);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json(invoice);
  } catch (error) {
    logger.error('Failed to get invoice', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/billing/invoices/user/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const options = {
      limit: parseInt(req.query.limit as string) || 50,
      offset: parseInt(req.query.offset as string) || 0,
      status: req.query.status as any,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    };
    const result = await invoiceService.getUserInvoices(userId, options);
    res.json(result);
  } catch (error) {
    logger.error('Failed to get user invoices', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// Budget Management Routes
app.post('/api/billing/budgets/set', async (req, res) => {
  try {
    const budgetData = req.body;
    const budget = await budgetService.setBudgetLimit(budgetData);
    res.json(budget);
  } catch (error) {
    logger.error('Failed to set budget limit', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/billing/budgets/user/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const budgets = await budgetService.getBudgetLimits(userId);
    res.json(budgets);
  } catch (error) {
    logger.error('Failed to get budget limits', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/billing/budgets/usage/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const usage = await budgetService.getBudgetUsage(userId);
    res.json(usage);
  } catch (error) {
    logger.error('Failed to get budget usage', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/billing/budgets/check', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const result = await budgetService.checkBudgetLimits(userId, amount);
    res.json(result);
  } catch (error) {
    logger.error('Failed to check budget limits', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/billing/budgets/alerts/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const options = {
      acknowledged: req.query.acknowledged === 'true',
      limit: parseInt(req.query.limit as string) || 50,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    };
    const alerts = await budgetService.getBudgetAlerts(userId, options);
    res.json(alerts);
  } catch (error) {
    logger.error('Failed to get budget alerts', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// Analytics Routes
app.get('/api/billing/analytics/usage', async (req, res) => {
  try {
    const options = {
      userId: req.query.userId ? parseInt(req.query.userId as string) : undefined,
      timeframe: (req.query.timeframe as any) || 'month',
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    };
    const analytics = await analyticsService.getUsageAnalytics(options);
    res.json(analytics);
  } catch (error) {
    logger.error('Failed to get usage analytics', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/billing/analytics/revenue', async (req, res) => {
  try {
    const options = {
      timeframe: (req.query.timeframe as any) || 'month',
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
    };
    const analytics = await analyticsService.getRevenueAnalytics(options);
    res.json(analytics);
  } catch (error) {
    logger.error('Failed to get revenue analytics', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/billing/analytics/forecast/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const options = {
      forecastPeriod: (req.query.forecastPeriod as any) || 'month',
      basedOnDays: req.query.basedOnDays ? parseInt(req.query.basedOnDays as string) : undefined,
    };
    const forecast = await analyticsService.getBillingForecast(userId, options);
    res.json(forecast);
  } catch (error) {
    logger.error('Failed to get billing forecast', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/billing/analytics/insights/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const insights = await analyticsService.getCostOptimizationInsights(userId);
    res.json(insights);
  } catch (error) {
    logger.error('Failed to get cost optimization insights', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// Stripe Webhooks
app.post('/api/billing/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'] as string;
    const result = await stripeIntegration.handleWebhook(req.body, signature);
    res.json(result);
  } catch (error) {
    logger.error('Failed to handle Stripe webhook', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// Payment Routes
app.post('/api/billing/payments/intent', async (req, res) => {
  try {
    const paymentData = req.body;
    const paymentIntent = await stripeIntegration.createPaymentIntent(paymentData);
    res.json(paymentIntent);
  } catch (error) {
    logger.error('Failed to create payment intent', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/billing/customers', async (req, res) => {
  try {
    const customerData = req.body;
    const customer = await stripeIntegration.createCustomer(customerData);
    res.json(customer);
  } catch (error) {
    logger.error('Failed to create customer', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

// Error handling middleware
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
  });

  res.status(500).json({
    error: 'Internal server error',
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    timestamp: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3005;

async function startServer() {
  try {
    // Connect to database
    await prisma.$connect();
    logger.info('Connected to database');

    // Start server
    app.listen(PORT, () => {
      logger.info(`Billing service started on port ${PORT}`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        version: '1.0.0',
      });
    });
  } catch (error) {
    logger.error('Failed to start billing service', { error: error.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

startServer();

export default app;
