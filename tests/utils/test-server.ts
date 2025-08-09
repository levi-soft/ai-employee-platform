
/**
 * Test Server Utilities
 * Provides test server setup and utilities for integration tests
 */

import express from 'express';
import { Server } from 'http';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

// Mock the auth service app structure for testing
export const createTestApp = async () => {
  const app = express();
  
  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // CORS middleware
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
    
    if (req.method === 'OPTIONS') {
      res.status(204).send();
    } else {
      next();
    }
  });
  
  // Security headers middleware
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });
  
  // Rate limiting simulation (simplified for testing)
  const rateLimitStore = new Map();
  app.use('/api/auth', (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window
    
    let requests = rateLimitStore.get(key) || [];
    requests = requests.filter((time: number) => time > windowStart);
    
    const limit = req.path.includes('login') ? 5 : 10;
    
    if (requests.length >= limit) {
      res.set({
        'X-RateLimit-Limit': limit.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': Math.ceil((now + 60000) / 1000).toString()
      });
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded'
      });
    }
    
    requests.push(now);
    rateLimitStore.set(key, requests);
    
    res.set({
      'X-RateLimit-Limit': limit.toString(),
      'X-RateLimit-Remaining': (limit - requests.length).toString(),
      'X-RateLimit-Reset': Math.ceil((now + 60000) / 1000).toString()
    });
    
    next();
  });
  
  // Import and setup auth routes (mocked for testing)
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, firstName, lastName, role } = req.body;
      
      // Basic validation
      if (!email || !email.includes('@')) {
        return res.status(400).json({
          error: 'Invalid email format',
          timestamp: new Date().toISOString(),
          path: req.path
        });
      }
      
      if (!password || password.length < 8) {
        return res.status(400).json({
          error: 'Password must be at least 8 characters long',
          timestamp: new Date().toISOString(),
          path: req.path
        });
      }
      
      if (!firstName || !lastName) {
        return res.status(400).json({
          error: 'First name and last name are required',
          timestamp: new Date().toISOString(),
          path: req.path
        });
      }
      
      // XSS sanitization (basic)
      const sanitizedFirstName = firstName.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      const sanitizedLastName = lastName.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      
      // Check if user already exists (simplified)
      const existingUser = await req.prisma?.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(409).json({
          error: 'User with this email already exists',
          timestamp: new Date().toISOString(),
          path: req.path
        });
      }
      
      // Mock user creation response
      const user = {
        id: `test-user-${Date.now()}`,
        email,
        firstName: sanitizedFirstName,
        lastName: sanitizedLastName,
        role: role || 'EMPLOYEE',
        createdAt: new Date()
      };
      
      const tokens = {
        accessToken: `test-access-token-${Date.now()}`,
        refreshToken: `test-refresh-token-${Date.now()}`
      };
      
      res.status(201).json({ user, tokens });
    } catch (error) {
      res.status(500).json({
        error: 'Internal server error',
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }
  });
  
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({
          error: 'Email and password are required',
          timestamp: new Date().toISOString(),
          path: req.path
        });
      }
      
      // Mock authentication logic
      if (email === 'nonexistent@test.com' || password === 'WrongPassword') {
        return res.status(401).json({
          error: 'Invalid credentials',
          timestamp: new Date().toISOString(),
          path: req.path
        });
      }
      
      const user = {
        id: `test-user-${email.replace(/[^a-zA-Z0-9]/g, '')}`,
        email,
        firstName: 'Test',
        lastName: 'User',
        role: 'EMPLOYEE',
        createdAt: new Date()
      };
      
      const tokens = {
        accessToken: `test-access-token-${Date.now()}`,
        refreshToken: `test-refresh-token-${Date.now()}`
      };
      
      res.status(200).json({ user, tokens });
    } catch (error) {
      res.status(500).json({
        error: 'Internal server error',
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }
  });
  
  app.get('/api/auth/profile', (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        error: 'No token provided',
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    if (!token || !token.startsWith('test-access-token')) {
      return res.status(401).json({
        error: 'Invalid token',
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }
    
    const user = {
      id: 'test-user-profile',
      email: 'protected@test.com',
      firstName: 'Protected',
      lastName: 'User',
      role: 'EMPLOYEE',
      createdAt: new Date()
    };
    
    res.status(200).json({ user });
  });
  
  app.post('/api/auth/refresh', (req, res) => {
    const { refreshToken } = req.body;
    
    if (!refreshToken || !refreshToken.startsWith('test-refresh-token')) {
      return res.status(401).json({
        error: 'Invalid refresh token',
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }
    
    const tokens = {
      accessToken: `test-access-token-refreshed-${Date.now()}`,
      refreshToken: `test-refresh-token-refreshed-${Date.now()}`
    };
    
    res.status(200).json({ tokens });
  });
  
  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        error: 'No token provided',
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }
    
    res.status(200).json({
      message: 'Logged out successfully',
      timestamp: new Date().toISOString()
    });
  });
  
  app.post('/api/auth/logout-all', (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        error: 'No token provided',
        timestamp: new Date().toISOString(),
        path: req.path
      });
    }
    
    res.status(200).json({
      message: 'Logged out from all devices successfully',
      timestamp: new Date().toISOString()
    });
  });
  
  // Health check endpoint
  app.get('/health', async (req, res) => {
    const health = {
      status: 'healthy',
      service: 'auth-service-test',
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: 'healthy', responseTime: '< 50ms' },
        redis: { status: 'healthy', responseTime: '< 10ms' },
        memory: { status: 'healthy', usage: '45%' }
      },
      uptime: process.uptime()
    };
    
    res.status(200).json(health);
  });
  
  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not found',
      message: `The requested endpoint ${req.method} ${req.path} was not found`,
      timestamp: new Date().toISOString(),
      path: req.path
    });
  });
  
  // Error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Test server error:', err);
    res.status(500).json({
      error: 'Internal server error',
      timestamp: new Date().toISOString(),
      path: req.path
    });
  });
  
  return app;
};

