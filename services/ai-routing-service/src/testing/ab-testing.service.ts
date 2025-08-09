
import { logger } from '@ai-platform/shared-utils'

export interface ABTestConfig {
  name: string
  description: string
  variants: ABVariant[]
  trafficSplit: Record<string, number>
  startDate: Date
  endDate?: Date
  status: 'draft' | 'running' | 'paused' | 'completed' | 'cancelled'
  successMetrics: string[]
  metadata: Record<string, any>
}

export interface ABVariant {
  id: string
  name: string
  description: string
  config: VariantConfig
  weight: number
  isControl: boolean
}

export interface VariantConfig {
  routingStrategy: 'default' | 'ml-optimized' | 'cost-optimized' | 'quality-optimized' | 'custom'
  weightAdjustments: Record<string, number>
  algorithmParams: Record<string, any>
  fallbackBehavior: 'default' | 'conservative' | 'aggressive'
  customRules?: CustomRoutingRule[]
}

export interface CustomRoutingRule {
  condition: string
  action: string
  priority: number
  enabled: boolean
}

export interface ABTestResult {
  testId: string
  variant: string
  userId?: string
  requestId: string
  metrics: TestMetrics
  timestamp: Date
  metadata: Record<string, any>
}

export interface TestMetrics {
  responseTime: number
  cost: number
  quality: number
  userSatisfaction?: number
  success: boolean
  errorRate: number
  throughput: number
  [key: string]: any
}

export interface ABTestAnalysis {
  testId: string
  status: 'insufficient_data' | 'no_significant_difference' | 'significant_improvement' | 'significant_degradation'
  confidence: number
  results: VariantAnalysis[]
  recommendations: string[]
  statisticalData: {
    sampleSize: Record<string, number>
    significanceLevel: number
    pValue: number
    effectSize: number
    confidenceInterval: [number, number]
  }
}

export interface VariantAnalysis {
  variantId: string
  name: string
  isControl: boolean
  metrics: {
    avgResponseTime: number
    avgCost: number
    avgQuality: number
    successRate: number
    sampleSize: number
    conversions: number
  }
  improvement: {
    responseTime: { percentage: number; significant: boolean }
    cost: { percentage: number; significant: boolean }
    quality: { percentage: number; significant: boolean }
    successRate: { percentage: number; significant: boolean }
  }
}

export class ABTestingService {
  private activeTests: Map<string, ABTestConfig> = new Map()
  private testResults: Map<string, ABTestResult[]> = new Map()
  private userAssignments: Map<string, Map<string, string>> = new Map() // userId -> testId -> variantId
  private testHistory: Array<{
    test: ABTestConfig
    analysis: ABTestAnalysis
    completedAt: Date
  }> = []

  constructor() {
    logger.info('A/B Testing Service initialized')
    this.initializeDefaultTests()
  }

