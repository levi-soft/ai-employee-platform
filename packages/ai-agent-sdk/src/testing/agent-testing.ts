
import { performance } from 'perf_hooks';
import { Logger } from '@ai-platform/shared-utils';
import {
  IAgentBase,
  ITestCase,
  ITestSuite,
  ITestResult,
  ITestSuiteResult,
  IAgentConfig,
  CapabilityType,
  AgentStatus,
  IBenchmarkResult,
  IPerformanceMetrics
} from '../types/agent-types';
import { AgentFactory } from '../base/agent-base';

/**
 * Comprehensive testing framework for AI agents
 */
export class AgentTester {
  private logger: Logger;
  private results: Map<string, ITestSuiteResult> = new Map();

  constructor() {
    this.logger = new Logger('AgentTester');
  }

  /**
   * Run a complete test suite
   */
  async runTestSuite(testSuite: ITestSuite): Promise<ITestSuiteResult> {
    const startTime = performance.now();
    const results: ITestResult[] = [];

    this.logger.info('Starting test suite', {
      suite: testSuite.name,
      agent: testSuite.agentName,
      testCount: testSuite.testCases.length
    });

    // Create agent instance
    const agent = AgentFactory.create(testSuite.agentName, testSuite.agentConfig);
    if (!agent) {
      throw new Error(`Failed to create agent: ${testSuite.agentName}`);
    }

    try {
      // Run setup
      if (testSuite.setup) {
        await testSuite.setup();
      }

      // Run test cases
      for (const testCase of testSuite.testCases) {
        const result = await this.runTestCase(agent, testCase);
        results.push(result);
      }

      // Run teardown
      if (testSuite.teardown) {
        await testSuite.teardown();
      }

    } finally {
      await agent.shutdown();
    }

    const endTime = performance.now();
    const executionTime = endTime - startTime;

    const suiteResult: ITestSuiteResult = {
      suiteName: testSuite.name,
      agentName: testSuite.agentName,
      totalTests: testSuite.testCases.length,
      passedTests: results.filter(r => r.passed).length,
      failedTests: results.filter(r => !r.passed).length,
      executionTime,
      results,
      coverage: this.calculateCoverage(testSuite, agent)
    };

    this.results.set(testSuite.name, suiteResult);

    this.logger.info('Test suite completed', {
      suite: testSuite.name,
      passed: suiteResult.passedTests,
      failed: suiteResult.failedTests,
      executionTime: Math.round(executionTime)
    });

    return suiteResult;
  }

  /**
   * Run a single test case
   */
  async runTestCase(agent: IAgentBase, testCase: ITestCase): Promise<ITestResult> {
    const startTime = performance.now();

    this.logger.debug('Running test case', {
      id: testCase.id,
      name: testCase.name
    });

    try {
      // Set timeout
      const timeout = testCase.timeout || 30000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Test timeout')), timeout);
      });

      // Execute test
      const resultPromise = agent.execute(testCase.input);
      const actualOutput = await Promise.race([resultPromise, timeoutPromise]);

      const endTime = performance.now();
      const executionTime = endTime - startTime;

      // Validate result
      const passed = this.validateTestResult(testCase, actualOutput);

      const result: ITestResult = {
        testCaseId: testCase.id,
        passed: testCase.shouldFail ? !passed : passed,
        actualOutput,
        executionTime,
        details: {
          inputTokens: actualOutput.metadata?.inputTokens,
          outputTokens: actualOutput.metadata?.outputTokens,
          cost: actualOutput.metadata?.cost
        }
      };

      if (result.passed) {
        this.logger.debug('Test case passed', {
          id: testCase.id,
          executionTime: Math.round(executionTime)
        });
      } else {
        this.logger.warn('Test case failed', {
          id: testCase.id,
          expected: testCase.expectedOutput,
          actual: actualOutput
        });
      }

