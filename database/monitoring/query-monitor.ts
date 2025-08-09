
/**
 * Database Query Monitoring and Performance Analysis
 * Advanced monitoring for AI Employee Platform database performance
 */

import { Pool, PoolClient } from 'pg'
import { getDatabasePool } from '../config/connection-pool'
import { logger } from '@ai-platform/shared-utils'

export interface QueryMetrics {
  queryId: string
  query: string
  calls: number
  totalTime: number
  meanTime: number
  minTime: number
  maxTime: number
  rows: number
  hitRatio: number
  lastExecuted: Date
  category: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'OTHER'
}

export interface TableMetrics {
  schemaname: string
  tablename: string
  seqScan: number
  seqTupRead: number
  idxScan: number
  idxTupFetch: number
  nTupIns: number
  nTupUpd: number
  nTupDel: number
  nTupHotUpd: number
  vacuumCount: number
  autovacuumCount: number
  analyzeCount: number
  autoanalyzeCount: number
}

export interface IndexMetrics {
  schemaname: string
  tablename: string
  indexname: string
  idxScan: number
  idxTupRead: number
  idxTupFetch: number
  size: string
  isUnused: boolean
}

export interface DatabaseHealth {
  status: 'healthy' | 'warning' | 'critical'
  score: number
  metrics: {
    connectionUtilization: number
    queryPerformance: number
    indexEfficiency: number
    tableHealth: number
  }
  issues: Array<{
    severity: 'low' | 'medium' | 'high' | 'critical'
    message: string
    recommendation: string
  }>
  recommendations: string[]
}

class DatabaseQueryMonitor {
  private dbPool: any
  private monitoringInterval?: NodeJS.Timeout
  private queryHistory: QueryMetrics[] = []
  private alertThresholds = {
    slowQueryTime: 1000, // 1 second
    highConnectionUtilization: 0.8, // 80%
    lowIndexUsage: 0.1, // 10%
    highTableScanRatio: 0.5 // 50%
  }

  constructor() {
    this.dbPool = getDatabasePool()
  }