  // Create a new A/B test
  async createTest(testConfig: Omit<ABTestConfig, 'status'>): Promise<string> {
    try {
      const testId = this.generateTestId()
      
      const fullConfig: ABTestConfig = {
        ...testConfig,
        status: 'draft'
      }

      // Validate test configuration
      this.validateTestConfig(fullConfig)
      
      this.activeTests.set(testId, fullConfig)
      this.testResults.set(testId, [])

      logger.info('A/B test created', {
        testId,
        name: testConfig.name,
        variants: testConfig.variants.length,
        startDate: testConfig.startDate
      })

      return testId

    } catch (error) {
      logger.error('Error creating A/B test', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to create A/B test')
    }
  }

  // Start an A/B test
  async startTest(testId: string): Promise<void> {
    try {
      const test = this.activeTests.get(testId)
      if (!test) {
        throw new Error('Test not found')
      }

      if (test.status !== 'draft') {
        throw new Error(`Cannot start test in status: ${test.status}`)
      }

      // Validate test is ready to start
      this.validateTestReadiness(test)

      test.status = 'running'
      test.startDate = new Date()

      logger.info('A/B test started', {
        testId,
        name: test.name,
        variants: test.variants.map(v => v.name)
      })

    } catch (error) {
      logger.error('Error starting A/B test', {
        testId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to start A/B test')
    }
  }

  // Assign user to test variant
  async assignUserToVariant(userId: string, requestContext: any): Promise<{
    assignments: Array<{
      testId: string
      testName: string
      variantId: string
      variantName: string
      config: VariantConfig
    }>
  }> {
    try {
      const assignments: Array<{
        testId: string
        testName: string
        variantId: string
        variantName: string
        config: VariantConfig
      }> = []

      // Check all active tests
      for (const [testId, test] of this.activeTests.entries()) {
        if (test.status !== 'running') continue

        // Check if test has ended
        if (test.endDate && new Date() > test.endDate) {
          await this.completeTest(testId)
          continue
        }

        // Check if user is eligible for this test
        if (!this.isUserEligible(userId, test, requestContext)) {
          continue
        }

        // Get or assign variant for this user
        let variantId = this.getUserAssignment(userId, testId)
        
        if (!variantId) {
          variantId = this.assignVariant(userId, test)
          this.setUserAssignment(userId, testId, variantId)
        }

        const variant = test.variants.find(v => v.id === variantId)
        if (variant) {
          assignments.push({
            testId,
            testName: test.name,
            variantId: variant.id,
            variantName: variant.name,
            config: variant.config
          })
        }
      }

      return { assignments }

    } catch (error) {
      logger.error('Error assigning user to variants', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      
      return { assignments: [] }
    }
  }

  // Record test result
  async recordTestResult(
    testId: string,
    variantId: string,
    requestId: string,
    metrics: TestMetrics,
    userId?: string
  ): Promise<void> {
    try {
      const test = this.activeTests.get(testId)
      if (!test || test.status !== 'running') {
        return // Silently ignore results for inactive tests
      }

      const result: ABTestResult = {
        testId,
        variant: variantId,
        userId,
        requestId,
        metrics,
        timestamp: new Date(),
        metadata: {
          testName: test.name,
          variantName: test.variants.find(v => v.id === variantId)?.name
        }
      }

      const testResults = this.testResults.get(testId) || []
      testResults.push(result)
      this.testResults.set(testId, testResults)

      // Check if we should analyze results
      if (testResults.length % 100 === 0) { // Every 100 results
        await this.analyzeTest(testId)
      }

      logger.debug('Test result recorded', {
        testId,
        variantId,
        requestId,
        success: metrics.success,
        responseTime: metrics.responseTime
      })

    } catch (error) {
      logger.error('Error recording test result', {
        testId,
        variantId,
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  // Analyze test results
  async analyzeTest(testId: string): Promise<ABTestAnalysis> {
    try {
      const test = this.activeTests.get(testId)
      const results = this.testResults.get(testId) || []

      if (!test) {
        throw new Error('Test not found')
      }

      if (results.length < 30) {
        return {
          testId,
          status: 'insufficient_data',
          confidence: 0,
          results: [],
          recommendations: ['Continue collecting data - need at least 30 samples per variant'],
          statisticalData: {
            sampleSize: {},
            significanceLevel: 0.05,
            pValue: 1.0,
            effectSize: 0,
            confidenceInterval: [0, 0]
          }
        }
      }

      // Group results by variant
      const variantResults = this.groupResultsByVariant(results, test.variants)
      
      // Calculate metrics for each variant
      const variantAnalyses = await this.calculateVariantAnalyses(variantResults, test.variants)
      
      // Perform statistical analysis
      const statisticalData = this.performStatisticalAnalysis(variantAnalyses)
      
      // Determine overall status
      const status = this.determineTestStatus(variantAnalyses, statisticalData)
      
      // Generate recommendations
      const recommendations = this.generateRecommendations(variantAnalyses, status, statisticalData)

      const analysis: ABTestAnalysis = {
        testId,
        status,
        confidence: statisticalData.pValue < 0.05 ? 0.95 : 0.0,
        results: variantAnalyses,
        recommendations,
        statisticalData
      }

      logger.info('Test analysis completed', {
        testId,
        status,
        sampleSize: results.length,
        significant: statisticalData.pValue < 0.05
      })

      return analysis

    } catch (error) {
      logger.error('Error analyzing test', {
        testId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to analyze A/B test')
    }
  }

  // Get test results and analysis
  async getTestResults(testId: string): Promise<{
    test: ABTestConfig
    analysis: ABTestAnalysis
    rawResults: ABTestResult[]
  }> {
    try {
      const test = this.activeTests.get(testId)
      if (!test) {
        throw new Error('Test not found')
      }

      const analysis = await this.analyzeTest(testId)
      const rawResults = this.testResults.get(testId) || []

      return {
        test,
        analysis,
        rawResults
      }

    } catch (error) {
      logger.error('Error getting test results', {
        testId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to get test results')
    }
  }

  // Complete test
  async completeTest(testId: string): Promise<ABTestAnalysis> {
    try {
      const test = this.activeTests.get(testId)
      if (!test) {
        throw new Error('Test not found')
      }

      test.status = 'completed'
      test.endDate = new Date()

      const analysis = await this.analyzeTest(testId)
      
      this.testHistory.push({
        test: { ...test },
        analysis,
        completedAt: new Date()
      })

      // Clean up user assignments for this test
      for (const userAssignments of this.userAssignments.values()) {
        userAssignments.delete(testId)
      }

      logger.info('A/B test completed', {
        testId,
        name: test.name,
        status: analysis.status,
        duration: test.endDate.getTime() - test.startDate.getTime()
      })

      return analysis

    } catch (error) {
      logger.error('Error completing test', {
        testId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw new Error('Failed to complete A/B test')
    }
  }

  // Get all active tests
  async getActiveTests(): Promise<Array<{
    testId: string
    config: ABTestConfig
    resultCount: number
    lastActivity: Date
  }>> {
    try {
      const activeTests = []

      for (const [testId, config] of this.activeTests.entries()) {
        const results = this.testResults.get(testId) || []
        const lastActivity = results.length > 0 
          ? results[results.length - 1].timestamp 
          : config.startDate

        activeTests.push({
          testId,
          config,
          resultCount: results.length,
          lastActivity
        })
      }

      return activeTests

    } catch (error) {
      logger.error('Error getting active tests', { error })
      throw new Error('Failed to get active tests')
    }
  }

  // Private helper methods

  private generateTestId(): string {
    return `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private validateTestConfig(config: ABTestConfig): void {
    if (!config.name || config.name.trim().length === 0) {
      throw new Error('Test name is required')
    }

    if (!config.variants || config.variants.length < 2) {
      throw new Error('At least 2 variants are required')
    }

    if (!config.variants.some(v => v.isControl)) {
      throw new Error('At least one variant must be marked as control')
    }

    const totalWeight = Object.values(config.trafficSplit).reduce((sum, weight) => sum + weight, 0)
    if (Math.abs(totalWeight - 100) > 0.1) {
      throw new Error('Traffic split must sum to 100%')
    }

    if (config.startDate <= new Date()) {
      throw new Error('Start date must be in the future')
    }
  }

  private validateTestReadiness(test: ABTestConfig): void {
    if (test.variants.length === 0) {
      throw new Error('No variants configured')
    }

    if (test.successMetrics.length === 0) {
      throw new Error('No success metrics defined')
    }
  }

  private isUserEligible(userId: string, test: ABTestConfig, context: any): boolean {
    try {
      // Basic eligibility checks
      if (test.metadata.excludeUsers?.includes(userId)) {
        return false
      }

      if (test.metadata.includeOnlyUsers?.length > 0 && 
          !test.metadata.includeOnlyUsers.includes(userId)) {
        return false
      }

      // Context-based eligibility
      if (test.metadata.contextFilters) {
        for (const [key, expectedValue] of Object.entries(test.metadata.contextFilters)) {
          if (context[key] !== expectedValue) {
            return false
          }
        }
      }

      return true

    } catch (error) {
      logger.error('Error checking user eligibility', { userId, testId: test.name, error })
      return true // Default to eligible on error
    }
  }

  private getUserAssignment(userId: string, testId: string): string | undefined {
    return this.userAssignments.get(userId)?.get(testId)
  }

  private setUserAssignment(userId: string, testId: string, variantId: string): void {
    if (!this.userAssignments.has(userId)) {
      this.userAssignments.set(userId, new Map())
    }
    this.userAssignments.get(userId)!.set(testId, variantId)
  }

  private assignVariant(userId: string, test: ABTestConfig): string {
    // Deterministic assignment based on user ID and test ID
    const hash = this.hashString(`${userId}_${test.name}`)
    const normalizedHash = hash % 100

    let cumulativeWeight = 0
    for (const [variantId, weight] of Object.entries(test.trafficSplit)) {
      cumulativeWeight += weight
      if (normalizedHash < cumulativeWeight) {
        return variantId
      }
    }

    // Fallback to first variant
    return test.variants[0].id
  }

  private hashString(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash)
  }

  private groupResultsByVariant(
    results: ABTestResult[], 
    variants: ABVariant[]
  ): Record<string, ABTestResult[]> {
    const grouped: Record<string, ABTestResult[]> = {}
    
    variants.forEach(variant => {
      grouped[variant.id] = results.filter(r => r.variant === variant.id)
    })

    return grouped
  }

  private async calculateVariantAnalyses(
    variantResults: Record<string, ABTestResult[]>,
    variants: ABVariant[]
  ): Promise<VariantAnalysis[]> {
    const analyses: VariantAnalysis[] = []

    const controlVariant = variants.find(v => v.isControl)
    const controlResults = controlVariant ? variantResults[controlVariant.id] || [] : []
    const controlMetrics = this.calculateAggregateMetrics(controlResults)

    for (const variant of variants) {
      const results = variantResults[variant.id] || []
      const metrics = this.calculateAggregateMetrics(results)

      const improvement = {
        responseTime: this.calculateImprovement(
          controlMetrics.avgResponseTime,
          metrics.avgResponseTime,
          'lower_is_better'
        ),
        cost: this.calculateImprovement(
          controlMetrics.avgCost,
          metrics.avgCost,
          'lower_is_better'
        ),
        quality: this.calculateImprovement(
          controlMetrics.avgQuality,
          metrics.avgQuality,
          'higher_is_better'
        ),
        successRate: this.calculateImprovement(
          controlMetrics.successRate,
          metrics.successRate,
          'higher_is_better'
        )
      }

      analyses.push({
        variantId: variant.id,
        name: variant.name,
        isControl: variant.isControl,
        metrics,
        improvement
      })
    }

    return analyses
  }

  private calculateAggregateMetrics(results: ABTestResult[]): {
    avgResponseTime: number
    avgCost: number
    avgQuality: number
    successRate: number
    sampleSize: number
    conversions: number
  } {
    if (results.length === 0) {
      return {
        avgResponseTime: 0,
        avgCost: 0,
        avgQuality: 0,
        successRate: 0,
        sampleSize: 0,
        conversions: 0
      }
    }

    const totalResponseTime = results.reduce((sum, r) => sum + r.metrics.responseTime, 0)
    const totalCost = results.reduce((sum, r) => sum + r.metrics.cost, 0)
    const totalQuality = results.reduce((sum, r) => sum + r.metrics.quality, 0)
    const successfulResults = results.filter(r => r.metrics.success).length

    return {
      avgResponseTime: totalResponseTime / results.length,
      avgCost: totalCost / results.length,
      avgQuality: totalQuality / results.length,
      successRate: successfulResults / results.length,
      sampleSize: results.length,
      conversions: successfulResults
    }
  }

  private calculateImprovement(
    controlValue: number,
    testValue: number,
    direction: 'higher_is_better' | 'lower_is_better'
  ): { percentage: number; significant: boolean } {
    if (controlValue === 0) {
      return { percentage: 0, significant: false }
    }

    const rawPercentage = ((testValue - controlValue) / controlValue) * 100
    const percentage = direction === 'lower_is_better' ? -rawPercentage : rawPercentage

    // Simple significance test (would use more sophisticated tests in production)
    const significant = Math.abs(percentage) > 5 // 5% threshold

    return { percentage, significant }
  }

  private performStatisticalAnalysis(analyses: VariantAnalysis[]): {
    sampleSize: Record<string, number>
    significanceLevel: number
    pValue: number
    effectSize: number
    confidenceInterval: [number, number]
  } {
    const sampleSize: Record<string, number> = {}
    analyses.forEach(analysis => {
      sampleSize[analysis.variantId] = analysis.metrics.sampleSize
    })

    const totalSamples = Object.values(sampleSize).reduce((sum, size) => sum + size, 0)
    
    // Simplified statistical calculations (would use proper statistical tests in production)
    const significanceLevel = 0.05
    const pValue = totalSamples > 100 ? 0.03 : 0.15 // Simulated
    const effectSize = Math.random() * 0.5 // Simulated
    const confidenceInterval: [number, number] = [-0.1, 0.1] // Simulated

    return {
      sampleSize,
      significanceLevel,
      pValue,
      effectSize,
      confidenceInterval
    }
  }

  private determineTestStatus(
    analyses: VariantAnalysis[],
    statisticalData: { pValue: number }
  ): ABTestAnalysis['status'] {
    const totalSamples = analyses.reduce((sum, a) => sum + a.metrics.sampleSize, 0)
    
    if (totalSamples < 100) {
      return 'insufficient_data'
    }

    if (statisticalData.pValue >= 0.05) {
      return 'no_significant_difference'
    }

    // Check if any variant significantly outperforms control
    const hasSignificantImprovement = analyses.some(a => 
      !a.isControl && (
        a.improvement.quality.significant && a.improvement.quality.percentage > 0 ||
        a.improvement.responseTime.significant && a.improvement.responseTime.percentage > 0 ||
        a.improvement.cost.significant && a.improvement.cost.percentage > 0
      )
    )

    return hasSignificantImprovement ? 'significant_improvement' : 'significant_degradation'
  }

  private generateRecommendations(
    analyses: VariantAnalysis[],
    status: ABTestAnalysis['status'],
    statisticalData: any
  ): string[] {
    const recommendations: string[] = []

    switch (status) {
      case 'insufficient_data':
        recommendations.push('Continue test to gather more data')
        recommendations.push('Consider extending test duration or increasing traffic allocation')
        break

      case 'no_significant_difference':
        recommendations.push('No significant difference detected between variants')
        recommendations.push('Consider testing more dramatic changes')
        recommendations.push('May proceed with preferred variant based on other factors')
        break

      case 'significant_improvement':
        const bestVariant = analyses.find(a => !a.isControl && 
          a.improvement.quality.percentage > 0)
        if (bestVariant) {
          recommendations.push(`Implement ${bestVariant.name} as the new default`)
          recommendations.push('Monitor performance closely during rollout')
        }
        break

      case 'significant_degradation':
        recommendations.push('Stop test and revert to control variant')
        recommendations.push('Investigate causes of performance degradation')
        break
    }

    return recommendations
  }

  private initializeDefaultTests(): void {
    try {
      // Create a default ML vs Standard routing test
      const defaultTest: ABTestConfig = {
        name: 'ML Routing vs Standard Routing',
        description: 'Compare ML-optimized routing with standard capability-based routing',
        variants: [
          {
            id: 'control_standard',
            name: 'Standard Routing',
            description: 'Current capability-based routing algorithm',
            config: {
              routingStrategy: 'default',
              weightAdjustments: {
                capability: 0.4,
                cost: 0.35,
                load: 0.25
              },
              algorithmParams: {},
              fallbackBehavior: 'conservative'
            },
            weight: 50,
            isControl: true
          },
          {
            id: 'test_ml_optimized',
            name: 'ML-Optimized Routing',
            description: 'Machine learning optimized routing with contextual analysis',
            config: {
              routingStrategy: 'ml-optimized',
              weightAdjustments: {
                mlPrediction: 0.5,
                context: 0.3,
                performance: 0.2
              },
              algorithmParams: {
                useContextAnalysis: true,
                mlModelVersion: 'v1.0',
                adaptiveWeights: true
              },
              fallbackBehavior: 'default'
            },
            weight: 50,
            isControl: false
          }
        ],
        trafficSplit: {
          'control_standard': 50,
          'test_ml_optimized': 50
        },
        startDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
        successMetrics: ['responseTime', 'cost', 'quality', 'userSatisfaction'],
        status: 'draft',
        metadata: {
          autoStart: true,
          maxDuration: 7 * 24 * 60 * 60 * 1000 // 7 days
        }
      }

      this.activeTests.set('default_ml_test', defaultTest)
      this.testResults.set('default_ml_test', [])

      logger.info('Default A/B test initialized', {
        testName: defaultTest.name,
        variants: defaultTest.variants.length
      })

    } catch (error) {
      logger.error('Error initializing default tests', { error })
    }
  }
}
