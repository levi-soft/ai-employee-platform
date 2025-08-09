
/**
 * Auth Service Performance Tests
 * Tests performance characteristics of authentication endpoints
 */

import { performance } from 'perf_hooks';
import request from 'supertest';
import { createTestApp } from '../utils/test-server';
import { DatabaseFixture } from '../fixtures/database.fixture';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let app: any;
let databaseFixture: DatabaseFixture;

// Performance thresholds (in milliseconds)
const PERFORMANCE_THRESHOLDS = {
  LOGIN_RESPONSE: 500,      // Login should respond within 500ms
  REGISTER_RESPONSE: 1000,  // Registration should respond within 1s
  PROFILE_RESPONSE: 200,    // Profile access should respond within 200ms
  HEALTH_CHECK: 100,        // Health check should respond within 100ms
  CONCURRENT_REQUESTS: 5000 // Concurrent requests should complete within 5s
};

beforeAll(async () => {
  app = await createTestApp();
  databaseFixture = new DatabaseFixture(prisma);
  await databaseFixture.setup();
});

afterAll(async () => {
  await databaseFixture.cleanup();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await databaseFixture.cleanupTestData();
});

describe('Auth Service Performance Tests', () => {
  describe('Response Time Benchmarks', () => {
    it('should handle login requests within threshold', async () => {
      // Create test user first
      await request(app)
        .post('/api/auth/register')
        .send({
          email: 'perf@test.com',
          password: 'PerfTest123!',
          firstName: 'Perf',
          lastName: 'Test',
          role: 'EMPLOYEE'
        });

      const start = performance.now();
      
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'perf@test.com',
          password: 'PerfTest123!'
        });

      const duration = performance.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.LOGIN_RESPONSE);
    });

    it('should handle registration within threshold', async () => {
      const start = performance.now();

      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'register-perf@test.com',
          password: 'RegisterPerf123!',
          firstName: 'Register',
          lastName: 'Perf',
          role: 'EMPLOYEE'
        });

      const duration = performance.now() - start;

      expect(response.status).toBe(201);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.REGISTER_RESPONSE);
    });

    it('should handle profile access within threshold', async () => {
      // Setup authenticated user
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'profile-perf@test.com',
          password: 'ProfilePerf123!',
          firstName: 'Profile',
          lastName: 'Perf',
          role: 'EMPLOYEE'
        });

      const { tokens } = registerResponse.body;

      const start = performance.now();

      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${tokens.accessToken}`);

      const duration = performance.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.PROFILE_RESPONSE);
    });

    it('should handle health checks within threshold', async () => {
      const start = performance.now();

      const response = await request(app)
        .get('/health');

      const duration = performance.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.HEALTH_CHECK);
    });
  });

  describe('Load Testing', () => {
    it('should handle concurrent login requests', async () => {
      // Pre-register users for testing
      const users = await Promise.all(
        Array.from({ length: 20 }, async (_, i) => {
          await request(app)
            .post('/api/auth/register')
            .send({
              email: `load${i}@test.com`,
              password: 'LoadTest123!',
              firstName: `Load${i}`,
              lastName: 'Test',
              role: 'EMPLOYEE'
            });
          return { email: `load${i}@test.com`, password: 'LoadTest123!' };
        })
      );

      const start = performance.now();

      // Make concurrent login requests
      const promises = users.map(user =>
        request(app)
          .post('/api/auth/login')
          .send(user)
      );

      const responses = await Promise.all(promises);
      const duration = performance.now() - start;

      // All should succeed
      expect(responses.every(r => r.status === 200)).toBe(true);
      
      // Should complete within threshold
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.CONCURRENT_REQUESTS);

      console.log(`Concurrent login test completed in ${duration.toFixed(2)}ms`);
    });

    it('should maintain performance under sustained load', async () => {
      const testDuration = 10000; // 10 seconds
      const requestInterval = 100;  // 100ms between requests
      const start = performance.now();
      const responses: any[] = [];

      // Sustained load test
      while (performance.now() - start < testDuration) {
        const response = await request(app)
          .get('/health');
        
        responses.push({
          status: response.status,
          responseTime: performance.now() - start
        });

        // Wait before next request
        await new Promise(resolve => setTimeout(resolve, requestInterval));
      }

      // Calculate statistics
      const successRate = responses.filter(r => r.status === 200).length / responses.length;
      const responseTimes = responses.map(r => r.responseTime);
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);

      // Assertions
      expect(successRate).toBeGreaterThan(0.95); // 95% success rate
      expect(avgResponseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.HEALTH_CHECK);
      expect(maxResponseTime).toBeLessThan(PERFORMANCE_THRESHOLDS.HEALTH_CHECK * 2);

      console.log(`Sustained load test results:`);
      console.log(`  Success rate: ${(successRate * 100).toFixed(2)}%`);
      console.log(`  Average response time: ${avgResponseTime.toFixed(2)}ms`);
      console.log(`  Max response time: ${maxResponseTime.toFixed(2)}ms`);
      console.log(`  Total requests: ${responses.length}`);
    });

    it('should handle burst traffic patterns', async () => {
      const burstSize = 50;
      const burstCount = 3;
      const burstInterval = 2000; // 2 seconds between bursts

      const allResponses: any[] = [];

      for (let burst = 0; burst < burstCount; burst++) {
        const burstStart = performance.now();

        // Create burst of requests
        const promises = Array.from({ length: burstSize }, () =>
          request(app)
            .get('/health')
            .then(response => ({
              status: response.status,
              responseTime: performance.now() - burstStart,
              burst: burst + 1
            }))
        );

        const burstResponses = await Promise.all(promises);
        allResponses.push(...burstResponses);

        // Wait before next burst (except for last burst)
        if (burst < burstCount - 1) {
          await new Promise(resolve => setTimeout(resolve, burstInterval));
        }
      }

      // Analyze burst performance
      const successRate = allResponses.filter(r => r.status === 200).length / allResponses.length;
      const responseTimesByBurst = Array.from({ length: burstCount }, (_, i) =>
        allResponses.filter(r => r.burst === i + 1).map(r => r.responseTime)
      );

      // Each burst should maintain good performance
      for (let i = 0; i < burstCount; i++) {
        const burstTimes = responseTimesByBurst[i];
        const avgBurstTime = burstTimes.reduce((a, b) => a + b, 0) / burstTimes.length;
        const maxBurstTime = Math.max(...burstTimes);

        expect(avgBurstTime).toBeLessThan(PERFORMANCE_THRESHOLDS.HEALTH_CHECK * 1.5);
        expect(maxBurstTime).toBeLessThan(PERFORMANCE_THRESHOLDS.HEALTH_CHECK * 3);

        console.log(`Burst ${i + 1} - Avg: ${avgBurstTime.toFixed(2)}ms, Max: ${maxBurstTime.toFixed(2)}ms`);
      }

      expect(successRate).toBeGreaterThan(0.95);
    });
  });

  describe('Memory and Resource Usage', () => {
    it('should not have significant memory leaks during extended operation', async () => {
      const initialMemory = process.memoryUsage();
      const iterations = 100;

      // Perform many operations
      for (let i = 0; i < iterations; i++) {
        await request(app)
          .get('/health');

        // Force garbage collection occasionally (if available)
        if (i % 20 === 0 && global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage();
      
      // Memory usage should not increase dramatically
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryIncreasePercent = (memoryIncrease / initialMemory.heapUsed) * 100;

      console.log(`Memory usage change: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB (${memoryIncreasePercent.toFixed(2)}%)`);

      // Should not increase by more than 50% (allowing for normal variance)
      expect(memoryIncreasePercent).toBeLessThan(50);
    });

    it('should handle increasing payload sizes efficiently', async () => {
      const payloadSizes = [100, 500, 1000, 5000]; // bytes
      const results: any[] = [];

      for (const size of payloadSizes) {
        const payload = {
          email: 'payload@test.com',
          password: 'PayloadTest123!',
          firstName: 'Payload',
          lastName: 'Test',
          role: 'EMPLOYEE',
          // Add extra data to increase payload size
          extraData: 'x'.repeat(size)
        };

        const start = performance.now();

        const response = await request(app)
          .post('/api/auth/register')
          .send(payload);

        const duration = performance.now() - start;

        results.push({
          payloadSize: size,
          responseTime: duration,
          status: response.status
        });

        // Clean up user for next iteration
        await databaseFixture.cleanupTestData();
      }

      // Response time should scale reasonably with payload size
      for (let i = 1; i < results.length; i++) {
        const current = results[i];
        const previous = results[i - 1];

        // Response time should not increase dramatically with payload size
        const timeIncrease = current.responseTime - previous.responseTime;
        const payloadIncrease = current.payloadSize - previous.payloadSize;

        console.log(`Payload ${current.payloadSize}B: ${current.responseTime.toFixed(2)}ms`);

        // Time increase should be reasonable relative to payload increase
        expect(timeIncrease / payloadIncrease).toBeLessThan(1); // Less than 1ms per byte increase
      }
    });
  });

  describe('Database Performance', () => {
    it('should handle database operations efficiently', async () => {
      const operationCount = 50;
      const results: any[] = [];

      for (let i = 0; i < operationCount; i++) {
        const start = performance.now();

        // Register user (creates user + credit account)
        const registerResponse = await request(app)
          .post('/api/auth/register')
          .send({
            email: `dbperf${i}@test.com`,
            password: 'DbPerf123!',
            firstName: `DbPerf${i}`,
            lastName: 'Test',
            role: 'EMPLOYEE'
          });

        const registerTime = performance.now() - start;

        const loginStart = performance.now();

        // Login (database lookup + JWT creation)
        const loginResponse = await request(app)
          .post('/api/auth/login')
          .send({
            email: `dbperf${i}@test.com`,
            password: 'DbPerf123!'
          });

        const loginTime = performance.now() - loginStart;

        results.push({
          iteration: i,
          registerTime,
          loginTime,
          registerStatus: registerResponse.status,
          loginStatus: loginResponse.status
        });
      }

      // Calculate statistics
      const avgRegisterTime = results.reduce((sum, r) => sum + r.registerTime, 0) / results.length;
      const avgLoginTime = results.reduce((sum, r) => sum + r.loginTime, 0) / results.length;
      const maxRegisterTime = Math.max(...results.map(r => r.registerTime));
      const maxLoginTime = Math.max(...results.map(r => r.loginTime));

      console.log(`Database performance results (${operationCount} operations):`);
      console.log(`  Average register time: ${avgRegisterTime.toFixed(2)}ms`);
      console.log(`  Average login time: ${avgLoginTime.toFixed(2)}ms`);
      console.log(`  Max register time: ${maxRegisterTime.toFixed(2)}ms`);
      console.log(`  Max login time: ${maxLoginTime.toFixed(2)}ms`);

      // Performance assertions
      expect(avgRegisterTime).toBeLessThan(PERFORMANCE_THRESHOLDS.REGISTER_RESPONSE);
      expect(avgLoginTime).toBeLessThan(PERFORMANCE_THRESHOLDS.LOGIN_RESPONSE);
      expect(maxRegisterTime).toBeLessThan(PERFORMANCE_THRESHOLDS.REGISTER_RESPONSE * 2);
      expect(maxLoginTime).toBeLessThan(PERFORMANCE_THRESHOLDS.LOGIN_RESPONSE * 2);

      // All operations should succeed
      expect(results.every(r => r.registerStatus === 201)).toBe(true);
      expect(results.every(r => r.loginStatus === 200)).toBe(true);
    });

    it('should maintain consistent performance as database grows', async () => {
      // Create initial dataset
      const initialUsers = 100;
      const testBatches = [0, 50, 100]; // Test at different DB sizes

      const performanceResults: any[] = [];

      for (const batchIndex of testBatches) {
        // Add more users to database
        if (batchIndex > 0) {
          await Promise.all(
            Array.from({ length: 50 }, async (_, i) => {
              await request(app)
                .post('/api/auth/register')
                .send({
                  email: `batch${batchIndex}_${i}@test.com`,
                  password: 'BatchTest123!',
                  firstName: `Batch${batchIndex}`,
                  lastName: `User${i}`,
                  role: 'EMPLOYEE'
                });
            })
          );
        }

        // Test performance with current DB size
        const testIterations = 10;
        const batchResults: number[] = [];

        for (let i = 0; i < testIterations; i++) {
          const start = performance.now();

          await request(app)
            .post('/api/auth/login')
            .send({
              email: `batch${batchIndex}_0@test.com`, // Login with first user of batch
              password: 'BatchTest123!'
            });

          batchResults.push(performance.now() - start);
        }

        const avgResponseTime = batchResults.reduce((a, b) => a + b, 0) / batchResults.length;

        performanceResults.push({
          dbSize: (batchIndex + 1) * 50,
          avgResponseTime,
          maxResponseTime: Math.max(...batchResults),
          minResponseTime: Math.min(...batchResults)
        });

        console.log(`DB size ~${(batchIndex + 1) * 50} users: ${avgResponseTime.toFixed(2)}ms avg`);
      }

      // Performance should not degrade significantly as DB grows
      for (let i = 1; i < performanceResults.length; i++) {
        const current = performanceResults[i];
        const previous = performanceResults[i - 1];

        const performanceDegradation = (current.avgResponseTime - previous.avgResponseTime) / previous.avgResponseTime;

        // Performance should not degrade by more than 20% as DB grows
        expect(performanceDegradation).toBeLessThan(0.2);
      }
    });
  });
});
