
import { logger } from '../logger';
import DOMPurify from 'isomorphic-dompurify';
import validator from 'validator';

// Security configuration
export interface SanitizationConfig {
  maxLength: number;
  allowedTags: string[];
  allowedAttributes: Record<string, string[]>;
  stripTags: boolean;
  escapeHtml: boolean;
  removeNullBytes: boolean;
  removeControlChars: boolean;
}

// Default sanitization configurations
export const DEFAULT_SANITIZATION_CONFIG: SanitizationConfig = {
  maxLength: 10000,
  allowedTags: [],
  allowedAttributes: {},
  stripTags: true,
  escapeHtml: true,
  removeNullBytes: true,
  removeControlChars: true
};

export const RICH_TEXT_CONFIG: SanitizationConfig = {
  maxLength: 50000,
  allowedTags: ['p', 'br', 'strong', 'em', 'u', 'ol', 'ul', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  allowedAttributes: {
    'a': ['href', 'title'],
    '*': ['class']
  },
  stripTags: false,
  escapeHtml: false,
  removeNullBytes: true,
  removeControlChars: true
};

export const STRICT_CONFIG: SanitizationConfig = {
  maxLength: 1000,
  allowedTags: [],
  allowedAttributes: {},
  stripTags: true,
  escapeHtml: true,
  removeNullBytes: true,
  removeControlChars: true
};

// Dangerous patterns to detect
const DANGEROUS_PATTERNS = {
  SQL_INJECTION: [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|EXEC|EXECUTE|SCRIPT)\b)/gi,
    /(\b(OR|AND)\s+.*(=|>|<|\bLIKE\b))/gi,
    /(;|\-\-|\/\*|\*\/|\bxp_cmdshell\b)/gi,
    /('.*'.*=.*'.*')/gi
  ],
  XSS: [
    /<script[^>]*>.*?<\/script>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<object[^>]*>.*?<\/object>/gi,
    /<embed[^>]*>/gi,
    /<link[^>]*stylesheet[^>]*>/gi
  ],
  PATH_TRAVERSAL: [
    /\.\.[\/\\]/g,
    /\.(\/|\\)/g,
    /~[\/\\]/g
  ],
  COMMAND_INJECTION: [
    /(\||&|;|\$\(|`)/g,
    /\b(rm|del|format|cat|type|copy|move|mkdir|rmdir|net|ping|wget|curl|nc|netcat)\b/gi
  ],
  LDAP_INJECTION: [
    /[\(\)\*\\\u0000]/g,
    /\b(objectClass|cn|uid|mail)\b/gi
  ]
};

export class InputSanitizer {
  private config: SanitizationConfig;

  constructor(config: Partial<SanitizationConfig> = {}) {
    this.config = { ...DEFAULT_SANITIZATION_CONFIG, ...config };
  }

  /**
   * Sanitize a string input based on configuration
   */
  public sanitizeString(input: string, customConfig?: Partial<SanitizationConfig>): string {
    if (typeof input !== 'string') {
      return '';
    }

    const config = { ...this.config, ...customConfig };
    let sanitized = input;

    // 1. Trim and normalize whitespace
    sanitized = sanitized.trim();

    // 2. Check length limits
    if (sanitized.length > config.maxLength) {
      sanitized = sanitized.substring(0, config.maxLength);
      logger.warn('Input truncated due to length limit', {
        originalLength: input.length,
        maxLength: config.maxLength
      });
    }

    // 3. Remove null bytes and control characters
    if (config.removeNullBytes) {
      sanitized = sanitized.replace(/\u0000/g, '');
    }

    if (config.removeControlChars) {
      sanitized = sanitized.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
    }

    // 4. Detect and log dangerous patterns
    this.detectDangerousPatterns(sanitized);

    // 5. HTML sanitization
    if (config.escapeHtml) {
      sanitized = validator.escape(sanitized);
    } else if (config.stripTags || config.allowedTags.length > 0) {
      sanitized = this.sanitizeHtml(sanitized, config);
    }

    return sanitized;
  }

  /**
   * Sanitize HTML content with DOMPurify
   */
  private sanitizeHtml(input: string, config: SanitizationConfig): string {
    const purifyConfig: any = {};

    if (config.allowedTags.length > 0) {
      purifyConfig.ALLOWED_TAGS = config.allowedTags;
    }

    if (Object.keys(config.allowedAttributes).length > 0) {
      purifyConfig.ALLOWED_ATTR = [];
      for (const [tag, attrs] of Object.entries(config.allowedAttributes)) {
        if (tag === '*') {
          purifyConfig.ALLOWED_ATTR.push(...attrs);
        } else {
          purifyConfig.ALLOWED_ATTR.push(...attrs.map(attr => `${tag}-${attr}`));
        }
      }
    }

    if (config.stripTags && config.allowedTags.length === 0) {
      purifyConfig.ALLOWED_TAGS = [];
      purifyConfig.KEEP_CONTENT = true;
    }

    return DOMPurify.sanitize(input, purifyConfig);
  }

  /**
   * Detect dangerous patterns in input
   */
  private detectDangerousPatterns(input: string): void {
    for (const [patternType, patterns] of Object.entries(DANGEROUS_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(input)) {
          logger.warn('Dangerous pattern detected in input', {
            patternType,
            pattern: pattern.toString(),
            inputLength: input.length,
            inputPreview: input.substring(0, 100)
          });
        }
      }
    }
  }

  /**
   * Sanitize an object recursively
   */
  public sanitizeObject(obj: any, customConfig?: Partial<SanitizationConfig>): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.sanitizeString(obj, customConfig);
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item, customConfig));
    }

    if (typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        const sanitizedKey = this.sanitizeString(key, { maxLength: 100, stripTags: true, escapeHtml: true });
        sanitized[sanitizedKey] = this.sanitizeObject(value, customConfig);
      }
      return sanitized;
    }

    return obj;
  }

  /**
   * Validate and sanitize email address
   */
  public sanitizeEmail(email: string): string | null {
    if (typeof email !== 'string') {
      return null;
    }

    const sanitized = this.sanitizeString(email, { maxLength: 254, stripTags: true, escapeHtml: true });
    
    if (validator.isEmail(sanitized)) {
      return sanitized.toLowerCase();
    }

    logger.warn('Invalid email format detected', { email: sanitized });
    return null;
  }

  /**
   * Sanitize URL
   */
  public sanitizeUrl(url: string): string | null {
    if (typeof url !== 'string') {
      return null;
    }

    const sanitized = this.sanitizeString(url, { maxLength: 2048, stripTags: true, escapeHtml: true });

    // Check for valid URL format
    try {
      const urlObj = new URL(sanitized);
      
      // Only allow HTTP(S) protocols
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        logger.warn('Invalid URL protocol detected', { url: sanitized, protocol: urlObj.protocol });
        return null;
      }

      return sanitized;
    } catch (error) {
      logger.warn('Invalid URL format detected', { url: sanitized });
      return null;
    }
  }

  /**
   * Sanitize phone number
   */
  public sanitizePhoneNumber(phone: string): string | null {
    if (typeof phone !== 'string') {
      return null;
    }

    // Remove all non-digit characters except + at the beginning
    let sanitized = phone.replace(/[^\d+]/g, '');
    
    // Ensure + is only at the beginning
    if (sanitized.includes('+')) {
      const parts = sanitized.split('+');
      sanitized = parts[0] === '' ? '+' + parts.slice(1).join('') : parts.join('');
    }

    if (validator.isMobilePhone(sanitized)) {
      return sanitized;
    }

    logger.warn('Invalid phone number format detected', { phone: sanitized });
    return null;
  }

  /**
   * Sanitize filename
   */
  public sanitizeFilename(filename: string): string | null {
    if (typeof filename !== 'string') {
      return null;
    }

    // Remove dangerous characters for filenames
    let sanitized = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '');
    
    // Remove leading/trailing dots and spaces
    sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');
    
    // Limit length
    if (sanitized.length > 255) {
      const extension = sanitized.substring(sanitized.lastIndexOf('.'));
      const name = sanitized.substring(0, 255 - extension.length);
      sanitized = name + extension;
    }

    // Check for reserved names on Windows
    const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
    const name = sanitized.split('.')[0].toUpperCase();
    
    if (reservedNames.includes(name)) {
      logger.warn('Reserved filename detected', { filename: sanitized });
      return `safe_${sanitized}`;
    }

    if (sanitized.length === 0) {
      return null;
    }

    return sanitized;
  }

  /**
   * Sanitize database query parameters
   */
  public sanitizeQueryParam(param: any): any {
    if (param === null || param === undefined) {
      return param;
    }

    if (typeof param === 'string') {
      // Detect SQL injection patterns more aggressively for query params
      for (const pattern of DANGEROUS_PATTERNS.SQL_INJECTION) {
        if (pattern.test(param)) {
          logger.warn('Potential SQL injection detected in query parameter', {
            param: param.substring(0, 100),
            pattern: pattern.toString()
          });
          throw new Error('Invalid query parameter detected');
        }
      }

      return this.sanitizeString(param, STRICT_CONFIG);
    }

    if (typeof param === 'number') {
      // Validate numeric ranges
      if (!Number.isFinite(param)) {
        throw new Error('Invalid numeric parameter');
      }
      return param;
    }

    if (typeof param === 'boolean') {
      return param;
    }

    if (Array.isArray(param)) {
      return param.map(item => this.sanitizeQueryParam(item));
    }

    if (typeof param === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(param)) {
        sanitized[this.sanitizeString(key, STRICT_CONFIG)] = this.sanitizeQueryParam(value);
      }
      return sanitized;
    }

    return param;
  }
}

// Global sanitizer instances
export const defaultSanitizer = new InputSanitizer();
export const richTextSanitizer = new InputSanitizer(RICH_TEXT_CONFIG);
export const strictSanitizer = new InputSanitizer(STRICT_CONFIG);

// Utility functions
export function sanitizeString(input: string, config?: Partial<SanitizationConfig>): string {
  return defaultSanitizer.sanitizeString(input, config);
}

export function sanitizeObject(obj: any, config?: Partial<SanitizationConfig>): any {
  return defaultSanitizer.sanitizeObject(obj, config);
}

export function sanitizeEmail(email: string): string | null {
  return defaultSanitizer.sanitizeEmail(email);
}

export function sanitizeUrl(url: string): string | null {
  return defaultSanitizer.sanitizeUrl(url);
}

export function sanitizeFilename(filename: string): string | null {
  return defaultSanitizer.sanitizeFilename(filename);
}

export function sanitizeQueryParam(param: any): any {
  return defaultSanitizer.sanitizeQueryParam(param);
}
