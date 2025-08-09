
import { AIRoutingService } from '../../../services/ai-routing-service/src/services/ai-routing.service';
import { PerformanceProfilerService } from '../../../services/ai-routing-service/src/profiling/performance-profiler.service';

describe('Performance Regression Tests', () => {
  let aiRoutingService: AIRoutingService;
  let performanceProfiler: PerformanceProfilerService;

  beforeAll(async () => {
    aiRoutingService = new AIRoutingService();
    performanceProfiler = new PerformanceProfilerService();
    await performanceProfiler.initialize();
  });

  describe('Response Time Regression', () => {
    it('should maintain response times within acceptable limits', async () => {
      const baselineLatency = 2000; // 2 seconds baseline
      const acceptableIncrease = 1.5; // 50% increase maximum

      const testRequests = [
        {
          id: 'perf-test-1',
          userId: 'perf-user',
          prompt: 'What is artificial intelligence?',
          model: 'gpt-4o-mini',
          maxTokens: 150
        },
        {
          id: 'perf-test-2', 
          userId: 'perf-user',
          prompt: 'Explain machine learning in simple terms',
          model: 'gpt-4o-mini',
          maxTokens: 200
        },
        {
          id: 'perf-test-3',
          userId: 'perf-user',
          prompt: 'How does natural language processing work?',
          model: 'gpt-4o-mini',
          maxTokens: 250
        }
      ];

      const latencies: number[] = [];

      for (const request of testRequests) {
        const startTime = Date.now();
        const response = await aiRoutingService.processRequest(request);
        const endTime = Date.now();
        const latency = endTime - startTime;

        expect(response.success).toBe(true);
        expect(latency).toBeLessThan(baselineLatency * acceptableIncrease);
        latencies.push(latency);
      }

      const averageLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
      const maxLatency = Math.max(...latencies);

      console.log(`Performance Regression Test Results:
        Average Latency: ${averageLatency.toFixed(2)}ms
        Max Latency: ${maxLatency}ms
        Baseline: ${baselineLatency}ms
        Threshold: ${(baselineLatency * acceptableIncrease).toFixed(2)}ms`);

      expect(averageLatency).toBeLessThan(baselineLatency);
      expect(maxLatency).toBeLessThan(baselineLatency * acceptableIncrease);
    });

    it('should maintain consistent performance across different models', async () => {
      const models = ['gpt-4o-mini', 'claude-3-haiku-20240307', 'gemini-pro'];
      const modelPerformance: { [key: string]: number[] } = {};

      for (const model of models) {
        modelPerformance[model] = [];
        
        for (let i = 0; i < 5; i++) {
          const request = {
            id: `model-perf-${model}-${i}`,
            userId: 'model-perf-user',
            prompt: 'Explain the concept of neural networks',
            model,
            maxTokens: 200
          };

          const startTime = Date.now();
          const response = await aiRoutingService.processRequest(request);
          const endTime = Date.now();

          if (response.success) {
            modelPerformance[model].push(endTime - startTime);
          }
        }
      }

      // Calculate performance statistics for each model
      for (const model of models) {
        const latencies = modelPerformance[model];
        if (latencies.length > 0) {
          const average = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
          const variance = latencies.reduce((sum, lat) => sum + Math.pow(lat - average, 2), 0) / latencies.length;
          const standardDeviation = Math.sqrt(variance);

          // Performance should be consistent (low standard deviation)
          expect(standardDeviation / average).toBeLessThan(0.3); // CV < 30%
          
          console.log(`${model}: Avg ${average.toFixed(2)}ms, StdDev ${standardDeviation.toFixed(2)}ms`);
        }
      }
    });
  });

  describe('Throughput Regression', () => {
    it('should maintain minimum throughput requirements', async () => {
      const minThroughput = 10; // requests per second
      const testDuration = 10000; // 10 seconds
      const requestInterval = 100; // 100ms between requests

      let requestCount = 0;
      let successCount = 0;
      const startTime = Date.now();

      while (Date.now() - startTime < testDuration) {
        const request = {
          id: `throughput-test-${requestCount}`,
          userId: 'throughput-user',
          prompt: 'Quick response test',
          model: 'gpt-4o-mini',
          maxTokens: 50
        };

        try {
          const response = await aiRoutingService.processRequest(request);
          if (response.success) {
            successCount++;
          }
        } catch (error) {
          console.error('Request failed:', error.message);
        }

        requestCount++;
        await new Promise(resolve => setTimeout(resolve, requestInterval));
      }

      const actualDuration = Date.now() - startTime;
      const actualThroughput = (successCount / actualDuration) * 1000; // requests per second

      console.log(`Throughput Test Results:
        Duration: ${actualDuration}ms
        Total Requests: ${requestCount}
        Successful: ${successCount}
        Throughput: ${actualThroughput.toFixed(2)} req/s
        Target: ${minThroughput} req/s`);

      expect(actualThroughput).toBeGreaterThanOrEqual(minThroughput);
      expect(successCount / requestCount).toBeGreaterThan(0.95); // 95% success rate
    });

    it('should handle concurrent requests without degradation', async () => {
      const concurrencyLevels = [5, 10, 20];
      const performanceResults: any[] = [];

      for (const concurrency of concurrencyLevels) {
        const requests = Array.from({ length: concurrency }, (_, i) => ({
          id: `concurrency-${concurrency}-${i}`,
          userId: 'concurrency-user',
          prompt: `Concurrent test request ${i}`,
          model: 'gpt-4o-mini',
          maxTokens: 100
        }));

        const startTime = Date.now();
        const responses = await Promise.allSettled(
          requests.map(req => aiRoutingService.processRequest(req))
        );
        const endTime = Date.now();

        const successfulResponses = responses.filter(r => 
          r.status === 'fulfilled' && r.value.success
        );

        const totalTime = endTime - startTime;
        const throughput = (successfulResponses.length / totalTime) * 1000;

        performanceResults.push({
          concurrency,
          successCount: successfulResponses.length,
          totalTime,
          throughput,
          successRate: (successfulResponses.length / concurrency * 100).toFixed(2)
        });
      }

      console.log('Concurrency Performance Results:', performanceResults);

      // Performance shouldn't degrade significantly with increased concurrency
      const throughputs = performanceResults.map(r => r.throughput);
      const firstThroughput = throughputs[0];
      const lastThroughput = throughputs[throughputs.length - 1];

      // Last throughput should be at least 70% of first throughput
      expect(lastThroughput / firstThroughput).toBeGreaterThan(0.7);

      // All concurrency levels should maintain high success rates
      expect(performanceResults.every(r => parseFloat(r.successRate) > 90)).toBe(true);
    });
  });

  describe('Memory Usage Regression', () => {
    it('should not exceed memory usage baselines', async () => {
      const baselineMemoryMB = 500; // 500MB baseline
      const memoryGrowthLimit = 1.3; // 30% growth maximum

      const initialMemory = process.memoryUsage();
      console.log(`Initial Memory: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`);

      // Perform intensive operations
      const intensiveRequests = Array.from({ length: 20 }, (_, i) => ({
        id: `memory-intensive-${i}`,
        userId: 'memory-test-user',
        prompt: 'Generate a detailed analysis of artificial intelligence applications in healthcare, finance, and education. Include specific examples and case studies.',
        model: 'gpt-4o-mini',
        maxTokens: 500
      }));

      for (const request of intensiveRequests) {
        await aiRoutingService.processRequest(request);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const finalMemory = process.memoryUsage();
      const memoryUsageMB = finalMemory.heapUsed / 1024 / 1024;
      const memoryGrowth = memoryUsageMB / (initialMemory.heapUsed / 1024 / 1024);

      console.log(`Final Memory: ${memoryUsageMB.toFixed(2)}MB`);
      console.log(`Memory Growth: ${(memoryGrowth * 100).toFixed(2)}%`);

      expect(memoryUsageMB).toBeLessThan(baselineMemoryMB);
      expect(memoryGrowth).toBeLessThan(memoryGrowthLimit);
    });

    it('should clean up resources properly', async () => {
      const resourceLeakTest = async () => {
        const requests = Array.from({ length: 10 }, (_, i) => ({
          id: `resource-test-${i}`,
          userId: 'resource-user',
          prompt: 'Resource cleanup test',
          model: 'gpt-4o-mini',
          maxTokens: 100
        }));

        await Promise.allSettled(
          requests.map(req => aiRoutingService.processRequest(req))
        );
      };

      const memorySnapshots: number[] = [];

      // Run multiple cycles and measure memory
      for (let cycle = 0; cycle < 5; cycle++) {
        await resourceLeakTest();
        
        if (global.gc) {
          global.gc();
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        const memory = process.memoryUsage().heapUsed / 1024 / 1024;
        memorySnapshots.push(memory);
        console.log(`Cycle ${cycle + 1}: ${memory.toFixed(2)}MB`);
      }

      // Check for memory leaks (consistent growth)
      const trend = memorySnapshots.reduce((sum, memory, index, arr) => {
        if (index === 0) return 0;
        return sum + (memory - arr[index - 1]);
      }, 0) / (memorySnapshots.length - 1);

      // Memory trend should be stable (less than 5MB growth per cycle)
      expect(Math.abs(trend)).toBeLessThan(5);
    });
  });

  describe('Database Performance Regression', () => {
    it('should maintain database query performance', async () => {
      const queryPerformanceTest = async (operation: string) => {
        const startTime = Date.now();
        
        switch (operation) {
          case 'user_lookup':
            // Simulate user lookup operations
            for (let i = 0; i < 10; i++) {
              await performanceProfiler.profileQuery(`user-lookup-${i}`, async () => {
                // Simulate database query
                await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
              });
            }
            break;
            
          case 'request_logging':
            // Simulate request logging operations
            for (let i = 0; i < 20; i++) {
              await performanceProfiler.profileQuery(`request-log-${i}`, async () => {
                await new Promise(resolve => setTimeout(resolve, Math.random() * 20));
              });
            }
            break;
        }

        return Date.now() - startTime;
      };

      const userLookupTime = await queryPerformanceTest('user_lookup');
      const requestLoggingTime = await queryPerformanceTest('request_logging');

      console.log(`Database Performance:
        User Lookups: ${userLookupTime}ms
        Request Logging: ${requestLoggingTime}ms`);

      // Database operations should complete within reasonable time
      expect(userLookupTime).toBeLessThan(1000); // 1 second for 10 lookups
      expect(requestLoggingTime).toBeLessThan(800); // 800ms for 20 logging operations
    });
  });

  describe('Cache Performance Regression', () => {
    it('should maintain cache hit rates and performance', async () => {
      const cacheHitRateThreshold = 0.7; // 70% hit rate minimum
      const cacheLatencyThreshold = 50; // 50ms maximum

      // Warm up cache
      const warmupRequests = Array.from({ length: 5 }, (_, i) => ({
        id: `cache-warmup-${i}`,
        userId: 'cache-user',
        prompt: `Cache test prompt ${i % 3}`, // Repeat some prompts
        model: 'gpt-4o-mini',
        maxTokens: 100
      }));

      for (const request of warmupRequests) {
        await aiRoutingService.processRequest(request);
      }

      // Test cache performance
      let cacheHits = 0;
      let totalRequests = 0;
      const cacheLatencies: number[] = [];

      const testRequests = Array.from({ length: 15 }, (_, i) => ({
        id: `cache-test-${i}`,
        userId: 'cache-user',
        prompt: `Cache test prompt ${i % 3}`, // High repetition for cache hits
        model: 'gpt-4o-mini',
        maxTokens: 100
      }));

      for (const request of testRequests) {
        const startTime = Date.now();
        const response = await aiRoutingService.processRequest(request);
        const endTime = Date.now();

        totalRequests++;
        
        if (response.metadata?.cacheHit) {
          cacheHits++;
          cacheLatencies.push(endTime - startTime);
        }
      }

      const hitRate = cacheHits / totalRequests;
      const avgCacheLatency = cacheLatencies.reduce((sum, lat) => sum + lat, 0) / cacheLatencies.length;

      console.log(`Cache Performance:
        Hit Rate: ${(hitRate * 100).toFixed(2)}%
        Average Cache Latency: ${avgCacheLatency.toFixed(2)}ms
        Cache Hits: ${cacheHits}/${totalRequests}`);

      expect(hitRate).toBeGreaterThanOrEqual(cacheHitRateThreshold);
      if (cacheLatencies.length > 0) {
        expect(avgCacheLatency).toBeLessThan(cacheLatencyThreshold);
      }
    });
  });

  afterAll(async () => {
    await performanceProfiler.shutdown();
    await aiRoutingService.shutdown();
  });
});
