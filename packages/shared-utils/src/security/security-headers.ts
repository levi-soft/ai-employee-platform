
import { Request, Response, NextFunction } from 'express';

export interface SecurityHeadersConfig {
  contentSecurityPolicy?: boolean | string;
  hsts?: boolean | { maxAge?: number; includeSubDomains?: boolean; preload?: boolean };
  xssProtection?: boolean;
  contentTypeOptions?: boolean;
  frameOptions?: 'DENY' | 'SAMEORIGIN' | 'ALLOW-FROM' | false;
  referrerPolicy?: string | false;
  permissionsPolicy?: string | false;
  crossOriginEmbedderPolicy?: boolean;
  crossOriginOpenerPolicy?: boolean;
  crossOriginResourcePolicy?: boolean;
}

const defaultSecurityHeadersConfig: SecurityHeadersConfig = {
  contentSecurityPolicy: true,
  hsts: process.env.NODE_ENV === 'production',
  xssProtection: true,
  contentTypeOptions: true,
  frameOptions: 'DENY',
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: true,
  crossOriginEmbedderPolicy: false, // Can break functionality, enable carefully
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: false // Can break API usage, enable carefully
};

/**
 * Security headers middleware
 */
export const createSecurityHeaders = (config: SecurityHeadersConfig = {}) => {
  const finalConfig = { ...defaultSecurityHeadersConfig, ...config };
  
  return (req: Request, res: Response, next: NextFunction) => {
    // Content Security Policy
    if (finalConfig.contentSecurityPolicy) {
      const csp = typeof finalConfig.contentSecurityPolicy === 'string'
        ? finalConfig.contentSecurityPolicy
        : generateDefaultCSP(req);
      
      res.setHeader('Content-Security-Policy', csp);
    }
    
    // HTTP Strict Transport Security
    if (finalConfig.hsts && process.env.NODE_ENV === 'production') {
      const hstsConfig = typeof finalConfig.hsts === 'object' ? finalConfig.hsts : {};
      const maxAge = hstsConfig.maxAge || 31536000; // 1 year
      const includeSubDomains = hstsConfig.includeSubDomains !== false;
      const preload = hstsConfig.preload === true;
      
      let hstsValue = `max-age=${maxAge}`;
      if (includeSubDomains) hstsValue += '; includeSubDomains';
      if (preload) hstsValue += '; preload';
      
      res.setHeader('Strict-Transport-Security', hstsValue);
    }
    
    // XSS Protection
    if (finalConfig.xssProtection) {
      res.setHeader('X-XSS-Protection', '1; mode=block');
    }
    
    // Content Type Options
    if (finalConfig.contentTypeOptions) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    
    // Frame Options
    if (finalConfig.frameOptions) {
      res.setHeader('X-Frame-Options', finalConfig.frameOptions);
    }
    
    // Referrer Policy
    if (finalConfig.referrerPolicy) {
      res.setHeader('Referrer-Policy', finalConfig.referrerPolicy);
    }
    
    // Permissions Policy
    if (finalConfig.permissionsPolicy) {
      const policy = typeof finalConfig.permissionsPolicy === 'string'
        ? finalConfig.permissionsPolicy
        : generateDefaultPermissionsPolicy();
      
      res.setHeader('Permissions-Policy', policy);
    }
    
    // Cross-Origin Embedder Policy
    if (finalConfig.crossOriginEmbedderPolicy) {
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    }
    
    // Cross-Origin Opener Policy
    if (finalConfig.crossOriginOpenerPolicy) {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    }
    
    // Cross-Origin Resource Policy
    if (finalConfig.crossOriginResourcePolicy) {
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    }
    
    // Remove server identification
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');
    
    next();
  };
};

/**
 * Generate default Content Security Policy
 */
const generateDefaultCSP = (req: Request): string => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  const policies = [
    "default-src 'self'",
    isProduction 
      ? "script-src 'self'" 
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    isProduction
      ? "style-src 'self'"
      : "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.openai.com https://api.anthropic.com https://api.stripe.com",
    "media-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ];
  
  // Add WebSocket support for notification service
  if (req.path?.includes('/notifications') || req.headers.upgrade === 'websocket') {
    policies.push("connect-src 'self' ws: wss:");
  }
  
  return policies.join('; ');
};

/**
 * Generate default Permissions Policy
 */
const generateDefaultPermissionsPolicy = (): string => {
  return [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'payment=(self)',
    'usb=()',
    'serial=()',
    'bluetooth=()',
    'magnetometer=()',
    'gyroscope=()',
    'accelerometer=()',
    'ambient-light-sensor=()',
    'autoplay=()',
    'encrypted-media=()',
    'fullscreen=(self)',
    'picture-in-picture=()',
    'screen-wake-lock=()',
    'web-share=(self)'
  ].join(', ');
};

/**
 * API-specific security headers
 */
export const createApiSecurityHeaders = () => {
  return createSecurityHeaders({
    contentSecurityPolicy: "default-src 'none'; frame-ancestors 'none'",
    frameOptions: 'DENY',
    contentTypeOptions: true,
    referrerPolicy: 'no-referrer',
    crossOriginOpenerPolicy: true,
    permissionsPolicy: 'camera=(), microphone=(), geolocation=(), payment=()'
  });
};

/**
 * Frontend-specific security headers
 */
export const createFrontendSecurityHeaders = () => {
  return createSecurityHeaders({
    contentSecurityPolicy: true, // Use default CSP
    hsts: true,
    frameOptions: 'SAMEORIGIN',
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: true,
    crossOriginOpenerPolicy: true
  });
};

/**
 * Development-friendly security headers
 */
export const createDevSecurityHeaders = () => {
  return createSecurityHeaders({
    contentSecurityPolicy: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' localhost:*",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: localhost:*",
      "connect-src 'self' ws: wss: localhost:* https://api.openai.com",
      "font-src 'self' data:",
      "frame-src 'self' localhost:*"
    ].join('; '),
    hsts: false,
    frameOptions: 'SAMEORIGIN'
  });
};

/**
 * Strict security headers for sensitive operations
 */
export const createStrictSecurityHeaders = () => {
  return createSecurityHeaders({
    contentSecurityPolicy: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    frameOptions: 'DENY',
    referrerPolicy: 'no-referrer',
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: true,
    permissionsPolicy: [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'payment=()',
      'usb=()',
      'serial=()',
      'bluetooth=()',
      'fullscreen=()',
      'autoplay=()'
    ].join(', ')
  });
};
