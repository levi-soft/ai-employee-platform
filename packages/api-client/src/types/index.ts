
// API client types and interfaces
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
// Using relative import since workspace imports need proper setup
type APIResponse<T = any> = {
  success: boolean;
  data?: T;
  message?: string;
  errors?: any[];
  meta?: Record<string, any>;
};

export interface APIClientConfig {
  baseURL: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  enableLogging?: boolean;
  enableRetry?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType?: string;
}

export interface APIError {
  message: string;
  status?: number;
  code?: string;
  details?: any;
  timestamp: Date;
  requestId?: string;
}

export interface RequestConfig extends AxiosRequestConfig {
  skipAuth?: boolean;
  skipRetry?: boolean;
  skipErrorHandling?: boolean;
  customTimeout?: number;
}

export interface InterceptorOptions {
  onRequest?: (config: any) => any;
  onRequestError?: (error: any) => Promise<any>;
  onResponse?: (response: AxiosResponse) => AxiosResponse;
  onResponseError?: (error: any) => Promise<any>;
}

export interface RetryConfig {
  attempts: number;
  delay: number;
  condition?: (error: any) => boolean;
}

export interface LoggingConfig {
  logRequests: boolean;
  logResponses: boolean;
  logErrors: boolean;
  sensitiveHeaders: string[];
}

export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  params?: Record<string, any>;
  data?: any;
  headers?: Record<string, string>;
  timeout?: number;
  skipAuth?: boolean;
}

export interface PaginatedRequestOptions extends RequestOptions {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface StreamOptions extends RequestOptions {
  onProgress?: (chunk: string) => void;
  onComplete?: () => void;
  onError?: (error: APIError) => void;
  signal?: AbortSignal;
}