      return result;

    } catch (error) {
      const endTime = performance.now();
      const executionTime = endTime - startTime;

      const result: ITestResult = {
        testCaseId: testCase.id,
        passed: testCase.shouldFail || false,
        error: error instanceof Error ? error.message : String(error),
        executionTime
      };

      this.logger.error('Test case error', {
        id: testCase.id,
        error: result.error
      });

      return result;
    }
  }

  /**
   * Validate test result against expected output
   */
  private validateTestResult(testCase: ITestCase, actualOutput: any): boolean {
    if (!testCase.expectedOutput) {
      return actualOutput.success;
    }

    const expected = testCase.expectedOutput;

    // Check success status
    if (expected.success !== undefined && expected.success !== actualOutput.success) {
      return false;
    }

    // Check content (if specified)
    if (expected.content !== undefined && !this.compareContent(expected.content, actualOutput.content)) {
      return false;
    }

    // Check metadata (if specified)
    if (expected.metadata) {
      for (const [key, value] of Object.entries(expected.metadata)) {
        if (actualOutput.metadata?.[key] !== value) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Compare content with support for fuzzy matching
   */
  private compareContent(expected: string, actual: string): boolean {
    // Exact match
    if (expected === actual) {
      return true;
    }

    // Case-insensitive match
    if (expected.toLowerCase() === actual.toLowerCase()) {
      return true;
    }

    // Contains check (if expected is wrapped in wildcards)
    if (expected.startsWith('*') && expected.endsWith('*')) {
      const searchTerm = expected.slice(1, -1);
      return actual.includes(searchTerm);
    }

    return false;
  }

  /**
   * Calculate test coverage
   */
  private calculateCoverage(testSuite: ITestSuite, agent: IAgentBase): { capabilities: number; scenarios: number } {
    const agentCapabilities = agent.getCapabilities();
    const testedCapabilities = new Set<CapabilityType>();
    const testedScenarios = new Set<string>();

    testSuite.testCases.forEach(testCase => {
      // Track capabilities
      testCase.expectedCapabilities?.forEach(cap => testedCapabilities.add(cap));

      // Track scenarios
      testedScenarios.add(testCase.input.type);
    });

    return {
      capabilities: agentCapabilities.length > 0 ? testedCapabilities.size / agentCapabilities.length : 1,
      scenarios: testSuite.testCases.length > 0 ? testedScenarios.size / testSuite.testCases.length : 1
    };
  }

  /**
   * Run performance benchmark
   */
  async runBenchmark(
    agentName: string,
    agentConfig: IAgentConfig,
    testCases: ITestCase[],
    options: {
      concurrency?: number;
      duration?: number;
      iterations?: number;
    } = {}
  ): Promise<IBenchmarkResult> {
    const { concurrency = 1, duration = 60000, iterations = 100 } = options;

    this.logger.info('Starting benchmark', {
      agent: agentName,
      concurrency,
      duration,
      iterations
    });

    const agent = AgentFactory.create(agentName, agentConfig);
    if (!agent) {
      throw new Error(`Failed to create agent: ${agentName}`);
    }

    const results: number[] = [];
    const errors: number[] = [];
    const startTime = performance.now();

    try {
      const promises: Promise<void>[] = [];

      for (let i = 0; i < concurrency; i++) {
        promises.push(this.runBenchmarkWorker(agent, testCases, {
          duration: duration / concurrency,
          iterations: Math.floor(iterations / concurrency),
          results,
          errors
        }));
      }

      await Promise.all(promises);

    } finally {
      await agent.shutdown();
    }

    const endTime = performance.now();
    const totalTime = endTime - startTime;

    // Calculate metrics
    const sortedResults = results.sort((a, b) => a - b);
    const throughput = results.length / (totalTime / 1000);
    const errorRate = errors.length / (results.length + errors.length);

    const performanceMetrics: IPerformanceMetrics = {
      throughput,
      latency: {
        p50: this.percentile(sortedResults, 0.5),
        p95: this.percentile(sortedResults, 0.95),
        p99: this.percentile(sortedResults, 0.99)
      },
      errorRate,
      concurrency,
      resourceUsage: {
        cpu: process.cpuUsage().user / 1000000, // Convert to seconds
        memory: process.memoryUsage().heapUsed / 1024 / 1024 // Convert to MB
      }
    };

    const benchmarkResult: IBenchmarkResult = {
      agentName,
      agentVersion: agentConfig.version,
      testSuite: 'benchmark',
      performance: performanceMetrics,
      timestamp: new Date(),
      environment: {
        os: process.platform,
        nodeVersion: process.version,
        cpuCount: require('os').cpus().length,
        totalMemory: require('os').totalmem() / 1024 / 1024 // MB
      }
    };

    this.logger.info('Benchmark completed', {
      throughput: Math.round(throughput * 100) / 100,
      p95Latency: Math.round(performanceMetrics.latency.p95),
      errorRate: Math.round(errorRate * 10000) / 100 // Percentage
    });

    return benchmarkResult;
  }

  /**
   * Benchmark worker function
   */
  private async runBenchmarkWorker(
    agent: IAgentBase,
    testCases: ITestCase[],
    options: {
      duration: number;
      iterations: number;
      results: number[];
      errors: number[];
    }
  ): Promise<void> {
    const { duration, iterations, results, errors } = options;
    const endTime = Date.now() + duration;
    let iterationCount = 0;

    while (Date.now() < endTime && iterationCount < iterations) {
      const testCase = testCases[iterationCount % testCases.length];
      const startTime = performance.now();

      try {
        await agent.execute(testCase.input);
        const responseTime = performance.now() - startTime;
        results.push(responseTime);
      } catch (error) {
        errors.push(performance.now() - startTime);
      }

      iterationCount++;
    }
  }

  /**
   * Calculate percentile
   */
  private percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  /**
   * Get test results
   */
  getResults(): Map<string, ITestSuiteResult> {
    return new Map(this.results);
  }

  /**
   * Generate test report
   */
  generateReport(format: 'text' | 'json' | 'html' = 'text'): string {
    const results = Array.from(this.results.values());

    switch (format) {
      case 'json':
        return JSON.stringify(results, null, 2);

      case 'html':
        return this.generateHtmlReport(results);

      case 'text':
      default:
        return this.generateTextReport(results);
    }
  }

  /**
   * Generate text report
   */
  private generateTextReport(results: ITestSuiteResult[]): string {
    let report = '=== Agent Test Report ===\n\n';

    for (const result of results) {
      report += `Suite: ${result.suiteName}\n`;
      report += `Agent: ${result.agentName}\n`;
      report += `Tests: ${result.totalTests} (${result.passedTests} passed, ${result.failedTests} failed)\n`;
      report += `Execution Time: ${Math.round(result.executionTime)}ms\n`;
      report += `Success Rate: ${Math.round((result.passedTests / result.totalTests) * 100)}%\n`;
      
      if (result.coverage) {
        report += `Coverage: ${Math.round(result.coverage.capabilities * 100)}% capabilities, ${Math.round(result.coverage.scenarios * 100)}% scenarios\n`;
      }

      report += '\nFailed Tests:\n';
      result.results.filter(r => !r.passed).forEach(r => {
        report += `  - ${r.testCaseId}: ${r.error || 'Validation failed'}\n`;
      });

      report += '\n---\n\n';
    }

    return report;
  }

  /**
   * Generate HTML report
   */
  private generateHtmlReport(results: ITestSuiteResult[]): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Agent Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .suite { margin-bottom: 30px; padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
        .passed { color: green; }
        .failed { color: red; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
        .metric { padding: 10px; background: #f5f5f5; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>Agent Test Report</h1>
    ${results.map(result => `
        <div class="suite">
            <h2>${result.suiteName} (${result.agentName})</h2>
            <div class="metrics">
                <div class="metric">
                    <strong>Total Tests:</strong> ${result.totalTests}
                </div>
                <div class="metric">
                    <strong>Passed:</strong> <span class="passed">${result.passedTests}</span>
                </div>
                <div class="metric">
                    <strong>Failed:</strong> <span class="failed">${result.failedTests}</span>
                </div>
                <div class="metric">
                    <strong>Execution Time:</strong> ${Math.round(result.executionTime)}ms
                </div>
                <div class="metric">
                    <strong>Success Rate:</strong> ${Math.round((result.passedTests / result.totalTests) * 100)}%
                </div>
            </div>
        </div>
    `).join('')}
</body>
</html>
    `.trim();
  }
}

/**
 * Test builder for creating test suites
 */
export class TestBuilder {
  private testSuite: Partial<ITestSuite> = {};

  static create(): TestBuilder {
    return new TestBuilder();
  }

  suite(name: string, description?: string): TestBuilder {
    this.testSuite.name = name;
    this.testSuite.description = description;
    return this;
  }

  agent(name: string, config: IAgentConfig): TestBuilder {
    this.testSuite.agentName = name;
    this.testSuite.agentConfig = config;
    return this;
  }

  addTest(testCase: ITestCase): TestBuilder {
    if (!this.testSuite.testCases) {
      this.testSuite.testCases = [];
    }
    this.testSuite.testCases.push(testCase);
    return this;
  }

  setup(setupFn: () => Promise<void>): TestBuilder {
    this.testSuite.setup = setupFn;
    return this;
  }

  teardown(teardownFn: () => Promise<void>): TestBuilder {
    this.testSuite.teardown = teardownFn;
    return this;
  }

  build(): ITestSuite {
    if (!this.testSuite.name || !this.testSuite.agentName || !this.testSuite.agentConfig) {
      throw new Error('Test suite name, agent name, and config are required');
    }
    
    return {
      testCases: [],
      ...this.testSuite
    } as ITestSuite;
  }
}
