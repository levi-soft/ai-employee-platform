
import { logger } from '../logger';
import DOMPurify from 'isomorphic-dompurify';
import validator from 'validator';

// XSS attack patterns with severity levels
const XSS_PATTERNS = {
  CRITICAL: [
    // Script tags with various encodings
    /<script[^>]*>.*?<\/script>/gis,
    /<script[^>]*\/>/gi,
    // Event handlers
    /\bon\w+\s*=\s*["'][^"']*["']/gi,
    // JavaScript protocol
    /javascript\s*:/gi,
    // Data URLs with JavaScript
    /data\s*:\s*[^,]*script/gi,
    // iframe injections
    /<iframe[^>]*>.*?<\/iframe>/gis,
    // Object and embed tags
    /<(object|embed|applet)[^>]*>.*?<\/\1>/gis
  ],
  HIGH: [
    // Style tag with expression()
    /<style[^>]*>.*?expression\s*\(.*?\).*?<\/style>/gis,
    // Link tag with javascript
    /<link[^>]*href\s*=\s*["']javascript[^"']*["'][^>]*>/gi,
    // Meta refresh with javascript
    /<meta[^>]*http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["'][^"']*javascript[^"']*["'][^>]*>/gi,
    // Form with javascript action
    /<form[^>]*action\s*=\s*["']javascript[^"']*["'][^>]*>/gi,
    // Base tag manipulation
    /<base[^>]*href\s*=\s*["'][^"']*["'][^>]*>/gi
  ],
  MEDIUM: [
    // HTML tags that could be dangerous
    /<(svg|math|xml|xsl)[^>]*>.*?<\/\1>/gis,
    // Attribute injection
    /[\w-]+\s*=\s*["'][^"']*javascript[^"']*["']/gi,
    // Data attributes with scripts
    /data-[^=]*=\s*["'][^"']*<script[^"']*["']/gi,
    // CSS injection
    /style\s*=\s*["'][^"']*expression[^"']*["']/gi
  ],
  LOW: [
    // HTML entities that could be used for obfuscation
    /&#x?[0-9a-fA-F]+;/g,
    // Potential HTML tags
    /<\/?[a-zA-Z][^>]*>/g,
    // Suspicious characters in attributes
    /[<>'"&]/g
  ]
};

// Content Security Policy directives
export interface CSPConfig {
  'default-src': string[];
  'script-src': string[];
  'style-src': string[];
  'img-src': string[];
  'font-src': string[];
  'connect-src': string[];
  'media-src': string[];
  'object-src': string[];
  'child-src': string[];
  'frame-ancestors': string[];
  'base-uri': string[];
  'form-action': string[];
  'upgrade-insecure-requests': boolean;
  'block-all-mixed-content': boolean;
}

export const DEFAULT_CSP: CSPConfig = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https:'],
  'font-src': ["'self'", 'https:', 'data:'],
  'connect-src': ["'self'"],
  'media-src': ["'self'"],
  'object-src': ["'none'"],
  'child-src': ["'self'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'upgrade-insecure-requests': true,
  'block-all-mixed-content': true
};

export const STRICT_CSP: CSPConfig = {
  'default-src': ["'none'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'media-src': ["'none'"],
  'object-src': ["'none'"],
  'child-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'self'"],
  'upgrade-insecure-requests': true,
  'block-all-mixed-content': true
};

export interface XSSCheck {
  isClean: boolean;
  threats: Array<{
    pattern: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    description: string;
    position?: number;
    match?: string;
  }>;
  sanitizedContent?: string;
  riskScore: number; // 0-100
}

export class XSSProtection {
  private strictMode: boolean;
  private allowedTags: string[];
  private allowedAttributes: Record<string, string[]>;

  constructor(
    strictMode: boolean = true,
    allowedTags: string[] = [],
    allowedAttributes: Record<string, string[]> = {}
  ) {
    this.strictMode = strictMode;
    this.allowedTags = allowedTags;
    this.allowedAttributes = allowedAttributes;
  }

  /**
   * Check content for XSS patterns
   */
  public checkForXSS(content: string): XSSCheck {
    if (typeof content !== 'string' || content.length === 0) {
      return {
        isClean: true,
        threats: [],
        riskScore: 0
      };
    }

    const threats: XSSCheck['threats'] = [];
    let riskScore = 0;

    // Check XSS patterns by severity
    for (const [severity, patterns] of Object.entries(XSS_PATTERNS)) {
      for (const pattern of patterns) {
        const matches = [...content.matchAll(new RegExp(pattern.source, pattern.flags))];
        
        for (const match of matches) {
          const position = match.index;
          threats.push({
            pattern: pattern.toString(),
            severity: severity as any,
            description: this.getPatternDescription(pattern, severity as any),
            position,
            match: match[0]
          });

          // Add to risk score based on severity
          switch (severity) {
            case 'CRITICAL':
              riskScore += 50;
              break;
            case 'HIGH':
              riskScore += 30;
              break;
            case 'MEDIUM':
              riskScore += 15;
              break;
            case 'LOW':
              riskScore += 5;
              break;
          }
        }
      }
    }

    // Additional checks for encoded attacks
    riskScore += this.checkEncodedAttacks(content, threats);

    // Cap risk score at 100
    riskScore = Math.min(riskScore, 100);

    // Determine if content is clean
    const criticalThreats = threats.filter(t => ['CRITICAL', 'HIGH'].includes(t.severity));
    const isClean = this.strictMode 
      ? threats.length === 0 
      : criticalThreats.length === 0;

    // Log threats if found
    if (threats.length > 0) {
      logger.warn('XSS patterns detected', {
        contentLength: content.length,
        threatCount: threats.length,
        criticalThreats: criticalThreats.length,
        riskScore,
        strictMode: this.strictMode
      });
    }

    return {
      isClean,
      threats,
      riskScore,
      sanitizedContent: this.sanitizeContent(content)
    };
  }

  /**
   * Check for encoded XSS attacks
   */
  private checkEncodedAttacks(content: string, threats: XSSCheck['threats']): number {
    let additionalRisk = 0;

    // Check for HTML entity encoding
    const htmlEntityPattern = /&#x?[0-9a-fA-F]+;/g;
    const entityMatches = content.match(htmlEntityPattern);
    if (entityMatches && entityMatches.length > 5) {
      threats.push({
        pattern: htmlEntityPattern.toString(),
        severity: 'MEDIUM',
        description: 'Potentially obfuscated content using HTML entities',
        match: entityMatches.join(', ')
      });
      additionalRisk += 10;
    }

    // Check for URL encoding
    const urlEncodedPattern = /%[0-9a-fA-F]{2}/g;
    const urlMatches = content.match(urlEncodedPattern);
    if (urlMatches && urlMatches.length > 5) {
      threats.push({
        pattern: urlEncodedPattern.toString(),
        severity: 'MEDIUM',
        description: 'Potentially obfuscated content using URL encoding',
        match: urlMatches.slice(0, 5).join(', ') + (urlMatches.length > 5 ? '...' : '')
      });
      additionalRisk += 10;
    }

    // Check for Unicode escapes
    const unicodePattern = /\\u[0-9a-fA-F]{4}/g;
    const unicodeMatches = content.match(unicodePattern);
    if (unicodeMatches && unicodeMatches.length > 3) {
      threats.push({
        pattern: unicodePattern.toString(),
        severity: 'MEDIUM',
        description: 'Potentially obfuscated content using Unicode escapes',
        match: unicodeMatches.slice(0, 3).join(', ') + (unicodeMatches.length > 3 ? '...' : '')
      });
      additionalRisk += 10;
    }

    return additionalRisk;
  }

  /**
   * Get description for XSS pattern
   */
  private getPatternDescription(pattern: RegExp, severity: string): string {
    const patternStr = pattern.toString().toLowerCase();

    if (patternStr.includes('script')) return 'Script tag injection attempt';
    if (patternStr.includes('on\\w+')) return 'Event handler injection attempt';
    if (patternStr.includes('javascript')) return 'JavaScript protocol injection';
    if (patternStr.includes('iframe')) return 'iframe injection attempt';
    if (patternStr.includes('object|embed')) return 'Object/Embed tag injection';
    if (patternStr.includes('expression')) return 'CSS expression injection';
    if (patternStr.includes('data:')) return 'Data URL injection attempt';
    if (patternStr.includes('meta.*refresh')) return 'Meta refresh injection';
    if (patternStr.includes('form.*action')) return 'Form action injection';

    return `${severity.toLowerCase()} severity XSS pattern`;
  }

  /**
   * Sanitize content using DOMPurify
   */
  public sanitizeContent(content: string): string {
    if (typeof content !== 'string') {
      return '';
    }

    // DOMPurify configuration
    const config: any = {
      ALLOWED_TAGS: this.allowedTags,
      ALLOWED_ATTR: [],
      KEEP_CONTENT: true,
      RETURN_DOM: false,
      RETURN_DOM_FRAGMENT: false,
      RETURN_DOM_IMPORT: false,
      SANITIZE_DOM: true,
      WHOLE_DOCUMENT: false,
      IN_PLACE: false
    };

    // Build allowed attributes list
    for (const [tag, attrs] of Object.entries(this.allowedAttributes)) {
      if (tag === '*') {
        config.ALLOWED_ATTR.push(...attrs);
      } else {
        config.ALLOWED_ATTR.push(...attrs.map(attr => `${tag.toLowerCase()}-${attr.toLowerCase()}`));
      }
    }

    // Strict mode: remove all HTML
    if (this.strictMode && this.allowedTags.length === 0) {
      config.ALLOWED_TAGS = [];
      config.ALLOWED_ATTR = [];
    }

    try {
      return DOMPurify.sanitize(content, config);
    } catch (error) {
      logger.error('DOMPurify sanitization failed', {
        error: (error as Error).message,
        contentLength: content.length
      });
      // Fallback: escape all HTML
      return validator.escape(content);
    }
  }

  /**
   * Sanitize HTML attributes
   */
  public sanitizeAttributes(attributes: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(attributes)) {
      // Skip dangerous attribute names
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith('on') || 
          ['src', 'href', 'action', 'formaction', 'background', 'cite', 'codebase', 'data', 'icon', 'manifest', 'poster'].includes(lowerKey)) {
        
        if (this.isAllowedAttribute(key, value)) {
          sanitized[key] = this.sanitizeAttributeValue(value);
        }
        continue;
      }

      sanitized[key] = this.sanitizeAttributeValue(value);
    }

    return sanitized;
  }

  /**
   * Check if attribute is allowed
   */
  private isAllowedAttribute(name: string, value: string): boolean {
    const lowerName = name.toLowerCase();
    const lowerValue = value.toLowerCase();

    // Block javascript: protocol
    if (lowerValue.includes('javascript:')) return false;

    // Block data: URLs with script
    if (lowerValue.startsWith('data:') && lowerValue.includes('script')) return false;

    // Block vbscript: protocol
    if (lowerValue.includes('vbscript:')) return false;

    // Block event handlers
    if (lowerName.startsWith('on')) return false;

    // Allow only HTTP(S) URLs for href and src
    if (['src', 'href', 'action', 'formaction'].includes(lowerName)) {
      if (lowerValue.startsWith('http://') || lowerValue.startsWith('https://') || lowerValue.startsWith('/')) {
        return true;
      }
      return false;
    }

    return true;
  }

  /**
   * Sanitize attribute value
   */
  private sanitizeAttributeValue(value: string): string {
    // Remove null bytes and control characters
    let sanitized = value.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
    
    // Escape quotes
    sanitized = sanitized.replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
    
    return sanitized;
  }

  /**
   * Generate Content Security Policy header
   */
  public generateCSPHeader(config: Partial<CSPConfig> = {}): string {
    const csp = { ...DEFAULT_CSP, ...config };
    const directives: string[] = [];

    for (const [directive, values] of Object.entries(csp)) {
      if (typeof values === 'boolean') {
        if (values) {
          directives.push(directive.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`));
        }
      } else if (Array.isArray(values) && values.length > 0) {
        const directiveName = directive.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
        directives.push(`${directiveName} ${values.join(' ')}`);
      }
    }

    return directives.join('; ');
  }

  /**
   * Create Express middleware for XSS protection
   */
  public createMiddleware() {
    return (req: any, res: any, next: any) => {
      // Set security headers
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', this.generateCSPHeader());

      // Check request body for XSS
      const checkObject = (obj: any, objName: string) => {
        for (const [key, value] of Object.entries(obj || {})) {
          if (typeof value === 'string') {
            const check = this.checkForXSS(value);
            if (!check.isClean && check.threats.some(t => ['CRITICAL', 'HIGH'].includes(t.severity))) {
              logger.warn(`XSS attempt blocked in ${objName}`, {
                key,
                threats: check.threats.slice(0, 5), // Limit logged threats
                riskScore: check.riskScore,
                ip: req.ip,
                userAgent: req.headers['user-agent']
              });
              
              return res.status(400).json({
                error: 'Malicious content detected',
                code: 'XSS_ATTEMPT_BLOCKED'
              });
            }
            
            // Auto-sanitize if configured
            if (!check.isClean && check.sanitizedContent) {
              obj[key] = check.sanitizedContent;
            }
          }
        }
      };

      // Check query parameters
      checkObject(req.query, 'query');
      
      // Check body parameters
      checkObject(req.body, 'body');

      next();
    };
  }
}

// Global protection instances
export const defaultXSSProtection = new XSSProtection();
export const strictXSSProtection = new XSSProtection(true);
export const richTextXSSProtection = new XSSProtection(false, ['p', 'br', 'strong', 'em', 'u', 'a'], { 'a': ['href'], '*': ['class'] });

// Utility functions
export function checkForXSS(content: string): XSSCheck {
  return defaultXSSProtection.checkForXSS(content);
}

export function sanitizeContent(content: string, allowedTags?: string[], allowedAttributes?: Record<string, string[]>): string {
  if (allowedTags || allowedAttributes) {
    const customProtection = new XSSProtection(false, allowedTags || [], allowedAttributes || {});
    return customProtection.sanitizeContent(content);
  }
  return defaultXSSProtection.sanitizeContent(content);
}

export function generateCSP(config?: Partial<CSPConfig>): string {
  return defaultXSSProtection.generateCSPHeader(config);
}

export function createXSSMiddleware(strictMode?: boolean, allowedTags?: string[], allowedAttributes?: Record<string, string[]>) {
  const protection = new XSSProtection(strictMode, allowedTags, allowedAttributes);
  return protection.createMiddleware();
}
