
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface CsrfConfig {
  secret: string;
  sessionKey: string;
  headerName: string;
  cookieName: string;
  ignoredMethods: string[];
  maxAge: number;
}

const defaultCsrfConfig: CsrfConfig = {
  secret: process.env.CSRF_SECRET || 'default-csrf-secret-change-in-production',
  sessionKey: 'csrfSecret',
  headerName: 'x-csrf-token',
  cookieName: 'csrf-token',
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
  maxAge: 3600000 // 1 hour
};

/**
 * Generate CSRF token
 */
export const generateCsrfToken = (secret: string): string => {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHmac('sha256', secret).update(token).digest('hex');
  return `${token}.${hash}`;
};

/**
 * Verify CSRF token
 */
export const verifyCsrfToken = (token: string, secret: string): boolean => {
  if (!token || !token.includes('.')) {
    return false;
  }
  
  const [tokenPart, hashPart] = token.split('.');
  const expectedHash = crypto.createHmac('sha256', secret).update(tokenPart).digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(hashPart, 'hex'),
    Buffer.from(expectedHash, 'hex')
  );
};

/**
 * CSRF protection middleware
 */
export const createCsrfProtection = (config: Partial<CsrfConfig> = {}) => {
  const finalConfig = { ...defaultCsrfConfig, ...config };
  
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip CSRF protection for ignored methods
    if (finalConfig.ignoredMethods.includes(req.method.toUpperCase())) {
      // Generate and provide token for GET requests
      if (req.method.toUpperCase() === 'GET') {
        const token = generateCsrfToken(finalConfig.secret);
        
        // Store in session if session exists
        if (req.session) {
          (req.session as any)[finalConfig.sessionKey] = token;
        }
        
        // Set as cookie
        res.cookie(finalConfig.cookieName, token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: finalConfig.maxAge
        });
        
        // Add to response locals for template access
        res.locals.csrfToken = token;
      }
      
      return next();
    }
    
    // Get token from header or body
    const token = req.headers[finalConfig.headerName] as string || 
                  req.body?._csrf || 
                  req.query?._csrf as string;
    
    if (!token) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'CSRF token missing',
        code: 'CSRF_TOKEN_MISSING'
      });
    }
    
    // Verify token
    if (!verifyCsrfToken(token, finalConfig.secret)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid CSRF token',
        code: 'INVALID_CSRF_TOKEN'
      });
    }
    
    // Token is valid, proceed
    next();
  };
};

/**
 * Double submit cookie CSRF protection
 */
export const createDoubleSubmitCsrfProtection = (config: Partial<CsrfConfig> = {}) => {
  const finalConfig = { ...defaultCsrfConfig, ...config };
  
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip for ignored methods
    if (finalConfig.ignoredMethods.includes(req.method.toUpperCase())) {
      // Generate token for GET requests
      if (req.method.toUpperCase() === 'GET') {
        const token = crypto.randomBytes(32).toString('hex');
        
        res.cookie(finalConfig.cookieName, token, {
          httpOnly: false, // Allow JavaScript access for double submit
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: finalConfig.maxAge
        });
        
        res.locals.csrfToken = token;
      }
      
      return next();
    }
    
    // Get token from header and cookie
    const headerToken = req.headers[finalConfig.headerName] as string;
    const cookieToken = req.cookies?.[finalConfig.cookieName];
    
    if (!headerToken || !cookieToken) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'CSRF token missing from header or cookie',
        code: 'CSRF_TOKEN_MISSING'
      });
    }
    
    // Verify tokens match
    if (!crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(cookieToken))) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'CSRF token mismatch',
        code: 'CSRF_TOKEN_MISMATCH'
      });
    }
    
    next();
  };
};

/**
 * Synchronizer token pattern CSRF protection
 */
export const createSynchronizerTokenCsrfProtection = (config: Partial<CsrfConfig> = {}) => {
  const finalConfig = { ...defaultCsrfConfig, ...config };
  
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip for ignored methods
    if (finalConfig.ignoredMethods.includes(req.method.toUpperCase())) {
      // Generate and store token in session
      if (req.method.toUpperCase() === 'GET' && req.session) {
        const token = crypto.randomBytes(32).toString('hex');
        (req.session as any)[finalConfig.sessionKey] = token;
        res.locals.csrfToken = token;
      }
      
      return next();
    }
    
    // Check if session exists
    if (!req.session) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Session required for CSRF protection',
        code: 'SESSION_REQUIRED'
      });
    }
    
    // Get tokens
    const sessionToken = (req.session as any)[finalConfig.sessionKey];
    const requestToken = req.headers[finalConfig.headerName] as string || req.body?._csrf;
    
    if (!sessionToken || !requestToken) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'CSRF token missing',
        code: 'CSRF_TOKEN_MISSING'
      });
    }
    
    // Verify tokens match
    if (!crypto.timingSafeEqual(Buffer.from(sessionToken), Buffer.from(requestToken))) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid CSRF token',
        code: 'INVALID_CSRF_TOKEN'
      });
    }
    
    next();
  };
};
