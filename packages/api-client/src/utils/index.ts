
// API client utilities
import type { APIError } from '../types';
import { HTTP_STATUS, ERROR_CODES } from '@ai-platform/shared-types';

export function createAPIError(
  message: string,
  status?: number,
  code?: string,
  details?: any,
  requestId?: string
): APIError {
  return {
    message,
    status,
    code,
    details,
    timestamp: new Date(),
    requestId,
  };
}

export function isNetworkError(error: any): boolean {
  return error.code === 'NETWORK_ERROR' || 
         error.code === 'ECONNABORTED' ||
         error.message?.includes('Network Error');
}

export function isTimeoutError(error: any): boolean {
  return error.code === 'ECONNABORTED' || 
         error.message?.includes('timeout');
}

export function isRetryableError(error: any): boolean {
  // Retry on network errors, timeouts, and 5xx server errors
  if (isNetworkError(error) || isTimeoutError(error)) {
    return true;
  }
  
  const status = error.response?.status;
  return status >= 500 && status <= 599;
}

export function getErrorMessage(error: any): string {
  if (error.response?.data?.message) {
    return error.response.data.message;
  }
  
  if (error.response?.data?.error) {
    return error.response.data.error;
  }
  
  if (error.message) {
    return error.message;
  }
  
  return 'An unexpected error occurred';
}

export function getErrorCode(error: any): string {
  if (error.response?.data?.code) {
    return error.response.data.code;
  }
  
  const status = error.response?.status;
  switch (status) {
    case 400: return ERROR_CODES.VALIDATION_ERROR;
    case 401: return ERROR_CODES.AUTHENTICATION_FAILED;
    case 403: return ERROR_CODES.AUTHORIZATION_FAILED;
    case 404: return ERROR_CODES.RESOURCE_NOT_FOUND;
    case 409: return ERROR_CODES.DUPLICATE_RESOURCE;
    case 429: return ERROR_CODES.RATE_LIMIT_EXCEEDED;
    default: return ERROR_CODES.INTERNAL_ERROR;
  }
}

export function createQueryString(params: Record<string, any>): string {
  const searchParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        value.forEach(item => searchParams.append(key, String(item)));
      } else {
        searchParams.append(key, String(value));
      }
    }
  });
  
  return searchParams.toString();
}

export function sanitizeHeaders(
  headers: Record<string, any>,
  sensitiveHeaders: string[] = ['authorization', 'cookie', 'x-api-key']
): Record<string, any> {
  const sanitized: Record<string, any> = {};
  
  Object.entries(headers).forEach(([key, value]) => {
    const lowerKey = key.toLowerCase();
    if (sensitiveHeaders.includes(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  });
  
  return sanitized;
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function exponentialBackoff(attempt: number, baseDelay: number = 1000): number {
  return Math.min(baseDelay * Math.pow(2, attempt), 30000); // Cap at 30 seconds
}

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function isValidURL(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function parseErrorResponse(response: any): {
  message: string;
  code?: string;
  details?: any;
} {
  if (typeof response === 'string') {
    try {
      const parsed = JSON.parse(response);
      return {
        message: parsed.message || parsed.error || 'Unknown error',
        code: parsed.code,
        details: parsed.details,
      };
    } catch {
      return { message: response };
    }
  }
  
  if (response?.message || response?.error) {
    return {
      message: response.message || response.error,
      code: response.code,
      details: response.details,
    };
  }
  
  return { message: 'Unknown error' };
}

export function createAbortController(): AbortController {
  if (typeof AbortController !== 'undefined') {
    return new AbortController();
  }
  
  // Fallback for environments without AbortController
  return {
    signal: { aborted: false, addEventListener: () => {}, removeEventListener: () => {} },
    abort: () => {},
  } as any;
}
