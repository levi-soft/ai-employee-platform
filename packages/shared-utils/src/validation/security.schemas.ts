
import { z } from 'zod';

/**
 * Security validation schemas for input sanitization and validation
 */

// Common security patterns
const noSqlInjectionPattern = /^[a-zA-Z0-9\s\-_@.!?]*$/;
const noXssPattern = /^[^<>'"&]*$/;
const urlPattern = /^https?:\/\/.+/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Base security schema for all inputs
export const sanitizedStringSchema = z
  .string()
  .trim()
  .refine((val) => !val.includes('<script'), { message: 'Potential XSS detected' })
  .refine((val) => !val.includes('javascript:'), { message: 'Potential XSS detected' })
  .refine((val) => !val.includes('eval('), { message: 'Code injection detected' })
  .refine((val) => !val.includes('SELECT'), { message: 'SQL injection detected' })
  .refine((val) => !val.includes('INSERT'), { message: 'SQL injection detected' })
  .refine((val) => !val.includes('UPDATE'), { message: 'SQL injection detected' })
  .refine((val) => !val.includes('DELETE'), { message: 'SQL injection detected' })
  .refine((val) => !val.includes('DROP'), { message: 'SQL injection detected' });

// User input schemas
export const secureUserInputSchema = z.object({
  name: sanitizedStringSchema
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name must be less than 50 characters'),
  
  email: z
    .string()
    .email('Invalid email format')
    .min(5, 'Email too short')
    .max(255, 'Email too long')
    .refine((val) => emailPattern.test(val), { message: 'Invalid email format' }),
  
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password too long')
    .refine((val) => /[A-Z]/.test(val), { message: 'Password must contain uppercase letter' })
    .refine((val) => /[a-z]/.test(val), { message: 'Password must contain lowercase letter' })
    .refine((val) => /[0-9]/.test(val), { message: 'Password must contain number' })
    .refine((val) => /[^A-Za-z0-9]/.test(val), { message: 'Password must contain special character' }),
  
  role: z.enum(['ADMIN', 'EMPLOYEE'], { message: 'Invalid role specified' })
});

// API request schemas
export const secureApiRequestSchema = z.object({
  page: z.number().int().min(1).max(1000).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  search: sanitizedStringSchema.max(200).optional(),
  sortBy: z.enum(['name', 'email', 'createdAt', 'updatedAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional()
});

// File upload schemas
export const secureFileUploadSchema = z.object({
  filename: z
    .string()
    .min(1, 'Filename required')
    .max(255, 'Filename too long')
    .refine((val) => !val.includes('..'), { message: 'Path traversal detected' })
    .refine((val) => !val.includes('<'), { message: 'Invalid filename' })
    .refine((val) => !/[<>:"|?*]/.test(val), { message: 'Invalid filename characters' }),
  
  mimetype: z.enum([
    'image/jpeg',
    'image/png', 
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/json'
  ], { message: 'Unsupported file type' }),
  
  size: z
    .number()
    .int()
    .min(1, 'File cannot be empty')
    .max(50 * 1024 * 1024, 'File size must be less than 50MB')
});

// Database query schemas
export const secureDatabaseQuerySchema = z.object({
  id: z
    .string()
    .uuid('Invalid ID format')
    .or(z.number().int().positive('Invalid ID')),
    
  ids: z
    .array(z.string().uuid('Invalid ID format'))
    .max(100, 'Too many IDs')
    .optional(),
  
  filters: z
    .record(z.string(), sanitizedStringSchema)
    .optional(),
    
  relations: z
    .array(z.string().max(50))
    .max(10, 'Too many relations')
    .optional()
});

// URL validation
export const secureUrlSchema = z
  .string()
  .url('Invalid URL format')
  .refine((val) => urlPattern.test(val), { message: 'URL must use HTTP/HTTPS' })
  .refine((val) => !val.includes('localhost') || process.env.NODE_ENV === 'development', {
    message: 'Localhost URLs not allowed in production'
  });

// JWT token validation
export const secureTokenSchema = z
  .string()
  .min(10, 'Token too short')
  .max(2000, 'Token too long')
  .refine((val) => /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(val), {
    message: 'Invalid JWT format'
  });

// Plugin related schemas
export const securePluginSchema = z.object({
  name: sanitizedStringSchema
    .min(3, 'Plugin name too short')
    .max(50, 'Plugin name too long')
    .refine((val) => /^[a-zA-Z0-9\-_]+$/.test(val), { message: 'Invalid plugin name format' }),
  
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, 'Invalid version format (use semantic versioning)'),
  
  description: sanitizedStringSchema
    .min(10, 'Description too short')
    .max(500, 'Description too long'),
  
  permissions: z
    .array(z.enum(['READ', 'WRITE', 'EXECUTE', 'ADMIN']))
    .max(10, 'Too many permissions')
});

// AI request validation
export const secureAiRequestSchema = z.object({
  prompt: sanitizedStringSchema
    .min(1, 'Prompt cannot be empty')
    .max(10000, 'Prompt too long')
    .refine((val) => !val.includes('\\x'), { message: 'Hex encoding not allowed' })
    .refine((val) => !val.includes('%'), { message: 'URL encoding not allowed in prompts' }),
  
  model: z.enum(['gpt-4', 'gpt-3.5-turbo', 'claude-3', 'gemini-pro'], {
    message: 'Unsupported AI model'
  }),
  
  maxTokens: z
    .number()
    .int()
    .min(1, 'Max tokens must be positive')
    .max(8192, 'Max tokens too high'),
  
  temperature: z
    .number()
    .min(0, 'Temperature must be between 0 and 2')
    .max(2, 'Temperature must be between 0 and 2')
    .optional()
});

// Billing and transaction schemas
export const secureBillingSchema = z.object({
  amount: z
    .number()
    .positive('Amount must be positive')
    .max(10000, 'Amount too large')
    .refine((val) => Number.isFinite(val), { message: 'Invalid amount' }),
  
  currency: z.enum(['USD', 'EUR', 'GBP'], { message: 'Unsupported currency' }),
  
  description: sanitizedStringSchema
    .min(5, 'Description too short')
    .max(200, 'Description too long')
});

// Export commonly used validation functions
export const validateInput = <T>(schema: z.ZodSchema<T>, data: unknown): T => {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
      throw new Error(`Validation failed: ${issues.join(', ')}`);
    }
    throw error;
  }
};

export const validateInputAsync = async <T>(schema: z.ZodSchema<T>, data: unknown): Promise<T> => {
  try {
    return await schema.parseAsync(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
      throw new Error(`Validation failed: ${issues.join(', ')}`);
    }
    throw error;
  }
};

// Security utility functions
export const sanitizeHtml = (input: string): string => {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/&/g, '&amp;');
};

export const escapeForSql = (input: string): string => {
  return input
    .replace(/'/g, "''")
    .replace(/;/g, '\\;')
    .replace(/--/g, '\\--')
    .replace(/\/\*/g, '\\/*')
    .replace(/\*\//g, '\\*/');
};

export const validateOrigin = (origin: string, allowedOrigins: string[]): boolean => {
  if (!origin) return false;
  return allowedOrigins.includes(origin) || 
         (process.env.NODE_ENV === 'development' && origin.includes('localhost'));
};
