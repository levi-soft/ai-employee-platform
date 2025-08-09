
import { JWTService } from '../src/services/jwt.service';
import jwt from 'jsonwebtoken';

// Mock jsonwebtoken
jest.mock('jsonwebtoken');

describe('JWTService', () => {
  let jwtService: JWTService;
  const mockJwt = jwt as jest.Mocked<typeof jwt>;

  beforeEach(() => {
    jwtService = new JWTService();
    jest.clearAllMocks();
  });

  describe('generateTokens', () => {
    it('should generate access and refresh tokens', async () => {
      const userId = 'test-user-id';
      const role = 'EMPLOYEE';
      
      mockJwt.sign
        .mockReturnValueOnce('mock-access-token')
        .mockReturnValueOnce('mock-refresh-token');

      const result = await jwtService.generateTokens(userId, role);

      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      });
      
      expect(mockJwt.sign).toHaveBeenCalledTimes(2);
    });
  });

  describe('verifyToken', () => {
    it('should verify valid token', async () => {
      const mockPayload = {
        userId: 'test-user-id',
        role: 'EMPLOYEE',
        type: 'access',
        iat: Date.now(),
        exp: Date.now() + 3600,
      };
      
      mockJwt.verify.mockReturnValue(mockPayload);

      const result = await jwtService.verifyToken('valid-token');

      expect(result).toEqual(mockPayload);
      expect(mockJwt.verify).toHaveBeenCalledWith('valid-token', expect.any(String));
    });

    it('should throw error for invalid token', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(jwtService.verifyToken('invalid-token')).rejects.toThrow('Invalid token');
    });
  });

  describe('refreshToken', () => {
    it('should generate new tokens from valid refresh token', async () => {
      const mockRefreshPayload = {
        userId: 'test-user-id',
        role: 'EMPLOYEE',
        type: 'refresh',
        iat: Date.now(),
        exp: Date.now() + 3600,
      };
      
      mockJwt.verify.mockReturnValue(mockRefreshPayload);
      mockJwt.sign
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');

      const result = await jwtService.refreshToken('valid-refresh-token');

      expect(result).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
    });

    it('should throw error for invalid refresh token type', async () => {
      const mockPayload = {
        userId: 'test-user-id',
        role: 'EMPLOYEE',
        type: 'access', // Wrong type
        iat: Date.now(),
        exp: Date.now() + 3600,
      };
      
      mockJwt.verify.mockReturnValue(mockPayload);

      await expect(jwtService.refreshToken('invalid-refresh-token')).rejects.toThrow('Invalid refresh token');
    });
  });
});
