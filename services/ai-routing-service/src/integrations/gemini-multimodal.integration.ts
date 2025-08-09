
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { logger } from '@ai-platform/shared-utils';
import { BaseProvider } from './base-provider';

export interface GeminiMultimodalRequest {
  model: string;
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<{
      text?: string;
      inlineData?: {
        mimeType: string;
        data: string; // base64 encoded
      };
      fileData?: {
        mimeType: string;
        fileUri: string;
      };
    }>;
  }>;
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    responseMimeType?: string;
    responseSchema?: any;
    stopSequences?: string[];
  };
  safetySettings?: Array<{
    category: HarmCategory;
    threshold: HarmBlockThreshold;
  }>;
  tools?: Array<{
    functionDeclarations: Array<{
      name: string;
      description: string;
      parameters?: any;
    }>;
  }>;
  systemInstruction?: {
    role: 'system';
    parts: Array<{ text: string }>;
  };
}

export interface MultimodalAnalysisResult {
  visual_elements: {
    objects: Array<{
      name: string;
      confidence: number;
      boundingBox?: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
    }>;
    text: Array<{
      content: string;
      confidence: number;
      language?: string;
    }>;
    scenes: Array<{
      description: string;
      confidence: number;
      emotions?: string[];
    }>;
    colors: Array<{
      name: string;
      hex: string;
      percentage: number;
    }>;
  };
  text_analysis: {
    content: string;
    sentiment: {
      score: number;
      magnitude: number;
      label: 'positive' | 'negative' | 'neutral';
    };
    topics: string[];
    language: string;
  };
  multimodal_insights: {
    coherence_score: number;
    context_alignment: number;
    accessibility_score: number;
    recommendations: string[];
  };
}

export interface VideoAnalysisConfig {
  frameRate?: number; // frames per second to analyze
  maxFrames?: number;
  analysisType: 'motion' | 'objects' | 'scenes' | 'text' | 'comprehensive';
  generateCaptions?: boolean;
  trackObjects?: boolean;
}

export interface AudioAnalysisConfig {
  language?: string;
  enableTranscription?: boolean;
  enableSentimentAnalysis?: boolean;
  enableSpeakerRecognition?: boolean;
}

export class GeminiMultimodalIntegration extends BaseProvider {
  private client: GoogleGenerativeAI;
  private functionExecutors: Map<string, Function> = new Map();

  // Supported models and their capabilities
  private modelCapabilities = {
    'gemini-1.5-pro': {
      supportsVision: true,
      supportsAudio: true,
      supportsVideo: true,
      supportsDocuments: true,
      maxInputTokens: 2000000,
      maxOutputTokens: 8192
    },
    'gemini-1.5-flash': {
      supportsVision: true,
      supportsAudio: true,
      supportsVideo: true,
      supportsDocuments: true,
      maxInputTokens: 1000000,
      maxOutputTokens: 8192
    },
    'gemini-pro-vision': {
      supportsVision: true,
      supportsAudio: false,
      supportsVideo: false,
      supportsDocuments: false,
      maxInputTokens: 16384,
      maxOutputTokens: 2048
    }
  };

  constructor() {
    super();
    this.client = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');
    this.setupDefaultFunctions();
  }

