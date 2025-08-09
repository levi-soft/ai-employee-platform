
export interface AIRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
    name?: string;
  }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string | string[];
  stream?: boolean;
  userId?: number;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  capabilities?: string[];
}

export interface AIResponse {
  id: string;
  model: string;
  provider: string;
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
  responseTime: number;
  metadata: {
    requestId: string;
    timestamp: string;
    model: string;
    [key: string]: any;
  };
}

export interface ProviderHealth {
  providerId: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'offline';
  responseTime: number;
  lastCheck: string;
  details?: any;
}
