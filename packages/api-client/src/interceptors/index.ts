
// Request and response interceptors
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { AuthTokens, APIError, RetryConfig, LoggingConfig } from '../types';
import { 
  createAPIError, 
  getErrorMessage, 
  getErrorCode, 
  isRetryableError, 
  delay, 
  exponentialBackoff, 
  generateRequestId,
  sanitizeHeaders 
} from '../utils';

// Authentication interceptor
export function createAuthInterceptor(tokenProvider: () => AuthTokens | null) {
  return {
    onRequest: (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
      const tokens = tokenProvider();
      
      if (tokens?.accessToken && !config.skipAuth) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${tokens.accessToken}`;
      }
      
      return config;
    },
    
    onRequestError: (error: any): Promise<any> => {
      return Promise.reject(error);
    },
  };
}

// Retry interceptor
export function createRetryInterceptor(retryConfig: RetryConfig) {
  return {
    onResponseError: async (error: any): Promise<any> => {
      const config = error.config;
      
      if (!config || config.skipRetry || !isRetryableError(error)) {
        return Promise.reject(error);
      }
      
      config.retryCount = config.retryCount || 0;
      
      if (config.retryCount >= retryConfig.attempts) {
        return Promise.reject(error);
      }
      
      config.retryCount++;
      
      const delayTime = exponentialBackoff(config.retryCount - 1, retryConfig.delay);
      await delay(delayTime);
      
      return axios(config);
    },
  };
}

// Logging interceptor
export function createLoggingInterceptor(loggingConfig: LoggingConfig) {
  return {
    onRequest: (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
      if (loggingConfig.logRequests) {
        console.log(`[API Request] ${config.method?.toUpperCase()} ${config.url}`, {
          headers: sanitizeHeaders(config.headers || {}, loggingConfig.sensitiveHeaders),
          data: config.data,
          params: config.params,
          requestId: config.metadata?.requestId,
        });
      }
      
      return config;
    },
    
    onResponse: (response: AxiosResponse): AxiosResponse => {
      if (loggingConfig.logResponses) {
        console.log(`[API Response] ${response.status} ${response.config.url}`, {
          status: response.status,
          headers: sanitizeHeaders(response.headers || {}, loggingConfig.sensitiveHeaders),
          data: response.data,
          requestId: response.config.metadata?.requestId,
        });
      }
      
      return response;
    },
    
    onResponseError: (error: any): Promise<any> => {
      if (loggingConfig.logErrors) {
        console.error(`[API Error] ${error.config?.url}`, {
          status: error.response?.status,
          message: getErrorMessage(error),
          data: error.response?.data,
          requestId: error.config?.metadata?.requestId,
        });
      }
      
      return Promise.reject(error);
    },
  };
}

// Error handling interceptor
export function createErrorInterceptor() {
  return {
    onResponseError: (error: any): Promise<APIError> => {
      const apiError = createAPIError(
        getErrorMessage(error),
        error.response?.status,
        getErrorCode(error),
        error.response?.data,
        error.config?.metadata?.requestId
      );
      
      return Promise.reject(apiError);
    },
  };
}

// Request ID interceptor
export function createRequestIdInterceptor() {
  return {
    onRequest: (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
      if (!config.metadata) {
        config.metadata = {};
      }
      
      if (!config.metadata.requestId) {
        config.metadata.requestId = generateRequestId();
      }
      
      config.headers = config.headers || {};
      config.headers['X-Request-ID'] = config.metadata.requestId;
      
      return config;
    },
  };
}

// Token refresh interceptor
export function createTokenRefreshInterceptor(
  tokenProvider: () => AuthTokens | null,
  tokenSetter: (tokens: AuthTokens) => void,
  refreshTokenFn: (refreshToken: string) => Promise<AuthTokens>
) {
  let isRefreshing = false;
  let failedQueue: Array<{
    resolve: (token: string) => void;
    reject: (error: any) => void;
  }> = [];

  const processQueue = (error: any, token: string | null = null) => {
    failedQueue.forEach((prom) => {
      if (error) {
        prom.reject(error);
      } else {
        prom.resolve(token as string);
      }
    });
    
    failedQueue = [];
  };

  return {
    onResponseError: async (error: any): Promise<any> => {
      const originalRequest = error.config;
      
      if (error.response?.status === 401 && !originalRequest._retry) {
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          }).then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return axios(originalRequest);
          }).catch((err) => {
            return Promise.reject(err);
          });
        }

        originalRequest._retry = true;
        isRefreshing = true;

        const tokens = tokenProvider();
        if (!tokens?.refreshToken) {
          processQueue(error, null);
          isRefreshing = false;
          return Promise.reject(error);
        }

        try {
          const newTokens = await refreshTokenFn(tokens.refreshToken);
          tokenSetter(newTokens);
          
          processQueue(null, newTokens.accessToken);
          
          originalRequest.headers.Authorization = `Bearer ${newTokens.accessToken}`;
          return axios(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError, null);
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      }

      return Promise.reject(error);
    },
  };
}

// Setup all interceptors on an Axios instance
export function setupInterceptors(
  axiosInstance: AxiosInstance,
  options: {
    tokenProvider?: () => AuthTokens | null;
    tokenSetter?: (tokens: AuthTokens) => void;
    refreshTokenFn?: (refreshToken: string) => Promise<AuthTokens>;
    retryConfig?: RetryConfig;
    loggingConfig?: LoggingConfig;
    enableRequestId?: boolean;
  } = {}
): void {
  // Request interceptors
  if (options.enableRequestId) {
    const requestIdInterceptor = createRequestIdInterceptor();
    axiosInstance.interceptors.request.use(
      requestIdInterceptor.onRequest,
      requestIdInterceptor.onRequestError
    );
  }
  
  if (options.tokenProvider) {
    const authInterceptor = createAuthInterceptor(options.tokenProvider);
    axiosInstance.interceptors.request.use(
      authInterceptor.onRequest,
      authInterceptor.onRequestError
    );
  }
  
  if (options.loggingConfig) {
    const loggingInterceptor = createLoggingInterceptor(options.loggingConfig);
    axiosInstance.interceptors.request.use(
      loggingInterceptor.onRequest,
      loggingInterceptor.onRequestError
    );
  }

  // Response interceptors
  if (options.loggingConfig) {
    const loggingInterceptor = createLoggingInterceptor(options.loggingConfig);
    axiosInstance.interceptors.response.use(
      loggingInterceptor.onResponse,
      loggingInterceptor.onResponseError
    );
  }
  
  if (options.tokenProvider && options.tokenSetter && options.refreshTokenFn) {
    const tokenRefreshInterceptor = createTokenRefreshInterceptor(
      options.tokenProvider,
      options.tokenSetter,
      options.refreshTokenFn
    );
    axiosInstance.interceptors.response.use(
      undefined,
      tokenRefreshInterceptor.onResponseError
    );
  }
  
  if (options.retryConfig) {
    const retryInterceptor = createRetryInterceptor(options.retryConfig);
    axiosInstance.interceptors.response.use(
      undefined,
      retryInterceptor.onResponseError
    );
  }
  
  // Error handling interceptor (should be last)
  const errorInterceptor = createErrorInterceptor();
  axiosInstance.interceptors.response.use(
    undefined,
    errorInterceptor.onResponseError
  );
}
