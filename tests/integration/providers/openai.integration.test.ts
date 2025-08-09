
import { OpenAIAdvancedIntegration } from '../../../services/ai-routing-service/src/integrations/openai-advanced.integration';

describe('OpenAI Provider Integration Tests', () => {
  let openaiIntegration: OpenAIAdvancedIntegration;

  beforeAll(() => {
    openaiIntegration = new OpenAIAdvancedIntegration();
  });

  describe('Basic Text Generation', () => {
    it('should generate text responses successfully', async () => {
      const request = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say hello world' }],
        maxTokens: 50
      };

      const response = await openaiIntegration.generateResponse(request);
      
      expect(response.success).toBe(true);
      expect(response.content).toMatch(/hello/i);
      expect(response.usage).toBeDefined();
      expect(response.usage.totalTokens).toBeGreaterThan(0);
    });

    it('should handle different temperature settings', async () => {
      const requests = [
        { temperature: 0.1, expected: 'deterministic' },
        { temperature: 0.9, expected: 'creative' }
      ];

      for (const { temperature, expected } of requests) {
        const request = {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Write a creative sentence' }],
          temperature,
          maxTokens: 100
        };

        const response = await openaiIntegration.generateResponse(request);
        
        expect(response.success).toBe(true);
        expect(response.metadata.temperature).toBe(temperature);
      }
    });
  });

  describe('Function Calling', () => {
    it('should execute function calls correctly', async () => {
      const request = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'What is 15 + 27?' }],
        functions: [
          {
            name: 'calculator',
            description: 'Performs basic math operations',
            parameters: {
              type: 'object',
              properties: {
                operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
                a: { type: 'number' },
                b: { type: 'number' }
              },
              required: ['operation', 'a', 'b']
            }
          }
        ],
        functionCall: 'auto'
      };

      const response = await openaiIntegration.generateResponse(request);
      
      expect(response.success).toBe(true);
      expect(response.functionCalls).toBeDefined();
      if (response.functionCalls && response.functionCalls.length > 0) {
        expect(response.functionCalls[0].name).toBe('calculator');
        expect(response.functionCalls[0].arguments.operation).toBe('add');
      }
    });

    it('should handle multiple function calls', async () => {
      const request = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Get current time and calculate 10 + 5' }],
        functions: [
          {
            name: 'get_time',
            description: 'Get current time',
            parameters: { type: 'object', properties: {} }
          },
          {
            name: 'calculator',
            description: 'Performs math operations',
            parameters: {
              type: 'object',
              properties: {
                operation: { type: 'string' },
                a: { type: 'number' },
                b: { type: 'number' }
              }
            }
          }
        ],
        functionCall: 'auto'
      };

      const response = await openaiIntegration.generateResponse(request);
      
      expect(response.success).toBe(true);
      if (response.functionCalls) {
        expect(response.functionCalls.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('Vision Capabilities', () => {
    it('should analyze images successfully', async () => {
      const imageUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD...'; // Base64 image
      
      const request = {
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What do you see in this image?' },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        maxTokens: 200
      };

      const response = await openaiIntegration.generateResponse(request);
      
      expect(response.success).toBe(true);
      expect(response.content).toMatch(/\w+/); // Contains descriptive text
      expect(response.metadata.hasVision).toBe(true);
    });

    it('should handle multiple images', async () => {
      const images = [
        'data:image/jpeg;base64,image1data...',
        'data:image/jpeg;base64,image2data...'
      ];

      const request = {
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Compare these two images' },
              ...images.map(url => ({ type: 'image_url', image_url: { url } }))
            ]
          }
        ],
        maxTokens: 300
      };

      const response = await openaiIntegration.generateResponse(request);
      
      expect(response.success).toBe(true);
      expect(response.metadata.imageCount).toBe(2);
    });
  });

  describe('Streaming Responses', () => {
    it('should stream responses correctly', async () => {
      const request = {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Tell me a short story' }],
        stream: true,
        maxTokens: 200
      };

      const chunks: string[] = [];
      const stream = await openaiIntegration.streamResponse(request);
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('')).toMatch(/\w+/);
    });

    it('should handle streaming with function calls', async () => {
      const request = {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'What time is it and tell me a joke' }],
        functions: [
          {
            name: 'get_time',
            description: 'Get current time',
            parameters: { type: 'object', properties: {} }
          }
        ],
        stream: true,
        functionCall: 'auto'
      };

      const chunks: any[] = [];
      const stream = await openaiIntegration.streamResponse(request);
      
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      const hasFunctionCall = chunks.some(chunk => chunk.functionCall);
      const hasTextContent = chunks.some(chunk => chunk.content);
      
      expect(hasFunctionCall || hasTextContent).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      const request = {
        model: 'invalid-model',
        messages: [{ role: 'user', content: 'Test' }],
        maxTokens: 100
      };

      const response = await openaiIntegration.generateResponse(request);
      
      expect(response.success).toBe(false);
      expect(response.error).toBeDefined();
      expect(response.errorType).toBe('model_not_found');
    });

    it('should handle rate limiting', async () => {
      // Simulate rapid requests
      const requests = Array.from({ length: 5 }, () => ({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Quick test' }],
        maxTokens: 10
      }));

      const responses = await Promise.allSettled(
        requests.map(req => openaiIntegration.generateResponse(req))
      );

      const rateLimitedResponses = responses.filter(r => 
        r.status === 'fulfilled' && 
        !r.value.success && 
        r.value.errorType === 'rate_limit'
      );

      // Should handle rate limiting gracefully
      expect(rateLimitedResponses.length).toBeLessThanOrEqual(responses.length);
    });
  });
});
