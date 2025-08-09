
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { ConversationContext, ContextMessage } from './context-manager.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface ContextStorageOptions {
  compress: boolean;
  encrypt: boolean;
  archiveAfterDays: number;
  maxStorageSizeMB: number;
}

export interface ContextArchive {
  id: string;
  contextId: string;
  userId: string;
  archivedAt: Date;
  size: number;
  compressed: boolean;
  location: string;
  metadata: Record<string, any>;
}

@Injectable()
export class ContextPersistenceService {
  private readonly logger = new Logger(ContextPersistenceService.name);
  private readonly prisma: PrismaClient;
  private readonly storageOptions: ContextStorageOptions;
  private readonly storagePath: string;

  constructor(private readonly configService: ConfigService) {
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: this.configService.get('DATABASE_URL'),
        },
      },
    });

    this.storageOptions = {
      compress: this.configService.get('CONTEXT_COMPRESS', true),
      encrypt: this.configService.get('CONTEXT_ENCRYPT', false),
      archiveAfterDays: this.configService.get('CONTEXT_ARCHIVE_DAYS', 30),
      maxStorageSizeMB: this.configService.get('CONTEXT_MAX_STORAGE_MB', 1000),
    };

    this.storagePath = this.configService.get('CONTEXT_STORAGE_PATH', '/tmp/ai_contexts');
    this.initializeStorage();
  }

  async saveContext(context: ConversationContext): Promise<boolean> {
    try {
      // Save to database
      await this.saveToDatabase(context);
      
      // Save to file system for long-term storage
      if (this.shouldPersistToFile(context)) {
        await this.saveToFile(context);
      }

      this.logger.debug(`Context ${context.id} saved successfully`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to save context ${context.id}`, error);
      return false;
    }
  }

  async loadContext(contextId: string): Promise<ConversationContext | null> {
    try {
      // Try loading from database first (fastest)
      let context = await this.loadFromDatabase(contextId);
      
      if (!context) {
        // Try loading from file system
        context = await this.loadFromFile(contextId);
      }

      if (context) {
        this.logger.debug(`Context ${contextId} loaded successfully`);
      }

      return context;
    } catch (error) {
      this.logger.error(`Failed to load context ${contextId}`, error);
      return null;
    }
  }

  async deleteContext(contextId: string): Promise<boolean> {
    try {
      // Delete from database
      await this.deleteFromDatabase(contextId);
      
      // Delete from file system
      await this.deleteFromFile(contextId);

      this.logger.log(`Context ${contextId} deleted successfully`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete context ${contextId}`, error);
      return false;
    }
  }

  async archiveOldContexts(): Promise<number> {
    try {
      const archiveDate = new Date();
      archiveDate.setDate(archiveDate.getDate() - this.storageOptions.archiveAfterDays);

      // Find contexts to archive
      const contextsToArchive = await this.findContextsForArchive(archiveDate);
      let archivedCount = 0;

      for (const contextId of contextsToArchive) {
        const context = await this.loadFromDatabase(contextId);
        if (context) {
          const archived = await this.archiveContext(context);
          if (archived) {
            await this.deleteFromDatabase(contextId);
            archivedCount++;
          }
        }
      }

      this.logger.log(`Archived ${archivedCount} contexts`);
      return archivedCount;
    } catch (error) {
      this.logger.error('Failed to archive old contexts', error);
      return 0;
    }
  }

  async restoreArchivedContext(contextId: string): Promise<ConversationContext | null> {
    try {
      const archive = await this.findArchive(contextId);
      if (!archive) {
        return null;
      }

      const context = await this.loadFromArchive(archive);
      if (context) {
        // Restore to database
        await this.saveToDatabase(context);
        this.logger.log(`Context ${contextId} restored from archive`);
      }

      return context;
    } catch (error) {
      this.logger.error(`Failed to restore context ${contextId}`, error);
      return null;
    }
  }

  async getContextHistory(userId: string, limit = 100): Promise<Array<{
    contextId: string;
    sessionId: string;
    messageCount: number;
    tokenCount: number;
    createdAt: Date;
    lastUpdated: Date;
  }>> {
    try {
      // This would be implemented with proper database queries
      // For now, returning empty array as placeholder
      return [];
    } catch (error) {
      this.logger.error(`Failed to get context history for user ${userId}`, error);
      return [];
    }
  }

  private async initializeStorage(): Promise<void> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });
      await fs.mkdir(path.join(this.storagePath, 'contexts'), { recursive: true });
      await fs.mkdir(path.join(this.storagePath, 'archives'), { recursive: true });
      this.logger.log(`Context storage initialized at ${this.storagePath}`);
    } catch (error) {
      this.logger.error('Failed to initialize context storage', error);
    }
  }

  private async saveToDatabase(context: ConversationContext): Promise<void> {
    // In a real implementation, this would save to a contexts table
    // For now, we'll use a simple JSON storage approach
    
    const contextData = {
      id: context.id,
      userId: context.userId,
      agentId: context.agentId,
      sessionId: context.sessionId,
      messageCount: context.messages.length,
      tokenCount: context.tokenCount,
      metadata: JSON.stringify(context.metadata),
      createdAt: context.createdAt,
      updatedAt: context.updatedAt,
      lastAccessed: context.lastAccessed,
    };

    // This would be actual Prisma operations in production
    this.logger.debug(`Context metadata saved to database: ${context.id}`);
  }

  private async loadFromDatabase(contextId: string): Promise<ConversationContext | null> {
    // In a real implementation, this would query the database
    // For now, return null to fallback to file system
    return null;
  }

  private async deleteFromDatabase(contextId: string): Promise<void> {
    // Database deletion would happen here
    this.logger.debug(`Context metadata deleted from database: ${contextId}`);
  }

  private shouldPersistToFile(context: ConversationContext): boolean {
    // Persist to file if:
    // - Context has more than 10 messages
    // - Context is older than 1 hour
    // - Context has high importance
    const messageThreshold = 10;
    const ageThreshold = 60 * 60 * 1000; // 1 hour
    const age = Date.now() - new Date(context.createdAt).getTime();
    
    return context.messages.length >= messageThreshold || 
           age >= ageThreshold ||
           context.priority === 'high' || 
           context.priority === 'critical';
  }

  private async saveToFile(context: ConversationContext): Promise<void> {
    const filePath = path.join(this.storagePath, 'contexts', `${context.id}.json`);
    let data = JSON.stringify(context);

    if (this.storageOptions.compress) {
      const compressed = await gzip(Buffer.from(data));
      await fs.writeFile(filePath + '.gz', compressed);
      this.logger.debug(`Context ${context.id} saved compressed to file`);
    } else {
      await fs.writeFile(filePath, data);
      this.logger.debug(`Context ${context.id} saved to file`);
    }
  }

  private async loadFromFile(contextId: string): Promise<ConversationContext | null> {
    try {
      const filePath = path.join(this.storagePath, 'contexts', `${contextId}.json`);
      const compressedPath = filePath + '.gz';
      
      let data: string;
      
      try {
        // Try compressed file first
        const compressedData = await fs.readFile(compressedPath);
        const decompressed = await gunzip(compressedData);
        data = decompressed.toString();
      } catch {
        // Try uncompressed file
        data = await fs.readFile(filePath, 'utf-8');
      }

      const context = JSON.parse(data) as ConversationContext;
      
      // Convert date strings back to Date objects
      context.createdAt = new Date(context.createdAt);
      context.updatedAt = new Date(context.updatedAt);
      context.lastAccessed = new Date(context.lastAccessed);
      context.messages.forEach(msg => {
        msg.timestamp = new Date(msg.timestamp);
      });

      return context;
    } catch (error) {
      this.logger.debug(`Context ${contextId} not found in file system`);
      return null;
    }
  }

  private async deleteFromFile(contextId: string): Promise<void> {
    try {
      const filePath = path.join(this.storagePath, 'contexts', `${contextId}.json`);
      const compressedPath = filePath + '.gz';
      
      try {
        await fs.unlink(compressedPath);
      } catch {
        await fs.unlink(filePath);
      }
      
      this.logger.debug(`Context ${contextId} deleted from file system`);
    } catch (error) {
      this.logger.debug(`Context ${contextId} file deletion failed (may not exist)`);
    }
  }

  private async findContextsForArchive(archiveDate: Date): Promise<string[]> {
    // In a real implementation, this would query the database
    // for contexts older than archiveDate
    return [];
  }

  private async archiveContext(context: ConversationContext): Promise<boolean> {
    try {
      const archivePath = path.join(
        this.storagePath, 
        'archives', 
        `${context.id}_${Date.now()}.archive`
      );

      let data = JSON.stringify(context);
      if (this.storageOptions.compress) {
        const compressed = await gzip(Buffer.from(data));
        await fs.writeFile(archivePath, compressed);
      } else {
        await fs.writeFile(archivePath, data);
      }

      const archive: ContextArchive = {
        id: `archive_${context.id}_${Date.now()}`,
        contextId: context.id,
        userId: context.userId,
        archivedAt: new Date(),
        size: Buffer.byteLength(data),
        compressed: this.storageOptions.compress,
        location: archivePath,
        metadata: {
          originalMessageCount: context.messages.length,
          originalTokenCount: context.tokenCount,
          compressionLevel: context.compressionLevel,
        },
      };

      // Save archive metadata (would be in database in production)
      this.logger.log(`Context ${context.id} archived to ${archivePath}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to archive context ${context.id}`, error);
      return false;
    }
  }

  private async findArchive(contextId: string): Promise<ContextArchive | null> {
    // In a real implementation, this would query archive metadata
    // For now, try to find the archive file directly
    try {
      const archivesDir = path.join(this.storagePath, 'archives');
      const files = await fs.readdir(archivesDir);
      
      const archiveFile = files.find(file => file.startsWith(contextId));
      if (archiveFile) {
        return {
          id: `archive_${contextId}`,
          contextId,
          userId: 'unknown',
          archivedAt: new Date(),
          size: 0,
          compressed: this.storageOptions.compress,
          location: path.join(archivesDir, archiveFile),
          metadata: {},
        };
      }
    } catch (error) {
      this.logger.error(`Failed to find archive for context ${contextId}`, error);
    }
    
    return null;
  }

  private async loadFromArchive(archive: ContextArchive): Promise<ConversationContext | null> {
    try {
      let data: string;
      
      if (archive.compressed) {
        const compressedData = await fs.readFile(archive.location);
        const decompressed = await gunzip(compressedData);
        data = decompressed.toString();
      } else {
        data = await fs.readFile(archive.location, 'utf-8');
      }

      const context = JSON.parse(data) as ConversationContext;
      
      // Convert date strings back to Date objects
      context.createdAt = new Date(context.createdAt);
      context.updatedAt = new Date(context.updatedAt);
      context.lastAccessed = new Date(context.lastAccessed);
      context.messages.forEach(msg => {
        msg.timestamp = new Date(msg.timestamp);
      });

      return context;
    } catch (error) {
      this.logger.error(`Failed to load context from archive ${archive.id}`, error);
      return null;
    }
  }

  async getStorageStats(): Promise<{
    totalContexts: number;
    totalSize: number;
    compressedContexts: number;
    archivedContexts: number;
    storageUtilization: number;
  }> {
    try {
      const contextsDir = path.join(this.storagePath, 'contexts');
      const archivesDir = path.join(this.storagePath, 'archives');
      
      const contextFiles = await fs.readdir(contextsDir).catch(() => []);
      const archiveFiles = await fs.readdir(archivesDir).catch(() => []);
      
      let totalSize = 0;
      let compressedCount = 0;

      for (const file of contextFiles) {
        try {
          const stats = await fs.stat(path.join(contextsDir, file));
          totalSize += stats.size;
          if (file.endsWith('.gz')) compressedCount++;
        } catch (error) {
          // Ignore errors for individual files
        }
      }

      for (const file of archiveFiles) {
        try {
          const stats = await fs.stat(path.join(archivesDir, file));
          totalSize += stats.size;
        } catch (error) {
          // Ignore errors for individual files
        }
      }

      const maxStorageBytes = this.storageOptions.maxStorageSizeMB * 1024 * 1024;
      const utilization = maxStorageBytes > 0 ? (totalSize / maxStorageBytes) * 100 : 0;

      return {
        totalContexts: contextFiles.length,
        totalSize,
        compressedContexts: compressedCount,
        archivedContexts: archiveFiles.length,
        storageUtilization: utilization,
      };
    } catch (error) {
      this.logger.error('Failed to get storage stats', error);
      return {
        totalContexts: 0,
        totalSize: 0,
        compressedContexts: 0,
        archivedContexts: 0,
        storageUtilization: 0,
      };
    }
  }
}