  /**
   * Analyze multimodal content (text, images, video, audio)
   */
  async analyzeMultimodal(
    content: {
      text?: string;
      images?: Array<{ data: string; mimeType: string }>;
      videos?: Array<{ data: string; mimeType: string }>;
      audio?: Array<{ data: string; mimeType: string }>;
      documents?: Array<{ data: string; mimeType: string }>;
    },
    analysisType: 'comprehensive' | 'visual' | 'textual' | 'contextual' = 'comprehensive'
  ): Promise<MultimodalAnalysisResult> {
    try {
      logger.info('Starting multimodal analysis', {
        hasText: !!content.text,
        imageCount: content.images?.length || 0,
        videoCount: content.videos?.length || 0,
        audioCount: content.audio?.length || 0,
        documentCount: content.documents?.length || 0,
        analysisType
      });

      // Prepare content parts
      const parts = await this.prepareMultimodalContent(content);
      
      // Build analysis prompt
      const analysisPrompt = this.buildMultimodalAnalysisPrompt(analysisType);
      parts.unshift({ text: analysisPrompt });

      const request: GeminiMultimodalRequest = {
        model: 'gemini-1.5-pro',
        contents: [
          {
            role: 'user',
            parts
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema: this.getMultimodalAnalysisSchema()
        }
      };

      const response = await this.sendMultimodalRequest(request);
      return this.parseMultimodalAnalysisResponse(response);

    } catch (error) {
      logger.error('Multimodal analysis failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Analyze video content with frame-by-frame analysis
   */
  async analyzeVideo(
    videoData: string,
    mimeType: string,
    config: VideoAnalysisConfig
  ): Promise<{
    summary: string;
    frames: Array<{
      timestamp: number;
      analysis: {
        objects: string[];
        actions: string[];
        text: string[];
        emotions: string[];
      };
    }>;
    motion_analysis: {
      movement_intensity: number;
      dominant_motions: string[];
      scene_changes: number[];
    };
    captions?: string[];
  }> {
    try {
      const parts = [
        {
          text: this.buildVideoAnalysisPrompt(config)
        },
        {
          inlineData: {
            mimeType,
            data: videoData
          }
        }
      ];

      const request: GeminiMultimodalRequest = {
        model: 'gemini-1.5-pro',
        contents: [
          {
            role: 'user',
            parts
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json'
        }
      };

      const response = await this.sendMultimodalRequest(request);
      return this.parseVideoAnalysisResponse(response);

    } catch (error) {
      logger.error('Video analysis failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Process audio content with transcription and analysis
   */
  async analyzeAudio(
    audioData: string,
    mimeType: string,
    config: AudioAnalysisConfig
  ): Promise<{
    transcription: {
      text: string;
      confidence: number;
      language: string;
      timestamps?: Array<{
        start: number;
        end: number;
        text: string;
      }>;
    };
    sentiment?: {
      score: number;
      label: string;
      emotions: string[];
    };
    speakers?: Array<{
      id: string;
      name?: string;
      segments: Array<{
        start: number;
        end: number;
        text: string;
      }>;
    }>;
    audio_features: {
      duration: number;
      quality: string;
      noise_level: string;
      speech_rate: number;
    };
  }> {
    try {
      const parts = [
        {
          text: this.buildAudioAnalysisPrompt(config)
        },
        {
          inlineData: {
            mimeType,
            data: audioData
          }
        }
      ];

      const request: GeminiMultimodalRequest = {
        model: 'gemini-1.5-pro',
        contents: [
          {
            role: 'user',
            parts
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json'
        }
      };

      const response = await this.sendMultimodalRequest(request);
      return this.parseAudioAnalysisResponse(response);

    } catch (error) {
      logger.error('Audio analysis failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Generate content based on multimodal inputs
   */
  async generateFromMultimodal(
    inputs: {
      text?: string;
      images?: Array<{ data: string; mimeType: string }>;
      context?: string;
    },
    outputType: 'text' | 'story' | 'description' | 'summary' | 'analysis',
    style?: {
      tone?: string;
      format?: string;
      length?: 'short' | 'medium' | 'long';
      audience?: string;
    }
  ): Promise<{
    content: string;
    metadata: {
      input_analysis: string;
      generation_strategy: string;
      confidence: number;
    };
  }> {
    try {
      const parts = await this.prepareMultimodalContent(inputs);
      const generationPrompt = this.buildGenerationPrompt(outputType, style);
      parts.unshift({ text: generationPrompt });

      const request: GeminiMultimodalRequest = {
        model: 'gemini-1.5-pro',
        contents: [
          {
            role: 'user',
            parts
          }
        ],
        generationConfig: {
          temperature: outputType === 'story' ? 0.8 : 0.4,
          maxOutputTokens: this.getTokensForLength(style?.length),
          topP: 0.9
        }
      };

      const response = await this.sendMultimodalRequest(request);
      return {
        content: response.text || '',
        metadata: {
          input_analysis: 'Multimodal input processed',
          generation_strategy: `Generated ${outputType} content`,
          confidence: 0.85
        }
      };

    } catch (error) {
      logger.error('Multimodal generation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Stream multimodal content processing
   */
  async streamMultimodal(
    request: GeminiMultimodalRequest,
    onChunk: (chunk: any) => void,
    onComplete: (result: any) => void,
    onError: (error: Error) => void
  ): Promise<void> {
    try {
      const model = this.client.getGenerativeModel({
        model: request.model,
        generationConfig: request.generationConfig,
        safetySettings: request.safetySettings
      });

      const result = await model.generateContentStream({
        contents: request.contents,
        tools: request.tools,
        systemInstruction: request.systemInstruction
      });

      let fullText = '';
      let functionCalls: any[] = [];

      for await (const chunk of result.stream) {
        try {
          const chunkText = chunk.text();
          fullText += chunkText;

          // Process function calls if present
          if (chunk.functionCalls) {
            functionCalls.push(...chunk.functionCalls);
          }

          onChunk({
            text: chunkText,
            fullText,
            functionCalls: chunk.functionCalls || []
          });

        } catch (chunkError) {
          logger.error('Error processing multimodal streaming chunk', {
            error: chunkError instanceof Error ? chunkError.message : 'Unknown error'
          });
        }
      }

      // Execute any function calls
      const functionResults = await this.executeFunctionCalls(functionCalls);

      const finalResponse = await result.response;
      onComplete({
        text: fullText,
        response: finalResponse,
        functionCalls: functionResults
      });

    } catch (error) {
      logger.error('Multimodal streaming failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      onError(error instanceof Error ? error : new Error('Streaming failed'));
    }
  }

  /**
   * Register function for Gemini function calling
   */
  registerFunction(
    name: string,
    description: string,
    parameters: any,
    executor: Function
  ): void {
    this.functionExecutors.set(name, executor);
    
    logger.info('Function registered for Gemini', {
      name,
      description
    });
  }

  /**
   * Get model capabilities
   */
  getModelCapabilities(model: string): any {
    return this.modelCapabilities[model as keyof typeof this.modelCapabilities] || null;
  }

  private async sendMultimodalRequest(request: GeminiMultimodalRequest): Promise<any> {
    try {
      const model = this.client.getGenerativeModel({
        model: request.model,
        generationConfig: request.generationConfig,
        safetySettings: request.safetySettings || this.getDefaultSafetySettings()
      });

      const result = await model.generateContent({
        contents: request.contents,
        tools: request.tools,
        systemInstruction: request.systemInstruction
      });

      const response = result.response;
      return {
        text: response.text(),
        candidates: response.candidates,
        promptFeedback: response.promptFeedback,
        usageMetadata: response.usageMetadata
      };

    } catch (error) {
      logger.error('Gemini multimodal request failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw this.handleProviderError(error);
    }
  }

  private async prepareMultimodalContent(content: any): Promise<any[]> {
    const parts: any[] = [];

    if (content.text) {
      parts.push({ text: content.text });
    }

    if (content.images) {
      for (const image of content.images) {
        parts.push({
          inlineData: {
            mimeType: image.mimeType,
            data: image.data
          }
        });
      }
    }

    if (content.videos) {
      for (const video of content.videos) {
        parts.push({
          inlineData: {
            mimeType: video.mimeType,
            data: video.data
          }
        });
      }
    }

    if (content.audio) {
      for (const audio of content.audio) {
        parts.push({
          inlineData: {
            mimeType: audio.mimeType,
            data: audio.data
          }
        });
      }
    }

    if (content.documents) {
      for (const doc of content.documents) {
        parts.push({
          inlineData: {
            mimeType: doc.mimeType,
            data: doc.data
          }
        });
      }
    }

    return parts;
  }

  private buildMultimodalAnalysisPrompt(analysisType: string): string {
    const basePrompt = `Analyze the provided multimodal content comprehensively. `;

    switch (analysisType) {
      case 'comprehensive':
        return basePrompt + `Provide a detailed analysis covering visual elements, text content, context, and relationships between different modalities.`;
      
      case 'visual':
        return basePrompt + `Focus on visual elements including objects, scenes, colors, composition, and visual text.`;
      
      case 'textual':
        return basePrompt + `Focus on textual content including sentiment, topics, language, and meaning.`;
      
      case 'contextual':
        return basePrompt + `Focus on context, relationships, and coherence between different content elements.`;
      
      default:
        return basePrompt + `Provide a balanced analysis of all content elements.`;
    }
  }

  private buildVideoAnalysisPrompt(config: VideoAnalysisConfig): string {
    let prompt = `Analyze this video content with focus on: ${config.analysisType}. `;

    if (config.generateCaptions) {
      prompt += `Generate descriptive captions for key scenes. `;
    }

    if (config.trackObjects) {
      prompt += `Track and identify objects throughout the video. `;
    }

    prompt += `Provide detailed frame-by-frame analysis and overall video summary.`;
    return prompt;
  }

  private buildAudioAnalysisPrompt(config: AudioAnalysisConfig): string {
    let prompt = `Analyze this audio content. `;

    if (config.enableTranscription) {
      prompt += `Provide accurate transcription with timestamps. `;
    }

    if (config.enableSentimentAnalysis) {
      prompt += `Analyze sentiment and emotional tone. `;
    }

    if (config.enableSpeakerRecognition) {
      prompt += `Identify and track different speakers if present. `;
    }

    if (config.language) {
      prompt += `Process in ${config.language} language. `;
    }

    return prompt;
  }

  private buildGenerationPrompt(outputType: string, style?: any): string {
    let prompt = `Generate ${outputType} content based on the provided multimodal inputs. `;

    if (style?.tone) {
      prompt += `Use a ${style.tone} tone. `;
    }

    if (style?.format) {
      prompt += `Format as ${style.format}. `;
    }

    if (style?.audience) {
      prompt += `Target audience: ${style.audience}. `;
    }

    prompt += `Ensure the content is coherent, engaging, and makes use of all provided context.`;
    return prompt;
  }

  private getMultimodalAnalysisSchema(): any {
    return {
      type: 'object',
      properties: {
        visual_elements: {
          type: 'object',
          properties: {
            objects: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  confidence: { type: 'number' }
                }
              }
            },
            text: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  content: { type: 'string' },
                  confidence: { type: 'number' }
                }
              }
            },
            scenes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  confidence: { type: 'number' }
                }
              }
            }
          }
        },
        text_analysis: {
          type: 'object',
          properties: {
            content: { type: 'string' },
            sentiment: {
              type: 'object',
              properties: {
                score: { type: 'number' },
                label: { type: 'string' }
              }
            },
            topics: {
              type: 'array',
              items: { type: 'string' }
            }
          }
        }
      }
    };
  }

  private parseMultimodalAnalysisResponse(response: any): MultimodalAnalysisResult {
    try {
      const parsed = JSON.parse(response.text);
      return {
        visual_elements: {
          objects: parsed.visual_elements?.objects || [],
          text: parsed.visual_elements?.text || [],
          scenes: parsed.visual_elements?.scenes || [],
          colors: parsed.visual_elements?.colors || []
        },
        text_analysis: {
          content: parsed.text_analysis?.content || '',
          sentiment: {
            score: parsed.text_analysis?.sentiment?.score || 0,
            magnitude: parsed.text_analysis?.sentiment?.magnitude || 0,
            label: parsed.text_analysis?.sentiment?.label || 'neutral'
          },
          topics: parsed.text_analysis?.topics || [],
          language: parsed.text_analysis?.language || 'unknown'
        },
        multimodal_insights: {
          coherence_score: parsed.multimodal_insights?.coherence_score || 0.8,
          context_alignment: parsed.multimodal_insights?.context_alignment || 0.8,
          accessibility_score: parsed.multimodal_insights?.accessibility_score || 0.8,
          recommendations: parsed.multimodal_insights?.recommendations || []
        }
      };
    } catch (error) {
      logger.error('Failed to parse multimodal analysis response', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new Error('Failed to parse analysis results');
    }
  }

  private parseVideoAnalysisResponse(response: any): any {
    try {
      return JSON.parse(response.text);
    } catch (error) {
      return {
        summary: response.text,
        frames: [],
        motion_analysis: {
          movement_intensity: 0.5,
          dominant_motions: [],
          scene_changes: []
        }
      };
    }
  }

  private parseAudioAnalysisResponse(response: any): any {
    try {
      return JSON.parse(response.text);
    } catch (error) {
      return {
        transcription: {
          text: response.text,
          confidence: 0.8,
          language: 'unknown'
        },
        audio_features: {
          duration: 0,
          quality: 'good',
          noise_level: 'low',
          speech_rate: 150
        }
      };
    }
  }

  private async executeFunctionCalls(functionCalls: any[]): Promise<any[]> {
    const results = await Promise.all(
      functionCalls.map(async (call) => {
        const executor = this.functionExecutors.get(call.name);
        if (!executor) {
          return { name: call.name, error: 'Function not found' };
        }

        try {
          const result = await executor(call.args);
          return { name: call.name, result };
        } catch (error) {
          return { 
            name: call.name, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          };
        }
      })
    );
    return results;
  }

  private getDefaultSafetySettings(): any[] {
    return [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
      }
    ];
  }

  private getTokensForLength(length?: string): number {
    switch (length) {
      case 'short': return 500;
      case 'medium': return 1500;
      case 'long': return 4000;
      default: return 1000;
    }
  }

  private setupDefaultFunctions(): void {
    this.registerFunction(
      'analyze_image_content',
      'Analyze image content for objects, text, and scenes',
      {
        type: 'object',
        properties: {
          focus: { type: 'string', description: 'What to focus on in the analysis' }
        }
      },
      async (args: { focus?: string }) => {
        return {
          analysis_type: 'image_content',
          focus: args.focus || 'general',
          timestamp: new Date().toISOString()
        };
      }
    );

    this.registerFunction(
      'extract_text_from_media',
      'Extract and analyze text from images or video',
      {
        type: 'object',
        properties: {
          language: { type: 'string', description: 'Expected language of the text' }
        }
      },
      async (args: { language?: string }) => {
        return {
          extraction_type: 'text_from_media',
          language: args.language || 'auto-detect',
          timestamp: new Date().toISOString()
        };
      }
    );
  }
}

export default new GeminiMultimodalIntegration();
