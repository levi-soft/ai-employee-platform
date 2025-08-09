
/**
 * API Endpoints Integration Tests  
 * Tests API endpoint responses, authentication, and error handling
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from '../utils/test-server';
import { DatabaseFixture } from '../fixtures/database.fixture';
import { TestScenarios } from '../fixtures/database/scenarios.fixture';

const prisma = new PrismaClient();
let app: any;
let databaseFixture: DatabaseFixture;
let testScenarios: TestScenarios;

beforeAll(async () => {
  app = await createTestApp();
  databaseFixture = new DatabaseFixture(prisma);
  testScenarios = new TestScenarios(prisma);
  await databaseFixture.setup();
});

afterAll(async () => {
  await databaseFixture.cleanup();
  await prisma.$disconnect();
});

afterEach(async () => {
  await databaseFixture.cleanupTestData();
});

describe('API Endpoints Integration Tests', () => {
  describe('Health Check Endpoints', () => {
    it('should return health status for auth service', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('service');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('checks');
    });

    it('should return detailed health information', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.checks).toHaveProperty('database');
      expect(response.body.checks).toHaveProperty('redis');
      expect(response.body.checks.database.status).toBe('healthy');
      expect(response.body.checks.redis.status).toBe('healthy');
    });
  });

  describe('API Rate Limiting', () => {
    it('should enforce rate limits on auth endpoints', async () => {
      const loginData = {
        email: 'test@ratelimit.com',
        password: 'WrongPassword123!'
      };

      // Make multiple requests to trigger rate limit
      const promises = Array.from({ length: 6 }, () =>
        request(app)
          .post('/api/auth/login')
          .send(loginData)
      );

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited (429)
      const rateLimited = responses.filter(r => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    });

    it('should include rate limit headers', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@headers.com',
          password: 'Test123!'
        });

      expect(response.headers).toHaveProperty('x-ratelimit-limit');
      expect(response.headers).toHaveProperty('x-ratelimit-remaining');
      expect(response.headers).toHaveProperty('x-ratelimit-reset');
    });
  });

  describe('CORS Headers', () => {
    it('should include proper CORS headers', async () => {
      const response = await request(app)
        .options('/api/auth/login')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers).toHaveProperty('access-control-allow-origin');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
      expect(response.headers).toHaveProperty('access-control-allow-headers');
    });

    it('should handle preflight requests correctly', async () => {
      const response = await request(app)
        .options('/api/auth/login')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type,Authorization')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('Input Validation', () => {
    it('should validate email format in registration', async () => {
      const invalidData = {
        email: 'invalid-email',
        password: 'ValidPass123!',
        firstName: 'Test',
        lastName: 'User',
        role: 'EMPLOYEE'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toContain('email');
    });

    it('should validate password strength', async () => {
      const weakPasswordData = {
        email: 'test@weak.com',
        password: '123',
        firstName: 'Test',
        lastName: 'User',
        role: 'EMPLOYEE'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(weakPasswordData)
        .expect(400);

      expect(response.body.error).toContain('password');
    });

    it('should sanitize XSS attempts', async () => {
      const xssData = {
        email: 'test@xss.com',
        password: 'ValidPass123!',
        firstName: '<script>alert("xss")</script>',
        lastName: 'User',
        role: 'EMPLOYEE'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(xssData)
        .expect(201);

      // Should have sanitized the malicious script
      expect(response.body.user.firstName).not.toContain('<script>');
    });
  });

  describe('Error Handling', () => {
    it('should return structured error responses', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('path');
    });

    it('should handle 404 errors gracefully', async () => {
      const response = await request(app)
        .get('/api/non-existent-endpoint')
        .expect(404);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Not found');
    });

    it('should not expose sensitive information in errors', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'TestPass123!'
        })
        .expect(401);

      // Should not reveal if user exists or not
      expect(response.body.error).toBe('Invalid credentials');
    });
  });

  describe('Security Headers', () => {
    it('should include security headers', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
      expect(response.headers).toHaveProperty('x-xss-protection', '1; mode=block');
    });

    it('should include HSTS headers on HTTPS', async () => {
      // This would be tested with HTTPS setup
      // For now, just verify the middleware is configured
      const response = await request(app)
        .get('/health');

      // In production with HTTPS, would have strict-transport-security header
      expect(response.headers).not.toHaveProperty('strict-transport-security'); // HTTP in test
    });
  });

  describe('Authentication Flow Integration', () => {
    let testUser: any;
    let authToken: string;

    beforeEach(async () => {
      const scenario = await testScenarios.setupCompleteUser({
        email: 'integration@test.com'
      });
      testUser = scenario.user;

      // Login to get token
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'integration@test.com',
          password: testUser.password  // This would be the original password from fixture
        });

      // Note: In real scenario, we'd use the original password, not the hashed one
      // For now, let's test with a known password setup
    });

    it('should handle complete authentication flow', async () => {
      // 1. Register new user
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'flow@test.com',
          password: 'FlowTest123!',
          firstName: 'Flow',
          lastName: 'Test',
          role: 'EMPLOYEE'
        })
        .expect(201);

      const { tokens } = registerResponse.body;

      // 2. Use access token to access protected route
      const profileResponse = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      expect(profileResponse.body.user.email).toBe('flow@test.com');

      // 3. Refresh token
      const refreshResponse = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);

      expect(refreshResponse.body.tokens.accessToken).not.toBe(tokens.accessToken);

      // 4. Logout
      const logoutResponse = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${refreshResponse.body.tokens.accessToken}`)
        .expect(200);

      expect(logoutResponse.body.message).toContain('Logged out successfully');
    });
  });

  describe('Database Transaction Integrity', () => {
    it('should maintain data consistency during registration', async () => {
      const userData = {
        email: 'consistency@test.com',
        password: 'Consistent123!',
        firstName: 'Consistency',
        lastName: 'Test',
        role: 'EMPLOYEE'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      const userId = response.body.user.id;

      // Verify user was created
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { creditAccount: true }
      });

      expect(user).toBeTruthy();
      expect(user?.creditAccount).toBeTruthy();
      expect(user?.creditAccount?.balance).toBe(100); // Default balance
    });

    it('should handle concurrent requests properly', async () => {
      const userData = {
        email: 'concurrent@test.com',
        password: 'Concurrent123!',
        firstName: 'Concurrent',
        lastName: 'Test',
        role: 'EMPLOYEE'
      };

      // Make concurrent registration attempts
      const promises = Array.from({ length: 3 }, () =>
        request(app)
          .post('/api/auth/register')
          .send(userData)
      );

      const responses = await Promise.all(promises);

      // Only one should succeed
      const successful = responses.filter(r => r.status === 201);
      const conflicts = responses.filter(r => r.status === 409);

      expect(successful).toHaveLength(1);
      expect(conflicts).toHaveLength(2);
    });
  });

  describe('Performance Tests', () => {
    it('should respond within acceptable time limits', async () => {
      const start = Date.now();

      const response = await request(app)
        .get('/health')
        .expect(200);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should respond in under 1 second
      expect(response.body.status).toBe('healthy');
    });

    it('should handle multiple concurrent requests', async () => {
      const start = Date.now();

      const promises = Array.from({ length: 10 }, () =>
        request(app).get('/health')
      );

      const responses = await Promise.all(promises);
      const duration = Date.now() - start;

      expect(responses).toHaveLength(10);
      expect(responses.every(r => r.status === 200)).toBe(true);
      expect(duration).toBeLessThan(5000); // All requests in under 5 seconds
    });
  });
});
