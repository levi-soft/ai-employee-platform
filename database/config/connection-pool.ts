
/**
 * Database Connection Pool Configuration
 * High-performance connection pooling for AI Employee Platform
 */

import { Pool, PoolConfig, PoolClient } from 'pg'
import { PrismaClient } from '@prisma/client'
import { logger } from '@ai-platform/shared-utils'

export interface DatabaseConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl?: boolean
  connectionTimeout?: number
  idleTimeout?: number
  maxConnections?: number
  minConnections?: number
}

export interface PoolStats {
  totalConnections: number
  idleConnections: number
  activeConnections: number
  waitingClients: number
  maxConnections: number
  averageQueryTime: number
  totalQueries: number
  errorCount: number
}

class DatabaseConnectionPool {
  private pool: Pool
  private prisma: PrismaClient
  private config: DatabaseConfig
  private queryStats: {
    totalQueries: number
    totalTime: number
    errorCount: number
    slowQueries: Array<{ query: string; time: number; timestamp: Date }>
  }
  private healthCheckInterval?: NodeJS.Timeout
  private connectionHistory: Array<{ timestamp: Date; event: string; details?: any }> = []

  constructor(config: DatabaseConfig) {
    this.config = config
    this.queryStats = {
      totalQueries: 0,
      totalTime: 0,
      errorCount: 0,
      slowQueries: []
    }

    this.initializeConnectionPool()
    this.initializePrisma()
    this.setupHealthChecks()
    this.setupEventHandlers()
  }

  private initializeConnectionPool(): void {
    const poolConfig: PoolConfig = {
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.username,
      password: this.config.password,
      
      // Connection pool settings
      max: this.config.maxConnections || 20, // Maximum connections
      min: this.config.minConnections || 5,  // Minimum connections
      idleTimeoutMillis: this.config.idleTimeout || 30000, // 30 seconds
      connectionTimeoutMillis: this.config.connectionTimeout || 10000, // 10 seconds
      
      // SSL configuration
      ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
      
      // Performance settings
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      
      // Advanced settings for high performance
      statement_timeout: 60000, // 60 seconds for query timeout
      query_timeout: 60000,
      connect_timeout: 10,
      application_name: 'ai_employee_platform'
    }

    this.pool = new Pool(poolConfig)

    logger.info('Database connection pool initialized', {
      host: this.config.host,
      database: this.config.database,
      maxConnections: poolConfig.max,
      minConnections: poolConfig.min
    })
  }

  private initializePrisma(): void {
    const databaseUrl = `postgresql://${this.config.username}:${this.config.password}@${this.config.host}:${this.config.port}/${this.config.database}?schema=public&connection_limit=${this.config.maxConnections || 20}&pool_timeout=20&connect_timeout=10`

    this.prisma = new PrismaClient({
      datasources: {
        db: { url: databaseUrl }
      },
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
      errorFormat: 'pretty'
    })

    // Setup Prisma event listeners for monitoring
    this.prisma.$on('query' as any, (e: any) => {
      this.queryStats.totalQueries++
      this.queryStats.totalTime += e.duration

      // Track slow queries (>1000ms)
      if (e.duration > 1000) {
        this.queryStats.slowQueries.push({
          query: e.query,
          time: e.duration,
          timestamp: new Date()
        })

        // Keep only last 50 slow queries
        if (this.queryStats.slowQueries.length > 50) {
          this.queryStats.slowQueries.shift()
        }

        logger.warn('Slow query detected', {
          query: e.query.substring(0, 200),
          duration: e.duration,
          params: e.params
        })
      }
    })

    this.prisma.$on('error' as any, (e: any) => {
      this.queryStats.errorCount++
      logger.error('Prisma query error', { error: e })
    })

    logger.info('Prisma client initialized with connection pooling')
  }

