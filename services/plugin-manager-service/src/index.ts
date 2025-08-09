
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import routes from './routes';
import { errorHandler } from './utils/errors';
import { prisma } from './config/database';
import { requestLoggingMiddleware, errorLoggingMiddleware } from './middleware/logging.middleware';
import { healthChecker } from './health';
import { createServiceLogger, metrics } from '@ai-platform/shared-utils';

// Security middleware imports
import { 
  pluginSecurityMiddleware, 
  pluginRateLimit,
  sandboxSecurityMiddleware
} from './middleware/security.middleware';

// Load environment variables
dotenv.config();

// Initialize logger
const logger = createServiceLogger('plugin-manager-service');

const app = express();
const port = process.env.PORT || 9006;

// Request logging (must be first)
app.use(requestLoggingMiddleware);

// Security middleware
app.use(pluginSecurityMiddleware);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-eval'"], // Needed for plugin execution
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URLS?.split(',') || ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Plugin-Version', 'X-Plugin-Context']
}));

// Body parsing middleware
app.use(express.json({ limit: '50mb' })); // Large limit for plugin uploads
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Morgan logging
app.use(morgan('combined', {
  stream: { write: (message: string) => logger.http(message.trim()) }
}));

// Rate limiting for plugin operations
app.use('/api/plugins', pluginRateLimit);

// Plugin-specific routes
app.use('/api/plugins', routes);

// Health check endpoint
app.get('/health', healthChecker);

// Metrics endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(metrics.getMetrics());
});

// Error logging middleware
app.use(errorLoggingMiddleware);

// Global error handler
app.use(errorHandler);

// Graceful shutdown handling
const server = app.listen(port, () => {
  logger.info(`Plugin Manager Service running on port ${port}`);
  logger.info('Plugin Manager Service initialized', {
    port,
    environment: process.env.NODE_ENV || 'development',
    corsOrigins: process.env.FRONTEND_URLS?.split(',') || ['http://localhost:3000'],
    features: ['lifecycle-management', 'sandboxed-execution', 'marketplace', 'version-control']
  });
});

// Handle graceful shutdown
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      await prisma.$disconnect();
      logger.info('Database connections closed');
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
