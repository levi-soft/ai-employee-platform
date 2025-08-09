
import { logger } from '../logger';
import validator from 'validator';

// SQL injection patterns with severity levels
const SQL_INJECTION_PATTERNS = {
  CRITICAL: [
    // Union-based injection
    /\b(UNION\s+(ALL\s+)?SELECT)\b/gi,
    // Stacked queries
    /;\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|EXECUTE)\b/gi,
    // Information schema access
    /\b(INFORMATION_SCHEMA|SYSOBJECTS|SYSCOLUMNS|MSysObjects)\b/gi,
    // Database functions
    /\b(LOAD_FILE|INTO\s+OUTFILE|INTO\s+DUMPFILE)\b/gi,
    // Command execution
    /\b(xp_cmdshell|sp_executesql|OPENROWSET|OPENDATASOURCE)\b/gi
  ],
  HIGH: [
    // Time-based blind injection
    /\b(WAITFOR\s+DELAY|BENCHMARK|SLEEP|GET_LOCK)\b/gi,
    // Boolean-based blind injection
    /\b(AND|OR)\s+\d+\s*=\s*\d+/gi,
    // Error-based injection
    /\b(EXTRACTVALUE|UPDATEXML|CONVERT|CAST)\s*\(/gi,
    // Database version detection
    /\b(@@VERSION|VERSION\(\)|SQLITE_VERSION)\b/gi,
    // User and privilege escalation
    /\b(CURRENT_USER|USER\(\)|SYSTEM_USER)\b/gi
  ],
  MEDIUM: [
    // Comment-based injection
    /(\/\*.*?\*\/|--.*?$|#.*?$)/gm,
    // String concatenation
    /\|\||\+\s*\'/g,
    // Hex encoding
    /0x[0-9A-Fa-f]+/g,
    // Subquery injection
    /\(\s*(SELECT|INSERT|UPDATE|DELETE)\b/gi
  ],
  LOW: [
    // Basic SQL keywords (could be legitimate)
    /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/gi,
    // Single quotes (could be legitimate in text)
    /\'.*\'/g,
    // Double dashes
    /--/g
  ]
};

// Database-specific injection patterns
const DB_SPECIFIC_PATTERNS = {
  MYSQL: [
    /\b(LOAD_FILE|INTO\s+OUTFILE|SUBSTRING|MID|LEFT|RIGHT)\b/gi,
    /\b(CONCAT|CHAR|ASCII|ORD|HEX|UNHEX)\b/gi,
    /@@[A-Za-z_]+/g
  ],
  POSTGRESQL: [
    /\b(COPY|pg_read_file|pg_ls_dir|pg_stat_file)\b/gi,
    /\b(CHR|ASCII|SUBSTR|POSITION|OVERLAY)\b/gi,
    /\$\$.*\$\$/gs
  ],
  MSSQL: [
    /\b(xp_|sp_|fn_|OPENROWSET|OPENQUERY|OPENDATASOURCE)\b/gi,
    /\b(SERVERNAME|SERVERPROPERTY|DB_NAME|USER_NAME)\b/gi,
    /\[.*\]/g
  ],
  ORACLE: [
    /\b(UTL_FILE|DBMS_|SYS\.)\b/gi,
    /\b(DUAL|ROWNUM|SYSDATE|USER|ALL_TABLES)\b/gi,
    /\|\||NVL|DECODE/gi
  ],
  SQLITE: [
    /\b(ATTACH|DETACH|sqlite_master|pragma)\b/gi,
    /\b(load_extension|sqlite_version)\b/gi
  ]
};

export interface SQLInjectionCheck {
  isClean: boolean;
  threats: Array<{
    pattern: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    description: string;
    position?: number;
  }>;
  sanitizedInput?: string;
  riskScore: number; // 0-100
}

export class SQLInjectionPrevention {
  private dbType: string;
  private strictMode: boolean;

  constructor(dbType: string = 'GENERIC', strictMode: boolean = true) {
    this.dbType = dbType.toUpperCase();
    this.strictMode = strictMode;
  }

  /**
   * Check input for SQL injection patterns
   */
  public checkForSQLInjection(input: string): SQLInjectionCheck {
    if (typeof input !== 'string' || input.length === 0) {
      return {
        isClean: true,
        threats: [],
        riskScore: 0
      };
    }

    const threats: SQLInjectionCheck['threats'] = [];
    let riskScore = 0;

    // Check general SQL injection patterns
    for (const [severity, patterns] of Object.entries(SQL_INJECTION_PATTERNS)) {
      for (const pattern of patterns) {
        const matches = input.match(pattern);
        if (matches) {
          for (const match of matches) {
            const position = input.indexOf(match);
            threats.push({
              pattern: pattern.toString(),
              severity: severity as any,
              description: this.getPatternDescription(pattern, severity as any),
              position
            });

            // Add to risk score based on severity
            switch (severity) {
              case 'CRITICAL':
                riskScore += 40;
                break;
              case 'HIGH':
                riskScore += 25;
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
    }

    // Check database-specific patterns
    if (DB_SPECIFIC_PATTERNS[this.dbType as keyof typeof DB_SPECIFIC_PATTERNS]) {
      const dbPatterns = DB_SPECIFIC_PATTERNS[this.dbType as keyof typeof DB_SPECIFIC_PATTERNS];
      for (const pattern of dbPatterns) {
        const matches = input.match(pattern);
        if (matches) {
          for (const match of matches) {
            const position = input.indexOf(match);
            threats.push({
              pattern: pattern.toString(),
              severity: 'HIGH',
              description: `Database-specific injection pattern for ${this.dbType}`,
              position
            });
            riskScore += 20;
          }
        }
      }
    }

    // Cap risk score at 100
    riskScore = Math.min(riskScore, 100);

    // Determine if input is clean based on strict mode and threats
    const isClean = this.strictMode 
      ? threats.length === 0 
      : threats.filter(t => ['CRITICAL', 'HIGH'].includes(t.severity)).length === 0;

    // Log threats if found
    if (threats.length > 0) {
      logger.warn('SQL injection patterns detected', {
        inputLength: input.length,
        threatCount: threats.length,
        riskScore,
        severities: threats.map(t => t.severity),
        dbType: this.dbType,
        strictMode: this.strictMode
      });
    }

    return {
      isClean,
      threats,
      riskScore,
      sanitizedInput: isClean ? input : this.sanitizeInput(input)
    };
  }

  /**
   * Sanitize input by removing/escaping dangerous patterns
   */
  private sanitizeInput(input: string): string {
    let sanitized = input;

    // Remove critical patterns completely
    for (const pattern of SQL_INJECTION_PATTERNS.CRITICAL) {
      sanitized = sanitized.replace(pattern, '');
    }

    // Remove high-risk patterns
    for (const pattern of SQL_INJECTION_PATTERNS.HIGH) {
      sanitized = sanitized.replace(pattern, '');
    }

    // Escape single quotes
    sanitized = sanitized.replace(/'/g, "''");

    // Remove SQL comments
    sanitized = sanitized.replace(/(\/\*.*?\*\/|--.*?$|#.*?$)/gm, '');

    // Normalize whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();

    return sanitized;
  }

  /**
   * Get description for a pattern
   */
  private getPatternDescription(pattern: RegExp, severity: string): string {
    const patternStr = pattern.toString().toLowerCase();

    if (patternStr.includes('union')) return 'Union-based SQL injection attempt';
    if (patternStr.includes('information_schema')) return 'Information schema access attempt';
    if (patternStr.includes('xp_cmdshell')) return 'Command execution attempt';
    if (patternStr.includes('waitfor|sleep')) return 'Time-based blind injection attempt';
    if (patternStr.includes('and|or')) return 'Boolean-based injection attempt';
    if (patternStr.includes('--|\\/\\*')) return 'Comment-based injection attempt';
    if (patternStr.includes('concat|char')) return 'String manipulation attempt';
    if (patternStr.includes('version|user')) return 'Information gathering attempt';
    
    return `${severity.toLowerCase()} severity SQL injection pattern`;
  }

  /**
   * Validate and sanitize a SQL parameter
   */
  public sanitizeParameter(param: any, paramType: 'string' | 'number' | 'boolean' | 'array' = 'string'): any {
    if (param === null || param === undefined) {
      return param;
    }

    switch (paramType) {
      case 'string':
        if (typeof param !== 'string') {
          param = String(param);
        }
        
        const check = this.checkForSQLInjection(param);
        if (!check.isClean) {
          if (check.threats.some(t => ['CRITICAL', 'HIGH'].includes(t.severity))) {
            throw new Error('SQL injection attempt detected and blocked');
          }
          return check.sanitizedInput;
        }
        return param;

      case 'number':
        const num = Number(param);
        if (!Number.isFinite(num)) {
          throw new Error('Invalid numeric parameter');
        }
        return num;

      case 'boolean':
        return Boolean(param);

      case 'array':
        if (!Array.isArray(param)) {
          throw new Error('Expected array parameter');
        }
        return param.map(item => this.sanitizeParameter(item, 'string'));

      default:
        return param;
    }
  }

  /**
   * Validate a WHERE clause
   */
  public validateWhereClause(whereClause: string): SQLInjectionCheck {
    // Additional validation for WHERE clauses
    const check = this.checkForSQLInjection(whereClause);
    
    // Check for tautologies (always true conditions)
    const tautologyPatterns = [
      /\b1\s*=\s*1\b/gi,
      /\b''\s*=\s*''\b/gi,
      /\b1\s*OR\s*1\b/gi,
      /\b'[^']*'\s*=\s*'[^']*'\s*OR\s*'[^']*'\s*=\s*'[^']*'\b/gi
    ];

    for (const pattern of tautologyPatterns) {
      if (pattern.test(whereClause)) {
        check.threats.push({
          pattern: pattern.toString(),
          severity: 'CRITICAL',
          description: 'Tautology-based injection (always true condition)'
        });
        check.isClean = false;
        check.riskScore = Math.min(check.riskScore + 50, 100);
      }
    }

    return check;
  }

  /**
   * Create a parameterized query helper
   */
  public createParameterizedQuery(query: string, params: Record<string, any>): {
    query: string;
    params: Record<string, any>;
    isSecure: boolean;
    warnings: string[];
  } {
    const warnings: string[] = [];
    const sanitizedParams: Record<string, any> = {};
    let isSecure = true;

    // Check the base query for injection patterns
    const queryCheck = this.checkForSQLInjection(query);
    if (!queryCheck.isClean) {
      isSecure = false;
      warnings.push('Base query contains potentially dangerous patterns');
    }

    // Sanitize all parameters
    for (const [key, value] of Object.entries(params)) {
      try {
        // Detect parameter type
        let paramType: 'string' | 'number' | 'boolean' | 'array' = 'string';
        if (typeof value === 'number') paramType = 'number';
        else if (typeof value === 'boolean') paramType = 'boolean';
        else if (Array.isArray(value)) paramType = 'array';

        sanitizedParams[key] = this.sanitizeParameter(value, paramType);
      } catch (error) {
        isSecure = false;
        warnings.push(`Parameter '${key}' failed security validation: ${(error as Error).message}`);
        sanitizedParams[key] = null; // Safe default
      }
    }

    return {
      query,
      params: sanitizedParams,
      isSecure,
      warnings
    };
  }

  /**
   * Middleware for Express to check request parameters
   */
  public createMiddleware() {
    return (req: any, res: any, next: any) => {
      const checkObject = (obj: any, objName: string) => {
        for (const [key, value] of Object.entries(obj || {})) {
          if (typeof value === 'string') {
            const check = this.checkForSQLInjection(value);
            if (!check.isClean && check.threats.some(t => ['CRITICAL', 'HIGH'].includes(t.severity))) {
              logger.warn(`SQL injection attempt blocked in ${objName}`, {
                key,
                threats: check.threats,
                riskScore: check.riskScore,
                ip: req.ip,
                userAgent: req.headers['user-agent']
              });
              
              return res.status(400).json({
                error: 'Invalid request parameters detected',
                code: 'SECURITY_VIOLATION'
              });
            }
          }
        }
      };

      // Check query parameters
      checkObject(req.query, 'query');
      
      // Check body parameters
      checkObject(req.body, 'body');
      
      // Check URL parameters
      checkObject(req.params, 'params');

      next();
    };
  }
}

// Global prevention instances
export const defaultSQLPrevention = new SQLInjectionPrevention();
export const strictSQLPrevention = new SQLInjectionPrevention('GENERIC', true);
export const mysqlPrevention = new SQLInjectionPrevention('MYSQL');
export const postgresqlPrevention = new SQLInjectionPrevention('POSTGRESQL');

// Utility functions
export function checkForSQLInjection(input: string, dbType?: string): SQLInjectionCheck {
  const prevention = dbType ? new SQLInjectionPrevention(dbType) : defaultSQLPrevention;
  return prevention.checkForSQLInjection(input);
}

export function sanitizeSQLParameter(param: any, paramType?: 'string' | 'number' | 'boolean' | 'array'): any {
  return defaultSQLPrevention.sanitizeParameter(param, paramType);
}

export function validateWhereClause(whereClause: string): SQLInjectionCheck {
  return defaultSQLPrevention.validateWhereClause(whereClause);
}

export function createSQLMiddleware(dbType?: string, strictMode?: boolean) {
  const prevention = new SQLInjectionPrevention(dbType, strictMode);
  return prevention.createMiddleware();
}
