
import request from 'supertest';
import express from 'express';
import { AuthController } from '../src/controllers/auth.controller';
import { JWTService } from '../src/services/jwt.service';
import { UserModel } from '../src/models/user.model';
import { SessionService } from '../src/services/session.service';
import { createTestServer, TestServer } from '../../../tests/utils/test-server';
import { getTestUser } from '../../../tests/fixtures/users.fixture';

// Mock dependencies
jest.mock('../src/services/jwt.service');
jest.mock('../src/models/user.model');
jest.mock('../src/services/session.service');

describe('AuthController', () => {
  let app: express.Application;
  let testServer: TestServer;
  let authController: AuthController;
  let jwtService: jest.Mocked<JWTService>;
  let userModel: jest.Mocked<UserModel>;
  let sessionService: jest.Mocked<SessionService>;

  beforeAll(async () => {
    // Create mocked services
    jwtService = new JWTService() as jest.Mocked<JWTService>;
    userModel = new UserModel() as jest.Mocked<UserModel>;
    sessionService = new SessionService() as jest.Mocked<SessionService>;
    
    // Create auth controller with mocked dependencies
    authController = new AuthController(jwtService, userModel, sessionService);
    
    // Create Express app
    app = express();
    app.use(express.json());
    
    // Setup routes (simplified for testing)
    app.post('/api/auth/register', authController.register.bind(authController));
    app.post('/api/auth/login', authController.login.bind(authController));
    app.post('/api/auth/refresh', authController.refresh.bind(authController));
    app.get('/api/auth/profile', authController.getProfile.bind(authController));
    
    // Create test server
    testServer = createTestServer(app);
    await testServer.start();
  });

  afterAll(async () => {
    await testServer.stop();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      const testUser = getTestUser();
      const mockUser = {
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
        role: testUser.role,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      userModel.findByEmail.mockResolvedValue(null);
      userModel.create.mockResolvedValue(mockUser);
      jwtService.generateTokens.mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      });
      sessionService.createSession.mockResolvedValue('mock-session-id');

      const response = await testServer
        .request()
        .post('/api/auth/register')
        .send({
          email: testUser.email,
          password: testUser.password,
          name: testUser.name,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(testUser.email);
      expect(response.body.data.tokens.accessToken).toBe('mock-access-token');
    });

    it('should return 400 if user already exists', async () => {
      const testUser = getTestUser();
      
      userModel.findByEmail.mockResolvedValue({
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
        role: testUser.role,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await testServer
        .request()
        .post('/api/auth/register')
        .send({
          email: testUser.email,
          password: testUser.password,
          name: testUser.name,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('already exists');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login user successfully', async () => {
      const testUser = getTestUser();
      const mockUser = {
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
        role: testUser.role,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      userModel.findByEmail.mockResolvedValue(mockUser);
      userModel.validatePassword.mockResolvedValue(true);
      jwtService.generateTokens.mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      });
      sessionService.createSession.mockResolvedValue('mock-session-id');

      const response = await testServer
        .request()
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe(testUser.email);
      expect(response.body.data.tokens.accessToken).toBe('mock-access-token');
    });

    it('should return 401 for invalid credentials', async () => {
      const testUser = getTestUser();
      
      userModel.findByEmail.mockResolvedValue(null);

      const response = await testServer
        .request()
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'wrong-password',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid credentials');
    });
  });
});