  /**
   * Start continuous monitoring
   */
  startMonitoring(intervalMs = 60000): void {
    if (this.monitoringInterval) {
      logger.warn('Query monitoring already running')
      return
    }

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectMetrics()
      } catch (error) {
        logger.error('Error during query monitoring', { error })
      }
    }, intervalMs)

    logger.info('Database query monitoring started', { intervalMs })
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = undefined
      logger.info('Database query monitoring stopped')
    }
  }

  /**
   * Collect comprehensive database metrics
   */
  private async collectMetrics(): Promise<void> {
    const client = await this.dbPool.getClient()
    
    try {
      // Collect slow queries
      await this.collectSlowQueries(client)
      
      // Collect table statistics
      await this.collectTableMetrics(client)
      
      // Collect index usage
      await this.collectIndexMetrics(client)
      
      // Analyze query patterns
      await this.analyzeQueryPatterns(client)
      
      // Check for performance issues
      await this.detectPerformanceIssues(client)
      
    } catch (error) {
      logger.error('Error collecting database metrics', { error })
    } finally {
      client.release()
    }
  }

  /**
   * Collect slow query statistics
   */
  private async collectSlowQueries(client: PoolClient): Promise<QueryMetrics[]> {
    try {
      const result = await client.query(`
        SELECT 
          query,
          calls,
          total_exec_time as total_time,
          mean_exec_time as mean_time,
          min_exec_time as min_time,
          max_exec_time as max_time,
          rows,
          100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) as hit_ratio
        FROM pg_stat_statements 
        WHERE mean_exec_time > $1
        ORDER BY mean_exec_time DESC 
        LIMIT 20
      `, [this.alertThresholds.slowQueryTime])

      const slowQueries: QueryMetrics[] = result.rows.map(row => ({
        queryId: this.generateQueryId(row.query),
        query: row.query,
        calls: parseInt(row.calls),
        totalTime: parseFloat(row.total_time),
        meanTime: parseFloat(row.mean_time),
        minTime: parseFloat(row.min_time),
        maxTime: parseFloat(row.max_time),
        rows: parseInt(row.rows),
        hitRatio: parseFloat(row.hit_ratio) || 0,
        lastExecuted: new Date(),
        category: this.categorizeQuery(row.query)
      }))

      if (slowQueries.length > 0) {
        logger.warn(`Found ${slowQueries.length} slow queries`, {
          slowestQuery: {
            meanTime: slowQueries[0].meanTime,
            calls: slowQueries[0].calls
          }
        })
      }

      return slowQueries
    } catch (error) {
      logger.error('Error collecting slow queries', { error })
      return []
    }
  }

  /**
   * Collect table performance metrics
   */
  private async collectTableMetrics(client: PoolClient): Promise<TableMetrics[]> {
    try {
      const result = await client.query(`
        SELECT 
          schemaname,
          tablename,
          seq_scan,
          seq_tup_read,
          idx_scan,
          idx_tup_fetch,
          n_tup_ins,
          n_tup_upd,
          n_tup_del,
          n_tup_hot_upd,
          vacuum_count,
          autovacuum_count,
          analyze_count,
          autoanalyze_count
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY seq_scan DESC
      `)

      const tableMetrics: TableMetrics[] = result.rows.map(row => ({
        schemaname: row.schemaname,
        tablename: row.tablename,
        seqScan: parseInt(row.seq_scan) || 0,
        seqTupRead: parseInt(row.seq_tup_read) || 0,
        idxScan: parseInt(row.idx_scan) || 0,
        idxTupFetch: parseInt(row.idx_tup_fetch) || 0,
        nTupIns: parseInt(row.n_tup_ins) || 0,
        nTupUpd: parseInt(row.n_tup_upd) || 0,
        nTupDel: parseInt(row.n_tup_del) || 0,
        nTupHotUpd: parseInt(row.n_tup_hot_upd) || 0,
        vacuumCount: parseInt(row.vacuum_count) || 0,
        autovacuumCount: parseInt(row.autovacuum_count) || 0,
        analyzeCount: parseInt(row.analyze_count) || 0,
        autoanalyzeCount: parseInt(row.autoanalyze_count) || 0
      }))

      // Log tables with high sequential scan ratios
      const tablesWithHighSeqScans = tableMetrics.filter(table => {
        const totalScans = table.seqScan + table.idxScan
        const seqScanRatio = totalScans > 0 ? table.seqScan / totalScans : 0
        return seqScanRatio > this.alertThresholds.highTableScanRatio && totalScans > 100
      })

      if (tablesWithHighSeqScans.length > 0) {
        logger.warn('Tables with high sequential scan ratio detected', {
          tables: tablesWithHighSeqScans.map(t => ({
            table: t.tablename,
            seqScans: t.seqScan,
            idxScans: t.idxScan,
            ratio: Math.round((t.seqScan / (t.seqScan + t.idxScan)) * 100)
          }))
        })
      }

      return tableMetrics
    } catch (error) {
      logger.error('Error collecting table metrics', { error })
      return []
    }
  }

  /**
   * Collect index usage metrics
   */
  private async collectIndexMetrics(client: PoolClient): Promise<IndexMetrics[]> {
    try {
      const result = await client.query(`
        SELECT 
          schemaname,
          tablename,
          indexname,
          idx_scan,
          idx_tup_read,
          idx_tup_fetch,
          pg_size_pretty(pg_relation_size(indexrelid)) as size
        FROM pg_stat_user_indexes
        WHERE schemaname = 'public'
        ORDER BY idx_scan DESC
      `)

      const indexMetrics: IndexMetrics[] = result.rows.map(row => ({
        schemaname: row.schemaname,
        tablename: row.tablename,
        indexname: row.indexname,
        idxScan: parseInt(row.idx_scan) || 0,
        idxTupRead: parseInt(row.idx_tup_read) || 0,
        idxTupFetch: parseInt(row.idx_tup_fetch) || 0,
        size: row.size,
        isUnused: parseInt(row.idx_scan) === 0
      }))

      // Log unused indexes
      const unusedIndexes = indexMetrics.filter(idx => idx.isUnused)
      if (unusedIndexes.length > 0) {
        logger.warn('Unused indexes detected', {
          count: unusedIndexes.length,
          indexes: unusedIndexes.map(idx => ({
            name: idx.indexname,
            table: idx.tablename,
            size: idx.size
          }))
        })
      }

      return indexMetrics
    } catch (error) {
      logger.error('Error collecting index metrics', { error })
      return []
    }
  }

  /**
   * Analyze query patterns and performance
   */
  private async analyzeQueryPatterns(client: PoolClient): Promise<void> {
    try {
      // Get query pattern distribution
      const patternResult = await client.query(`
        SELECT 
          CASE 
            WHEN query ILIKE 'SELECT%' THEN 'SELECT'
            WHEN query ILIKE 'INSERT%' THEN 'INSERT'
            WHEN query ILIKE 'UPDATE%' THEN 'UPDATE'
            WHEN query ILIKE 'DELETE%' THEN 'DELETE'
            ELSE 'OTHER'
          END as query_type,
          COUNT(*) as count,
          AVG(mean_exec_time) as avg_time,
          SUM(calls) as total_calls
        FROM pg_stat_statements
        GROUP BY query_type
        ORDER BY total_calls DESC
      `)

      const patterns = patternResult.rows.map(row => ({
        type: row.query_type,
        count: parseInt(row.count),
        avgTime: parseFloat(row.avg_time) || 0,
        totalCalls: parseInt(row.total_calls)
      }))

      logger.info('Query pattern analysis', { patterns })

      // Check for concerning patterns
      patterns.forEach(pattern => {
        if (pattern.avgTime > this.alertThresholds.slowQueryTime) {
          logger.warn(`Slow ${pattern.type} queries detected`, {
            avgTime: Math.round(pattern.avgTime),
            count: pattern.count,
            totalCalls: pattern.totalCalls
          })
        }
      })
    } catch (error) {
      logger.error('Error analyzing query patterns', { error })
    }
  }

  /**
   * Detect performance issues and generate recommendations
   */
  private async detectPerformanceIssues(client: PoolClient): Promise<void> {
    try {
      const issues = []
      
      // Check connection pool utilization
      const poolStats = this.dbPool.getPoolStats()
      const connectionUtilization = poolStats.activeConnections / poolStats.maxConnections
      
      if (connectionUtilization > this.alertThresholds.highConnectionUtilization) {
        issues.push({
          type: 'high_connection_utilization',
          message: `Connection pool utilization is ${Math.round(connectionUtilization * 100)}%`,
          recommendation: 'Consider increasing max connections or optimizing query performance'
        })
      }

      // Check for lock contention
      const lockResult = await client.query(`
        SELECT count(*) as blocked_queries
        FROM pg_stat_activity 
        WHERE wait_event_type = 'Lock' AND state = 'active'
      `)
      
      const blockedQueries = parseInt(lockResult.rows[0].blocked_queries)
      if (blockedQueries > 0) {
        issues.push({
          type: 'lock_contention',
          message: `${blockedQueries} queries are blocked by locks`,
          recommendation: 'Review transaction patterns and consider shorter transaction times'
        })
      }

      // Check database size growth
      const sizeResult = await client.query(`
        SELECT pg_size_pretty(pg_database_size(current_database())) as db_size
      `)
      
      logger.info('Performance issue check completed', {
        connectionUtilization: Math.round(connectionUtilization * 100),
        blockedQueries,
        databaseSize: sizeResult.rows[0].db_size,
        issuesFound: issues.length
      })

      if (issues.length > 0) {
        logger.warn('Performance issues detected', { issues })
      }
    } catch (error) {
      logger.error('Error detecting performance issues', { error })
    }
  }

  /**
   * Get comprehensive database health report
   */
  async getDatabaseHealth(): Promise<DatabaseHealth> {
    const client = await this.dbPool.getClient()
    const issues: Array<{ severity: any; message: string; recommendation: string }> = []
    const recommendations: string[] = []
    
    try {
      // Connection health
      const poolStats = this.dbPool.getPoolStats()
      const connectionUtilization = poolStats.activeConnections / poolStats.maxConnections
      
      // Query performance health
      const slowQueries = await this.collectSlowQueries(client)
      const queryPerformanceScore = Math.max(0, 100 - (slowQueries.length * 10))
      
      // Index efficiency
      const indexMetrics = await this.collectIndexMetrics(client)
      const unusedIndexes = indexMetrics.filter(idx => idx.isUnused)
      const indexEfficiency = Math.max(0, 100 - (unusedIndexes.length * 5))
      
      // Overall health score
      const healthScore = Math.round(
        (queryPerformanceScore * 0.4) +
        (indexEfficiency * 0.3) +
        ((1 - connectionUtilization) * 100 * 0.3)
      )
      
      // Generate issues and recommendations
      if (connectionUtilization > 0.8) {
        issues.push({
          severity: 'high',
          message: `High connection pool utilization (${Math.round(connectionUtilization * 100)}%)`,
          recommendation: 'Consider increasing max connections or optimizing query performance'
        })
        recommendations.push('Optimize slow queries to reduce connection hold time')
      }
      
      if (slowQueries.length > 5) {
        issues.push({
          severity: 'medium',
          message: `${slowQueries.length} slow queries detected`,
          recommendation: 'Review and optimize slow queries, add missing indexes'
        })
        recommendations.push('Add performance indexes for frequently queried columns')
      }
      
      if (unusedIndexes.length > 3) {
        issues.push({
          severity: 'low',
          message: `${unusedIndexes.length} unused indexes found`,
          recommendation: 'Consider removing unused indexes to improve write performance'
        })
        recommendations.push('Regular index maintenance and cleanup')
      }

      const health: DatabaseHealth = {
        status: healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'warning' : 'critical',
        score: healthScore,
        metrics: {
          connectionUtilization: Math.round(connectionUtilization * 100),
          queryPerformance: queryPerformanceScore,
          indexEfficiency: indexEfficiency,
          tableHealth: 85 // Placeholder - would need more detailed analysis
        },
        issues,
        recommendations
      }
      
      logger.info('Database health assessment completed', {
        score: healthScore,
        status: health.status,
        issueCount: issues.length
      })
      
      return health
    } catch (error) {
      logger.error('Error generating database health report', { error })
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Get query performance report
   */
  async getQueryPerformanceReport(): Promise<{
    slowQueries: QueryMetrics[]
    queryDistribution: any[]
    indexUsage: IndexMetrics[]
    recommendations: string[]
  }> {
    const client = await this.dbPool.getClient()
    
    try {
      const slowQueries = await this.collectSlowQueries(client)
      const indexUsage = await this.collectIndexMetrics(client)
      
      // Query distribution
      const distributionResult = await client.query(`
        SELECT 
          CASE 
            WHEN query ILIKE 'SELECT%' THEN 'SELECT'
            WHEN query ILIKE 'INSERT%' THEN 'INSERT'
            WHEN query ILIKE 'UPDATE%' THEN 'UPDATE'
            WHEN query ILIKE 'DELETE%' THEN 'DELETE'
            ELSE 'OTHER'
          END as type,
          COUNT(*) as count,
          ROUND(AVG(mean_exec_time)::numeric, 2) as avg_time,
          SUM(calls) as total_calls
        FROM pg_stat_statements
        GROUP BY type
        ORDER BY total_calls DESC
      `)
      
      const recommendations = this.generatePerformanceRecommendations(slowQueries, indexUsage)
      
      return {
        slowQueries,
        queryDistribution: distributionResult.rows,
        indexUsage,
        recommendations
      }
    } catch (error) {
      logger.error('Error generating query performance report', { error })
      throw error
    } finally {
      client.release()
    }
  }

  /**
   * Generate performance optimization recommendations
   */
  private generatePerformanceRecommendations(
    slowQueries: QueryMetrics[],
    indexUsage: IndexMetrics[]
  ): string[] {
    const recommendations = []
    
    if (slowQueries.length > 0) {
      recommendations.push(`Optimize ${slowQueries.length} slow queries detected`)
      
      const selectQueries = slowQueries.filter(q => q.category === 'SELECT')
      if (selectQueries.length > 0) {
        recommendations.push('Add indexes for frequently accessed columns in SELECT queries')
      }
      
      const updateQueries = slowQueries.filter(q => q.category === 'UPDATE')
      if (updateQueries.length > 0) {
        recommendations.push('Consider batch updates and optimize WHERE clauses')
      }
    }
    
    const unusedIndexes = indexUsage.filter(idx => idx.isUnused)
    if (unusedIndexes.length > 0) {
      recommendations.push(`Remove ${unusedIndexes.length} unused indexes to improve write performance`)
    }
    
    const poolStats = this.dbPool.getPoolStats()
    if (poolStats.averageQueryTime > 500) {
      recommendations.push('Overall query performance is slow - review database design')
    }
    
    return recommendations
  }

  /**
   * Utility methods
   */
  private generateQueryId(query: string): string {
    return Buffer.from(query.substring(0, 100)).toString('base64')
  }

  private categorizeQuery(query: string): 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'OTHER' {
    const upperQuery = query.toUpperCase().trim()
    if (upperQuery.startsWith('SELECT')) return 'SELECT'
    if (upperQuery.startsWith('INSERT')) return 'INSERT'
    if (upperQuery.startsWith('UPDATE')) return 'UPDATE'
    if (upperQuery.startsWith('DELETE')) return 'DELETE'
    return 'OTHER'
  }
}

// Singleton instance
let queryMonitor: DatabaseQueryMonitor | null = null

/**
 * Initialize database query monitor
 */
export const initializeQueryMonitor = (): DatabaseQueryMonitor => {
  if (!queryMonitor) {
    queryMonitor = new DatabaseQueryMonitor()
  }
  return queryMonitor
}

/**
 * Get query monitor instance
 */
export const getQueryMonitor = (): DatabaseQueryMonitor => {
  if (!queryMonitor) {
    queryMonitor = initializeQueryMonitor()
  }
  return queryMonitor
}

export default DatabaseQueryMonitor
