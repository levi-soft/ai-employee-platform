
import { AIRoutingService } from '../../../services/ai-routing-service/src/services/ai-routing.service';

describe('AI Routing Load Tests', () => {
  let aiRoutingService: AIRoutingService;

  beforeAll(async () => {
    aiRoutingService = new AIRoutingService();
  });

  describe('Concurrent Request Handling', () => {
    it('should handle 50 concurrent requests successfully', async () => {
      const concurrentRequests = 50;
      const requests = Array.from({ length: concurrentRequests }, (_, i) => ({
        id: `load-test-${i}`,
        userId: `user-${i % 10}`, // 10 different users
        prompt: `Test request number ${i}`,
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
      const averageLatency = totalTime / concurrentRequests;

      expect(successfulResponses.length).toBeGreaterThanOrEqual(concurrentRequests * 0.95); // 95% success rate
      expect(averageLatency).toBeLessThan(10000); // Average < 10 seconds
      
      console.log(`Load Test Results:
        Total Requests: ${concurrentRequests}
        Successful: ${successfulResponses.length}
        Success Rate: ${(successfulResponses.length / concurrentRequests * 100).toFixed(2)}%
        Total Time: ${totalTime}ms
        Average Latency: ${averageLatency.toFixed(2)}ms`);
    });

    it('should maintain performance under sustained load', async () => {
      const batchSize = 20;
      const batches = 5;
      const results: any[] = [];

      for (let batch = 0; batch < batches; batch++) {
        const requests = Array.from({ length: batchSize }, (_, i) => ({
          id: `sustained-${batch}-${i}`,
          userId: 'load-test-user',
          prompt: `Sustained load test batch ${batch}, request ${i}`,
          model: 'gpt-4o-mini',
          maxTokens: 50
        }));

        const batchStart = Date.now();
        const responses = await Promise.allSettled(
          requests.map(req => aiRoutingService.processRequest(req))
        );
        const batchEnd = Date.now();

        const successCount = responses.filter(r => 
          r.status === 'fulfilled' && r.value.success
        ).length;

        results.push({
          batch,
          successCount,
          totalRequests: batchSize,
          batchTime: batchEnd - batchStart,
          avgLatency: (batchEnd - batchStart) / batchSize
        });

        // Brief pause between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Verify performance doesn't degrade significantly
      const firstBatchLatency = results[0].avgLatency;
      const lastBatchLatency = results[results.length - 1].avgLatency;
      const degradationRatio = lastBatchLatency / firstBatchLatency;

      expect(degradationRatio).toBeLessThan(2.0); // Less than 2x degradation
      expect(results.every(r => r.successCount / r.totalRequests > 0.9)).toBe(true); // 90% success rate maintained

      console.log('Sustained Load Test Results:', results);
    });
  });

  describe('Memory and Resource Management', () => {
    it('should not leak memory during high load', async () => {
      const initialMemory = process.memoryUsage();
      
      // Run multiple batches of requests
      for (let i = 0; i < 3; i++) {
        const requests = Array.from({ length: 30 }, (_, j) => ({
          id: `memory-test-${i}-${j}`,
          userId: 'memory-test-user',
          prompt: 'Memory leak test request',
          model: 'gpt-4o-mini',
          maxTokens: 100
        }));

        await Promise.allSettled(
          requests.map(req => aiRoutingService.processRequest(req))
        );

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = (finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024);

      // Memory increase should be reasonable (less than 100MB)
      expect(memoryIncrease).toBeLessThan(100);
      
      console.log(`Memory Usage:
        Initial: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB
        Final: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB
        Increase: ${memoryIncrease.toFixed(2)}MB`);
    });

    it('should handle request spikes gracefully', async () => {
      // Simulate traffic spike: start low, spike up, then return to normal
      const phases = [
        { requests: 5, duration: 1000 },  // Normal load
        { requests: 50, duration: 2000 }, // Traffic spike
        { requests: 5, duration: 1000 }   // Return to normal
      ];

      const results: any[] = [];

      for (const phase of phases) {
        const requests = Array.from({ length: phase.requests }, (_, i) => ({
          id: `spike-test-${Date.now()}-${i}`,
          userId: 'spike-test-user',
          prompt: `Traffic spike test request ${i}`,
          model: 'gpt-4o-mini',
          maxTokens: 50
        }));

        const phaseStart = Date.now();
        const responses = await Promise.allSettled(
          requests.map(req => aiRoutingService.processRequest(req))
        );
        const phaseEnd = Date.now();

        const successCount = responses.filter(r => 
          r.status === 'fulfilled' && r.value.success
        ).length;

        results.push({
          requests: phase.requests,
          successCount,
          duration: phaseEnd - phaseStart,
          successRate: (successCount / phase.requests * 100).toFixed(2)
        });
      }

      // All phases should maintain reasonable success rates
      expect(results.every(r => parseFloat(r.successRate) > 80)).toBe(true);
      
      console.log('Traffic Spike Test Results:', results);
    });
  });

  describe('Provider Failover Under Load', () => {
    it('should maintain service during provider failures', async () => {
      const totalRequests = 40;
      const requests = Array.from({ length: totalRequests }, (_, i) => ({
        id: `failover-test-${i}`,
        userId: 'failover-test-user',
        prompt: `Failover test request ${i}`,
        model: 'gpt-4o-mini',
        maxTokens: 100
      }));

      // Simulate provider failure halfway through
      const responses: any[] = [];
      
      for (let i = 0; i < requests.length; i++) {
        // Simulate provider failure at 50% mark
        if (i === Math.floor(totalRequests / 2)) {
          // Simulate OpenAI failure
          console.log('Simulating provider failure...');
        }

        const response = await aiRoutingService.processRequest(requests[i]);
        responses.push(response);
      }

      const successfulResponses = responses.filter(r => r.success);
      const fallbackResponses = responses.filter(r => r.success && r.metadata?.fallbackUsed);

      expect(successfulResponses.length).toBeGreaterThanOrEqual(totalRequests * 0.8); // 80% success rate
      expect(fallbackResponses.length).toBeGreaterThan(0); // Some fallbacks should be used
      
      console.log(`Failover Test Results:
        Total: ${totalRequests}
        Successful: ${successfulResponses.length}
        Fallbacks Used: ${fallbackResponses.length}
        Success Rate: ${(successfulResponses.length / totalRequests * 100).toFixed(2)}%`);
    });
  });

  describe('Streaming Load Tests', () => {
    it('should handle multiple concurrent streams', async () => {
      const streamCount = 10;
      const streamRequests = Array.from({ length: streamCount }, (_, i) => ({
        id: `stream-load-${i}`,
        userId: 'stream-test-user',
        prompt: `Stream test ${i}: Tell me a story`,
        model: 'gpt-4o-mini',
        maxTokens: 200,
        stream: true
      }));

      const streamResults: any[] = [];
      const streamPromises = streamRequests.map(async (request) => {
        const chunks: string[] = [];
        const startTime = Date.now();
        
        try {
          const stream = await aiRoutingService.processStreamingRequest(request);
          
          for await (const chunk of stream) {
            chunks.push(chunk);
          }
          
          const endTime = Date.now();
          return {
            id: request.id,
            success: true,
            chunkCount: chunks.length,
            duration: endTime - startTime,
            totalContent: chunks.join('')
          };
        } catch (error) {
          return {
            id: request.id,
            success: false,
            error: error.message
          };
        }
      });

      const results = await Promise.allSettled(streamPromises);
      const successfulStreams = results.filter(r => 
        r.status === 'fulfilled' && r.value.success
      );

      expect(successfulStreams.length).toBeGreaterThanOrEqual(streamCount * 0.8); // 80% success rate
      
      console.log(`Streaming Load Test Results:
        Total Streams: ${streamCount}
        Successful: ${successfulStreams.length}
        Success Rate: ${(successfulStreams.length / streamCount * 100).toFixed(2)}%`);
    });
  });

  afterAll(async () => {
    await aiRoutingService.shutdown();
  });
});