export const createTestServer = async (port: number = 0): Promise<{ app: express.Application; server: Server; port: number }> => {
  const app = await createTestApp();
  
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === 'string' ? port : address?.port || port;
      resolve({ app, server, port: actualPort });
    });
    
    server.on('error', reject);
  });
};

export const closeTestServer = (server: Server): Promise<void> => {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

// Test database utilities
export const setupTestDatabase = async () => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || 'postgresql://postgres:testpassword@localhost:5432/ai_platform_test'
      }
    }
  });
  
  // Clean up test data
  await prisma.aIRequest.deleteMany({});
  await prisma.budgetLimit.deleteMany({});
  await prisma.userPlugin.deleteMany({});
  await prisma.plugin.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.creditAccount.deleteMany({});
  await prisma.aIAgent.deleteMany({});
  await prisma.user.deleteMany({});
  
  return prisma;
};

// Test Redis utilities
export const setupTestRedis = () => {
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_DB || '1'),
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100
  });
  
  return redis;
};

// Cleanup utilities
export const cleanupTestEnvironment = async () => {
  // Clean up any test files, logs, etc.
  try {
    const fs = await import('fs/promises');
    await fs.rmdir('/tmp/test-uploads', { recursive: true });
  } catch (error) {
    // Ignore cleanup errors
  }
};

// Mock service responses
export const mockServiceResponse = (service: string, endpoint: string, response: any) => {
  // This would be used for mocking other microservice responses
  return {
    service,
    endpoint,
    response,
    timestamp: new Date().toISOString()
  };
};

export default {
  createTestApp,
  createTestServer,
  closeTestServer,
  setupTestDatabase,
  setupTestRedis,
  cleanupTestEnvironment,
  mockServiceResponse
};
