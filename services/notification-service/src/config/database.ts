
import { PrismaClient } from '@prisma/client';
import { createServiceLogger } from '@ai-platform/shared-utils';

const logger = createServiceLogger('notification-db');

// Initialize Prisma client with logging
export const prisma = new PrismaClient({
  log: [
    {
      emit: 'event',
      level: 'query',
    },
    {
      emit: 'event',
      level: 'error',
    },
    {
      emit: 'event',
      level: 'info',
    },
    {
      emit: 'event',
      level: 'warn',
    },
  ],
});

// Log database queries in development
prisma.$on('query', (e) => {
  if (process.env.NODE_ENV === 'development') {
    logger.debug('Database Query', {
      query: e.query,
      params: e.params,
      duration: e.duration,
    });
  }
});

// Log database errors
prisma.$on('error', (e) => {
  logger.error('Database Error', {
    message: e.message,
    target: e.target,
  });
});

// Handle database connection
prisma.$connect()
  .then(() => {
    logger.info('Notification Service Database connected successfully');
  })
  .catch((error) => {
    logger.error('Failed to connect to database:', error);
    process.exit(1);
  });

export default prisma;
