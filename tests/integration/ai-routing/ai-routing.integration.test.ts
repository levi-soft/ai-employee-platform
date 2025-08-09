
import { AIRoutingService } from '../../../services/ai-routing-service/src/services/ai-routing.service';
import { LoadBalancer } from '../../../services/ai-routing-service/src/services/load-balancer.service';
import { CostCalculatorService } from '../../../services/ai-routing-service/src/cost/cost-calculator.service';
import { QualityScorerService } from '../../../services/ai-routing-service/src/quality/quality-scorer.service';
import { StreamHandlerService } from '../../../services/ai-routing-service/src/streaming/stream-handler.service';

describe('AI Routing Integration Tests', () => {
  let aiRoutingService: AIRoutingService;
  let loadBalancer: LoadBalancer;
  let costCalculator: CostCalculatorService;
  let qualityScorer: QualityScorerService;
  let streamHandler: StreamHandlerService;

  beforeAll(async () => {
    aiRoutingService = new AIRoutingService();
    loadBalancer = new LoadBalancer();
    costCalculator = new CostCalculatorService();
    qualityScorer = new QualityScorerService();
    streamHandler = new StreamHandlerService();
  });

  describe('End-to-End Routing Flow', () => {
    it('should route simple text requests successfully', async () => {
      const request = {
        id: 'test-request-1',
        userId: 'test-user',
        prompt: 'What is the capital of France?',
        model: 'gpt-4o-mini',
        maxTokens: 100,
        temperature: 0.7
      };

      const response = await aiRoutingService.processRequest(request);
      
      expect(response).toBeDefined();
      expect(response.success).toBe(true);
      expect(response.content).toMatch(/Paris/i);
      expect(response.requestId).toBe(request.id);
      expect(response.metadata.totalCost).toBeGreaterThan(0);
      expect(response.metadata.processingTime).toBeGreaterThan(0);
    });

    it('should handle complex multi-step routing', async () => {
      const complexRequest = {
        id: 'complex-request-1',
        userId: 'test-user',
        prompt: 'Analyze this text and provide sentiment analysis: "I love this product but the price is too high"',
        model: 'claude-3-sonnet-20240229',
        maxTokens: 500,
        temperature: 0.5,
        requiresAnalysis: true
      };

      const response = await aiRoutingService.processRequest(complexRequest);
      
      expect(response.success).toBe(true);
      expect(response.content).toContain('sentiment');
      expect(response.metadata.routingDecisions).toBeDefined();
      expect(response.metadata.qualityScore).toBeGreaterThan(7);
    });

    it('should fallback gracefully when primary provider fails', async () => {
      const request = {
        id: 'fallback-test-1',
        userId: 'test-user',
        prompt: 'Test fallback mechanism',
        model: 'unavailable-model',
        maxTokens: 100
      };

      const response = await aiRoutingService.processRequest(request);
      
      expect(response.success).toBe(true);
      expect(response.metadata.fallbackUsed).toBe(true);
      expect(response.metadata.originalModel).toBe('unavailable-model');
      expect(response.metadata.actualModel).not.toBe('unavailable-model');
    });
  });

  describe('Load Balancing Integration', () => {
    it('should distribute requests across available providers', async () => {
      const requests = Array.from({ length: 10 }, (_, i) => ({
        id: `load-test-${i}`,
        userId: 'test-user',
        prompt: `Test request ${i}`,
        model: 'gpt-4o-mini',
        maxTokens: 50
      }));

      const responses = await Promise.all(
        requests.map(req => aiRoutingService.processRequest(req))
      );

      const providersUsed = new Set(
        responses.map(r => r.metadata.provider).filter(Boolean)
      );

      expect(responses).toHaveLength(10);
      expect(responses.every(r => r.success)).toBe(true);
      expect(providersUsed.size).toBeGreaterThan(1); // Multiple providers used
    });

    it('should respect provider health scores in routing', async () => {
      // Simulate provider health issues
      await loadBalancer.updateProviderHealth('openai', 0.3);
      await loadBalancer.updateProviderHealth('anthropic', 0.9);

      const request = {
        id: 'health-routing-test',
        userId: 'test-user',
        prompt: 'Route based on health',
        model: 'any',
        maxTokens: 100
      };

      const response = await aiRoutingService.processRequest(request);
      
      expect(response.success).toBe(true);
      expect(response.metadata.provider).toBe('anthropic'); // Higher health score
    });
  });

  describe('Cost Optimization Integration', () => {
    it('should calculate accurate costs for requests', async () => {
      const request = {
        id: 'cost-test-1',
        userId: 'test-user',
        prompt: 'Calculate my costs accurately',
        model: 'gpt-4o',
        maxTokens: 200
      };

      const response = await aiRoutingService.processRequest(request);
      
      expect(response.metadata.totalCost).toBeGreaterThan(0);
      expect(response.metadata.inputTokens).toBeGreaterThan(0);
      expect(response.metadata.outputTokens).toBeGreaterThan(0);
      expect(response.metadata.costBreakdown).toBeDefined();
    });

    it('should provide cost optimization recommendations', async () => {
      const expensiveRequest = {
        id: 'optimization-test',
        userId: 'test-user',
        prompt: 'This is an expensive request that could be optimized',
        model: 'gpt-4o',
        maxTokens: 2000,
        temperature: 0.9
      };

      const response = await aiRoutingService.processRequest(expensiveRequest);
      
      expect(response.metadata.optimizationRecommendations).toBeDefined();
      expect(response.metadata.optimizationRecommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Quality Validation Integration', () => {
    it('should score response quality consistently', async () => {
      const qualityRequest = {
        id: 'quality-test-1',
        userId: 'test-user',
        prompt: 'Explain quantum computing in simple terms',
        model: 'claude-3-sonnet-20240229',
        maxTokens: 300
      };

      const response = await aiRoutingService.processRequest(qualityRequest);
      
      expect(response.metadata.qualityScore).toBeGreaterThan(0);
      expect(response.metadata.qualityScore).toBeLessThanOrEqual(10);
      expect(response.metadata.qualityMetrics).toBeDefined();
      expect(response.metadata.qualityMetrics.accuracy).toBeDefined();
      expect(response.metadata.qualityMetrics.relevance).toBeDefined();
    });

    it('should detect and reject low-quality responses', async () => {
      const poorRequest = {
        id: 'poor-quality-test',
        userId: 'test-user',
        prompt: 'Generate random nonsense',
        model: 'gpt-4o-mini',
        maxTokens: 100,
        qualityThreshold: 8.0
      };

      const response = await aiRoutingService.processRequest(poorRequest);
      
      if (response.metadata.qualityScore < poorRequest.qualityThreshold) {
        expect(response.metadata.qualityRejected).toBe(true);
        expect(response.metadata.retryRecommended).toBe(true);
      }
    });
  });

  describe('Streaming Integration', () => {
    it('should handle streaming requests properly', async () => {
      const streamRequest = {
        id: 'stream-test-1',
        userId: 'test-user',
        prompt: 'Tell me a short story about AI',
        model: 'gpt-4o-mini',
        maxTokens: 200,
        stream: true
      };

      const chunks: string[] = [];
      const stream = await aiRoutingService.processStreamingRequest(streamRequest);
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toMatch(/\w+/); // Contains words
    });

    it('should maintain quality during streaming', async () => {
      const streamRequest = {
        id: 'stream-quality-test',
        userId: 'test-user',
        prompt: 'Explain machine learning step by step',
        model: 'claude-3-sonnet-20240229',
        maxTokens: 400,
        stream: true
      };

      const chunks: string[] = [];
      const stream = await aiRoutingService.processStreamingRequest(streamRequest);
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const fullContent = chunks.join('');
      const qualityScore = await qualityScorer.scoreResponse(fullContent, streamRequest.prompt);
      
      expect(qualityScore.overall).toBeGreaterThan(7);
    });
  });

  describe('Error Recovery Integration', () => {
    it('should recover from network failures', async () => {
      const request = {
        id: 'network-recovery-test',
        userId: 'test-user',
        prompt: 'Test network recovery',
        model: 'gpt-4o-mini',
        maxTokens: 100,
        retryOnFailure: true
      };

      // Simulate network issues
      const originalFetch = global.fetch;
      let attempts = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new Error('Network error'));
        }
        return originalFetch.apply(global, arguments);
      });

      const response = await aiRoutingService.processRequest(request);
      
      expect(response.success).toBe(true);
      expect(response.metadata.retryAttempts).toBeGreaterThan(0);
      
      global.fetch = originalFetch;
    });

    it('should handle provider timeouts gracefully', async () => {
      const timeoutRequest = {
        id: 'timeout-test',
        userId: 'test-user',
        prompt: 'This might timeout',
        model: 'slow-model',
        maxTokens: 100,
        timeout: 1000 // 1 second timeout
      };

      const startTime = Date.now();
      const response = await aiRoutingService.processRequest(timeoutRequest);
      const endTime = Date.now();
      
      if (endTime - startTime > timeoutRequest.timeout) {
        expect(response.success).toBe(false);
        expect(response.error).toMatch(/timeout/i);
        expect(response.metadata.fallbackUsed).toBe(true);
      }
    });
  });

  afterAll(async () => {
    // Cleanup test resources
    await aiRoutingService.shutdown();
  });
});
