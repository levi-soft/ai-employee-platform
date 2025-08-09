
/**
 * API Test Runner
 * Orchestrates and executes all API tests with reporting
 */

import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { validateTestEnvironment, testConfig } from './api-testing-config'

interface TestResult {
  suite: string
  passed: number
  failed: number
  duration: number
  errors: string[]
}

interface TestReport {
  timestamp: Date
  environment: string
  totalSuites: number
  totalTests: number
  totalPassed: number
  totalFailed: number
  totalDuration: number
  coverage?: number
  results: TestResult[]
}

class APITestRunner {
  private testSuites: string[]
  private results: TestResult[] = []
  private startTime: number = 0

  constructor() {
    this.testSuites = this.discoverTestSuites()
  }

  private discoverTestSuites(): string[] {
    const testDir = __dirname
    const testFiles = fs.readdirSync(testDir)
      .filter(file => file.endsWith('.test.ts') || file.endsWith('.test.js'))
      .map(file => path.join(testDir, file))

    console.log(`Discovered ${testFiles.length} test suites:`)
    testFiles.forEach(file => console.log(`  - ${path.basename(file)}`))
    
    return testFiles
  }

  async runAllTests(): Promise<TestReport> {
    console.log('🚀 Starting API Test Suite Execution\n')
    
    // Validate environment
    try {
      validateTestEnvironment()
    } catch (error) {
      console.error('❌ Environment validation failed:', (error as Error).message)
      process.exit(1)
    }

    this.startTime = Date.now()

    // Run each test suite
    for (const testSuite of this.testSuites) {
      await this.runTestSuite(testSuite)
    }

    // Generate final report
    const report = this.generateReport()
    await this.saveReport(report)
    this.printSummary(report)

    return report
  }

  private async runTestSuite(suitePath: string): Promise<void> {
    const suiteName = path.basename(suitePath, path.extname(suitePath))
    console.log(`\n📋 Running test suite: ${suiteName}`)
    
    return new Promise((resolve) => {
      const startTime = Date.now()
      let output = ''
      let errorOutput = ''

      const testProcess = spawn('npx', ['mocha', suitePath, '--reporter', 'json'], {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: 'test' }
      })

      testProcess.stdout.on('data', (data) => {
        output += data.toString()
      })

      testProcess.stderr.on('data', (data) => {
        errorOutput += data.toString()
        console.error(data.toString())
      })

      testProcess.on('close', (code) => {
        const duration = Date.now() - startTime
        
        try {
          const result = this.parseTestOutput(output, suiteName, duration)
          this.results.push(result)
          
          console.log(`✅ Suite completed: ${result.passed} passed, ${result.failed} failed (${duration}ms)`)
        } catch (error) {
          // If JSON parsing fails, create a basic result
          const result: TestResult = {
            suite: suiteName,
            passed: code === 0 ? 1 : 0,
            failed: code === 0 ? 0 : 1,
            duration,
            errors: errorOutput ? [errorOutput] : []
          }
          this.results.push(result)
          
          console.log(`⚠️  Suite completed with parsing errors: ${suiteName}`)
        }
        
        resolve()
      })
    })
  }

  private parseTestOutput(output: string, suiteName: string, duration: number): TestResult {
    try {
      const jsonOutput = JSON.parse(output)
      
      return {
        suite: suiteName,
        passed: jsonOutput.stats?.passes || 0,
        failed: jsonOutput.stats?.failures || 0,
        duration,
        errors: jsonOutput.failures?.map((failure: any) => 
          `${failure.title}: ${failure.err?.message || 'Unknown error'}`
        ) || []
      }
    } catch (error) {
      // Fallback parsing for non-JSON output
      const passedMatch = output.match(/(\d+) passing/)
      const failedMatch = output.match(/(\d+) failing/)
      
      return {
        suite: suiteName,
        passed: passedMatch ? parseInt(passedMatch[1]) : 0,
        failed: failedMatch ? parseInt(failedMatch[1]) : 0,
        duration,
        errors: output.includes('Error') ? [output] : []
      }
    }
  }

  private generateReport(): TestReport {
    const totalDuration = Date.now() - this.startTime
    const totalPassed = this.results.reduce((sum, result) => sum + result.passed, 0)
    const totalFailed = this.results.reduce((sum, result) => sum + result.failed, 0)
    
    return {
      timestamp: new Date(),
      environment: process.env.NODE_ENV || 'test',
      totalSuites: this.results.length,
      totalTests: totalPassed + totalFailed,
      totalPassed,
      totalFailed,
      totalDuration,
      results: this.results
    }
  }

  private async saveReport(report: TestReport): Promise<void> {
    const reportsDir = path.join(process.cwd(), 'test-reports')
    
    // Ensure reports directory exists
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true })
    }
    
    const timestamp = report.timestamp.toISOString().replace(/[:.]/g, '-')
    const reportPath = path.join(reportsDir, `api-test-report-${timestamp}.json`)
    
    try {
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
      console.log(`\n📊 Test report saved: ${reportPath}`)
      
      // Also save as latest report
      const latestPath = path.join(reportsDir, 'latest-api-test-report.json')
      fs.writeFileSync(latestPath, JSON.stringify(report, null, 2))
    } catch (error) {
      console.error('❌ Failed to save test report:', error)
    }
  }

  private printSummary(report: TestReport): void {
    console.log('\n' + '='.repeat(60))
    console.log('📊 API TEST EXECUTION SUMMARY')
    console.log('='.repeat(60))
    console.log(`Timestamp: ${report.timestamp.toISOString()}`)
    console.log(`Environment: ${report.environment}`)
    console.log(`Total Test Suites: ${report.totalSuites}`)
    console.log(`Total Tests: ${report.totalTests}`)
    console.log(`✅ Passed: ${report.totalPassed}`)
    console.log(`❌ Failed: ${report.totalFailed}`)
    console.log(`⏱️  Total Duration: ${report.totalDuration}ms`)
    
    if (report.totalFailed > 0) {
      console.log('\n❌ FAILED TESTS:')
      report.results.forEach(result => {
        if (result.failed > 0) {
          console.log(`\n  Suite: ${result.suite}`)
          result.errors.forEach(error => {
            console.log(`    - ${error}`)
          })
        }
      })
    }
    
    const successRate = report.totalTests > 0 
      ? ((report.totalPassed / report.totalTests) * 100).toFixed(1)
      : '0'
    
    console.log(`\n🎯 Success Rate: ${successRate}%`)
    
    if (report.totalFailed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! 🎉')
    } else {
      console.log(`\n⚠️  ${report.totalFailed} tests failed. Please review the results above.`)
    }
    
    console.log('='.repeat(60))
  }

  // Static method to run tests from command line
  static async run(): Promise<void> {
    const runner = new APITestRunner()
    const report = await runner.runAllTests()
    
    // Exit with error code if tests failed
    process.exit(report.totalFailed > 0 ? 1 : 0)
  }
}

// CLI interface
if (require.main === module) {
  APITestRunner.run().catch(error => {
    console.error('❌ Test runner failed:', error)
    process.exit(1)
  })
}

export { APITestRunner, TestResult, TestReport }