  private setupEventHandlers(): void {
    // Pool connection events
    this.pool.on('connect', (client) => {
      this.connectionHistory.push({
        timestamp: new Date(),
        event: 'connect',
        details: { totalCount: this.pool.totalCount }
      })
      
      logger.debug('Database client connected', {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount
      })
    })

    this.pool.on('acquire', (client) => {
      logger.debug('Database client acquired', {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount
      })
    })

    this.pool.on('error', (err, client) => {
      this.queryStats.errorCount++
      this.connectionHistory.push({
        timestamp: new Date(),
        event: 'error',
        details: { error: err.message }
      })
      
      logger.error('Database connection pool error', { error: err })
    })

    this.pool.on('remove', (client) => {
      this.connectionHistory.push({
        timestamp: new Date(),
        event: 'remove',
        details: { totalCount: this.pool.totalCount }
      })
      
      logger.debug('Database client removed', {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount
      })
    })

    // Cleanup connection history every hour
    setInterval(() => {
      const oneHourAgo = new Date(Date.now() - 3600000)
      this.connectionHistory = this.connectionHistory.filter(
        event => event.timestamp > oneHourAgo
      )
    }, 3600000)
  }

  private setupHealthChecks(): void {
    // Periodic health check every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.healthCheck()
      } catch (error) {
        logger.error('Database health check failed', { error })
      }
    }, 30000)

    logger.info('Database health checks enabled')
  }

  /**
   * Get a client from the connection pool
   */
  async getClient(): Promise<PoolClient> {
    try {
      const client = await this.pool.connect()
      return client
    } catch (error) {
      logger.error('Failed to acquire database client', { error })
      throw error
    }
  }

  /**
   * Get Prisma client instance
   */
  getPrisma(): PrismaClient {
    return this.prisma
  }

  /**
   * Execute a raw query with timing
   */
  async query(text: string, params?: any[]): Promise<any> {
    const startTime = Date.now()
    const client = await this.getClient()
    
    try {
      const result = await client.query(text, params)
      const duration = Date.now() - startTime
      
      this.queryStats.totalQueries++
      this.queryStats.totalTime += duration
      
      if (duration > 1000) {
        this.queryStats.slowQueries.push({
          query: text,
          time: duration,
          timestamp: new Date()
        })
        
        logger.warn('Slow raw query detected', {
          query: text.substring(0, 200),
          duration,
          params
        })
      }
      
      return result
    } catch (error) {
      this.queryStats.errorCount++
      logger.error('Raw query error', { query: text, params, error })
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Execute a transaction with automatic retry
   */
  async transaction<T>(callback: (client: PoolClient) => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: Error
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const client = await this.getClient()
      
      try {
        await client.query('BEGIN')
        const result = await callback(client)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        lastError = error as Error
        
        logger.warn(`Transaction attempt ${attempt} failed`, {
          error: error,
          willRetry: attempt < maxRetries
        })
        
        if (attempt < maxRetries) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
        }
      } finally {
        client.release()
      }
    }
    
    throw lastError!
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats(): PoolStats {
    const averageQueryTime = this.queryStats.totalQueries > 0 
      ? this.queryStats.totalTime / this.queryStats.totalQueries 
      : 0

    return {
      totalConnections: this.pool.totalCount,
      idleConnections: this.pool.idleCount,
      activeConnections: this.pool.totalCount - this.pool.idleCount,
      waitingClients: this.pool.waitingCount,
      maxConnections: this.config.maxConnections || 20,
      averageQueryTime,
      totalQueries: this.queryStats.totalQueries,
      errorCount: this.queryStats.errorCount
    }
  }

  /**
   * Get slow query report
   */
  getSlowQueries(limit = 10): Array<{ query: string; time: number; timestamp: Date }> {
    return this.queryStats.slowQueries
      .sort((a, b) => b.time - a.time)
      .slice(0, limit)
  }

  /**
   * Get connection history
   */
  getConnectionHistory(limit = 50): Array<{ timestamp: Date; event: string; details?: any }> {
    return this.connectionHistory
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit)
  }

  /**
   * Health check for database connectivity
   */
  async healthCheck(): Promise<{ status: string; details: any }> {
    try {
      const startTime = Date.now()
      
      // Test pool connection
      const client = await this.getClient()
      const poolTestResult = await client.query('SELECT 1 as test')
      client.release()
      
      // Test Prisma connection
      await this.prisma.$queryRaw`SELECT 1 as prisma_test`
      
      const responseTime = Date.now() - startTime
      const stats = this.getPoolStats()
      
      const health = {
        status: 'healthy',
        details: {
          responseTime,
          database: this.config.database,
          host: this.config.host,
          connectionPool: {
            totalConnections: stats.totalConnections,
            activeConnections: stats.activeConnections,
            idleConnections: stats.idleConnections,
            maxConnections: stats.maxConnections,
            utilization: `${Math.round((stats.activeConnections / stats.maxConnections) * 100)}%`
          },
          performance: {
            totalQueries: stats.totalQueries,
            averageQueryTime: Math.round(stats.averageQueryTime),
            errorCount: stats.errorCount,
            slowQueries: this.queryStats.slowQueries.length
          },
          timestamp: new Date().toISOString()
        }
      }

      // Log health status if there are issues
      if (stats.errorCount > 0 || this.queryStats.slowQueries.length > 10) {
        logger.warn('Database health check completed with issues', health.details)
      }
      
      return health
    } catch (error) {
      logger.error('Database health check failed', { error })
      return {
        status: 'unhealthy',
        details: {
          error: (error as Error).message,
          timestamp: new Date().toISOString()
        }
      }
    }
  }

  /**
   * Optimize database performance
   */
  async optimize(): Promise<{ message: string; results: any[] }> {
    const client = await this.getClient()
    const results = []

    try {
      // Update table statistics
      logger.info('Updating table statistics...')
      await client.query('ANALYZE')
      results.push({ operation: 'ANALYZE', status: 'completed' })

      // Get table sizes
      const tableSizes = await client.query(`
        SELECT schemaname, tablename, 
               pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
               pg_total_relation_size(schemaname||'.'||tablename) as bytes
        FROM pg_tables 
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
      `)
      
      results.push({
        operation: 'table_sizes',
        data: tableSizes.rows
      })

      // Check index usage
      const indexUsage = await client.query(`
        SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
        FROM pg_stat_user_indexes 
        WHERE schemaname = 'public'
        ORDER BY idx_scan DESC
        LIMIT 20
      `)
      
      results.push({
        operation: 'index_usage',
        data: indexUsage.rows
      })

      logger.info('Database optimization completed')
      
      return {
        message: 'Database optimization completed successfully',
        results
      }
    } catch (error) {
      logger.error('Database optimization failed', { error })
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down database connection pool...')
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }
    
    try {
      await this.prisma.$disconnect()
      await this.pool.end()
      logger.info('Database connection pool shutdown completed')
    } catch (error) {
      logger.error('Error during database shutdown', { error })
      throw error
    }
  }
}

// Singleton instance
let dbPool: DatabaseConnectionPool | null = null

/**
 * Initialize database connection pool
 */
export const initializeDatabasePool = (config: DatabaseConfig): DatabaseConnectionPool => {
  if (dbPool) {
    logger.warn('Database pool already initialized')
    return dbPool
  }

  dbPool = new DatabaseConnectionPool(config)
  return dbPool
}

/**
 * Get database connection pool instance
 */
export const getDatabasePool = (): DatabaseConnectionPool => {
  if (!dbPool) {
    throw new Error('Database pool not initialized. Call initializeDatabasePool() first.')
  }
  return dbPool
}

/**
 * Initialize from environment variables
 */
export const initializeDatabasePoolFromEnv = (): DatabaseConnectionPool => {
  const config: DatabaseConfig = {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME || 'ai_employee_platform',
    username: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
    ssl: process.env.DATABASE_SSL === 'true',
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000'),
    idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20'),
    minConnections: parseInt(process.env.DB_MIN_CONNECTIONS || '5')
  }

  return initializeDatabasePool(config)
}

export default DatabaseConnectionPool
export type { DatabaseConnectionPool }
