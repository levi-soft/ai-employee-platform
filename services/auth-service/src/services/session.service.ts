

import { v4 as uuidv4 } from 'uuid';
import { connectRedis } from '../config/redis';
import type { SessionData } from '../types';

const SESSION_TTL = parseInt(process.env.SESSION_TTL || '86400'); // 24 hours in seconds
const SESSION_PREFIX = 'session:';
const USER_SESSIONS_PREFIX = 'user_sessions:';

export class SessionService {
  /**
   * Create a new session
   */
  static async createSession(
    userId: string,
    email: string,
    role: any,
    metadata: { userAgent?: string; ipAddress?: string } = {}
  ): Promise<string> {
    const sessionId = uuidv4();
    const redis = await connectRedis();

    const sessionData: SessionData = {
      userId,
      email,
      role,
      createdAt: new Date(),
      lastAccessAt: new Date(),
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress,
    };

    // Store session data
    await redis.setEx(
      `${SESSION_PREFIX}${sessionId}`,
      SESSION_TTL,
      JSON.stringify(sessionData)
    );

    // Track user sessions
    await redis.sAdd(`${USER_SESSIONS_PREFIX}${userId}`, sessionId);
    await redis.expire(`${USER_SESSIONS_PREFIX}${userId}`, SESSION_TTL);

    return sessionId;
  }

  /**
   * Get session data
   */
  static async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const redis = await connectRedis();
      const sessionData = await redis.get(`${SESSION_PREFIX}${sessionId}`);
      
      if (!sessionData) {
        return null;
      }

      const parsed = JSON.parse(sessionData) as SessionData;
      
      // Update last access time
      parsed.lastAccessAt = new Date();
      await redis.setEx(
        `${SESSION_PREFIX}${sessionId}`,
        SESSION_TTL,
        JSON.stringify(parsed)
      );

      return parsed;
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    }
  }

  /**
   * Delete a session
   */
  static async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const redis = await connectRedis();
      
      // Get session data to find user ID
      const sessionData = await redis.get(`${SESSION_PREFIX}${sessionId}`);
      if (sessionData) {
        const parsed = JSON.parse(sessionData) as SessionData;
        await redis.sRem(`${USER_SESSIONS_PREFIX}${parsed.userId}`, sessionId);
      }

      // Delete the session
      const result = await redis.del(`${SESSION_PREFIX}${sessionId}`);
      return result > 0;
    } catch (error) {
      console.error('Error deleting session:', error);
      return false;
    }
  }

  /**
   * Delete all sessions for a user
   */
  static async deleteUserSessions(userId: string): Promise<boolean> {
    try {
      const redis = await connectRedis();
      
      // Get all user sessions
      const sessionIds = await redis.sMembers(`${USER_SESSIONS_PREFIX}${userId}`);
      
      if (sessionIds.length > 0) {
        // Delete all sessions
        const sessionKeys = sessionIds.map(id => `${SESSION_PREFIX}${id}`);
        await redis.del(sessionKeys);
      }

      // Delete the user sessions set
      await redis.del(`${USER_SESSIONS_PREFIX}${userId}`);
      
      return true;
    } catch (error) {
      console.error('Error deleting user sessions:', error);
      return false;
    }
  }

  /**
   * Get all active sessions for a user
   */
  static async getUserSessions(userId: string): Promise<SessionData[]> {
    try {
      const redis = await connectRedis();
      const sessionIds = await redis.sMembers(`${USER_SESSIONS_PREFIX}${userId}`);
      
      if (sessionIds.length === 0) {
        return [];
      }

      const sessions: SessionData[] = [];
      for (const sessionId of sessionIds) {
        const sessionData = await redis.get(`${SESSION_PREFIX}${sessionId}`);
        if (sessionData) {
          sessions.push(JSON.parse(sessionData));
        }
      }

      return sessions;
    } catch (error) {
      console.error('Error getting user sessions:', error);
      return [];
    }
  }

  /**
   * Validate session exists and is active
   */
  static async validateSession(sessionId: string): Promise<boolean> {
    try {
      const redis = await connectRedis();
      const exists = await redis.exists(`${SESSION_PREFIX}${sessionId}`);
      return exists === 1;
    } catch (error) {
      console.error('Error validating session:', error);
      return false;
    }
  }

  /**
   * Extend session TTL
   */
  static async extendSession(sessionId: string): Promise<boolean> {
    try {
      const redis = await connectRedis();
      const result = await redis.expire(`${SESSION_PREFIX}${sessionId}`, SESSION_TTL);
      return result === 1;
    } catch (error) {
      console.error('Error extending session:', error);
      return false;
    }
  }

  /**
   * Clean up expired sessions
   */
  static async cleanupExpiredSessions(): Promise<number> {
    try {
      const redis = await connectRedis();
      
      // Get all session keys
      const sessionKeys = await redis.keys(`${SESSION_PREFIX}*`);
      let cleanedCount = 0;

      for (const key of sessionKeys) {
        const ttl = await redis.ttl(key);
        if (ttl === -1 || ttl <= 0) {
          await redis.del(key);
          cleanedCount++;
        }
      }

      return cleanedCount;
    } catch (error) {
      console.error('Error cleaning up expired sessions:', error);
      return 0;
    }
  }
}

