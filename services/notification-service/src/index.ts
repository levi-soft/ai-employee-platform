
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { createServer } from 'http';
import routes from './routes';
import { errorHandler } from './utils/errors';
import { prisma } from './config/database';
import { requestLoggingMiddleware, errorLoggingMiddleware } from './middleware/logging.middleware';
import { healthChecker } from './health';
import { createServiceLogger, metrics } from '@ai-platform/shared-utils';
import { NotificationGateway } from './websocket/notification-gateway';

// Security middleware imports
import { 
  notificationSecurityMiddleware, 
  notificationRateLimit
} from './middleware/security.middleware';

// Load environment variables
dotenv.config();

// Initialize logger
const logger = createServiceLogger('notification-service');

const app = express();
const port = process.env.PORT || 9007;

// Create HTTP server for WebSocket support
const server = createServer(app);

// Initialize WebSocket Gateway
const notificationGateway = new NotificationGateway(server);

// Request logging (must be first)
app.use(requestLoggingMiddleware);

// Security middleware
app.use(notificationSecurityMiddleware);
app.use(helmet({
  crossOriginEmbedderPolicy: false, // Allow WebSocket connections
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"], // Allow WebSocket connections
      upgradeInsecureRequests: [],
    },
  }
}));

// CORS configuration with WebSocket support
app.use(cors({
  origin: process.env.FRONTEND_URLS?.split(',') || ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Socket-ID', 'X-Notification-Type']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Morgan logging
app.use(morgan('combined', {
  stream: { write: (message: string) => logger.http(message.trim()) }
}));

// Rate limiting
app.use('/api/notifications', notificationRateLimit);

// Routes
app.use('/api/notifications', routes);

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
const gracefulShutdown = (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      // Close WebSocket connections
      await notificationGateway.shutdown();
      logger.info('WebSocket gateway closed');
      
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

// Start server
server.listen(port, () => {
  logger.info(`Notification Service running on port ${port}`);
  logger.info('Notification Service initialized', {
    port,
    environment: process.env.NODE_ENV || 'development',
    corsOrigins: process.env.FRONTEND_URLS?.split(',') || ['http://localhost:3000'],
    features: ['websocket-notifications', 'email-notifications', 'sms-notifications', 'notification-history']
  });
});

export default app;
