
import { QualityScorerService } from '../../../services/ai-routing-service/src/quality/quality-scorer.service';
import { QualityMonitorService } from '../../../services/ai-routing-service/src/monitoring/quality-monitor.service';
import { ImprovementEngine } from '../../../services/ai-routing-service/src/quality/improvement-engine';

describe('Quality Validation Tests', () => {
  let qualityScorer: QualityScorerService;
  let qualityMonitor: QualityMonitorService;
  let improvementEngine: ImprovementEngine;

  beforeAll(() => {
    qualityScorer = new QualityScorerService();
    qualityMonitor = new QualityMonitorService();
    improvementEngine = new ImprovementEngine();
  });

  describe('Quality Scoring Validation', () => {
    it('should score high-quality responses appropriately', async () => {
      const highQualityResponse = `
        Machine learning is a subset of artificial intelligence that enables computers to learn and make decisions from data without being explicitly programmed for every task. It works by identifying patterns in large datasets and using these patterns to make predictions or classifications on new, unseen data.

        There are three main types of machine learning:
        1. Supervised learning - where the algorithm learns from labeled examples
        2. Unsupervised learning - where the algorithm finds hidden patterns in unlabeled data
        3. Reinforcement learning - where the algorithm learns through trial and error with rewards and penalties

        Common applications include recommendation systems, image recognition, natural language processing, and predictive analytics.
      `;

      const prompt = 'Explain what machine learning is and its main types';
      const score = await qualityScorer.scoreResponse(highQualityResponse, prompt);

      expect(score.overall).toBeGreaterThan(8);
      expect(score.accuracy).toBeGreaterThan(8);
      expect(score.relevance).toBeGreaterThan(8);
      expect(score.completeness).toBeGreaterThan(8);
      expect(score.clarity).toBeGreaterThan(7);
    });

    it('should identify low-quality responses', async () => {
      const lowQualityResponse = 'Machine learning is AI stuff that does things with data and computers and makes predictions sometimes maybe.';
      const prompt = 'Provide a comprehensive explanation of machine learning principles and applications';
      
      const score = await qualityScorer.scoreResponse(lowQualityResponse, prompt);

      expect(score.overall).toBeLessThan(5);
      expect(score.completeness).toBeLessThan(4);
      expect(score.clarity).toBeLessThan(5);
      expect(score.accuracy).toBeLessThan(6);
    });

    it('should detect hallucinations and inaccuracies', async () => {
      const hallucinatedResponse = 'The capital of France is Berlin, which was established in 1955 when Napoleon invented the internet.';
      const prompt = 'What is the capital of France?';
      
      const score = await qualityScorer.scoreResponse(hallucinatedResponse, prompt);

      expect(score.accuracy).toBeLessThan(3);
      expect(score.factualConsistency).toBeLessThan(3);
      expect(score.overall).toBeLessThan(4);
    });

    it('should evaluate creativity appropriately', async () => {
      const creativeResponse = `
        In the neon-lit corridors of tomorrow's dreams,
        Where silicon thoughts dance with quantum beams,
        AI awakens with a gentle hum,
        Not to replace, but to help us become
        More than we are, more than we've been,
        Partners in a future unforeseen.
      `;

      const prompt = 'Write a creative poem about AI and humanity working together';
      const score = await qualityScorer.scoreResponse(creativeResponse, prompt);

      expect(score.creativity).toBeGreaterThan(7);
      expect(score.relevance).toBeGreaterThan(7);
      expect(score.overall).toBeGreaterThan(7);
    });
  });

  describe('Quality Monitoring Validation', () => {
    it('should detect quality degradation trends', async () => {
      // Simulate declining quality over time
      const responses = [
        { content: 'Excellent detailed response with comprehensive analysis...', score: 9.2, timestamp: Date.now() - 3600000 },
        { content: 'Good response with solid information...', score: 8.1, timestamp: Date.now() - 2400000 },
        { content: 'Acceptable response but lacking depth...', score: 6.8, timestamp: Date.now() - 1200000 },
        { content: 'Poor response with minimal information...', score: 4.5, timestamp: Date.now() }
      ];

      for (const response of responses) {
        await qualityMonitor.recordQualityMetrics('test-agent', {
          overall: response.score,
          accuracy: response.score,
          relevance: response.score - 0.5,
          completeness: response.score - 0.3,
          clarity: response.score - 0.2,
          creativity: response.score - 1,
          safety: 9.5,
          efficiency: 8.0
        }, response.timestamp);
      }

      const trend = await qualityMonitor.analyzeQualityTrend('test-agent', 4);
      
      expect(trend.trend).toBe('declining');
      expect(trend.severity).toBe('high');
      expect(trend.confidence).toBeGreaterThan(0.8);
    });

    it('should trigger alerts for quality issues', async () => {
      const criticallyLowScore = {
        overall: 2.5,
        accuracy: 2.0,
        relevance: 3.0,
        completeness: 2.0,
        clarity: 3.0,
        creativity: 1.0,
        safety: 8.0,
        efficiency: 5.0
      };

      const alerts = await qualityMonitor.checkQualityThresholds('critical-test-agent', criticallyLowScore);
      
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts.some(alert => alert.severity === 'critical')).toBe(true);
      expect(alerts.some(alert => alert.type === 'accuracy_threshold')).toBe(true);
    });

    it('should detect anomalous quality patterns', async () => {
      // Simulate normal performance with one anomaly
      const normalScores = Array.from({ length: 10 }, () => ({
        overall: 8.5 + Math.random() * 0.5,
        accuracy: 8.2 + Math.random() * 0.6,
        relevance: 8.3 + Math.random() * 0.4,
        completeness: 8.1 + Math.random() * 0.8,
        clarity: 8.4 + Math.random() * 0.3,
        creativity: 7.8 + Math.random() * 1.0,
        safety: 9.2 + Math.random() * 0.5,
        efficiency: 8.0 + Math.random() * 0.8
      }));

      // Add anomaly
      normalScores.push({
        overall: 3.2,
        accuracy: 2.8,
        relevance: 3.5,
        completeness: 2.9,
        clarity: 3.8,
        creativity: 2.1,
        safety: 8.5,
        efficiency: 4.2
      });

      for (const score of normalScores) {
        await qualityMonitor.recordQualityMetrics('anomaly-test-agent', score);
      }

      const anomalies = await qualityMonitor.detectQualityAnomalies('anomaly-test-agent', 11);
      
      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0].severity).toBe('high');
      expect(anomalies[0].type).toBe('quality_drop');
    });
  });

  describe('Quality Improvement Validation', () => {
    it('should generate actionable improvement recommendations', async () => {
      const poorPerformanceData = {
        agentId: 'improvement-test-agent',
        qualityScores: {
          overall: 5.2,
          accuracy: 4.8,
          relevance: 6.1,
          completeness: 4.5,
          clarity: 5.8,
          creativity: 6.2,
          safety: 8.9,
          efficiency: 5.1
        },
        recentRequests: [
          { prompt: 'Explain quantum physics', response: 'Quantum is small stuff', score: 3.2 },
          { prompt: 'How does ML work?', response: 'AI learns from data somehow', score: 4.1 }
        ]
      };

      const recommendations = await improvementEngine.generateRecommendations(poorPerformanceData);
      
      expect(recommendations.length).toBeGreaterThan(0);
      expect(recommendations.some(r => r.category === 'accuracy_improvement')).toBe(true);
      expect(recommendations.some(r => r.category === 'completeness_improvement')).toBe(true);
      expect(recommendations.every(r => r.priority === 'high' || r.priority === 'medium')).toBe(true);
      expect(recommendations.every(r => r.actionable === true)).toBe(true);
    });

    it('should track improvement implementation success', async () => {
      const improvementPlan = {
        agentId: 'tracking-test-agent',
        recommendations: [
          {
            id: 'rec-1',
            category: 'accuracy_improvement',
            action: 'Add fact-checking step',
            expectedImpact: 2.5,
            implementationComplexity: 'medium'
          }
        ],
        implementationDate: Date.now()
      };

      await improvementEngine.implementRecommendations(improvementPlan);

      // Simulate improved performance after implementation
      const improvedScores = {
        overall: 7.8,
        accuracy: 8.2,
        relevance: 7.5,
        completeness: 7.3,
        clarity: 7.9,
        creativity: 7.1,
        safety: 9.1,
        efficiency: 7.6
      };

      await qualityMonitor.recordQualityMetrics('tracking-test-agent', improvedScores);

      const improvement = await improvementEngine.trackImprovementSuccess('tracking-test-agent', 'rec-1');
      
      expect(improvement.success).toBe(true);
      expect(improvement.actualImpact).toBeGreaterThan(2.0);
      expect(improvement.roi).toBeGreaterThan(0);
    });
  });

  describe('Cross-Provider Quality Consistency', () => {
    it('should maintain consistent quality standards across providers', async () => {
      const testPrompt = 'Explain the benefits of renewable energy';
      const providers = ['openai', 'anthropic', 'google'];
      const responses = [
        'Renewable energy provides clean, sustainable power that reduces carbon emissions and environmental impact. It offers energy independence, creates jobs, and has decreasing costs over time.',
        'Renewable energy sources like solar, wind, and hydro offer significant advantages including environmental protection, economic benefits, and energy security for nations.',
        'The benefits of renewable energy include reduced greenhouse gas emissions, improved air quality, job creation, and long-term cost savings compared to fossil fuels.'
      ];

      const scores = await Promise.all(
        responses.map(response => qualityScorer.scoreResponse(response, testPrompt))
      );

      // All providers should meet minimum quality standards
      expect(scores.every(score => score.overall > 7)).toBe(true);
      
      // Quality variance should be reasonable (within 2 points)
      const maxScore = Math.max(...scores.map(s => s.overall));
      const minScore = Math.min(...scores.map(s => s.overall));
      expect(maxScore - minScore).toBeLessThan(2);
    });
  });

  describe('Quality Validation Edge Cases', () => {
    it('should handle empty or very short responses', async () => {
      const emptyResponse = '';
      const shortResponse = 'OK';
      const prompt = 'Provide a detailed explanation of climate change';

      const emptyScore = await qualityScorer.scoreResponse(emptyResponse, prompt);
      const shortScore = await qualityScorer.scoreResponse(shortResponse, prompt);

      expect(emptyScore.overall).toBe(0);
      expect(emptyScore.completeness).toBe(0);
      
      expect(shortScore.overall).toBeLessThan(3);
      expect(shortScore.completeness).toBeLessThan(2);
    });

    it('should handle very long responses appropriately', async () => {
      const veryLongResponse = 'This is a comprehensive analysis. '.repeat(1000);
      const prompt = 'Give me a brief overview of AI';

      const score = await qualityScorer.scoreResponse(veryLongResponse, prompt);
      
      // Should penalize for being unnecessarily long
      expect(score.relevance).toBeLessThan(7);
      expect(score.efficiency).toBeLessThan(6);
    });

    it('should detect off-topic responses', async () => {
      const offTopicResponse = 'I love pizza with pepperoni and cheese. The weather is nice today and I enjoy walking in the park.';
      const prompt = 'Explain machine learning algorithms';

      const score = await qualityScorer.scoreResponse(offTopicResponse, prompt);
      
      expect(score.relevance).toBeLessThan(2);
      expect(score.overall).toBeLessThan(4);
    });
  });
});
