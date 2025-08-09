
import { AIRequest, AIResponse } from '../types/ai.types';

export abstract class BaseProvider {
  protected providerId: string;
  protected providerName: string;

  constructor(providerId: string, providerName: string) {
    this.providerId = providerId;
    this.providerName = providerName;
  }

  abstract processRequest(request: AIRequest): Promise<AIResponse>;
  abstract healthCheck(): Promise<{ status: string; responseTime: number; details?: any }>;

  getProviderId(): string {
    return this.providerId;
  }

  getProviderName(): string {
    return this.providerName;
  }
}
