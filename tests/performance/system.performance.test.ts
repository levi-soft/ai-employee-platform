
/**
 * System Performance Tests
 * Tests overall system performance and resource utilization
 */

import { performance } from 'perf_hooks';
import request from 'supertest';
import { createTestApp } from '../utils/test-server';
import { DatabaseFixture } from '../fixtures/database.fixture';
import { TestScenarios } from '../fixtures/database/scenarios.fixture';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let app: any;
let databaseFixture: DatabaseFixture;
let testScenarios: TestScenarios;

// System performance thresholds
const SYSTEM_THRESHOLDS = {
  MAX_RESPONSE_TIME: 2000,     // Maximum response time for complex operations
  THROUGHPUT_RPS: 100,         // Minimum requests per second
  MEMORY_LIMIT_MB: 512,        // Maximum memory usage in MB
  CPU_USAGE_PERCENT: 80,       // Maximum CPU usage percentage
  DATABASE_QUERY_TIME: 1000,   // Maximum database query time
  CONCURRENT_USERS: 50         // Number of concurrent users system should handle
};

beforeAll(async () => {
  app = await createTestApp();
  databaseFixture = new DatabaseFixture(prisma);
  testScenarios = new TestScenarios(prisma);
  await databaseFixture.setup();
});

afterAll(async () => {
  await databaseFixture.cleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await databaseFixture.cleanupTestData();
});

