
// Base API client with common functionality
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import type { 
  APIClientConfig, 
  AuthTokens, 
  RequestConfig, 
  RequestOptions, 
  PaginatedRequestOptions,
  StreamOptions,
  APIError 
} from '../types';
import { 
  API_ROUTES, 
  APIResponse, 
  PaginatedResponse 
} from '@ai-platform/shared-types';
import { setupInterceptors } from '../interceptors';
import { createQueryString, createAbortController } from '../utils';

export class BaseAPIClient {
  protected axiosInstance: AxiosInstance;
  private tokens: AuthTokens | null = null;
  private config: Required<APIClientConfig>;

  constructor(config: APIClientConfig) {
    this.config = {
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000,
      enableLogging: process.env.NODE_ENV === 'development',
      enableRetry: true,
      ...config,
    };

    this.axiosInstance = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    setupInterceptors(this.axiosInstance, {
      tokenProvider: () => this.tokens,
      tokenSetter: (tokens: AuthTokens) => this.setTokens(tokens),
      refreshTokenFn: (refreshToken: string) => this.refreshToken(refreshToken),
      retryConfig: this.config.enableRetry ? {
        attempts: this.config.retryAttempts,
        delay: this.config.retryDelay,
      } : undefined,
      loggingConfig: this.config.enableLogging ? {
        logRequests: true,
        logResponses: true,
        logErrors: true,
        sensitiveHeaders: ['authorization', 'cookie', 'x-api-key'],
      } : undefined,
      enableRequestId: true,
    });
  }

  // Token management
  public setTokens(tokens: AuthTokens): void {
    this.tokens = tokens;
  }

  public getTokens(): AuthTokens | null {
    return this.tokens;
  }

  public clearTokens(): void {
    this.tokens = null;
  }

  private async refreshToken(refreshToken: string): Promise<AuthTokens> {
    const response = await this.axiosInstance.post(API_ROUTES.AUTH.REFRESH, {
      refreshToken,
    }, { skipAuth: true });
    
    return response.data.data;
  }

  // HTTP methods
  protected async get<T = any>(
    url: string, 
    options: RequestOptions = {}
  ): Promise<APIResponse<T>> {
    const { params, ...config } = options;
    const response = await this.axiosInstance.get<APIResponse<T>>(url, {
      ...config,
      params,
    });
    return response.data;
  }

  protected async post<T = any>(
    url: string, 
    data?: any, 
    options: RequestOptions = {}
  ): Promise<APIResponse<T>> {
    const response = await this.axiosInstance.post<APIResponse<T>>(url, data, options);
    return response.data;
  }

  protected async put<T = any>(
    url: string, 
    data?: any, 
    options: RequestOptions = {}
  ): Promise<APIResponse<T>> {
    const response = await this.axiosInstance.put<APIResponse<T>>(url, data, options);
    return response.data;
  }

  protected async patch<T = any>(
    url: string, 
    data?: any, 
    options: RequestOptions = {}
  ): Promise<APIResponse<T>> {
    const response = await this.axiosInstance.patch<APIResponse<T>>(url, data, options);
    return response.data;
  }

  protected async delete<T = any>(
    url: string, 
    options: RequestOptions = {}
  ): Promise<APIResponse<T>> {
    const response = await this.axiosInstance.delete<APIResponse<T>>(url, options);
    return response.data;
  }

  // Paginated requests
  protected async getPaginated<T = any>(
    url: string,
    options: PaginatedRequestOptions = {}
  ): Promise<PaginatedResponse<T>> {
    const { page = 1, limit = 20, sortBy, sortOrder = 'asc', ...rest } = options;
    
    const params = {
      page,
      limit,
      ...(sortBy && { sortBy }),
      sortOrder,
      ...rest.params,
    };

    const response = await this.get<PaginatedResponse<T>>(url, { ...rest, params });
    return response.data!;
  }

  // Streaming requests
  protected async stream(
    url: string,
    options: StreamOptions = {}
  ): Promise<void> {
    const { onProgress, onComplete, onError, signal, ...requestConfig } = options;
    const controller = signal ? null : createAbortController();
    const actualSignal = signal || controller?.signal;

    try {
      const response = await this.axiosInstance({
        url,
        method: 'POST',
        responseType: 'stream',
        signal: actualSignal,
        ...requestConfig,
      });

      const reader = response.data.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            onComplete?.();
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          onProgress?.(chunk);
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      const apiError = error as APIError;
      onError?.(apiError);
      throw apiError;
    }
  }

  // Upload file
  protected async uploadFile<T = any>(
    url: string,
    file: File,
    options: RequestOptions & {
      onUploadProgress?: (progress: number) => void;
      fieldName?: string;
    } = {}
  ): Promise<APIResponse<T>> {
    const { onUploadProgress, fieldName = 'file', ...rest } = options;
    
    const formData = new FormData();
    formData.append(fieldName, file);

    const response = await this.axiosInstance.post<APIResponse<T>>(url, formData, {
      ...rest,
      headers: {
        'Content-Type': 'multipart/form-data',
        ...rest.headers,
      },
      onUploadProgress: onUploadProgress ? (progressEvent) => {
        if (progressEvent.total) {
          const progress = (progressEvent.loaded / progressEvent.total) * 100;
          onUploadProgress(Math.round(progress));
        }
      } : undefined,
    });

    return response.data;
  }

  // Health check
  public async healthCheck(): Promise<boolean> {
    try {
      await this.axiosInstance.get('/health', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  // Update configuration
  public updateConfig(config: Partial<APIClientConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Update axios instance config
    if (config.baseURL) {
      this.axiosInstance.defaults.baseURL = config.baseURL;
    }
    
    if (config.timeout) {
      this.axiosInstance.defaults.timeout = config.timeout;
    }
  }

  // Get current configuration
  public getConfig(): APIClientConfig {
    return { ...this.config };
  }
}
