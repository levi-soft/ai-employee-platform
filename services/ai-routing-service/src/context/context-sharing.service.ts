
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Redis } from 'ioredis';

export interface ContextShare {
  id: string;
  contextId: string;
  fromUserId: string;
  toUserId: string;
  permissions: string[];
  createdAt: Date;
  expiresAt?: Date;
  accessCount: number;
  lastAccessed?: Date;
  status: 'active' | 'revoked' | 'expired';
  metadata?: Record<string, any>;
}

export interface SharePermission {
  read: boolean;
  write: boolean;
  share: boolean;
  delete: boolean;
}

@Injectable()
export class ContextSharingService {
  private readonly logger = new Logger(ContextSharingService.name);
  private readonly redisClient: Redis;
  private readonly defaultExpirationHours: number;
  private readonly maxSharesPerContext: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.redisClient = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      password: this.configService.get('REDIS_PASSWORD'),
      keyPrefix: 'ai_context_share:',
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
    });

    this.defaultExpirationHours = this.configService.get('CONTEXT_SHARE_EXPIRATION_HOURS', 72);
    this.maxSharesPerContext = this.configService.get('MAX_SHARES_PER_CONTEXT', 10);

    this.setupCleanupInterval();
  }

  async shareContext(
    contextId: string,
    fromUserId: string,
    toUserId: string,
    permissions: string[] = ['read'],
    expirationHours?: number
  ): Promise<boolean> {
    try {
      // Validate sharing limits
      const existingShares = await this.getContextShares(contextId);
      if (existingShares.length >= this.maxSharesPerContext) {
        this.logger.warn(`Maximum shares reached for context ${contextId}`);
        return false;
      }

      // Check if already shared with this user
      const existingShare = existingShares.find(share => 
        share.toUserId === toUserId && share.status === 'active'
      );

      if (existingShare) {
        // Update existing share
        return await this.updateShare(existingShare.id, permissions, expirationHours);
      }

      // Create new share
      const shareId = `share_${contextId}_${toUserId}_${Date.now()}`;
      const expirationTime = expirationHours || this.defaultExpirationHours;
      
      const share: ContextShare = {
        id: shareId,
        contextId,
        fromUserId,
        toUserId,
        permissions,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + (expirationTime * 60 * 60 * 1000)),
        accessCount: 0,
        status: 'active',
        metadata: {
          sharedVia: 'direct',
          originalPermissions: permissions,
        },
      };

      await this.storeShare(share);
      
      // Create reverse lookup for user
      await this.addUserShare(toUserId, shareId);
      
      this.eventEmitter.emit('context.share_created', {
        shareId,
        contextId,
        fromUserId,
        toUserId,
        permissions,
        timestamp: new Date(),
      });

      this.logger.log(
        `Context ${contextId} shared from ${fromUserId} to ${toUserId} ` +
        `with permissions: ${permissions.join(', ')}`
      );

      return true;
    } catch (error) {
      this.logger.error(`Failed to share context ${contextId}`, error);
      return false;
    }
  }

  async checkPermission(
    contextId: string,
    userId: string,
    permission: string
  ): Promise<boolean> {
    try {
      const shares = await this.getUserShares(userId);
      const contextShare = shares.find(share => 
        share.contextId === contextId && share.status === 'active'
      );

      if (!contextShare) {
        return false;
      }

      // Check if share has expired
      if (contextShare.expiresAt && new Date() > contextShare.expiresAt) {
        await this.expireShare(contextShare.id);
        return false;
      }

      // Update access tracking
      await this.trackAccess(contextShare.id);

      return contextShare.permissions.includes(permission) || 
             contextShare.permissions.includes('all');
    } catch (error) {
      this.logger.error(`Failed to check permission for context ${contextId}`, error);
      return false;
    }
  }

  async getContextShares(contextId: string): Promise<ContextShare[]> {
    try {
      const shareKeys = await this.redisClient.keys(`*${contextId}*`);
      const shares: ContextShare[] = [];

      for (const key of shareKeys) {
        const shareData = await this.redisClient.get(key);
        if (shareData) {
          const share = JSON.parse(shareData) as ContextShare;
          if (share.contextId === contextId) {
            shares.push(share);
          }
        }
      }

      return shares.filter(share => share.status === 'active');
    } catch (error) {
      this.logger.error(`Failed to get shares for context ${contextId}`, error);
      return [];
    }
  }

  async getUserShares(userId: string): Promise<ContextShare[]> {
    try {
      const userSharesKey = `user_shares:${userId}`;
      const shareIds = await this.redisClient.smembers(userSharesKey);
      const shares: ContextShare[] = [];

      for (const shareId of shareIds) {
        const shareData = await this.redisClient.get(shareId);
        if (shareData) {
          const share = JSON.parse(shareData) as ContextShare;
          if (share.status === 'active') {
            shares.push(share);
          }
        }
      }

      return shares.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch (error) {
      this.logger.error(`Failed to get shares for user ${userId}`, error);
      return [];
    }
  }

  async revokeShare(shareId: string, userId: string): Promise<boolean> {
    try {
      const share = await this.getShare(shareId);
      if (!share) {
        return false;
      }

      // Only the sharer or the recipient can revoke
      if (share.fromUserId !== userId && share.toUserId !== userId) {
        this.logger.warn(`User ${userId} cannot revoke share ${shareId}`);
        return false;
      }

      share.status = 'revoked';
      await this.storeShare(share);
      await this.removeUserShare(share.toUserId, shareId);
      
      this.eventEmitter.emit('context.share_revoked', {
        shareId,
        contextId: share.contextId,
        revokedBy: userId,
        timestamp: new Date(),
      });

      this.logger.log(`Share ${shareId} revoked by ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to revoke share ${shareId}`, error);
      return false;
    }
  }

  async updateShare(
    shareId: string,
    permissions?: string[],
    expirationHours?: number
  ): Promise<boolean> {
    try {
      const share = await this.getShare(shareId);
      if (!share || share.status !== 'active') {
        return false;
      }

      if (permissions) {
        share.permissions = permissions;
      }

      if (expirationHours) {
        share.expiresAt = new Date(Date.now() + (expirationHours * 60 * 60 * 1000));
      }

      await this.storeShare(share);
      
      this.eventEmitter.emit('context.share_updated', {
        shareId,
        contextId: share.contextId,
        permissions: share.permissions,
        timestamp: new Date(),
      });

      return true;
    } catch (error) {
      this.logger.error(`Failed to update share ${shareId}`, error);
      return false;
    }
  }

  async getSharedContextsForUser(userId: string): Promise<Array<{
    contextId: string;
    permissions: string[];
    sharedBy: string;
    sharedAt: Date;
    accessCount: number;
  }>> {
    try {
      const shares = await this.getUserShares(userId);
      
      return shares.map(share => ({
        contextId: share.contextId,
        permissions: share.permissions,
        sharedBy: share.fromUserId,
        sharedAt: share.createdAt,
        accessCount: share.accessCount,
      }));
    } catch (error) {
      this.logger.error(`Failed to get shared contexts for user ${userId}`, error);
      return [];
    }
  }

  private async getShare(shareId: string): Promise<ContextShare | null> {
    try {
      const shareData = await this.redisClient.get(shareId);
      return shareData ? JSON.parse(shareData) as ContextShare : null;
    } catch (error) {
      this.logger.error(`Failed to get share ${shareId}`, error);
      return null;
    }
  }

  private async storeShare(share: ContextShare): Promise<void> {
    const ttl = share.expiresAt ? 
      Math.floor((share.expiresAt.getTime() - Date.now()) / 1000) :
      7 * 24 * 60 * 60; // 7 days default

    await this.redisClient.setex(share.id, ttl, JSON.stringify(share));
  }

  private async addUserShare(userId: string, shareId: string): Promise<void> {
    const userSharesKey = `user_shares:${userId}`;
    await this.redisClient.sadd(userSharesKey, shareId);
    await this.redisClient.expire(userSharesKey, 7 * 24 * 60 * 60); // 7 days
  }

  private async removeUserShare(userId: string, shareId: string): Promise<void> {
    const userSharesKey = `user_shares:${userId}`;
    await this.redisClient.srem(userSharesKey, shareId);
  }

  private async trackAccess(shareId: string): Promise<void> {
    try {
      const share = await this.getShare(shareId);
      if (share) {
        share.accessCount++;
        share.lastAccessed = new Date();
        await this.storeShare(share);
      }
    } catch (error) {
      this.logger.error(`Failed to track access for share ${shareId}`, error);
    }
  }

  private async expireShare(shareId: string): Promise<void> {
    try {
      const share = await this.getShare(shareId);
      if (share) {
        share.status = 'expired';
        await this.storeShare(share);
        await this.removeUserShare(share.toUserId, shareId);
        
        this.eventEmitter.emit('context.share_expired', {
          shareId,
          contextId: share.contextId,
          timestamp: new Date(),
        });
      }
    } catch (error) {
      this.logger.error(`Failed to expire share ${shareId}`, error);
    }
  }

  private setupCleanupInterval(): void {
    // Clean up expired shares every 6 hours
    setInterval(async () => {
      try {
        await this.cleanupExpiredShares();
      } catch (error) {
        this.logger.error('Share cleanup failed', error);
      }
    }, 6 * 60 * 60 * 1000);
  }

  private async cleanupExpiredShares(): Promise<void> {
    try {
      const keys = await this.redisClient.keys('*');
      let cleaned = 0;

      for (const key of keys) {
        const shareData = await this.redisClient.get(key);
        if (shareData) {
          const share = JSON.parse(shareData) as ContextShare;
          
          if (share.expiresAt && new Date() > share.expiresAt && share.status === 'active') {
            await this.expireShare(share.id);
            cleaned++;
          }
        }
      }

      if (cleaned > 0) {
        this.logger.log(`Cleaned up ${cleaned} expired shares`);
      }
    } catch (error) {
      this.logger.error('Failed to cleanup expired shares', error);
    }
  }

  async getShareStats(): Promise<{
    totalShares: number;
    activeShares: number;
    expiredShares: number;
    revokedShares: number;
    averageAccessCount: number;
  }> {
    try {
      const keys = await this.redisClient.keys('*');
      let totalShares = 0;
      let activeShares = 0;
      let expiredShares = 0;
      let revokedShares = 0;
      let totalAccessCount = 0;

      for (const key of keys) {
        if (key.startsWith('share_')) {
          const shareData = await this.redisClient.get(key);
          if (shareData) {
            const share = JSON.parse(shareData) as ContextShare;
            totalShares++;
            totalAccessCount += share.accessCount;
            
            switch (share.status) {
              case 'active':
                activeShares++;
                break;
              case 'expired':
                expiredShares++;
                break;
              case 'revoked':
                revokedShares++;
                break;
            }
          }
        }
      }

      return {
        totalShares,
        activeShares,
        expiredShares,
        revokedShares,
        averageAccessCount: totalShares > 0 ? totalAccessCount / totalShares : 0,
      };
    } catch (error) {
      this.logger.error('Failed to get share stats', error);
      return {
        totalShares: 0,
        activeShares: 0,
        expiredShares: 0,
        revokedShares: 0,
        averageAccessCount: 0,
      };
    }
  }
}