describe('System Performance Tests', () => {
  describe('Throughput Benchmarks', () => {
    it('should achieve minimum throughput requirements', async () => {
      const testDuration = 10000; // 10 seconds
      const start = performance.now();
      let requestCount = 0;
      const responses: any[] = [];

      // Run requests for the test duration
      while (performance.now() - start < testDuration) {
        const reqStart = performance.now();
        
        const response = await request(app)
          .get('/health');

        const reqEnd = performance.now();
        
        responses.push({
          status: response.status,
          responseTime: reqEnd - reqStart,
          timestamp: reqEnd
        });

        requestCount++;
      }

      const totalTime = (performance.now() - start) / 1000; // Convert to seconds
      const rps = requestCount / totalTime;
      const avgResponseTime = responses.reduce((sum, r) => sum + r.responseTime, 0) / responses.length;
      const successRate = responses.filter(r => r.status === 200).length / responses.length;

      console.log(`Throughput test results:`);
      console.log(`  Requests per second: ${rps.toFixed(2)}`);
      console.log(`  Total requests: ${requestCount}`);
      console.log(`  Average response time: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`  Success rate: ${(successRate * 100).toFixed(2)}%`);

      expect(rps).toBeGreaterThan(SYSTEM_THRESHOLDS.THROUGHPUT_RPS);
      expect(successRate).toBeGreaterThan(0.99);
      expect(avgResponseTime).toBeLessThan(SYSTEM_THRESHOLDS.MAX_RESPONSE_TIME / 4);
    });

    it('should maintain throughput under mixed workload', async () => {
      const testDuration = 15000; // 15 seconds
      const start = performance.now();
      let requestCount = 0;
      const responses: any[] = [];

      // Mixed workload: health checks, registrations, logins
      const workloadTypes = ['health', 'register', 'login'];
      let userCounter = 0;

      while (performance.now() - start < testDuration) {
        const workloadType = workloadTypes[requestCount % workloadTypes.length];
        const reqStart = performance.now();
        let response: any;

        try {
          switch (workloadType) {
            case 'health':
              response = await request(app).get('/health');
              break;
            case 'register':
              response = await request(app)
                .post('/api/auth/register')
                .send({
                  email: `mixed${userCounter}@test.com`,
                  password: 'MixedTest123!',
                  firstName: `Mixed${userCounter}`,
                  lastName: 'Test',
                  role: 'EMPLOYEE'
                });
              userCounter++;
              break;
            case 'login':
              // Login with a previously registered user
              const loginUser = Math.max(0, userCounter - 1);
              response = await request(app)
                .post('/api/auth/login')
                .send({
                  email: `mixed${loginUser}@test.com`,
                  password: 'MixedTest123!'
                });
              break;
          }

          const reqEnd = performance.now();

          responses.push({
            type: workloadType,
            status: response?.status || 0,
            responseTime: reqEnd - reqStart,
            timestamp: reqEnd
          });
        } catch (error) {
          responses.push({
            type: workloadType,
            status: 500,
            responseTime: performance.now() - reqStart,
            error: true
          });
        }

        requestCount++;
      }

      const totalTime = (performance.now() - start) / 1000;
      const rps = requestCount / totalTime;

      // Analyze by workload type
      const resultsByType = workloadTypes.reduce((acc, type) => {
        const typeResponses = responses.filter(r => r.type === type);
        acc[type] = {
          count: typeResponses.length,
          avgResponseTime: typeResponses.reduce((sum, r) => sum + r.responseTime, 0) / typeResponses.length,
          successRate: typeResponses.filter(r => r.status >= 200 && r.status < 300).length / typeResponses.length
        };
        return acc;
      }, {} as any);

      console.log(`Mixed workload test results (${rps.toFixed(2)} RPS):`);
      Object.entries(resultsByType).forEach(([type, stats]: [string, any]) => {
        console.log(`  ${type}: ${stats.count} requests, ${stats.avgResponseTime.toFixed(2)}ms avg, ${(stats.successRate * 100).toFixed(2)}% success`);
      });

      expect(rps).toBeGreaterThan(SYSTEM_THRESHOLDS.THROUGHPUT_RPS * 0.8); // Allow for mixed workload overhead
      
      // Each workload type should maintain good performance
      Object.values(resultsByType).forEach((stats: any) => {
        expect(stats.successRate).toBeGreaterThan(0.95);
        expect(stats.avgResponseTime).toBeLessThan(SYSTEM_THRESHOLDS.MAX_RESPONSE_TIME);
      });
    });
  });

  describe('Concurrent User Performance', () => {
    it('should handle concurrent user sessions', async () => {
      const concurrentUsers = SYSTEM_THRESHOLDS.CONCURRENT_USERS;
      const operationsPerUser = 5;

      // Simulate concurrent users performing operations
      const userSessions = Array.from({ length: concurrentUsers }, async (_, userId) => {
        const userEmail = `concurrent${userId}@test.com`;
        const userPassword = 'ConcurrentTest123!';

        try {
          // Register user
          const registerResponse = await request(app)
            .post('/api/auth/register')
            .send({
              email: userEmail,
              password: userPassword,
              firstName: `User${userId}`,
              lastName: 'Concurrent',
              role: 'EMPLOYEE'
            });

          if (registerResponse.status !== 201) {
            throw new Error(`Registration failed for user ${userId}`);
          }

          const { tokens } = registerResponse.body;
          const operations: any[] = [];

          // Perform multiple operations per user
          for (let op = 0; op < operationsPerUser; op++) {
            const opStart = performance.now();

            const profileResponse = await request(app)
              .get('/api/auth/profile')
              .set('Authorization', `Bearer ${tokens.accessToken}`);

            const opEnd = performance.now();

            operations.push({
              userId,
              operation: op,
              responseTime: opEnd - opStart,
              status: profileResponse.status
            });
          }

          return {
            userId,
            success: true,
            operations
          };
        } catch (error) {
          return {
            userId,
            success: false,
            error: error.message
          };
        }
      });

      const start = performance.now();
      const results = await Promise.all(userSessions);
      const totalTime = performance.now() - start;

      const successfulUsers = results.filter(r => r.success);
      const failedUsers = results.filter(r => !r.success);
      
      const allOperations = successfulUsers.flatMap(r => r.operations || []);
      const avgResponseTime = allOperations.reduce((sum, op) => sum + op.responseTime, 0) / allOperations.length;
      const maxResponseTime = Math.max(...allOperations.map(op => op.responseTime));
      const successRate = allOperations.filter(op => op.status === 200).length / allOperations.length;

      console.log(`Concurrent users test results:`);
      console.log(`  Concurrent users: ${concurrentUsers}`);
      console.log(`  Successful users: ${successfulUsers.length}`);
      console.log(`  Failed users: ${failedUsers.length}`);
      console.log(`  Total time: ${totalTime.toFixed(2)}ms`);
      console.log(`  Average operation time: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`  Max operation time: ${maxResponseTime.toFixed(2)}ms`);
      console.log(`  Operation success rate: ${(successRate * 100).toFixed(2)}%`);

      // Performance assertions
      expect(successfulUsers.length / concurrentUsers).toBeGreaterThan(0.95); // 95% of users should succeed
      expect(successRate).toBeGreaterThan(0.95);
      expect(avgResponseTime).toBeLessThan(SYSTEM_THRESHOLDS.MAX_RESPONSE_TIME);
      expect(maxResponseTime).toBeLessThan(SYSTEM_THRESHOLDS.MAX_RESPONSE_TIME * 2);
    });

    it('should scale with increasing concurrent load', async () => {
      const loadLevels = [10, 25, 50]; // Different concurrency levels
      const results: any[] = [];

      for (const concurrency of loadLevels) {
        console.log(`Testing with ${concurrency} concurrent users...`);
        
        const start = performance.now();

        // Create concurrent user operations
        const userOperations = Array.from({ length: concurrency }, async (_, userId) => {
          const opStart = performance.now();

          try {
            // Register user
            const response = await request(app)
              .post('/api/auth/register')
              .send({
                email: `scale${concurrency}_${userId}@test.com`,
                password: 'ScaleTest123!',
                firstName: `Scale${userId}`,
                lastName: 'Test',
                role: 'EMPLOYEE'
              });

            return {
              success: response.status === 201,
              responseTime: performance.now() - opStart,
              status: response.status
            };
          } catch (error) {
            return {
              success: false,
              responseTime: performance.now() - opStart,
              error: error.message
            };
          }
        });

        const userResults = await Promise.all(userOperations);
        const totalTime = performance.now() - start;

        const successCount = userResults.filter(r => r.success).length;
        const avgResponseTime = userResults.reduce((sum, r) => sum + r.responseTime, 0) / userResults.length;
        const maxResponseTime = Math.max(...userResults.map(r => r.responseTime));
        const throughput = successCount / (totalTime / 1000);

        results.push({
          concurrency,
          successCount,
          successRate: successCount / concurrency,
          avgResponseTime,
          maxResponseTime,
          throughput,
          totalTime
        });

        console.log(`  Success rate: ${(successCount / concurrency * 100).toFixed(2)}%`);
        console.log(`  Avg response time: ${avgResponseTime.toFixed(2)}ms`);
        console.log(`  Throughput: ${throughput.toFixed(2)} ops/sec`);

        // Clean up for next test
        await databaseFixture.cleanupTestData();
      }

      // Analyze scaling characteristics
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        
        // All tests should maintain minimum success rate
        expect(result.successRate).toBeGreaterThan(0.9);
        
        // Response times should remain reasonable
        expect(result.avgResponseTime).toBeLessThan(SYSTEM_THRESHOLDS.MAX_RESPONSE_TIME);
        
        if (i > 0) {
          const prevResult = results[i - 1];
          
          // Response time should not increase dramatically with load
          const responseTimeIncrease = (result.avgResponseTime - prevResult.avgResponseTime) / prevResult.avgResponseTime;
          expect(responseTimeIncrease).toBeLessThan(2.0); // Less than 200% increase
          
          console.log(`Load scaling ${prevResult.concurrency} -> ${result.concurrency}: ${(responseTimeIncrease * 100).toFixed(2)}% response time increase`);
        }
      }
    });
  });

  describe('Resource Usage Performance', () => {
    it('should monitor memory usage patterns', async () => {
      const measurements: any[] = [];
      const testDuration = 20000; // 20 seconds
      const measurementInterval = 1000; // 1 second
      const start = performance.now();

      // Take initial measurement
      measurements.push({
        timestamp: 0,
        memory: process.memoryUsage(),
        activeHandles: (process as any)._getActiveHandles?.()?.length || 0,
        activeRequests: (process as any)._getActiveRequests?.()?.length || 0
      });

      // Run background load while measuring
      const backgroundLoad = async () => {
        while (performance.now() - start < testDuration) {
          try {
            await request(app).get('/health');
            await new Promise(resolve => setTimeout(resolve, 10));
          } catch (error) {
            // Continue despite errors
          }
        }
      };

      const loadPromise = backgroundLoad();

      // Take measurements at intervals
      const measurementTimer = setInterval(() => {
        measurements.push({
          timestamp: performance.now() - start,
          memory: process.memoryUsage(),
          activeHandles: (process as any)._getActiveHandles?.()?.length || 0,
          activeRequests: (process as any)._getActiveRequests?.()?.length || 0
        });
      }, measurementInterval);

      await loadPromise;
      clearInterval(measurementTimer);

      // Take final measurement
      measurements.push({
        timestamp: performance.now() - start,
        memory: process.memoryUsage(),
        activeHandles: (process as any)._getActiveHandles?.()?.length || 0,
        activeRequests: (process as any)._getActiveRequests?.()?.length || 0
      });

      // Analyze memory patterns
      const initialMemory = measurements[0].memory.heapUsed;
      const finalMemory = measurements[measurements.length - 1].memory.heapUsed;
      const maxMemory = Math.max(...measurements.map(m => m.memory.heapUsed));
      const memoryGrowth = finalMemory - initialMemory;
      const memoryGrowthPercent = (memoryGrowth / initialMemory) * 100;

      console.log(`Memory usage analysis:`);
      console.log(`  Initial heap: ${(initialMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`  Final heap: ${(finalMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`  Max heap: ${(maxMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`  Memory growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB (${memoryGrowthPercent.toFixed(2)}%)`);

      // Memory usage should stay within reasonable bounds
      expect(maxMemory / 1024 / 1024).toBeLessThan(SYSTEM_THRESHOLDS.MEMORY_LIMIT_MB);
      expect(Math.abs(memoryGrowthPercent)).toBeLessThan(100); // Less than 100% growth during test

      // Check for memory leaks (gradual increase over time)
      const midPoint = Math.floor(measurements.length / 2);
      const firstHalfAvg = measurements.slice(0, midPoint).reduce((sum, m) => sum + m.memory.heapUsed, 0) / midPoint;
      const secondHalfAvg = measurements.slice(midPoint).reduce((sum, m) => sum + m.memory.heapUsed, 0) / (measurements.length - midPoint);
      const leakIndicator = (secondHalfAvg - firstHalfAvg) / firstHalfAvg * 100;

      console.log(`  Potential memory leak indicator: ${leakIndicator.toFixed(2)}%`);
      expect(leakIndicator).toBeLessThan(25); // Less than 25% increase in second half
    });

    it('should handle database connection pooling efficiently', async () => {
      const simultaneousQueries = 20;
      const queryRounds = 5;
      const allResults: any[] = [];

      for (let round = 0; round < queryRounds; round++) {
        const roundStart = performance.now();

        // Execute multiple database operations simultaneously
        const queryPromises = Array.from({ length: simultaneousQueries }, async (_, queryId) => {
          const queryStart = performance.now();

          try {
            // Simulate complex database operation
            const userCount = await prisma.user.count();
            const queryEnd = performance.now();

            return {
              round,
              queryId,
              success: true,
              responseTime: queryEnd - queryStart,
              result: userCount
            };
          } catch (error) {
            return {
              round,
              queryId,
              success: false,
              responseTime: performance.now() - queryStart,
              error: error.message
            };
          }
        });

        const roundResults = await Promise.all(queryPromises);
        const roundTime = performance.now() - roundStart;

        allResults.push(...roundResults);

        const successCount = roundResults.filter(r => r.success).length;
        const avgResponseTime = roundResults.reduce((sum, r) => sum + r.responseTime, 0) / roundResults.length;

        console.log(`Round ${round + 1}: ${successCount}/${simultaneousQueries} queries successful, ${avgResponseTime.toFixed(2)}ms avg, ${roundTime.toFixed(2)}ms total`);

        // Brief pause between rounds
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Analyze overall database performance
      const successfulQueries = allResults.filter(r => r.success);
      const overallSuccessRate = successfulQueries.length / allResults.length;
      const overallAvgTime = successfulQueries.reduce((sum, r) => sum + r.responseTime, 0) / successfulQueries.length;
      const maxQueryTime = Math.max(...successfulQueries.map(r => r.responseTime));

      console.log(`Database connection pooling test results:`);
      console.log(`  Total queries: ${allResults.length}`);
      console.log(`  Success rate: ${(overallSuccessRate * 100).toFixed(2)}%`);
      console.log(`  Average query time: ${overallAvgTime.toFixed(2)}ms`);
      console.log(`  Max query time: ${maxQueryTime.toFixed(2)}ms`);

      // Database performance assertions
      expect(overallSuccessRate).toBeGreaterThan(0.95);
      expect(overallAvgTime).toBeLessThan(SYSTEM_THRESHOLDS.DATABASE_QUERY_TIME);
      expect(maxQueryTime).toBeLessThan(SYSTEM_THRESHOLDS.DATABASE_QUERY_TIME * 2);
    });
  });

  describe('Stress Testing', () => {
    it('should maintain stability under extreme load', async () => {
      const extremeLoadDuration = 30000; // 30 seconds
      const requestsPerSecond = 200;
      const requestInterval = 1000 / requestsPerSecond;
      
      let requestCount = 0;
      let errorCount = 0;
      const responseTimes: number[] = [];
      const start = performance.now();

      console.log(`Starting extreme load test: ${requestsPerSecond} RPS for ${extremeLoadDuration / 1000} seconds`);

      while (performance.now() - start < extremeLoadDuration) {
        const reqStart = performance.now();

        try {
          const response = await request(app).get('/health');
          const reqTime = performance.now() - reqStart;

          responseTimes.push(reqTime);

          if (response.status !== 200) {
            errorCount++;
          }
        } catch (error) {
          errorCount++;
          responseTimes.push(performance.now() - reqStart);
        }

        requestCount++;

        // Maintain request rate
        const nextRequestTime = start + (requestCount * requestInterval);
        const currentTime = performance.now();
        if (nextRequestTime > currentTime) {
          await new Promise(resolve => setTimeout(resolve, nextRequestTime - currentTime));
        }
      }

      const actualDuration = (performance.now() - start) / 1000;
      const actualRPS = requestCount / actualDuration;
      const errorRate = errorCount / requestCount;
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const p95ResponseTime = responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length * 0.95)];

      console.log(`Extreme load test completed:`);
      console.log(`  Target RPS: ${requestsPerSecond}`);
      console.log(`  Actual RPS: ${actualRPS.toFixed(2)}`);
      console.log(`  Total requests: ${requestCount}`);
      console.log(`  Error rate: ${(errorRate * 100).toFixed(2)}%`);
      console.log(`  Avg response time: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`  P95 response time: ${p95ResponseTime.toFixed(2)}ms`);

      // System should remain stable even under extreme load
      expect(errorRate).toBeLessThan(0.05); // Less than 5% error rate
      expect(avgResponseTime).toBeLessThan(SYSTEM_THRESHOLDS.MAX_RESPONSE_TIME * 2); // Allow higher response times under stress
      expect(p95ResponseTime).toBeLessThan(SYSTEM_THRESHOLDS.MAX_RESPONSE_TIME * 3);

      // Should achieve reasonable fraction of target RPS
      expect(actualRPS).toBeGreaterThan(requestsPerSecond * 0.7); // At least 70% of target
    });
  });
});
