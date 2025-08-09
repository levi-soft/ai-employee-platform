
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import passport from 'passport';
import routes from './routes';
import { errorHandler } from './utils/errors';
import { connectRedis } from './config/redis';
import { prisma } from './config/database';
import { requestLoggingMiddleware, errorLoggingMiddleware } from './middleware/logging.middleware';
import { healthChecker } from './health';
import { createServiceLogger, metrics } from '@ai-platform/shared-utils';
import { OAuthService } from './services/oauth.service';
import SessionMiddleware from './middleware/session.middleware';

// Security middleware imports
import { 
  authSecurityMiddleware, 
  authRateLimit,
  securityEventLogger,
  bruteForceProtection,
  jwtSecurityValidation,
  sessionSecurityValidation
} from './middleware/security.middleware';

// Load environment variables
dotenv.config();

// Initialize logger
const logger = createServiceLogger('auth-service');

const app = express();
const port = process.env.PORT || 9001;

// Initialize OAuth service (sets up passport strategies)
OAuthService.initialize();

// Initialize Passport
app.use(passport.initialize());

// Request logging (must be first)
app.use(requestLoggingMiddleware);

// Security middleware (comprehensive protection)
app.use(authSecurityMiddleware);
app.use(securityEventLogger);

// Enhanced security headers
app.use(SessionMiddleware.securityHeaders);

// Basic security
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? (process.env.ALLOWED_ORIGINS?.split(',') || ['https://ai-platform.com'])
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:8080'],
  credentials: true,
}));

// Rate limiting (before body parsing)
app.use(authRateLimit);

// JWT security validation
app.use(jwtSecurityValidation);

// Session security validation
app.use(sessionSecurityValidation);

// Logging
app.use(morgan(process.env.LOG_FORMAT || 'combined'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Brute force protection (after body parsing)
app.use(bruteForceProtection);

// Trust proxy for accurate IP addresses
app.set('trust proxy', true);

// Session activity tracking (for authenticated requests)
app.use(SessionMiddleware.trackActivity);

// Health check endpoint
app.get('/health', healthChecker.getHealthCheckMiddleware());

// Metrics endpoint (internal only)
app.get('/metrics', (req, res) => {
  // Only allow internal access
  const clientIp = req.ip || req.connection.remoteAddress;
  if (!clientIp || (!clientIp.includes('127.0.0.1') && !clientIp.includes('::1'))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const metricsData = metrics.getMetrics();
  
  // Return both JSON and Prometheus format based on Accept header
  if (req.headers.accept?.includes('text/plain')) {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics.exportPrometheusFormat());
  } else {
    res.json(metricsData);
  }
});

// API routes
app.use('/api', routes);

// Error logging middleware
app.use(errorLoggingMiddleware);

// Global error handler
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
    code: 'ROUTE_NOT_FOUND',
  });
});

// Initialize connections and start server
async function startServer() {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('Database connected successfully');

    // Connect to Redis
    await connectRedis();
    logger.info('Redis connected successfully');

    // Start server
    const server = app.listen(port, () => {
      logger.info('Auth service started successfully', {
        port,
        environment: process.env.NODE_ENV || 'development',
        jwtSecretSet: !!process.env.JWT_SECRET,
        redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
        version: process.env.npm_package_version || '1.0.0',
      });
    });

    // Graceful shutdown handling
    const gracefulShutdown = (signal: string) => {
      logger.info(`Received ${signal} signal, shutting down gracefully`);
      
      server.close(async (err) => {
        if (err) {
          logger.error('Error during server shutdown', err);
          process.exit(1);
        }
        
        try {
          await prisma.$disconnect();
          logger.info('Database disconnected');
        } catch (error) {
          logger.error('Error disconnecting database', error instanceof Error ? error : undefined);
        }
        
        logger.info('Auth service shut down successfully');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start auth service', error instanceof Error ? error : undefined);
    process.exit(1);
  }
}

// Start the server
startServer();

export default app;
