
import { PrismaClient, Plugin, PluginStatus } from '@prisma/client';
import { createServiceLogger } from '@ai-platform/shared-utils';
import { z } from 'zod';

const logger = createServiceLogger('plugin-marketplace');

// Validation schemas
const PluginSearchSchema = z.object({
  query: z.string().optional(),
  category: z.string().optional(),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DELETED']).optional(),
  featured: z.boolean().optional(),
  limit: z.number().min(1).max(100).optional().default(20),
  offset: z.number().min(0).optional().default(0),
  sortBy: z.enum(['name', 'createdAt', 'downloads', 'rating']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
});

const PluginRatingSchema = z.object({
  rating: z.number().min(1).max(5),
  review: z.string().max(500).optional()
});

export interface PluginSearchOptions {
  query?: string;
  category?: string;
  author?: string;
  tags?: string[];
  status?: PluginStatus;
  featured?: boolean;
  limit?: number;
  offset?: number;
  sortBy?: 'name' | 'createdAt' | 'downloads' | 'rating';
  sortOrder?: 'asc' | 'desc';
}

export interface MarketplacePlugin extends Plugin {
  downloadCount: number;
  averageRating: number;
  ratingCount: number;
  isFeatured: boolean;
  compatibility: string[];
  screenshots?: string[];
  documentation?: string;
  changeLog?: string;
}

export interface PluginStats {
  totalPlugins: number;
  activePlugins: number;
  categories: Array<{ category: string; count: number }>;
  topAuthors: Array<{ author: string; count: number }>;
  recentlyAdded: Plugin[];
  mostDownloaded: Plugin[];
  highestRated: Plugin[];
}

export class MarketplaceService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Search plugins in marketplace with advanced filtering
   */
  async searchPlugins(options: PluginSearchOptions) {
    const validOptions = PluginSearchSchema.parse(options);
    
    logger.info('Searching marketplace plugins', { 
      query: validOptions.query,
      category: validOptions.category,
      limit: validOptions.limit
    });

    try {
      // Build where clause
      const where: any = {
        status: validOptions.status || 'ACTIVE'
      };

      if (validOptions.query) {
        where.OR = [
          { name: { contains: validOptions.query, mode: 'insensitive' } },
          { description: { contains: validOptions.query, mode: 'insensitive' } },
          { author: { contains: validOptions.query, mode: 'insensitive' } }
        ];
      }

      if (validOptions.category) {
        where.category = validOptions.category;
      }

      if (validOptions.author) {
        where.author = validOptions.author;
      }

      if (validOptions.tags && validOptions.tags.length > 0) {
        where.tags = { hasSome: validOptions.tags };
      }

      // Build order by clause
      let orderBy: any = {};
      switch (validOptions.sortBy) {
        case 'name':
          orderBy = { name: validOptions.sortOrder };
          break;
        case 'downloads':
          orderBy = { downloadCount: validOptions.sortOrder };
          break;
        case 'rating':
          orderBy = { averageRating: validOptions.sortOrder };
          break;
        default:
          orderBy = { createdAt: validOptions.sortOrder };
      }

      // Execute search
      const [plugins, total] = await Promise.all([
        this.prisma.plugin.findMany({
          where,
          orderBy,
          take: validOptions.limit,
          skip: validOptions.offset,
          select: {
            id: true,
            name: true,
            version: true,
            author: true,
            description: true,
            category: true,
            tags: true,
            status: true,
            createdAt: true,
            lastUpdated: true,
            downloadCount: true,
            averageRating: true,
            ratingCount: true,
            isFeatured: true,
            compatibility: true,
            screenshots: true,
            _count: {
              select: { userPlugins: { where: { status: 'ACTIVE' } } }
            }
          }
        }),
        this.prisma.plugin.count({ where })
      ]);

      logger.info('Marketplace search completed', {
        resultCount: plugins.length,
        totalMatching: total
      });

      return {
        plugins,
        total,
        hasMore: validOptions.offset + validOptions.limit < total,
        pagination: {
          limit: validOptions.limit,
          offset: validOptions.offset,
          page: Math.floor(validOptions.offset / validOptions.limit) + 1,
          totalPages: Math.ceil(total / validOptions.limit)
        }
      };
    } catch (error) {
      logger.error('Marketplace search failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get featured plugins for marketplace homepage
   */
  async getFeaturedPlugins(limit: number = 10): Promise<Plugin[]> {
    logger.info('Fetching featured plugins', { limit });

    try {
      const featuredPlugins = await this.prisma.plugin.findMany({
        where: {
          status: 'ACTIVE',
          isFeatured: true
        },
        orderBy: [
          { averageRating: 'desc' },
          { downloadCount: 'desc' }
        ],
        take: limit,
        select: {
          id: true,
          name: true,
          version: true,
          author: true,
          description: true,
          category: true,
          tags: true,
          createdAt: true,
          downloadCount: true,
          averageRating: true,
          ratingCount: true,
          screenshots: true,
          compatibility: true
        }
      });

      logger.info('Featured plugins fetched', { count: featuredPlugins.length });

      return featuredPlugins;
    } catch (error) {
      logger.error('Failed to fetch featured plugins', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get marketplace statistics
   */
  async getMarketplaceStats(): Promise<PluginStats> {
    logger.info('Fetching marketplace statistics');

    try {
      const [
        totalPlugins,
        activePlugins,
        categoryStats,
        authorStats,
        recentlyAdded,
        mostDownloaded,
        highestRated
      ] = await Promise.all([
        // Total plugins count
        this.prisma.plugin.count(),
        
        // Active plugins count
        this.prisma.plugin.count({ where: { status: 'ACTIVE' } }),
        
        // Plugins by category
        this.prisma.plugin.groupBy({
          by: ['category'],
          where: { status: 'ACTIVE' },
          _count: { category: true },
          orderBy: { _count: { category: 'desc' } },
          take: 10
        }),
        
        // Plugins by author
        this.prisma.plugin.groupBy({
          by: ['author'],
          where: { status: 'ACTIVE' },
          _count: { author: true },
          orderBy: { _count: { author: 'desc' } },
          take: 10
        }),
        
        // Recently added plugins
        this.prisma.plugin.findMany({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            name: true,
            author: true,
            description: true,
            category: true,
            createdAt: true
          }
        }),
        
        // Most downloaded plugins
        this.prisma.plugin.findMany({
          where: { status: 'ACTIVE' },
          orderBy: { downloadCount: 'desc' },
          take: 5,
          select: {
            id: true,
            name: true,
            author: true,
            description: true,
            downloadCount: true
          }
        }),
        
        // Highest rated plugins
        this.prisma.plugin.findMany({
          where: { 
            status: 'ACTIVE',
            ratingCount: { gt: 0 }
          },
          orderBy: [
            { averageRating: 'desc' },
            { ratingCount: 'desc' }
          ],
          take: 5,
          select: {
            id: true,
            name: true,
            author: true,
            description: true,
            averageRating: true,
            ratingCount: true
          }
        })
      ]);

      const stats: PluginStats = {
        totalPlugins,
        activePlugins,
        categories: categoryStats.map(stat => ({
          category: stat.category || 'uncategorized',
          count: stat._count.category
        })),
        topAuthors: authorStats.map(stat => ({
          author: stat.author,
          count: stat._count.author
        })),
        recentlyAdded,
        mostDownloaded,
        highestRated
      };

      logger.info('Marketplace statistics generated', {
        totalPlugins,
        activePlugins,
        categoriesCount: stats.categories.length
      });

      return stats;
    } catch (error) {
      logger.error('Failed to generate marketplace statistics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get plugin details for marketplace
   */
  async getPluginDetails(pluginId: string): Promise<MarketplacePlugin | null> {
    logger.info('Fetching plugin details', { pluginId });

    try {
      const plugin = await this.prisma.plugin.findUnique({
        where: { id: pluginId },
        include: {
          userPlugins: {
            where: { status: 'ACTIVE' },
            select: { userId: true, installedAt: true }
          },
          _count: {
            select: { userPlugins: { where: { status: 'ACTIVE' } } }
          }
        }
      });

      if (!plugin) {
        logger.warn('Plugin not found', { pluginId });
        return null;
      }

      // Increment view count (simple analytics)
      await this.prisma.plugin.update({
        where: { id: pluginId },
        data: { 
          viewCount: { increment: 1 }
        }
      }).catch(err => {
        logger.warn('Failed to increment view count', { pluginId, error: err.message });
      });

      logger.info('Plugin details fetched', { 
        pluginId, 
        name: plugin.name,
        activeInstallations: plugin._count.userPlugins
      });

      return plugin as MarketplacePlugin;
    } catch (error) {
      logger.error('Failed to fetch plugin details', {
        pluginId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Download plugin (increment download counter)
   */
  async downloadPlugin(pluginId: string, userId: string): Promise<void> {
    logger.info('Recording plugin download', { pluginId, userId });

    try {
      await this.prisma.plugin.update({
        where: { id: pluginId },
        data: { downloadCount: { increment: 1 } }
      });

      // Log download event for analytics
      logger.info('Plugin download recorded', { pluginId, userId });
    } catch (error) {
      logger.error('Failed to record plugin download', {
        pluginId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Rate a plugin
   */
  async ratePlugin(
    pluginId: string, 
    userId: string, 
    ratingData: { rating: number; review?: string }
  ): Promise<void> {
    const validData = PluginRatingSchema.parse(ratingData);
    
    logger.info('Recording plugin rating', { 
      pluginId, 
      userId, 
      rating: validData.rating 
    });

    try {
      // This would typically involve a separate ratings table
      // For now, we'll update aggregate values
      const plugin = await this.prisma.plugin.findUnique({
        where: { id: pluginId },
        select: { averageRating: true, ratingCount: true }
      });

      if (!plugin) {
        throw new Error('Plugin not found');
      }

      // Calculate new average (simplified - in production, use proper rating table)
      const currentTotal = plugin.averageRating * plugin.ratingCount;
      const newRatingCount = plugin.ratingCount + 1;
      const newAverage = (currentTotal + validData.rating) / newRatingCount;

      await this.prisma.plugin.update({
        where: { id: pluginId },
        data: {
          averageRating: Math.round(newAverage * 100) / 100, // Round to 2 decimal places
          ratingCount: newRatingCount
        }
      });

      logger.info('Plugin rating recorded', { 
        pluginId, 
        userId, 
        newAverage: Math.round(newAverage * 100) / 100,
        newRatingCount 
      });
    } catch (error) {
      logger.error('Failed to record plugin rating', {
        pluginId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get plugin categories
   */
  async getCategories(): Promise<Array<{ category: string; count: number }>> {
    logger.info('Fetching plugin categories');

    try {
      const categories = await this.prisma.plugin.groupBy({
        by: ['category'],
        where: { status: 'ACTIVE' },
        _count: { category: true },
        orderBy: { _count: { category: 'desc' } }
      });

      return categories.map(cat => ({
        category: cat.category || 'uncategorized',
        count: cat._count.category
      }));
    } catch (error) {
      logger.error('Failed to fetch categories', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Mark plugin as featured/unfeatured (admin only)
   */
  async toggleFeaturedStatus(pluginId: string, featured: boolean): Promise<Plugin> {
    logger.info('Toggling plugin featured status', { pluginId, featured });

    try {
      const plugin = await this.prisma.plugin.update({
        where: { id: pluginId },
        data: { isFeatured: featured }
      });

      logger.info('Plugin featured status updated', { 
        pluginId, 
        name: plugin.name, 
        featured 
      });

      return plugin;
    } catch (error) {
      logger.error('Failed to toggle featured status', {
        pluginId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}
