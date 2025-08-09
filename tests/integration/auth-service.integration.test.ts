
/**
 * Integration Tests for Auth Service
 * Tests complete authentication flows with real database and Redis
 */

import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from '../utils/test-server';
import { DatabaseFixture } from '../fixtures/database.fixture';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
let app: any;
let databaseFixture: DatabaseFixture;

beforeAll(async () => {
  // Setup test environment
  app = await createTestApp();
  databaseFixture = new DatabaseFixture(prisma);
  await databaseFixture.setup();
});

afterAll(async () => {
  await databaseFixture.cleanup();
  await prisma.$disconnect();
});

afterEach(async () => {
  await databaseFixture.cleanupTestData();
});

describe('Auth Service Integration Tests', () => {
  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        email: 'newuser@test.com',
        password: 'StrongPass123!',
        firstName: 'New',
        lastName: 'User',
        role: 'EMPLOYEE'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('tokens');
      expect(response.body.user.email).toBe(userData.email);
      expect(response.body.user).not.toHaveProperty('password');

      // Verify user was created in database
      const user = await prisma.user.findUnique({
        where: { email: userData.email }
      });
      expect(user).toBeTruthy();
      expect(user?.firstName).toBe(userData.firstName);
    });

    it('should prevent duplicate user registration', async () => {
      const userData = {
        email: 'duplicate@test.com',
        password: 'StrongPass123!',
        firstName: 'First',
        lastName: 'User',
        role: 'EMPLOYEE'
      };

      // First registration should succeed
      await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      // Second registration should fail
      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(409);

      expect(response.body.error).toContain('already exists');
    });

    it('should validate required fields', async () => {
      const incompleteData = {
        email: 'incomplete@test.com',
        // Missing required fields
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(incompleteData)
        .expect(400);

      expect(response.body.error).toContain('validation');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Create test user
      const hashedPassword = await bcrypt.hash('TestPass123!', 10);
      await databaseFixture.createUser({
        email: 'testuser@test.com',
        password: hashedPassword,
        firstName: 'Test',
        lastName: 'User',
        role: 'EMPLOYEE'
      });
    });

    it('should login with valid credentials', async () => {
      const loginData = {
        email: 'testuser@test.com',
        password: 'TestPass123!'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('tokens');
      expect(response.body.user.email).toBe(loginData.email);
      expect(response.body.tokens).toHaveProperty('accessToken');
      expect(response.body.tokens).toHaveProperty('refreshToken');
    });

    it('should reject invalid credentials', async () => {
      const invalidLogin = {
        email: 'testuser@test.com',
        password: 'WrongPassword'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(invalidLogin)
        .expect(401);

      expect(response.body.error).toContain('Invalid credentials');
    });

    it('should reject non-existent user', async () => {
      const nonExistentLogin = {
        email: 'nonexistent@test.com',
        password: 'TestPass123!'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(nonExistentLogin)
        .expect(401);

      expect(response.body.error).toContain('Invalid credentials');
    });
  });

  describe('Protected Routes', () => {
    let authToken: string;
    let testUserId: string;

    beforeEach(async () => {
      // Create and authenticate user
      const hashedPassword = await bcrypt.hash('TestPass123!', 10);
      const user = await databaseFixture.createUser({
        email: 'protected@test.com',
        password: hashedPassword,
        firstName: 'Protected',
        lastName: 'User',
        role: 'EMPLOYEE'
      });
      testUserId = user.id;

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'protected@test.com',
          password: 'TestPass123!'
        });

      authToken = loginResponse.body.tokens.accessToken;
    });

    it('should access profile with valid token', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.user.email).toBe('protected@test.com');
    });

    it('should reject access without token', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .expect(401);

      expect(response.body.error).toContain('No token provided');
    });

    it('should reject access with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', 'Bearer invalid_token')
        .expect(401);

      expect(response.body.error).toContain('Invalid token');
    });
  });

  describe('Token Refresh Flow', () => {
    let refreshToken: string;
    let accessToken: string;

    beforeEach(async () => {
      // Create and login user
      const hashedPassword = await bcrypt.hash('RefreshTest123!', 10);
      await databaseFixture.createUser({
        email: 'refresh@test.com',
        password: hashedPassword,
        firstName: 'Refresh',
        lastName: 'User',
        role: 'EMPLOYEE'
      });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'refresh@test.com',
          password: 'RefreshTest123!'
        });

      refreshToken = loginResponse.body.tokens.refreshToken;
      accessToken = loginResponse.body.tokens.accessToken;
    });

    it('should refresh token with valid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(response.body).toHaveProperty('tokens');
      expect(response.body.tokens.accessToken).not.toBe(accessToken);
      expect(response.body.tokens).toHaveProperty('refreshToken');
    });

    it('should reject invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid_refresh_token' })
        .expect(401);

      expect(response.body.error).toContain('Invalid refresh token');
    });
  });

  describe('Logout Flow', () => {
    let authToken: string;
    let refreshToken: string;

    beforeEach(async () => {
      const hashedPassword = await bcrypt.hash('LogoutTest123!', 10);
      await databaseFixture.createUser({
        email: 'logout@test.com',
        password: hashedPassword,
        firstName: 'Logout',
        lastName: 'User',
        role: 'EMPLOYEE'
      });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'logout@test.com',
          password: 'LogoutTest123!'
        });

      authToken = loginResponse.body.tokens.accessToken;
      refreshToken = loginResponse.body.tokens.refreshToken;
    });

    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.message).toContain('Logged out successfully');

      // Verify token is invalidated
      const profileResponse = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(401);
    });

    it('should logout from all devices', async () => {
      const response = await request(app)
        .post('/api/auth/logout-all')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.message).toContain('Logged out from all devices');

      // Verify refresh token is also invalidated
      const refreshResponse = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });
});
