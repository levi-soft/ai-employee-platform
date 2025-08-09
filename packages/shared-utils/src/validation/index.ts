
// Validation utilities using Zod
import { z } from 'zod';
import { VALIDATION_RULES } from '../constants';

// Common validation schemas
export const emailSchema = z
  .string()
  .email('Invalid email format')
  .max(VALIDATION_RULES.EMAIL.MAX_LENGTH, `Email must be less than ${VALIDATION_RULES.EMAIL.MAX_LENGTH} characters`);

export const passwordSchema = z
  .string()
  .min(VALIDATION_RULES.PASSWORD.MIN_LENGTH, `Password must be at least ${VALIDATION_RULES.PASSWORD.MIN_LENGTH} characters`)
  .max(VALIDATION_RULES.PASSWORD.MAX_LENGTH, `Password must be less than ${VALIDATION_RULES.PASSWORD.MAX_LENGTH} characters`)
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/\d/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

export const nameSchema = z
  .string()
  .min(VALIDATION_RULES.NAME.MIN_LENGTH, `Name must be at least ${VALIDATION_RULES.NAME.MIN_LENGTH} characters`)
  .max(VALIDATION_RULES.NAME.MAX_LENGTH, `Name must be less than ${VALIDATION_RULES.NAME.MAX_LENGTH} characters`)
  .regex(/^[a-zA-Z\s'-]+$/, 'Name can only contain letters, spaces, hyphens and apostrophes');

export const uuidSchema = z.string().uuid('Invalid UUID format');

export const positiveNumberSchema = z.number().positive('Must be a positive number');

export const urlSchema = z.string().url('Invalid URL format');

// Auth validation schemas
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional(),
});

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  role: z.enum(['super_admin', 'admin', 'employee', 'viewer']).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
});

export const resetPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordConfirmSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  newPassword: passwordSchema,
});

// User validation schemas
export const userProfileSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  avatar: urlSchema.optional(),
  timezone: z.string().optional(),
  language: z.string().min(2).max(5).optional(),
});

export const userCreateSchema = z.object({
  email: emailSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  role: z.enum(['super_admin', 'admin', 'employee', 'viewer']),
  status: z.enum(['active', 'inactive', 'pending', 'suspended']).optional(),
});

export const userUpdateSchema = userCreateSchema.partial().omit({ email: true });

// AI Request validation schemas
export const aiRequestSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required').max(4000, 'Prompt must be less than 4000 characters'),
  agentId: uuidSchema.optional(),
  maxTokens: z.number().int().min(1).max(4000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  capabilities: z.array(z.enum(['text-generation', 'code-generation', 'data-analysis', 'image-generation', 'translation', 'summarization', 'conversation', 'document-analysis'])).optional(),
  metadata: z.record(z.any()).optional(),
});

// AI Agent validation schemas
export const aiAgentSchema = z.object({
  name: z.string().min(1, 'Agent name is required').max(100),
  provider: z.enum(['openai', 'anthropic', 'google', 'cohere', 'ollama', 'custom']),
  model: z.string().min(1, 'Model is required'),
  capabilities: z.array(z.enum(['text-generation', 'code-generation', 'data-analysis', 'image-generation', 'translation', 'summarization', 'conversation', 'document-analysis'])),
  costPerToken: positiveNumberSchema,
  maxTokens: z.number().int().positive(),
  status: z.enum(['active', 'inactive', 'maintenance']).optional(),
  configuration: z.record(z.any()).optional(),
});

// Budget validation schemas
export const budgetLimitSchema = z.object({
  limitAmount: positiveNumberSchema,
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  alertThreshold: z.number().min(0).max(1, 'Alert threshold must be between 0 and 1'),
});

// Plugin validation schemas
export const pluginSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be in semver format (x.y.z)'),
  author: z.string().min(1).max(100),
  category: z.string().min(1).max(50),
  tags: z.array(z.string().max(30)).max(10),
  configuration: z.record(z.any()).optional(),
});

// Pagination validation schemas
export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const searchSchema = z.object({
  query: z.string().max(200).optional(),
  filters: z.record(z.any()).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

// File upload validation
export const fileUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mimetype: z.string().min(1),
  size: z.number().int().positive().max(10 * 1024 * 1024), // 10MB
});

// Validation utility functions
export function validateEmail(email: string): boolean {
  try {
    emailSchema.parse(email);
    return true;
  } catch {
    return false;
  }
}

export function validatePassword(password: string): boolean {
  try {
    passwordSchema.parse(password);
    return true;
  } catch {
    return false;
  }
}

export function validateUUID(id: string): boolean {
  try {
    uuidSchema.parse(id);
    return true;
  } catch {
    return false;
  }
}

export function getValidationError(error: z.ZodError): string {
  const firstError = error.errors[0];
  return firstError?.message || 'Validation failed';
}

export function formatValidationErrors(error: z.ZodError): Array<{ field: string; message: string; code?: string }> {
  return error.errors.map((err) => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code,
  }));
}

// Schema export for external use
export const schemas = {
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
  uuid: uuidSchema,
  positiveNumber: positiveNumberSchema,
  url: urlSchema,
  login: loginSchema,
  register: registerSchema,
  changePassword: changePasswordSchema,
  resetPassword: resetPasswordSchema,
  resetPasswordConfirm: resetPasswordConfirmSchema,
  userProfile: userProfileSchema,
  userCreate: userCreateSchema,
  userUpdate: userUpdateSchema,
  aiRequest: aiRequestSchema,
  aiAgent: aiAgentSchema,
  budgetLimit: budgetLimitSchema,
  plugin: pluginSchema,
  pagination: paginationSchema,
  search: searchSchema,
  fileUpload: fileUploadSchema,
};
